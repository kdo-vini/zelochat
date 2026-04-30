export interface DeliveryNeighborhood {
  name: string;
  fee: number;
}

export interface DeliveryConfig {
  enabled: boolean;
  neighborhoods: DeliveryNeighborhood[];
}

export interface CatalogCategoriaGroup {
  nome: string;
  subcategorias: { nome: string; produtos: { name: string; price: number; available: boolean }[] }[];
  produtosDireto: { name: string; price: number; available: boolean }[];
}

import { getServiceSupabase } from './supabase.js';

export interface BusinessConfig {
  name: string;
  specialty: string;
  hours: string;
  closedDays: string[];
  address: string;
  pixKey: string;
  products: { name: string; price: number; available: boolean }[];
  catalogHierarchy: CatalogCategoriaGroup[];
  blockedDates: { date: string; reason: string }[];
  dailyContext: { id: string; text: string }[];
  aiInstructions: string;
  managerPhone: string;
  /**
   * Global kill-switch for auto-reply. Tri-state on purpose:
   *   true      — dono confirmed AI is on (DB row hydrated).
   *   false     — dono confirmed AI is off.
   *   undefined — not yet hydrated from DB; kill-switch must treat as off (fail-closed).
   * Always read via `getConfig().aiEnabled === true` to be safe.
   */
  aiEnabled?: boolean;
  /** Allow the AI to proactively reference unconfirmed pending orders in conversation. */
  aiCanReengagePending: boolean;
  deliveryConfig: DeliveryConfig | null;
}

const DEFAULT_CONFIG: BusinessConfig = {
  name: '',
  specialty: '',
  hours: '',
  closedDays: [],
  address: '',
  pixKey: '',
  products: [],
  catalogHierarchy: [],
  blockedDates: [],
  dailyContext: [],
  aiInstructions: '',
  managerPhone: '',
  // aiEnabled intentionally omitted — undefined means "not hydrated yet". Hydration
  // happens via loadAiSettingsFromDb / ensureAiSettingsHydrated. This is the fail-closed
  // posture for the global kill-switch: until we've read the DB, we don't reply.
  aiCanReengagePending: false,
  deliveryConfig: null,
};

// Keyed by empresaId — one config entry per authenticated empresa.
const configMap = new Map<string, BusinessConfig>();

function normalizeBlockedDates(value: unknown): BusinessConfig['blockedDates'] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as { date?: unknown; reason?: unknown };
      const date = typeof row.date === 'string' ? row.date.trim() : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
      const reason = typeof row.reason === 'string' ? row.reason.trim() : '';
      return { date, reason };
    })
    .filter((item): item is { date: string; reason: string } => item !== null);
}

export function getConfig(empresaId: string): BusinessConfig {
  return configMap.get(empresaId) ?? { ...DEFAULT_CONFIG };
}

export function setConfig(empresaId: string, c: Partial<BusinessConfig>): void {
  const existing = configMap.get(empresaId) ?? { ...DEFAULT_CONFIG };
  const patch: Partial<BusinessConfig> = { ...c };
  if ('blockedDates' in patch) {
    if (patch.blockedDates === undefined) {
      delete patch.blockedDates;
    } else {
      patch.blockedDates = normalizeBlockedDates(patch.blockedDates);
    }
  }
  configMap.set(empresaId, { ...existing, ...patch });
}

// Tracks which empresas had their AI settings successfully hydrated from the DB.
// On failure we leave the empresa OUT of this set so the next message retries —
// fail-closed in the meantime (aiEnabled stays undefined → kill-switch treats as off).
const hydratedAiSettings = new Set<string>();

/**
 * Reads AI runtime settings from `empresa_perfil` and merges them into the
 * in-memory config. Idempotent. On DB errors, throws — caller decides whether
 * to swallow (lazy hydration) or propagate (startup hydration).
 *
 * This is the single source of truth for hydrating these flags. Used by:
 *   - POST /api/bind-empresa (frontend boot)
 *   - ensureAiSettingsHydrated (lazy on first webhook message)
 */
export async function loadAiSettingsFromDb(empresaId: string): Promise<void> {
  const { data, error } = await getServiceSupabase()
    .from('empresa_perfil')
    .select('ai_enabled, ai_can_reengage_pending, blocked_dates')
    .eq('id', empresaId)
    .maybeSingle();
  if (error) throw error;
  const row = (data as {
    ai_enabled?: boolean;
    ai_can_reengage_pending?: boolean;
    blocked_dates?: unknown;
  } | null);
  const patch: Partial<BusinessConfig> = {};
  if (typeof row?.ai_enabled === 'boolean') patch.aiEnabled = row.ai_enabled;
  if (typeof row?.ai_can_reengage_pending === 'boolean') patch.aiCanReengagePending = row.ai_can_reengage_pending;
  if (row && 'blocked_dates' in row) patch.blockedDates = normalizeBlockedDates(row.blocked_dates);
  if (Object.keys(patch).length > 0) setConfig(empresaId, patch);
  hydratedAiSettings.add(empresaId);
}

/**
 * Lazy hydration for the webhook hot-path. Skips the DB call if we've already
 * hydrated this empresa in this server lifetime. On DB error, logs and leaves
 * `aiEnabled` undefined — the kill-switch will then keep the AI silent until
 * the next message retries. This is intentional: we'd rather miss a reply than
 * send a reply when the dono asked us to stay quiet.
 */
export async function ensureAiSettingsHydrated(empresaId: string): Promise<void> {
  if (hydratedAiSettings.has(empresaId)) return;
  try {
    await loadAiSettingsFromDb(empresaId);
  } catch (err) {
    console.warn(`[configStore] ai settings hydration failed for ${empresaId} — kill-switch stays fail-closed:`, err);
  }
}
