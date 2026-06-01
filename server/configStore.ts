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
  subcategorias: { nome: string; produtos: CatalogProduct[] }[];
  produtosDireto: CatalogProduct[];
}

import { getServiceSupabase } from './supabase.js';
import {
  DEFAULT_AI_GLOBAL_MODE,
  evaluateAiSchedule,
  isAiGloballyEnabledNow as sharedIsAiGloballyEnabledNow,
  normalizeAiGlobalMode,
  normalizeAiScheduleTime,
  type AiGlobalMode,
} from '../src/domain/aiSchedule.js';
import {
  DEFAULT_PIX_RECEIPT_CONFIG,
  normalizePixReceiptConfig,
  type PixReceiptConfig,
} from '../src/domain/pixReceipt.js';
import {
  DEFAULT_ZELOCHAT_MODE,
  normalizeZeloChatMode,
  type ZeloChatMode,
} from '../src/domain/zelochatMode.js';

export type CatalogProduct = {
  name: string;
  price: number;
  available: boolean;
  unitBased?: boolean;
  stockControlled?: boolean;
  stockQuantity?: number;
};

export interface BusinessConfig {
  name: string;
  specialty: string;
  hours: string;
  openTime: string;
  closeTime: string;
  closedDays: string[];
  /**
   * IANA timezone for this empresa (e.g. 'America/Sao_Paulo', 'America/Manaus',
   * 'America/Rio_Branco'). Used by AI date helpers so the prompt's "agora" and
   * the business-hours checks reflect the empresa's local clock — Brazil spans
   * UTC-2 to UTC-5 across states. Falls back to 'America/Sao_Paulo' when the DB
   * value is missing or invalid.
   */
  timezone: string;
  address: string;
  pixKey: string;
  products: CatalogProduct[];
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
  aiMode?: AiGlobalMode;
  aiScheduleStart: string | null;
  aiScheduleEnd: string | null;
  /** Allow the AI to proactively reference unconfirmed pending orders in conversation. */
  aiCanReengagePending: boolean;
  deliveryConfig: DeliveryConfig | null;
  pixReceiptConfig: PixReceiptConfig;
  zelochatMode: ZeloChatMode;
}

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

const DEFAULT_CONFIG: BusinessConfig = {
  name: '',
  specialty: '',
  hours: '',
  openTime: '',
  closeTime: '',
  closedDays: [],
  timezone: DEFAULT_TIMEZONE,
  address: '',
  pixKey: '',
  products: [],
  catalogHierarchy: [],
  blockedDates: [],
  dailyContext: [],
  aiInstructions: '',
  managerPhone: '',
  aiScheduleStart: null,
  aiScheduleEnd: null,
  // aiEnabled intentionally omitted — undefined means "not hydrated yet". Hydration
  // happens via loadAiSettingsFromDb / ensureAiSettingsHydrated. This is the fail-closed
  // posture for the global kill-switch: until we've read the DB, we don't reply.
  aiCanReengagePending: false,
  deliveryConfig: null,
  pixReceiptConfig: DEFAULT_PIX_RECEIPT_CONFIG,
  zelochatMode: DEFAULT_ZELOCHAT_MODE,
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

function normalizeTime(value: unknown): string {
  if (typeof value !== 'string') return '';
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return '';
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseHoursRange(value: unknown): { openTime: string; closeTime: string } {
  if (typeof value !== 'string') return { openTime: '', closeTime: '' };
  const matches = [...value.matchAll(/(\d{1,2}):(\d{2})/g)];
  return {
    openTime: normalizeTime(matches[0]?.[0] ?? ''),
    closeTime: normalizeTime(matches[1]?.[0] ?? ''),
  };
}

function normalizeClosedDays(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']);
  return value
    .filter((day): day is string => typeof day === 'string' && allowed.has(day));
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isValidIanaTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function normalizeTimezone(value: unknown): string {
  const raw = normalizeText(value);
  if (!raw) return DEFAULT_TIMEZONE;
  return isValidIanaTimezone(raw) ? raw : DEFAULT_TIMEZONE;
}

export function getEmpresaTimezone(empresaId: string): string {
  return getConfig(empresaId).timezone || DEFAULT_TIMEZONE;
}

function normalizeNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeDeliveryConfig(value: unknown): DeliveryConfig | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as { enabled?: unknown; neighborhoods?: unknown };
  const neighborhoods = Array.isArray(row.neighborhoods)
    ? row.neighborhoods
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const n = item as { name?: unknown; fee?: unknown };
        const name = normalizeText(n.name);
        const fee = normalizeNumber(n.fee);
        if (!name || fee < 0) return null;
        return { name, fee };
      })
      .filter((item): item is DeliveryNeighborhood => item !== null)
    : [];
  return { enabled: row.enabled === true, neighborhoods };
}

function normalizeProductRow(row: unknown): (CatalogProduct & {
  idCategoria: number | null;
  idSubcategoria: number | null;
}) | null {
  if (!row || typeof row !== 'object') return null;
  const product = row as {
    nome?: unknown;
    preco?: unknown;
    id_categoria?: unknown;
    id_subcategoria?: unknown;
    eh_item_por_unidade?: unknown;
    ocultar_no_pdv?: unknown;
    controlar_estoque?: unknown;
    estoque_atual?: unknown;
  };
  const name = normalizeText(product.nome);
  if (!name) return null;
  const idCategoria = product.id_categoria == null ? null : normalizeNumber(product.id_categoria);
  const idSubcategoria = product.id_subcategoria == null ? null : normalizeNumber(product.id_subcategoria);
  const stockControlled = product.controlar_estoque === true;
  const stockQuantity = normalizeNumber(product.estoque_atual);
  return {
    name,
    price: normalizeNumber(product.preco),
    available: product.ocultar_no_pdv !== true && (!stockControlled || stockQuantity > 0),
    unitBased: product.eh_item_por_unidade === true,
    stockControlled,
    stockQuantity,
    idCategoria,
    idSubcategoria,
  };
}

function buildCatalogHierarchy(
  categorias: unknown[],
  subcategorias: unknown[],
  produtos: ReturnType<typeof normalizeProductRow>[],
): CatalogCategoriaGroup[] {
  const productRows = produtos.filter((item): item is NonNullable<ReturnType<typeof normalizeProductRow>> => item !== null);
  const subRows = subcategorias
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as { id?: unknown; id_categoria?: unknown; nome?: unknown };
      const nome = normalizeText(row.nome);
      if (!nome) return null;
      return {
        id: normalizeNumber(row.id),
        idCategoria: normalizeNumber(row.id_categoria),
        nome,
      };
    })
    .filter((item): item is { id: number; idCategoria: number; nome: string } => item !== null);

  return categorias
    .map((item): CatalogCategoriaGroup | null => {
      if (!item || typeof item !== 'object') return null;
      const row = item as { id?: unknown; nome?: unknown };
      const id = normalizeNumber(row.id);
      const nome = normalizeText(row.nome);
      if (!nome) return null;
      const productsInCategory = productRows.filter((p) => p.idCategoria === id);
      const subs = subRows
        .filter((sub) => sub.idCategoria === id)
        .map((sub) => ({
          nome: sub.nome,
          produtos: productsInCategory
            .filter((p) => p.idSubcategoria === sub.id)
            .map(({ name, price, available, unitBased, stockControlled, stockQuantity }) => ({
              name,
              price,
              available,
              unitBased,
              stockControlled,
              stockQuantity,
            })),
        }));
      return {
        nome,
        subcategorias: subs,
        produtosDireto: productsInCategory
          .filter((p) => p.idSubcategoria == null)
          .map(({ name, price, available, unitBased, stockControlled, stockQuantity }) => ({
            name,
            price,
            available,
            unitBased,
            stockControlled,
            stockQuantity,
          })),
      };
    })
    .filter((item): item is CatalogCategoriaGroup => item !== null);
}

export function getConfig(empresaId: string): BusinessConfig {
  return configMap.get(empresaId) ?? { ...DEFAULT_CONFIG };
}

export function evaluateGlobalAiState(empresaId: string, now = new Date()) {
  return evaluateAiSchedule(getConfig(empresaId), now);
}

export function isAiGloballyEnabledNow(empresaId: string, now = new Date()): boolean {
  return sharedIsAiGloballyEnabledNow(getConfig(empresaId), now);
}

export function setConfig(empresaId: string, c: Partial<BusinessConfig>): void {
  const existing = configMap.get(empresaId) ?? { ...DEFAULT_CONFIG };
  const patch: Partial<BusinessConfig> = { ...c };
  const parsedHours = parseHoursRange(patch.hours);
  if (!patch.openTime && parsedHours.openTime) patch.openTime = parsedHours.openTime;
  if (!patch.closeTime && parsedHours.closeTime) patch.closeTime = parsedHours.closeTime;
  if ('openTime' in patch) patch.openTime = normalizeTime(patch.openTime);
  if ('closeTime' in patch) patch.closeTime = normalizeTime(patch.closeTime);
  if (patch.openTime && patch.closeTime) patch.hours = `${patch.openTime}–${patch.closeTime}`;
  if ('closedDays' in patch) patch.closedDays = normalizeClosedDays(patch.closedDays);
  if ('aiMode' in patch) {
    patch.aiMode = patch.aiMode === undefined ? undefined : normalizeAiGlobalMode(patch.aiMode) ?? DEFAULT_AI_GLOBAL_MODE;
    if (patch.aiMode === 'always_off') patch.aiEnabled = false;
    if (patch.aiMode === 'always_on' || patch.aiMode === 'scheduled') patch.aiEnabled = true;
  }
  if ('aiScheduleStart' in patch) {
    patch.aiScheduleStart = patch.aiScheduleStart === undefined
      ? existing.aiScheduleStart
      : normalizeAiScheduleTime(patch.aiScheduleStart);
  }
  if ('aiScheduleEnd' in patch) {
    patch.aiScheduleEnd = patch.aiScheduleEnd === undefined
      ? existing.aiScheduleEnd
      : normalizeAiScheduleTime(patch.aiScheduleEnd);
  }
  if ('blockedDates' in patch) {
    if (patch.blockedDates === undefined) {
      delete patch.blockedDates;
    } else {
      patch.blockedDates = normalizeBlockedDates(patch.blockedDates);
    }
  }
  if ('pixReceiptConfig' in patch) {
    if (patch.pixReceiptConfig === undefined) {
      delete patch.pixReceiptConfig;
    } else {
      patch.pixReceiptConfig = normalizePixReceiptConfig(patch.pixReceiptConfig);
    }
  }
  if ('zelochatMode' in patch) {
    patch.zelochatMode = normalizeZeloChatMode(patch.zelochatMode);
  }
  configMap.set(empresaId, { ...existing, ...patch });
}

// Tracks which empresas had their AI settings successfully hydrated from the DB.
// On failure we leave the empresa OUT of this set so the next message retries —
// fail-closed in the meantime (aiEnabled stays undefined → kill-switch treats as off).
const hydratedAiSettings = new Map<string, number>();
const OPERATIONAL_PROFILE_TTL_MS = 5 * 60 * 1000;

/**
 * Reads AI runtime settings from `empresa_perfil` and merges them into the
 * in-memory config. Idempotent. On DB errors, throws — caller decides whether
 * to swallow (lazy hydration) or propagate (startup hydration).
 *
 * This is the single source of truth for hydrating these flags. Used by:
 *   - POST /api/bind-empresa (frontend boot)
 *   - ensureAiSettingsHydrated (lazy on first webhook message)
 */
const LOAD_AI_SETTINGS_TIMEOUT_MS = 3000;

export async function loadAiSettingsFromDb(empresaId: string): Promise<void> {
  const supabase = getServiceSupabase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOAD_AI_SETTINGS_TIMEOUT_MS);
  let data: unknown;
  let error: unknown;
  try {
    let result = await supabase
      .from('empresa_perfil')
      .select('user_id, nome_exibicao, endereco, chave_pix, manager_phone, ai_instructions, delivery_config, pix_receipt_config, ai_enabled, ai_mode, ai_schedule_start, ai_schedule_end, ai_can_reengage_pending, blocked_dates, horario_abertura, horario_fechamento, dias_fechamento, timezone, zelochat_mode')
      .eq('id', empresaId)
      .abortSignal(controller.signal)
      .maybeSingle();
    if (
      result.error?.message?.includes('zelochat_mode')
    ) {
      console.warn('[configStore] zelochat_mode column is not available yet; hydrating with legacy fallback.');
      result = await supabase
        .from('empresa_perfil')
        .select('user_id, nome_exibicao, endereco, chave_pix, manager_phone, ai_instructions, delivery_config, ai_enabled, ai_can_reengage_pending, blocked_dates, horario_abertura, horario_fechamento, dias_fechamento, timezone')
        .eq('id', empresaId)
        .abortSignal(controller.signal)
        .maybeSingle();
    } else if (
      result.error?.message?.includes('pix_receipt_config')
      || result.error?.message?.includes('ai_mode')
      || result.error?.message?.includes('ai_schedule_start')
      || result.error?.message?.includes('ai_schedule_end')
    ) {
      console.warn('[configStore] some optional AI settings columns are not available yet; hydrating with legacy fallback.');
      result = await supabase
        .from('empresa_perfil')
        .select('user_id, nome_exibicao, endereco, chave_pix, manager_phone, ai_instructions, delivery_config, ai_enabled, ai_can_reengage_pending, blocked_dates, horario_abertura, horario_fechamento, dias_fechamento, timezone, zelochat_mode')
        .eq('id', empresaId)
        .abortSignal(controller.signal)
        .maybeSingle();
    }
    data = result.data;
    error = result.error;
  } finally {
    clearTimeout(timer);
  }
  if (error) throw error;
  if (!data) throw new Error(`empresa_perfil not found for ${empresaId}`);
  const row = (data as {
    user_id?: string | null;
    nome_exibicao?: string | null;
    endereco?: string | null;
    chave_pix?: string | null;
    manager_phone?: string | null;
    ai_instructions?: string | null;
    delivery_config?: unknown;
    pix_receipt_config?: unknown;
    ai_enabled?: boolean;
    ai_mode?: string | null;
    ai_schedule_start?: string | null;
    ai_schedule_end?: string | null;
    ai_can_reengage_pending?: boolean;
    blocked_dates?: unknown;
    horario_abertura?: string | null;
    horario_fechamento?: string | null;
    dias_fechamento?: unknown;
    timezone?: string | null;
    zelochat_mode?: string | null;
  });

  const userId = normalizeText(row.user_id);
  if (!userId) throw new Error(`empresa_perfil.user_id missing for ${empresaId}`);

  const [categoriasRes, subcategoriasRes, produtosRes] = await Promise.all([
    supabase
      .from('categorias')
      .select('id, nome, ordem')
      .eq('id_usuario', userId)
      .order('ordem')
      .order('nome'),
    supabase
      .from('subcategorias')
      .select('id, id_categoria, nome, ordem')
      .eq('id_usuario', userId)
      .order('ordem')
      .order('nome'),
    supabase
      .from('produtos')
      .select('id, nome, preco, id_categoria, id_subcategoria, eh_item_por_unidade, ocultar_no_pdv, controlar_estoque, estoque_atual')
      .eq('id_usuario', userId)
      .order('nome'),
  ]);
  if (categoriasRes.error) throw categoriasRes.error;
  if (subcategoriasRes.error) throw subcategoriasRes.error;
  if (produtosRes.error) throw produtosRes.error;

  const productsWithPlacement = (produtosRes.data ?? []).map(normalizeProductRow);
  const products = productsWithPlacement
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .map(({ name, price, available, unitBased, stockControlled, stockQuantity }) => ({
      name,
      price,
      available,
      unitBased,
      stockControlled,
      stockQuantity,
    }));

  const patch: Partial<BusinessConfig> = {};
  patch.name = normalizeText(row.nome_exibicao);
  patch.address = normalizeText(row.endereco);
  patch.pixKey = normalizeText(row.chave_pix);
  patch.managerPhone = normalizeText(row.manager_phone);
  patch.aiInstructions = normalizeText(row.ai_instructions);
  patch.deliveryConfig = normalizeDeliveryConfig(row.delivery_config);
  patch.pixReceiptConfig = normalizePixReceiptConfig(row.pix_receipt_config);
  patch.zelochatMode = normalizeZeloChatMode(row.zelochat_mode);
  patch.products = products;
  patch.catalogHierarchy = buildCatalogHierarchy(
    categoriasRes.data ?? [],
    subcategoriasRes.data ?? [],
    productsWithPlacement,
  );
  patch.aiMode = normalizeAiGlobalMode(row?.ai_mode) ?? DEFAULT_AI_GLOBAL_MODE;
  patch.aiScheduleStart = normalizeAiScheduleTime(row?.ai_schedule_start);
  patch.aiScheduleEnd = normalizeAiScheduleTime(row?.ai_schedule_end);
  if (typeof row?.ai_enabled === 'boolean') {
    patch.aiEnabled = row.ai_enabled;
  } else {
    patch.aiEnabled = patch.aiMode !== 'always_off';
  }
  if (typeof row?.ai_can_reengage_pending === 'boolean') patch.aiCanReengagePending = row.ai_can_reengage_pending;
  if (row && 'blocked_dates' in row) patch.blockedDates = normalizeBlockedDates(row.blocked_dates);
  const openTime = normalizeTime(row?.horario_abertura);
  const closeTime = normalizeTime(row?.horario_fechamento);
  if (openTime) patch.openTime = openTime;
  if (closeTime) patch.closeTime = closeTime;
  if (openTime && closeTime) patch.hours = `${openTime}–${closeTime}`;
  if (row && 'dias_fechamento' in row) patch.closedDays = normalizeClosedDays(row.dias_fechamento);
  patch.timezone = normalizeTimezone(row.timezone);
  setConfig(empresaId, patch);
  hydratedAiSettings.set(empresaId, Date.now());
}

/**
 * Lazy hydration for the webhook hot-path. Skips the DB call if we've already
 * hydrated this empresa in this server lifetime.
 *
 * Failure policy: on DB error, log and clear the cache so the next message
 * retries — but PRESERVE the previously hydrated config (if any). Reasoning:
 *   - If we never hydrated this empresa, config stays at DEFAULT_CONFIG with
 *     `aiEnabled=undefined` and the kill-switch silences correctly (we don't
 *     know what the dono configured).
 *   - If we hydrated successfully earlier this lifetime, the prior values
 *     (aiEnabled, aiMode, …) are still the dono's last expressed intent.
 *     Wiping them on a transient DB error caused production silences for
 *     established empresas (Casa dos Salgados, 2026-05-17): AI mode was
 *     "always_on" in DB, but a transient query failure reset it to
 *     `undefined`, making `isAiGloballyEnabledNow` return false until the
 *     next successful hydration. Customers received no reply during the gap.
 */
export async function ensureAiSettingsHydrated(empresaId: string): Promise<void> {
  const hydratedAt = hydratedAiSettings.get(empresaId);
  if (hydratedAt && Date.now() - hydratedAt < OPERATIONAL_PROFILE_TTL_MS) return;
  try {
    await loadAiSettingsFromDb(empresaId);
  } catch (err) {
    hydratedAiSettings.delete(empresaId);
    console.warn(`[configStore] ai settings hydration failed for ${empresaId} — keeping last-good config:`, err);
  }
}
