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
const CACHE_TTL_MS = 60_000;

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
 */
export async function getEmpresaForInstance(instance: string): Promise<string | null> {
  if (!instance) return null;
  await ensureCache();
  const cached = instanceToEmpresa.get(instance);
  if (cached) return cached;

  try {
    const { data } = await getServiceSupabase()
      .from('empresa_perfil')
      .select('id')
      .eq('whatsmiau_instance', instance)
      .maybeSingle();
    const empresaId = (data as { id?: string } | null)?.id ?? null;
    if (empresaId) {
      empresaToInstance.set(empresaId, instance);
      instanceToEmpresa.set(instance, empresaId);
    }
    return empresaId;
  } catch (err) {
    console.error('[instanceManager] reverse lookup failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Creates a new Whatsmiau instance for an empresa and persists the name on
 * empresa_perfil. Called during signup (P1-01) and from the connect-WhatsApp
 * UI for empresas migrating from the legacy single-tenant setup.
 *
 * Instance name pattern: `zelo-{empresaId-first-8}` — deterministic and easy
 * to recognise in the Whatsmiau dashboard.
 */
export async function createInstance(empresaId: string): Promise<string> {
  const instanceName = `zelo-${empresaId.slice(0, 8)}`;
  await axios.post(
    `${BASE_URL}/evolution/instance/create`,
    { instanceName, qrcode: true, integration: 'WHATSAPP-BAILEYS' },
    { headers: apiHeaders() },
  );
  const { error } = await getServiceSupabase()
    .from('empresa_perfil')
    .update({ whatsmiau_instance: instanceName, updated_at: new Date().toISOString() })
    .eq('id', empresaId);
  if (error) throw new Error(`Failed to persist whatsmiau_instance: ${error.message}`);
  invalidateCache();
  return instanceName;
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
