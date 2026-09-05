import { randomBytes } from 'crypto';
import axios from 'axios';
import { getServiceSupabase } from './supabase.js';

const BASE_URL = (process.env.WHATSMIAU_BASE_URL || 'https://api.whatsmiau.dev').replace(/\/$/, '');
const API_KEY = process.env.WHATSMIAU_API_KEY || '';

// Legacy single-tenant fallback. When an empresa has no whatsmiau_instance
// assigned yet, fall back to this so the beta deploy keeps working unchanged.
// Removed once every empresa has been migrated to its own instance.
const FALLBACK_INSTANCE = process.env.WHATSMIAU_INSTANCE || '';

const empresaToInstance = new Map<string, string>();
const instanceToEmpresa = new Map<string, string>();
let cachedAt = 0;
// Bounded staleness window. Was 60s — reduced to 15s so an out-of-band write
// to `empresa_perfil.whatsmiau_instance` (admin tool, dashboard, migration)
// can poison cross-tenant routing for at most 15s. The webhook reverse lookup
// (`getEmpresaForInstance`) bypasses this cache entirely — it's auth-critical.
const CACHE_TTL_MS = 15_000;

function apiHeaders() {
  return { apikey: API_KEY };
}

async function deleteProviderInstanceExact(instance: string): Promise<void> {
  try {
    await axios.delete(`${BASE_URL}/v2/instance/delete/${instance}`, { timeout: 15_000, headers: apiHeaders() });
  } catch (err: any) {
    const status = err?.response?.status;
    if (status !== 404) throw err;
  }
}

async function refreshCache(): Promise<void> {
  try {
    const { data, error } = await getServiceSupabase()
      .from('empresa_perfil')
      .select('id, whatsmiau_instance')
      .not('whatsmiau_instance', 'is', null);
    if (error) {
      console.error('[instanceManager] cache refresh failed:', error.message);
      return;
    }
    empresaToInstance.clear();
    instanceToEmpresa.clear();
    for (const row of (data ?? []) as { id: string; whatsmiau_instance: string | null }[]) {
      if (!row.whatsmiau_instance) continue;
      empresaToInstance.set(row.id, row.whatsmiau_instance);
      instanceToEmpresa.set(row.whatsmiau_instance, row.id);
    }
    cachedAt = Date.now();
  } catch (err) {
    console.error('[instanceManager] cache refresh threw:', err instanceof Error ? err.message : err);
  }
}

async function ensureCache(): Promise<void> {
  if (Date.now() - cachedAt > CACHE_TTL_MS) {
    await refreshCache();
  }
}

export function invalidateCache(): void {
  cachedAt = 0;
}

/**
 * Selectively evict a single empresa from the cache. Call this after ANY code
 * path that mutates `empresa_perfil.whatsmiau_instance` for that empresa
 * outside of `createInstance`/`deleteInstance` (which already invalidate).
 * Cheaper than `invalidateCache()` because it doesn't force a full DB reload.
 */
export function clearEmpresaCache(empresaId: string): void {
  const inst = empresaToInstance.get(empresaId);
  empresaToInstance.delete(empresaId);
  if (inst) instanceToEmpresa.delete(inst);
}

/**
 * Resolves the Whatsmiau instance name for the given empresa. Falls back to
 * the legacy WHATSMIAU_INSTANCE env var when the empresa has not been assigned
 * one yet — keeps the existing beta deploy working unchanged. Returns an empty
 * string if no instance can be resolved (caller should treat as a hard error).
 */
export async function getInstanceForEmpresa(
  empresaId: string | null | undefined,
): Promise<string> {
  if (!empresaId) return FALLBACK_INSTANCE;
  await ensureCache();
  const cached = empresaToInstance.get(empresaId);
  if (cached) return cached;

  // Cache miss — empresa was created after the last refresh. Hit DB directly
  // and prime the cache so subsequent sends are fast.
  try {
    const { data } = await getServiceSupabase()
      .from('empresa_perfil')
      .select('whatsmiau_instance')
      .eq('id', empresaId)
      .maybeSingle();
    const inst = (data as { whatsmiau_instance?: string | null } | null)?.whatsmiau_instance;
    if (inst) {
      empresaToInstance.set(empresaId, inst);
      instanceToEmpresa.set(inst, empresaId);
      return inst;
    }
  } catch (err) {
    console.error('[instanceManager] direct lookup failed:', err instanceof Error ? err.message : err);
  }

  return FALLBACK_INSTANCE;
}

/**
 * Reverse lookup used by the webhook handler. Resolves empresaId from an
 * instance name embedded in the webhook URL path (`/webhook/:instance`).
 *
 * AUTH-CRITICAL: this is what attributes an inbound message to a tenant. We
 * always hit the DB and only fall back to the cache when the DB query fails
 * — a stale cache here would route messages to the wrong empresa if an
 * instance was reassigned. The hot path is one DB round-trip per inbound
 * webhook event, which is fine (Whatsmiau already round-trips for delivery).
 */
/**
 * P0.1 — fetch both empresa_id and the per-tenant webhook_token in one query.
 * Used by /webhook/:instance to validate the optional `apikey` header sent by
 * Whatsmiau (or whichever upstream we configure to sign webhook calls).
 *
 * Returns null on any failure (no row, DB error, missing token). Webhook handler
 * MUST treat null as "unknown instance, reject 404" — never fall through to
 * "trust the path".
 */
export async function getEmpresaAndTokenForInstance(
  instance: string,
): Promise<{ empresaId: string; webhookToken: string } | null> {
  if (!instance) return null;
  try {
    const { data } = await getServiceSupabase()
      .from('empresa_perfil')
      .select('id, webhook_token')
      .eq('whatsmiau_instance', instance)
      .maybeSingle();
    const row = data as { id?: string; webhook_token?: string } | null;
    if (!row?.id || !row?.webhook_token) return null;
    // Reuse the standard cache-refresh side-effect from getEmpresaForInstance.
    const stale = instanceToEmpresa.get(instance);
    if (stale && stale !== row.id) empresaToInstance.delete(stale);
    empresaToInstance.set(row.id, instance);
    instanceToEmpresa.set(instance, row.id);
    return { empresaId: row.id, webhookToken: row.webhook_token };
  } catch (err) {
    console.error('[instanceManager] empresa+token lookup failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * P0.3 — Legacy lookup, removed. The previous implementation fell back to the
 * in-memory cache when the DB query threw, which meant a single Supabase blip
 * could route an inbound webhook to a STALE empresaId (cross-tenant message
 * leak window of up to 60s — the cache TTL).
 *
 * The webhook path now uses `getEmpresaAndTokenForInstance` exclusively
 * (returns null on any error → handler responds 404 → Whatsmiau retries
 * → eventually DB recovers → message processed once, deduped by
 * `wa_message_id` UNIQUE index from migration 015).
 *
 * Fail-closed > stale cache for an auth boundary. Fail-closed + idempotent
 * retries > everything for THIS auth boundary specifically.
 */

/**
 * Creates a new Whatsmiau instance for an empresa and persists the name on
 * empresa_perfil. Called during signup (P1-01) and from the connect-WhatsApp
 * UI for empresas migrating from the legacy single-tenant setup.
 *
 * Instance name pattern: `zelo-{empresaId-first-8}-{16-hex-random}`
 * The random suffix (64 bits) makes the URL-path webhook unfeasible to enumerate.
 * Existing empresas keep their original name (set in migrations / DB directly)
 * and are NOT renamed automatically — see TODO below.
 *
 * TODO(ops): after sufficient soak time, rotate instance names for empresas
 * that still use the legacy `zelo-{first-8}` pattern (no random suffix).
 * Steps: call deleteInstance → createInstance → re-register webhook via
 * setWebhookForInstance. Schedule during low-traffic window; coordinate with
 * Whatsmiau support if needed.
 */
export async function createInstance(empresaId: string): Promise<string> {
  const instanceName = `zelo-${empresaId.slice(0, 8)}-${randomBytes(8).toString('hex')}`;
  try {
    await axios.post(
      `${BASE_URL}/evolution/instance/create`,
      { instanceName, qrcode: true, integration: 'WHATSAPP-BAILEYS' },
      { timeout: 15_000, headers: apiHeaders() },
    );
  } catch (err: any) {
    // 409 / "already exists" → instance was previously created (e.g. retry path);
    // proceed to persist the name on empresa_perfil so subsequent calls reuse it.
    const status = err?.response?.status;
    const msg = (err?.response?.data?.message ?? err?.message ?? '') as string;
    const alreadyExists = status === 409 || /already.*exists|exists.*already|conflict/i.test(msg);
    if (!alreadyExists) throw err;
  }
  const { data: persisted, error } = await getServiceSupabase()
    .from('empresa_perfil')
    .update({ whatsmiau_instance: instanceName, updated_at: new Date().toISOString() })
    .eq('id', empresaId)
    .is('deletion_purge_token', null)
    .is('deletion_reactivation_token', null)
    .select('id')
    .maybeSingle();
  if (error || !(persisted as { id?: string } | null)?.id) {
    try {
      await deleteProviderInstanceExact(instanceName);
    } catch (cleanupError) {
      const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      throw new Error(`Failed to persist WhatsApp instance and compensate provider creation: ${cleanupMessage}`);
    }
    const reason = error?.message ?? 'account deletion is in progress';
    throw new Error(`Failed to persist whatsmiau_instance: ${reason}`);
  }
  invalidateCache();
  return instanceName;
}

/**
 * P1.6 — Per-empresa in-flight mutex pra createInstance.
 *
 * Sem isso, duas abas do operador abrindo /api/qr simultaneamente faziam:
 *   • Ambas miss cache → ambas miss DB lookup
 *   • Ambas geravam um instanceName diferente (random 16-hex suffix)
 *   • Ambas POSTavam pra Whatsmiau → 2 instâncias criadas
 *   • Ambas UPDATE empresa_perfil — last-write-wins
 *   • A instância "perdedora" fica órfã no Whatsmiau (custo recorrente
 *     sem pointer no DB pra deletar)
 *
 * Solução: in-memory promise map. Segunda chamada concorrente await na
 * promise da primeira em vez de criar nova. Multi-node deploys precisariam
 * de Postgres advisory lock — single-node atual é OK com mutex
 * em memória.
 */
const inFlightInstanceLookups = new Map<string, Promise<string>>();

/**
 * Resolves the empresa's dedicated Whatsmiau instance, creating one on demand
 * if it doesn't have one yet. Multi-tenant safe — NEVER falls back to another
 * empresa's instance (in contrast with `getInstanceForEmpresa` which still
 * returns FALLBACK_INSTANCE for legacy outbound paths). Use this from the
 * public connect-WhatsApp endpoints (/api/qr, /api/qr/refresh, /api/status).
 */
export async function getOrCreateOwnInstanceForEmpresa(empresaId: string): Promise<string> {
  if (!empresaId) throw new Error('empresaId required');

  // P1.6 — se outra request pra essa empresa já está rodando o lookup/create,
  // espera ela em vez de duplicar.
  const inFlight = inFlightInstanceLookups.get(empresaId);
  if (inFlight) return inFlight;

  const promise = (async () => {
    // Destructive account deletion is fenced in the database. This lookup must
    // be fresh even when the instance cache is warm: returning a cached pointer
    // after a purge claim would let QR/connect recreate provider state mid-purge.
    const { data, error: lookupError } = await getServiceSupabase()
      .from('empresa_perfil')
      .select('whatsmiau_instance, deletion_purge_token, deletion_reactivation_token')
      .eq('id', empresaId)
      .maybeSingle();
    if (lookupError) throw new Error(`Failed to resolve dedicated WhatsApp instance: ${lookupError.message}`);

    const row = data as {
      whatsmiau_instance?: string | null;
      deletion_purge_token?: string | null;
      deletion_reactivation_token?: string | null;
    } | null;
    if (row?.deletion_purge_token || row?.deletion_reactivation_token) {
      throw new Error('ACCOUNT_DELETION_IN_PROGRESS');
    }

    const inst = row?.whatsmiau_instance;
    if (inst) {
      empresaToInstance.set(empresaId, inst);
      instanceToEmpresa.set(inst, empresaId);
      return inst;
    }

    // No instance assigned yet — create one. Webhook registration is a follow-up
    // call from the route handler (kept out of this module to avoid a circular
    // import with whatsapp.ts).
    return createInstance(empresaId);
  })();

  inFlightInstanceLookups.set(empresaId, promise);
  try {
    return await promise;
  } finally {
    inFlightInstanceLookups.delete(empresaId);
  }
}

/**
 * Clears the stored instance only if it still matches the value that just
 * failed upstream. This lets /api/qr recover from an out-of-band provider-side
 * deletion without racing a concurrent reconnect that already wrote a new
 * instance.
 */
export async function clearMissingOwnInstanceForEmpresa(
  empresaId: string,
  expectedInstance: string,
): Promise<boolean> {
  if (!empresaId || !expectedInstance) return false;

  const { data, error } = await getServiceSupabase()
    .from('empresa_perfil')
    .update({
      whatsmiau_instance: null,
      whatsmiau_connected: false,
      whatsmiau_phone: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', empresaId)
    .eq('whatsmiau_instance', expectedInstance)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[instanceManager] clearMissingOwnInstanceForEmpresa failed:', error.message);
    return false;
  }

  clearEmpresaCache(empresaId);
  return Boolean((data as { id?: string } | null)?.id);
}

export async function deleteInstance(empresaId: string): Promise<void> {
  const instance = await getInstanceForEmpresa(empresaId);
  if (!instance) return;
  try {
    await axios.delete(`${BASE_URL}/v2/instance/delete/${instance}`, { timeout: 15_000, headers: apiHeaders() });
  } catch (err: any) {
    const status = err?.response?.status;
    // 404 → instance was already deleted upstream; treat as success.
    if (status !== 404) throw err;
  }
  await getServiceSupabase()
    .from('empresa_perfil')
    .update({
      whatsmiau_instance: null,
      whatsmiau_connected: false,
      whatsmiau_phone: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', empresaId);
  invalidateCache();
}

/**
 * Deletes only the instance pointer captured by the database deletion claim.
 *
 * Account deletion must never use `getInstanceForEmpresa`: that resolver keeps a
 * legacy fleet-wide fallback for old outbound paths, and using that fallback in
 * a destructive workflow could delete another tenant's instance. Receiving the
 * claimed pointer also prevents a stale worker from looking up and deleting a
 * newly connected instance after its lease expired. The compare-and-clear is
 * fenced by both pointer and claim token, so a stale worker cannot mutate the
 * row after a successor has reclaimed it.
 */
export async function deleteDedicatedInstance(
  empresaId: string,
  instance: string,
  claimToken: string,
): Promise<void> {
  if (!empresaId) throw new Error('empresaId required');
  if (!instance) throw new Error('dedicated instance required');
  if (!claimToken) throw new Error('account deletion claim token required');

  const supabase = getServiceSupabase();
  await deleteProviderInstanceExact(instance);

  const { data: cleared, error: clearError } = await supabase
    .from('empresa_perfil')
    .update({
      whatsmiau_instance: null,
      whatsmiau_connected: false,
      whatsmiau_phone: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', empresaId)
    .eq('whatsmiau_instance', instance)
    .eq('deletion_purge_token', claimToken)
    .select('id')
    .maybeSingle();
  if (clearError) throw new Error(`Failed to clear dedicated WhatsApp instance: ${clearError.message}`);
  if (!(cleared as { id?: string } | null)?.id) {
    clearEmpresaCache(empresaId);
    throw new Error('Dedicated WhatsApp instance changed during account deletion');
  }

  clearEmpresaCache(empresaId);
}

/**
 * Reads then writes the empresa's WhatsApp connection state.
 * Returns `{ wasConnected }` so the caller can detect real transitions (e.g.
 * connected→disconnected) and suppress duplicate email alerts.
 */
export async function setConnectionState(
  empresaId: string,
  connected: boolean,
  phone?: string | null,
): Promise<{ wasConnected: boolean }> {
  // Read current value first so we can detect transition direction.
  let wasConnected = false;
  try {
    const { data } = await getServiceSupabase()
      .from('empresa_perfil')
      .select('whatsmiau_connected')
      .eq('id', empresaId)
      .maybeSingle();
    wasConnected = (data as { whatsmiau_connected?: boolean } | null)?.whatsmiau_connected ?? false;
  } catch {
    // Non-fatal — proceed with update even if we can't read prior state.
  }

  const patch: Record<string, unknown> = {
    whatsmiau_connected: connected,
    updated_at: new Date().toISOString(),
  };
  if (phone !== undefined) patch.whatsmiau_phone = phone;
  const { error } = await getServiceSupabase()
    .from('empresa_perfil')
    .update(patch)
    .eq('id', empresaId);
  if (error) {
    console.error('[instanceManager] setConnectionState failed:', error.message);
  }

  return { wasConnected };
}
