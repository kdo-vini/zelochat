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

export async function getEmpresaForInstance(instance: string): Promise<string | null> {
  if (!instance) return null;

  try {
    const { data } = await getServiceSupabase()
      .from('empresa_perfil')
      .select('id')
      .eq('whatsmiau_instance', instance)
      .maybeSingle();
    const empresaId = (data as { id?: string } | null)?.id ?? null;
    if (empresaId) {
      // Refresh cache with the verified mapping. If the cached entry pointed
      // at a different empresa, evict that stale binding too so subsequent
      // outbound sends don't keep routing to the wrong instance.
      const stale = instanceToEmpresa.get(instance);
      if (stale && stale !== empresaId) empresaToInstance.delete(stale);
      empresaToInstance.set(empresaId, instance);
      instanceToEmpresa.set(instance, empresaId);
    } else {
      // DB says no empresa owns this instance. Drop any stale cache binding so
      // a future caller doesn't see the old attribution.
      const stale = instanceToEmpresa.get(instance);
      if (stale) {
        empresaToInstance.delete(stale);
        instanceToEmpresa.delete(instance);
      }
    }
    return empresaId;
  } catch (err) {
    console.error('[instanceManager] reverse lookup failed:', err instanceof Error ? err.message : err);
    // DB unreachable — fall back to cache as a soft-degrade. The TTL bound
    // limits how stale this can be.
    await ensureCache().catch(() => {});
    return instanceToEmpresa.get(instance) ?? null;
  }
}

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
      { headers: apiHeaders() },
    );
  } catch (err: any) {
    // 409 / "already exists" → instance was previously created (e.g. retry path);
    // proceed to persist the name on empresa_perfil so subsequent calls reuse it.
    const status = err?.response?.status;
    const msg = (err?.response?.data?.message ?? err?.message ?? '') as string;
    const alreadyExists = status === 409 || /already.*exists|exists.*already|conflict/i.test(msg);
    if (!alreadyExists) throw err;
  }
  const { error } = await getServiceSupabase()
    .from('empresa_perfil')
    .update({ whatsmiau_instance: instanceName, updated_at: new Date().toISOString() })
    .eq('id', empresaId);
  if (error) throw new Error(`Failed to persist whatsmiau_instance: ${error.message}`);
  invalidateCache();
  return instanceName;
}

/**
 * Resolves the empresa's dedicated Whatsmiau instance, creating one on demand
 * if it doesn't have one yet. Multi-tenant safe — NEVER falls back to another
 * empresa's instance (in contrast with `getInstanceForEmpresa` which still
 * returns FALLBACK_INSTANCE for legacy outbound paths). Use this from the
 * public connect-WhatsApp endpoints (/api/qr, /api/qr/refresh, /api/status).
 */
export async function getOrCreateOwnInstanceForEmpresa(empresaId: string): Promise<string> {
  if (!empresaId) throw new Error('empresaId required');
  await ensureCache();
  const cached = empresaToInstance.get(empresaId);
  if (cached) return cached;

  // Cache miss — try direct lookup before paying the create round-trip.
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

  // No instance assigned yet — create one. Webhook registration is a follow-up
  // call from the route handler (kept out of this module to avoid a circular
  // import with whatsapp.ts).
  return createInstance(empresaId);
}

export async function deleteInstance(empresaId: string): Promise<void> {
  const instance = await getInstanceForEmpresa(empresaId);
  if (!instance) return;
  try {
    await axios.delete(`${BASE_URL}/v2/instance/delete/${instance}`, { headers: apiHeaders() });
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
