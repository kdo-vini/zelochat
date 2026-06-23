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
  normalizeAiScheduleDays,
  normalizeAiScheduleTime,
  type AiGlobalMode,
  type AiScheduleDays,
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
import {
  resolveZeloMenuPublicationCatalogProduct,
  type ZeloMenuProductPublication,
} from '../src/domain/zelomenuPublication.js';
import {
  sortModifierGroups,
  type ZeloMenuModifierGroup,
  type ZeloMenuModifierOption,
} from '../src/domain/zelomenuModifiers.js';

export type CatalogProduct = {
  id?: number;
  name: string;
  price: number;
  basePrice?: number;
  available: boolean;
  description?: string | null;
  photoUrl?: string | null;
  sortOrder?: number;
  unitBased?: boolean;
  stockControlled?: boolean;
  stockQuantity?: number;
  modifierGroups?: ZeloMenuModifierGroup[];
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
  /**
   * Per-day AI schedule. When present (non-null), takes precedence over the
   * legacy single-window aiScheduleStart/aiScheduleEnd. Customers who haven't
   * re-saved their schedule from the new UI stay on the legacy fields and
   * keep working through the fallback path in evaluateAiSchedule.
   */
  aiScheduleDays: AiScheduleDays | null;
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
  aiScheduleDays: null,
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

type CatalogProductWithPlacement = CatalogProduct & {
  id: number;
  idCategoria: number | null;
  idSubcategoria: number | null;
  ocultarNoPdv: boolean;
};

function normalizeProductRow(row: unknown): CatalogProductWithPlacement | null {
  if (!row || typeof row !== 'object') return null;
  const product = row as {
    id?: unknown;
    nome?: unknown;
    preco?: unknown;
    id_categoria?: unknown;
    id_subcategoria?: unknown;
    eh_item_por_unidade?: unknown;
    ocultar_no_pdv?: unknown;
    controlar_estoque?: unknown;
    estoque_atual?: unknown;
  };
  const id = normalizeNumber(product.id);
  const name = normalizeText(product.nome);
  if (!id || !name) return null;
  const idCategoria = product.id_categoria == null ? null : normalizeNumber(product.id_categoria);
  const idSubcategoria = product.id_subcategoria == null ? null : normalizeNumber(product.id_subcategoria);
  const ocultarNoPdv = product.ocultar_no_pdv === true;
  const stockControlled = product.controlar_estoque === true;
  const stockQuantity = normalizeNumber(product.estoque_atual);
  return {
    id,
    name,
    price: normalizeNumber(product.preco),
    available: !ocultarNoPdv && (!stockControlled || stockQuantity > 0),
    unitBased: product.eh_item_por_unidade === true,
    stockControlled,
    stockQuantity,
    idCategoria,
    idSubcategoria,
    ocultarNoPdv,
  };
}

function normalizeProductPublicationRow(row: unknown): ZeloMenuProductPublication | null {
  if (!row || typeof row !== 'object') return null;
  const publication = row as {
    id_produto?: unknown;
    nome_publico?: unknown;
    descricao_publica?: unknown;
    foto_url?: unknown;
    visivel_online?: unknown;
    pausado_manualmente?: unknown;
    ordem?: unknown;
  };
  const idProduto = normalizeNumber(publication.id_produto);
  if (!idProduto) return null;
  return {
    id_produto: idProduto,
    nome_publico: normalizeText(publication.nome_publico) || null,
    descricao_publica: normalizeText(publication.descricao_publica) || null,
    foto_url: normalizeText(publication.foto_url) || null,
    visivel_online: publication.visivel_online === true,
    pausado_manualmente: publication.pausado_manualmente === true,
    ordem: Math.max(0, Math.trunc(normalizeNumber(publication.ordem))),
  };
}

function normalizeModifierGroupRow(row: unknown): Omit<ZeloMenuModifierGroup, 'options'> | null {
  if (!row || typeof row !== 'object') return null;
  const group = row as {
    id?: unknown;
    id_produto?: unknown;
    nome?: unknown;
    tipo?: unknown;
    min_selecoes?: unknown;
    max_selecoes?: unknown;
    ativo?: unknown;
    ordem?: unknown;
  };
  const id = normalizeText(group.id);
  const productId = normalizeNumber(group.id_produto);
  const name = normalizeText(group.nome);
  if (!id || !productId || !name) return null;
  return {
    id,
    productId,
    name,
    kind: group.tipo === 'variacao' ? 'variacao' : 'adicional',
    minSelections: Math.max(0, Math.trunc(normalizeNumber(group.min_selecoes))),
    maxSelections: group.max_selecoes == null ? null : Math.max(1, Math.trunc(normalizeNumber(group.max_selecoes))),
    active: group.ativo !== false,
    order: Math.max(0, Math.trunc(normalizeNumber(group.ordem))),
  };
}

function normalizeModifierOptionRow(row: unknown): (ZeloMenuModifierOption & { groupId: string }) | null {
  if (!row || typeof row !== 'object') return null;
  const option = row as {
    id?: unknown;
    id_grupo?: unknown;
    nome?: unknown;
    price_delta?: unknown;
    ativo?: unknown;
    ordem?: unknown;
  };
  const id = normalizeText(option.id);
  const groupId = normalizeText(option.id_grupo);
  const name = normalizeText(option.nome);
  if (!id || !groupId || !name) return null;
  return {
    id,
    groupId,
    name,
    priceDelta: normalizeNumber(option.price_delta),
    active: option.ativo !== false,
    order: Math.max(0, Math.trunc(normalizeNumber(option.ordem))),
  };
}

function applyZeloMenuPublicationOverlay(
  product: CatalogProductWithPlacement,
  publicationsByProductId: Map<number, ZeloMenuProductPublication>,
  modifierGroupsByProductId: Map<number, ZeloMenuModifierGroup[]>,
): CatalogProductWithPlacement {
  const publication = publicationsByProductId.get(product.id) ?? null;
  const resolved = resolveZeloMenuPublicationCatalogProduct({
    id: product.id,
    nome: product.name,
    name: product.name,
    price: product.price,
    id_categoria: product.idCategoria,
    controlar_estoque: product.stockControlled === true,
    estoque_atual: product.stockQuantity ?? 0,
    ocultar_no_pdv: product.ocultarNoPdv,
    unitBased: product.unitBased,
    stockControlled: product.stockControlled,
    stockQuantity: product.stockQuantity,
    publication,
    modifierGroups: modifierGroupsByProductId.get(product.id) ?? [],
  });

  return {
    ...product,
    id: resolved.id,
    name: resolved.name,
    price: resolved.price,
    available: resolved.available,
    description: resolved.description,
    photoUrl: resolved.photoUrl,
    sortOrder: resolved.sortOrder,
    modifierGroups: resolved.modifierGroups,
  };
}

function toPublicCatalogProduct(product: CatalogProductWithPlacement): CatalogProduct {
  return {
    id: product.id,
    name: product.name,
    price: product.price,
    basePrice: product.price,
    available: product.available,
    description: product.description ?? null,
    photoUrl: product.photoUrl ?? null,
    sortOrder: product.sortOrder ?? 0,
    unitBased: product.unitBased,
    stockControlled: product.stockControlled,
    stockQuantity: product.stockQuantity,
    modifierGroups: product.modifierGroups ?? [],
  };
}

function sortCatalogProducts(a: CatalogProductWithPlacement, b: CatalogProductWithPlacement): number {
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name);
}

function buildCatalogHierarchy(
  categorias: unknown[],
  subcategorias: unknown[],
  produtos: Array<CatalogProductWithPlacement | null>,
): CatalogCategoriaGroup[] {
  const productRows = produtos.filter((item): item is CatalogProductWithPlacement => item !== null);
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
            .sort(sortCatalogProducts)
            .map(toPublicCatalogProduct),
        }));
      return {
        nome,
        subcategorias: subs,
        produtosDireto: productsInCategory
          .filter((p) => p.idSubcategoria == null)
          .sort(sortCatalogProducts)
          .map(toPublicCatalogProduct),
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
  if ('aiScheduleDays' in patch) {
    patch.aiScheduleDays = patch.aiScheduleDays === undefined
      ? existing.aiScheduleDays
      : normalizeAiScheduleDays(patch.aiScheduleDays);
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
      .select('user_id, nome_exibicao, endereco, chave_pix, manager_phone, ai_instructions, delivery_config, pix_receipt_config, ai_enabled, ai_mode, ai_schedule_start, ai_schedule_end, ai_schedule_days, ai_can_reengage_pending, blocked_dates, horario_abertura, horario_fechamento, dias_fechamento, timezone, zelochat_mode')
      .eq('id', empresaId)
      .abortSignal(controller.signal)
      .maybeSingle();
    if (result.error?.message?.includes('ai_schedule_days')) {
      console.warn('[configStore] ai_schedule_days column is not available yet; hydrating without per-day schedule.');
      result = await supabase
        .from('empresa_perfil')
        .select('user_id, nome_exibicao, endereco, chave_pix, manager_phone, ai_instructions, delivery_config, pix_receipt_config, ai_enabled, ai_mode, ai_schedule_start, ai_schedule_end, ai_can_reengage_pending, blocked_dates, horario_abertura, horario_fechamento, dias_fechamento, timezone, zelochat_mode')
        .eq('id', empresaId)
        .abortSignal(controller.signal)
        .maybeSingle();
    }
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
    ai_schedule_days?: unknown;
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

  const [categoriasRes, subcategoriasRes, produtosRes, publicationsRes, modifierGroupsRes, modifierOptionsRes] = await Promise.all([
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
    supabase
      .from('zelomenu_product_publications')
      .select('id_produto, nome_publico, descricao_publica, foto_url, visivel_online, pausado_manualmente, ordem')
      .eq('id_usuario', userId)
      .order('ordem')
      .limit(2000),
    supabase
      .from('zelomenu_modifier_groups')
      .select('id, id_produto, nome, tipo, min_selecoes, max_selecoes, ativo, ordem')
      .eq('id_usuario', userId)
      .order('ordem')
      .limit(4000),
    supabase
      .from('zelomenu_modifier_options')
      .select('id, id_grupo, nome, price_delta, ativo, ordem')
      .eq('id_usuario', userId)
      .order('ordem')
      .limit(8000),
  ]);
  if (categoriasRes.error) throw categoriasRes.error;
  if (subcategoriasRes.error) throw subcategoriasRes.error;
  if (produtosRes.error) throw produtosRes.error;
  if (publicationsRes.error) throw publicationsRes.error;
  if (modifierGroupsRes.error) throw modifierGroupsRes.error;
  if (modifierOptionsRes.error) throw modifierOptionsRes.error;

  const publicationsByProductId = new Map<number, ZeloMenuProductPublication>();
  for (const row of publicationsRes.data ?? []) {
    const publication = normalizeProductPublicationRow(row);
    if (publication) publicationsByProductId.set(publication.id_produto, publication);
  }
  const optionsByGroupId = new Map<string, ZeloMenuModifierOption[]>();
  for (const row of modifierOptionsRes.data ?? []) {
    const option = normalizeModifierOptionRow(row);
    if (!option) continue;
    const existing = optionsByGroupId.get(option.groupId) ?? [];
    existing.push({
      id: option.id,
      name: option.name,
      priceDelta: option.priceDelta,
      active: option.active,
      order: option.order,
    });
    optionsByGroupId.set(option.groupId, existing);
  }
  const modifierGroupsByProductId = new Map<number, ZeloMenuModifierGroup[]>();
  for (const row of modifierGroupsRes.data ?? []) {
    const group = normalizeModifierGroupRow(row);
    if (!group) continue;
    const existing = modifierGroupsByProductId.get(group.productId) ?? [];
    existing.push({
      ...group,
      options: optionsByGroupId.get(group.id) ?? [],
    });
    modifierGroupsByProductId.set(group.productId, existing);
  }
  for (const [productId, groups] of modifierGroupsByProductId.entries()) {
    modifierGroupsByProductId.set(productId, sortModifierGroups(groups));
  }
  const productsWithPlacement = (produtosRes.data ?? [])
    .map(normalizeProductRow)
    .map((product) => (
      product
        ? applyZeloMenuPublicationOverlay(product, publicationsByProductId, modifierGroupsByProductId)
        : null
    ));
  const products = productsWithPlacement
    .filter((item): item is CatalogProductWithPlacement => item !== null)
    .sort(sortCatalogProducts)
    .map(toPublicCatalogProduct);

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
  patch.aiScheduleDays = normalizeAiScheduleDays(row?.ai_schedule_days);
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
