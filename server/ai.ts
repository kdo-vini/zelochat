import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions.js';
import { OpenAI } from 'openai';
import { getSession, addAssistantMessage, addToolMessage } from './messageHandler.js';
import { sendTextMessage, sendButtonMessage, sendPresence } from './whatsapp.js';
import { getConfig, ensureAiSettingsHydrated, type CatalogCategoriaGroup } from './configStore.js';
import { getServiceSupabase } from './supabase.js';
import { buildContentForModel, normalizePhoneNumber } from '../src/domain/chat.js';
import { fetchActiveTriggers, type TriggerRecord } from './triggers.js';
import { broadcast } from './ws.js';
import {
  escalateSession,
  recordAiFailure,
  resetAiFailureCounter,
  categorizeReason,
  handoffMessageFor,
  type ReasonCategory,
} from './escalation.js';
import { isBuiltinTriggerId, getBuiltinTrigger } from './builtinTriggers.js';

const OPENAI_MODEL = 'gpt-4o-mini';
const PENDING_ORDER_TTL_MIN = 30;

/**
 * Fast-path cache (key: `${empresaId}:${jid}`) for "this JID had an order confirmed
 * recently". Read+write hot-path optimization; the source of truth is
 * `zelochat_orders.created_at` queried by `wasOrderRecentlyConfirmedInDb` so the
 * guardrail survives server restarts and replica swaps. Without the DB fallback,
 * the post-confirm "Obrigado!" → re-runs criar_pedido bug returns whenever the
 * pod that handled the confirm differs from the pod handling the next message.
 * See P0.11 in CODE_REVIEW.md.
 */
const justConfirmedMap = new Map<string, number>();
const JUST_CONFIRMED_TTL_MS = 5 * 60 * 1000; // 5 min cooldown after confirmation

async function wasOrderRecentlyConfirmedInDb(
  empresaId: string,
  customerPhone: string,
): Promise<boolean> {
  if (!customerPhone) return false;
  const cutoff = new Date(Date.now() - JUST_CONFIRMED_TTL_MS).toISOString();
  try {
    const { data, error } = await getServiceSupabase()
      .from('zelochat_orders')
      .select('id')
      .eq('empresa_id', empresaId)
      .eq('customer_phone', customerPhone)
      .gte('created_at', cutoff)
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error('[AI] wasOrderRecentlyConfirmedInDb query error:', error);
      return false;
    }
    return !!data;
  } catch (err) {
    console.error('[AI] wasOrderRecentlyConfirmedInDb threw:', err);
    return false;
  }
}

/**
 * Pending-order intent whitelist. Used by the soft-confirm/soft-cancel guardrail
 * when a pending order is open and the customer replies with text instead of tapping
 * a button. We accent-strip + lowercase + drop trailing punctuation/emoji, then
 * exact-match against these sets. Anything not in the set falls through to the
 * "ambiguous → edit" path. Keep these conservative — false positives auto-confirm
 * or auto-cancel real orders. False negatives just route to the AI, which is fine.
 */
const AFFIRMATIVE_INTENTS = new Set<string>([
  'sim', 's', 'ss', 'simm',
  'ok', 'okay', 'okk', 'oki',
  'confirmar', 'confirma', 'confirmo', 'confirmado',
  'beleza', 'blz', 'bele',
  'fechado', 'fechou',
  'isso', 'isso ai', 'isso ae',
  'perfeito', 'otimo', 'exato', 'exatamente',
  'certo', 'tudo certo', 'ta certo',
  'pode', 'pode ser', 'pode mandar', 'pode confirmar',
  'manda', 'manda ai', 'manda ae', 'manda ver',
  'vai sim',
  'claro',
  'show', 'dale',
]);

const NEGATIVE_INTENTS = new Set<string>([
  'nao', 'n', 'nn',
  'no', 'nop', 'nope',
  'cancelar', 'cancela', 'cancelo', 'cancelado',
  'desistir', 'desisto', 'desiste',
  'esquece', 'esquecer',
  'para', 'pare', 'parar',
]);

interface PendingOrder {
  empresaId: string;
  jid: string;
  customerName: string;
  customerPhone: string;
  items: { product: string; quantity: number }[];
  pickupDate: string;
  pickupTime: string;
  paymentMethod?: string;
  total: number;
  toolCallId?: string;
  orderType?: 'pickup' | 'delivery';
  deliveryAddress?: string;
  deliveryNeighborhood?: string;
  deliveryFee?: number;
  observations?: string;
}

interface PendingOrderRow {
  empresa_id: string;
  remote_jid: string;
  customer_name: string;
  customer_phone: string | null;
  items: { product: string; quantity: number }[];
  pickup_date: string;
  pickup_time: string;
  payment_method: string | null;
  total: number | string;
  tool_call_id: string | null;
  order_type: string | null;
  delivery_address: string | null;
  delivery_neighborhood: string | null;
  delivery_fee: number | string | null;
  observations: string | null;
}

function rowToPendingOrder(row: PendingOrderRow): PendingOrder {
  return {
    empresaId: row.empresa_id,
    jid: row.remote_jid,
    customerName: row.customer_name,
    customerPhone: row.customer_phone || '',
    items: row.items,
    pickupDate: row.pickup_date,
    pickupTime: row.pickup_time,
    paymentMethod: row.payment_method || undefined,
    total: Number(row.total),
    toolCallId: row.tool_call_id || undefined,
    orderType: (row.order_type === 'delivery' ? 'delivery' : 'pickup') as 'pickup' | 'delivery',
    deliveryAddress: row.delivery_address || undefined,
    deliveryNeighborhood: row.delivery_neighborhood || undefined,
    deliveryFee: row.delivery_fee != null ? Number(row.delivery_fee) : undefined,
    observations: row.observations || undefined,
  };
}

/**
 * Returns the active pending order for this JID, or null if none/expired.
 * Source of truth is Supabase — survives server restarts (review fix C2).
 */
export async function getPendingOrder(jid: string, empresaId: string): Promise<PendingOrder | null> {
  try {
    const { data, error } = await getServiceSupabase()
      .from('zelochat_pending_orders')
      .select('empresa_id, remote_jid, customer_name, customer_phone, items, pickup_date, pickup_time, payment_method, total, tool_call_id, order_type, delivery_address, delivery_neighborhood, delivery_fee, observations')
      .eq('empresa_id', empresaId)
      .eq('remote_jid', jid)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (error) {
      console.error('[AI] getPendingOrder query error:', error);
      return null;
    }
    return data ? rowToPendingOrder(data as PendingOrderRow) : null;
  } catch (err) {
    console.error('[AI] getPendingOrder threw:', err);
    return null;
  }
}

async function setPendingOrder(order: PendingOrder): Promise<void> {
  const expiresAt = new Date(Date.now() + PENDING_ORDER_TTL_MIN * 60 * 1000).toISOString();
  const { error } = await getServiceSupabase()
    .from('zelochat_pending_orders')
    .upsert(
      {
        empresa_id: order.empresaId,
        remote_jid: order.jid,
        customer_name: order.customerName,
        customer_phone: order.customerPhone || null,
        items: order.items,
        pickup_date: order.pickupDate,
        pickup_time: order.pickupTime,
        payment_method: order.paymentMethod || null,
        total: order.total,
        tool_call_id: order.toolCallId || null,
        order_type: order.orderType || 'pickup',
        delivery_address: order.deliveryAddress || null,
        delivery_neighborhood: order.deliveryNeighborhood || null,
        delivery_fee: order.deliveryFee ?? null,
        observations: order.observations || null,
        expires_at: expiresAt,
      },
      { onConflict: 'empresa_id,remote_jid' },
    );
  if (error) throw new Error(`Falha ao salvar pedido pendente: ${error.message}`);
}

export async function clearPendingOrder(jid: string, empresaId: string): Promise<void> {
  await getServiceSupabase()
    .from('zelochat_pending_orders')
    .delete()
    .eq('empresa_id', empresaId)
    .eq('remote_jid', jid);
}

/**
 * 🚨 CRITICAL — order confirmation finalization
 *
 * Persists a pending order to `zelochat_orders`, clears the pending row, sends
 * a confirmation message to the customer, and broadcasts to the operator UI.
 *
 * BUTTERFLY EFFECT — what cascades if you change this function:
 *
 *   1. Operation order is LOAD-BEARING (FIX H1 below): if you swap the
 *      insert/clear order, a DB transient could leave the customer in a
 *      "your order was confirmed but is missing" state.
 *
 *   2. The catch-on-insert path MUST keep the pending row in place. If
 *      you `clearPendingOrder` here on failure, the customer cannot retry
 *      with one tap — they have to repeat the entire AI conversation.
 *
 *   3. `justConfirmedMap.set` at the end + `wasOrderRecentlyConfirmedInDb`
 *      lookup before any future `criar_pedido` is the duplicate-order
 *      guardrail (P0.11). DO NOT drop the map write — and DO NOT add a
 *      `createOrderInDb` call anywhere outside this function and the
 *      AI tool-call path in generateAndSendReply (criar_pedido catch-fallback
 *      explicitly does NOT call this — that's Layer 2 of CLAUDE.md's
 *      3-layer trap).
 *
 *   4. The `addAssistantMessage` call on the success path persists the
 *      reply for chat history. If you remove it, the operator's UI shows
 *      a confirmed order but no record of the confirmation message.
 *
 * Customer-impact failure modes if broken:
 *   • Duplicate orders billed twice (the documented bug that cost 2 days)
 *   • Customer thinks order was confirmed but it wasn't persisted
 *   • Customer sees "✅ Pedido confirmado!" but pending row never cleared
 *   • Operator UI never shows the new order (broadcast lost)
 *
 * Always test the full webhook → AI → confirm chain after touching this.
 */
export async function confirmPendingOrder(jid: string, empresaId: string): Promise<void> {
  console.log('[AI] confirmPendingOrder called for JID:', jid);
  const pending = await getPendingOrder(jid, empresaId);
  if (!pending) {
    console.warn('[AI] confirmPendingOrder: No pending order found for JID:', jid);
    return;
  }

  // FIX H1: insert FIRST, delete only on success. If the insert fails the pending row
  // stays in place and the customer can click Confirmar again without re-entering data.
  let orderId: string;
  try {
    orderId = await createOrderInDb(pending.empresaId, pending);
  } catch (err) {
    console.error('[AI] Failed to insert order, keeping pending row:', err);
    // P1.23 — antes a mensagem dizia "Toque em ✅ Confirmar de novo" mas o
    // botão original já foi consumido pelo WhatsApp (não dá pra clicar duas
    // vezes no mesmo botão). Customer ficava preso. Agora pede pra responder
    // *Sim* — o soft-confirm em router.ts pega esse texto e roda
    // confirmPendingOrder de novo (a pending row continua intacta porque
    // FIX H1 só limpa em sucesso).
    const errMsg = 'Desculpe, tive um problema momentâneo. Pode responder *Sim* pra eu tentar confirmar de novo? 🙏';
    await sendTextMessage(jid, errMsg, pending.empresaId);
    await addAssistantMessage(jid, errMsg, undefined, pending.empresaId);
    return;
  }

  await clearPendingOrder(jid, pending.empresaId);

  const shortId = orderId.slice(0, 8).toUpperCase();
  const itemsList = pending.items.map((i) => `${i.quantity}x ${i.product}`).join(', ');
  const cfg = getConfig(pending.empresaId);
  const isDelivery = pending.orderType === 'delivery';
  const scheduleLabel = isDelivery ? '🛵 Entrega' : '📅 Retirada';
  const deliveryLine = isDelivery && pending.deliveryAddress
    ? `\n📍 ${pending.deliveryAddress}\n🏘️ Taxa${pending.deliveryNeighborhood ? ` (${pending.deliveryNeighborhood})` : ''}: R$ ${(pending.deliveryFee ?? 0).toFixed(2)}`
    : '';
  const dateBR = isoToDisplayBR(pending.pickupDate) || pending.pickupDate;
  const obsLine = pending.observations ? `\n📝 Obs: ${pending.observations}` : '';
  const reply = `✅ Pedido confirmado! Número: *#${shortId}*\n\n📦 ${itemsList}${deliveryLine}${obsLine}\n${scheduleLabel}: ${dateBR} às ${pending.pickupTime}\n💳 Pagamento: ${pending.paymentMethod || 'Não informado'}\n💰 Total: R$ ${pending.total.toFixed(2)}\n\nPagamento via Pix: *${cfg.pixKey || 'consulte a loja'}*\n\nQualquer dúvida é só chamar! 😊`;

  // P1.10 — send-failure detection. Antes, se sendTextMessage throws aqui
  // (Whatsmiau 5xx, network blip), a exceção propagava e o operador via
  // o pedido criado mas não sabia que o cliente NUNCA recebeu a confirmação.
  // Customer pensava "será que meu pedido foi?" e ligava reclamando.
  //
  // Agora: persiste a tentativa com prefixo [FALHA NO ENVIO] caso o send
  // falhe. Operador vê no chat history "tentei mandar isso mas falhou —
  // me deixa retentar manualmente". Pedido continua válido (createOrderInDb
  // já rolou). justConfirmedMap também é setado pra evitar que o próximo
  // "obrigado" do cliente vire criar_pedido novamente.
  let sendOk = true;
  try {
    await sendTextMessage(jid, reply, pending.empresaId);
  } catch (sendErr) {
    sendOk = false;
    console.error('[AI] confirmPendingOrder: send to customer FAILED — order is in DB but customer was not notified:', sendErr);
  }
  const persistedReply = sendOk ? reply : `[FALHA NO ENVIO — reenviar manualmente]\n${reply}`;
  await addAssistantMessage(jid, persistedReply, undefined, pending.empresaId);

  broadcast(
    { type: 'order_created', data: { orderId, empresaId: pending.empresaId } },
    pending.empresaId,
  );
  // Mark this JID so generateAndSendReply blocks any accidental criar_pedido for 5 min.
  justConfirmedMap.set(`${pending.empresaId}:${jid}`, Date.now());
  console.log(`[AI] Confirmed pending order #${shortId} for ${jid} (send=${sendOk ? 'ok' : 'FAILED'})`);
}

export async function cancelPendingOrder(jid: string, empresaId: string): Promise<void> {
  await clearPendingOrder(jid, empresaId);
  const reply = 'Tudo bem! Pedido cancelado. Se quiser fazer outro, é só me chamar 😊';
  // P1.10 — same try/catch pattern as confirmPendingOrder. Cancelar é menos
  // crítico (sem efeito colateral em zelochat_orders), mas se o customer não
  // receber a mensagem ele continua mandando "não" e a IA pode ficar em loop
  // de "Tudo bem! Pedido cancelado." invisível. Persistir com marker permite
  // o operador detectar o problema rapidamente.
  let sendOk = true;
  try {
    await sendTextMessage(jid, reply, empresaId);
  } catch (sendErr) {
    sendOk = false;
    console.error('[AI] cancelPendingOrder: send to customer FAILED:', sendErr);
  }
  const persistedReply = sendOk ? reply : `[FALHA NO ENVIO — reenviar manualmente]\n${reply}`;
  await addAssistantMessage(jid, persistedReply, undefined, empresaId);
}

/**
 * Strips characters that could turn user-controlled text into a prompt-injection
 * vector when interpolated into the system prompt (review fix H2).
 * Apply at every boundary where customer/operator input gets concatenated into
 * model-visible strings: customer_name, items[].product, phone, free-text reasons.
 */
function safeForPrompt(value: unknown, maxLen = 200): string {
  return String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[`<>]/g, '')
    .slice(0, maxLen);
}

/**
 * Brazil-timezone date helpers (review fix H5). Hoisted to module scope so any
 * function that needs "today" / "tomorrow" in BRT does not accidentally use UTC.
 */
function toIsoBrazil(d: Date): string {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value ?? '';
  const mo = parts.find((p) => p.type === 'month')?.value ?? '';
  const dy = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${y}-${mo}-${dy}`;
}

/** Converts a YYYY-MM-DD string to Brazilian display format DD/MM/YYYY. */
function isoToDisplayBR(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  if (!y || !m || !d) return isoDate;
  return `${d}/${m}/${y}`;
}

function dayLabelBrazil(d: Date): string {
  const dow = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', weekday: 'short',
  }).format(d).toLowerCase().replace(/\./g, '');
  const map: Record<string, string> = {
    'dom': 'Dom', 'seg': 'Seg', 'ter': 'Ter', 'qua': 'Qua',
    'qui': 'Qui', 'sex': 'Sex', 'sáb': 'Sáb',
  };
  return map[dow] ?? dow;
}

const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTH_BY_NAME: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

const WEEKDAY_BY_NAME: Record<string, number> = {
  domingo: 0,
  'segunda feira': 1,
  segunda: 1,
  'terca feira': 2,
  terca: 2,
  'quarta feira': 3,
  quarta: 3,
  'quinta feira': 4,
  quinta: 4,
  'sexta feira': 5,
  sexta: 5,
  sabado: 6,
};

function normalizeDateText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(/[ºª]/g, '')
    .replace(/[-_]+/g, ' ');
}

function datePartsToIso(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 2020 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const utc = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalizeIsoDateInput(value: string): string | null {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  return datePartsToIso(Number(match[1]), Number(match[2]), Number(match[3]));
}

function normalizeCustomerYear(year: string | undefined, fallbackYear: number): number {
  if (!year) return fallbackYear;
  const parsed = Number(year);
  if (year.length === 2) return 2000 + parsed;
  return parsed;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectRequestedDateIsos(text: string, now = new Date()): string[] {
  const isos = new Set<string>();
  const addIso = (iso: string | null) => {
    if (iso) isos.add(iso);
  };

  const todayIso = toIsoBrazil(now);
  const currentYear = Number(todayIso.slice(0, 4));
  const raw = text.toLowerCase();

  let match: RegExpExecArray | null;
  const isoRe = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g;
  while ((match = isoRe.exec(raw)) !== null) {
    addIso(datePartsToIso(Number(match[1]), Number(match[2]), Number(match[3])));
  }

  const slashRe = /\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/g;
  while ((match = slashRe.exec(raw)) !== null) {
    const year = normalizeCustomerYear(match[3], currentYear);
    addIso(datePartsToIso(year, Number(match[2]), Number(match[1])));
  }

  const normalized = normalizeDateText(text);
  const monthNames = Object.keys(MONTH_BY_NAME).map(escapeRegExp).join('|');
  const monthNameRe = new RegExp(`\\b(\\d{1,2})\\s*(?:de\\s+)?(${monthNames})(?:\\s*(?:de\\s*)?(\\d{2,4}))?\\b`, 'g');
  while ((match = monthNameRe.exec(normalized)) !== null) {
    const day = Number(match[1]);
    const month = MONTH_BY_NAME[match[2]];
    const year = normalizeCustomerYear(match[3], currentYear);
    addIso(datePartsToIso(year, month, day));
  }

  if (/\bhoje\b/.test(normalized)) {
    addIso(todayIso);
  }

  const hasAfterTomorrow = /\bdepois\s+de\s+amanha\b/.test(normalized);
  if (hasAfterTomorrow) {
    addIso(toIsoBrazil(new Date(now.getTime() + 2 * 86400000)));
  }
  const withoutAfterTomorrow = normalized.replace(/\bdepois\s+de\s+amanha\b/g, '');
  if (/\bamanha\b/.test(withoutAfterTomorrow)) {
    addIso(toIsoBrazil(new Date(now.getTime() + 86400000)));
  }

  const wordText = normalized.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const currentWeekday = DAY_LABELS.indexOf(dayLabelBrazil(now));
  if (currentWeekday >= 0) {
    const targetWeekdays = new Set<number>();
    for (const alias of Object.keys(WEEKDAY_BY_NAME).sort((a, b) => b.length - a.length)) {
      const aliasRe = new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'u');
      if (aliasRe.test(wordText)) targetWeekdays.add(WEEKDAY_BY_NAME[alias]);
    }
    for (const targetWeekday of targetWeekdays) {
      const deltaDays = (targetWeekday - currentWeekday + 7) % 7;
      addIso(toIsoBrazil(new Date(now.getTime() + deltaDays * 86400000)));
    }
  }

  return [...isos];
}

function hasSchedulingIntentForBlockedDate(text: string, dateCount: number): boolean {
  if (dateCount === 0) return false;
  const normalized = normalizeDateText(text)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized.length <= 40) return true;
  return /\b(pedido|pedir|pede|quero|queria|preciso|encomenda|encomendar|agendar|agenda|reservar|reserva|retirada|retirar|buscar|entrega|entregar|delivery|para|pra|pro|pode ser|seria|dia|data|horario|hora|cento|salgado|salgados|doce|doces|bolo|bolos|kit|kits)\b/u.test(normalized);
}

function getBlockedDates(empresaId: string): { date: string; reason: string }[] {
  const dates = getConfig(empresaId).blockedDates;
  return Array.isArray(dates) ? dates : [];
}

function findBlockedDateFromCustomerText(
  empresaId: string,
  text: string,
): { date: string; reason: string } | null {
  const requestedDates = collectRequestedDateIsos(text);
  if (!hasSchedulingIntentForBlockedDate(text, requestedDates.length)) return null;
  const blockedDates = getBlockedDates(empresaId);
  return requestedDates
    .map((iso) => blockedDates.find((blocked) => blocked.date === iso) ?? null)
    .find((blocked): blocked is { date: string; reason: string } => blocked !== null) ?? null;
}

function getBlockedDateByIso(empresaId: string, isoDate: string): { date: string; reason: string } | null {
  return getBlockedDates(empresaId).find((blocked) => blocked.date === isoDate) ?? null;
}

function isoToShortDisplayBR(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  if (!year || !month || !day) return isoDate;
  return `${day}/${month}`;
}

function buildBlockedDateReply(blockedDate: { date: string; reason: string }): string {
  const dateLabel = isoToShortDisplayBR(blockedDate.date);
  const reason = safeForPrompt(blockedDate.reason, 120);
  const reasonText = reason ? ` porque é ${reason}` : ' porque essa data está bloqueada';
  return `Para ${dateLabel} não estamos aceitando encomendas${reasonText}. Posso te ajudar a escolher outro dia, antecipar para antes, deixar para depois ou chamar um atendente.`;
}

async function sendBlockedDateReply(
  jid: string,
  empresaId: string,
  blockedDate: { date: string; reason: string },
): Promise<string> {
  const reply = buildBlockedDateReply(blockedDate);
  await sendTextMessage(jid, reply, empresaId);
  await addAssistantMessage(jid, reply, undefined, empresaId);
  return reply;
}

interface OperatingWindow {
  openMinutes: number;
  closeMinutes: number;
  openLabel: string;
  closeLabel: string;
}

interface BusinessHoursIssue {
  date: string;
  timeMinutes?: number;
  kind: 'before_open' | 'after_close' | 'currently_closed' | 'closed_day' | 'past_time';
  window: OperatingWindow | null;
  dayLabel: string;
  nowMinutes?: number;
}

function parseTimeToMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().toLowerCase().match(/^(\d{1,2})(?:(?::|h)(\d{2}))?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function minutesToDisplay(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function getBrazilTimeParts(d: Date): { hour: number; minute: number; label: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const normalizedHour = hour === 24 ? 0 : hour;
  return {
    hour: normalizedHour,
    minute,
    label: `${String(normalizedHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    minutes: normalizedHour * 60 + minute,
  };
}

function getOperatingWindow(empresaId: string): OperatingWindow | null {
  const cfg = getConfig(empresaId);
  let open = parseTimeToMinutes((cfg as typeof cfg & { openTime?: string }).openTime);
  let close = parseTimeToMinutes((cfg as typeof cfg & { closeTime?: string }).closeTime);

  if (open === null || close === null) {
    const matches = [...String(cfg.hours || '').matchAll(/(\d{1,2}):(\d{2})/g)];
    open = open ?? parseTimeToMinutes(matches[0]?.[0]);
    close = close ?? parseTimeToMinutes(matches[1]?.[0]);
  }

  if (open === null || close === null) return null;
  return {
    openMinutes: open,
    closeMinutes: close,
    openLabel: minutesToDisplay(open),
    closeLabel: minutesToDisplay(close),
  };
}

function isWithinOperatingWindow(minutes: number, window: OperatingWindow): boolean {
  if (window.openMinutes <= window.closeMinutes) {
    return minutes >= window.openMinutes && minutes <= window.closeMinutes;
  }
  return minutes >= window.openMinutes || minutes <= window.closeMinutes;
}

function isPastSameDaySchedule(isoDate: string, timeMinutes: number, now = new Date()): boolean {
  return isoDate === toIsoBrazil(now) && timeMinutes <= getBrazilTimeParts(now).minutes;
}

function collectRequestedTimeMinutes(text: string): number[] {
  const times = new Set<number>();
  const addTime = (hourRaw: string | undefined, minuteRaw: string | undefined) => {
    if (!hourRaw) return;
    const hour = Number(hourRaw);
    const minute = minuteRaw ? Number(minuteRaw) : 0;
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return;
    times.add(hour * 60 + minute);
  };

  const normalized = normalizeDateText(text);
  let match: RegExpExecArray | null;

  const colonRe = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g;
  while ((match = colonRe.exec(normalized)) !== null) {
    addTime(match[1], match[2]);
  }

  const compactHourRe = /\b([01]?\d|2[0-3])h([0-5]\d)\b/g;
  while ((match = compactHourRe.exec(normalized)) !== null) {
    addTime(match[1], match[2]);
  }

  const hourMarkerRe = /\b([01]?\d|2[0-3])\s*(?:h|hs|hrs|horas)\b/g;
  while ((match = hourMarkerRe.exec(normalized)) !== null) {
    addTime(match[1], undefined);
  }

  const dayPeriodRe = /\b(1[0-2]|0?[1-9])\s+(?:da\s+)?(manha|tarde|noite)\b/g;
  while ((match = dayPeriodRe.exec(normalized)) !== null) {
    let hour = Number(match[1]);
    const period = match[2];
    if (period === 'tarde' && hour < 12) hour += 12;
    if (period === 'noite' && hour < 12) hour += 12;
    addTime(String(hour), undefined);
  }

  if (/\bmeio\s+dia\b/.test(normalized)) addTime('12', undefined);

  const prepositionRe = /\b(?:as|a)\s+([01]?\d|2[0-3])(?:[:h]([0-5]\d))?\b/g;
  while ((match = prepositionRe.exec(normalized)) !== null) {
    addTime(match[1], match[2]);
  }

  return [...times];
}

function hasOrderIntent(text: string): boolean {
  const normalized = normalizeDateText(text)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return false;
  return /\b(pedido|pedir|pede|quero|queria|preciso|encomenda|encomendar|agendar|agenda|reservar|reserva|retirada|retirar|buscar|entrega|entregar|delivery|para|pra|pro|pode ser|seria|dia|data|horario|hora|cento|salgado|salgados|doce|doces|bolo|bolos|kit|kits)\b/u.test(normalized);
}

function hasImmediateOrderIntent(text: string): boolean {
  const normalized = normalizeDateText(text)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return false;
  return /\b(fazer pedido|fazer um pedido|pedido|pedir|pede|encomenda|encomendar|agendar|agenda|reservar|reserva|retirada|retirar|buscar|entrega|entregar|delivery|cento|salgado|salgados|doce|doces|bolo|bolos|kit|kits)\b/u.test(normalized);
}

function hasScheduleContextIntent(text: string): boolean {
  const normalized = normalizeDateText(text)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return false;
  return /\b(pedido|pediu|pedir|pede|quero|queria|preciso|encomenda|encomendar|agendar|agenda|agendado|reservar|reserva|retirada|retirar|buscar|entrega|entregar|delivery|para|pra|pro|seria|dia|data|horario|hora|cento|salgado|salgados|doce|doces|bolo|bolos|kit|kits)\b/u.test(normalized);
}

function getDayLabelFromIso(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  if (!year || !month || !day) return '';
  return dayLabelBrazil(new Date(Date.UTC(year, month - 1, day, 12)));
}

function findBusinessHoursIssueForSchedule(
  empresaId: string,
  pickupDate: string,
  pickupTime?: string,
  now = new Date(),
): BusinessHoursIssue | null {
  const cfg = getConfig(empresaId);
  const dayLabel = getDayLabelFromIso(pickupDate);
  if (dayLabel && cfg.closedDays.includes(dayLabel)) {
    return { date: pickupDate, kind: 'closed_day', window: getOperatingWindow(empresaId), dayLabel };
  }

  const window = getOperatingWindow(empresaId);
  const timeMinutes = parseTimeToMinutes(pickupTime);
  if (!window || timeMinutes === null) return null;
  if (isPastSameDaySchedule(pickupDate, timeMinutes, now)) {
    return {
      date: pickupDate,
      timeMinutes,
      kind: 'past_time',
      window,
      dayLabel,
      nowMinutes: getBrazilTimeParts(now).minutes,
    };
  }
  if (isWithinOperatingWindow(timeMinutes, window)) return null;

  return {
    date: pickupDate,
    timeMinutes,
    kind: timeMinutes < window.openMinutes ? 'before_open' : 'after_close',
    window,
    dayLabel,
  };
}

function findBusinessHoursIssueFromCustomerText(
  empresaId: string,
  text: string,
  now = new Date(),
  options: { checkCurrentMoment?: boolean } = {},
): BusinessHoursIssue | null {
  const window = getOperatingWindow(empresaId);
  const cfg = getConfig(empresaId);
  const todayIso = toIsoBrazil(now);
  const todayLabel = dayLabelBrazil(now);
  const requestedDates = collectRequestedDateIsos(text, now);
  const requestedTimes = collectRequestedTimeMinutes(text);
  const hasIntent = hasOrderIntent(text);
  const nowBr = getBrazilTimeParts(now);
  if (!hasIntent && requestedTimes.length === 0) return null;

  if (requestedTimes.length > 0) {
    const datesForTimeCheck = requestedDates.length > 0
      ? requestedDates
      : options.checkCurrentMoment !== false
        ? [todayIso]
        : [];
    for (const date of datesForTimeCheck) {
      const dayLabel = getDayLabelFromIso(date);
      if (dayLabel && cfg.closedDays.includes(dayLabel)) {
        return { date, timeMinutes: requestedTimes[0], kind: 'closed_day', window, dayLabel };
      }
      if (!window) continue;
      for (const timeMinutes of requestedTimes) {
        if (isPastSameDaySchedule(date, timeMinutes, now)) {
          return {
            date,
            timeMinutes,
            kind: 'past_time',
            window,
            dayLabel,
            nowMinutes: nowBr.minutes,
          };
        }
        if (!isWithinOperatingWindow(timeMinutes, window)) {
          return {
            date,
            timeMinutes,
            kind: timeMinutes < window.openMinutes ? 'before_open' : 'after_close',
            window,
            dayLabel,
          };
        }
      }
    }
  }

  const shouldCheckCurrentMoment =
    options.checkCurrentMoment !== false &&
    requestedTimes.length === 0 &&
    hasImmediateOrderIntent(text) &&
    (requestedDates.length === 0 || requestedDates.includes(todayIso));
  if (shouldCheckCurrentMoment) {
    if (cfg.closedDays.includes(todayLabel)) {
      return { date: todayIso, kind: 'closed_day', window, dayLabel: todayLabel };
    }
    if (window) {
      if (!isWithinOperatingWindow(nowBr.minutes, window)) {
        return {
          date: todayIso,
          timeMinutes: nowBr.minutes,
          kind: 'currently_closed',
          window,
          dayLabel: todayLabel,
        };
      }
    }
  }

  return null;
}

type ScheduleContextGuard =
  | { type: 'blocked_date'; blockedDate: { date: string; reason: string } }
  | { type: 'business_hours'; issue: BusinessHoursIssue }
  | { type: 'valid_schedule' };

function evaluateScheduleContextText(
  empresaId: string,
  text: string,
  now = new Date(),
): ScheduleContextGuard | null {
  const requestedDates = collectRequestedDateIsos(text, now);
  const requestedTimes = collectRequestedTimeMinutes(text);
  if (requestedDates.length === 0) return null;

  const hasContext = hasScheduleContextIntent(text);
  if (!hasContext && requestedTimes.length === 0) return null;

  let sawUsableSchedule = false;
  for (const date of requestedDates) {
    const blockedDate = getBlockedDateByIso(empresaId, date);
    if (blockedDate) return { type: 'blocked_date', blockedDate };

    if (requestedTimes.length === 0) {
      const closedIssue = findBusinessHoursIssueForSchedule(empresaId, date, undefined, now);
      if (closedIssue) return { type: 'business_hours', issue: closedIssue };
      if (date === toIsoBrazil(now)) {
        const window = getOperatingWindow(empresaId);
        const nowBr = getBrazilTimeParts(now);
        if (window && !isWithinOperatingWindow(nowBr.minutes, window)) {
          return {
            type: 'business_hours',
            issue: {
              date,
              timeMinutes: nowBr.minutes,
              kind: 'currently_closed',
              window,
              dayLabel: getDayLabelFromIso(date),
            },
          };
        }
      }
      sawUsableSchedule = true;
      continue;
    }

    for (const timeMinutes of requestedTimes) {
      const issue = findBusinessHoursIssueForSchedule(
        empresaId,
        date,
        minutesToDisplay(timeMinutes),
        now,
      );
      if (issue) return { type: 'business_hours', issue };
      sawUsableSchedule = true;
    }
  }

  return sawUsableSchedule ? { type: 'valid_schedule' } : null;
}

function isScheduleGuardReply(text: string): boolean {
  const normalized = normalizeDateText(text)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (
    normalized.includes('nao estamos aceitando') ||
    normalized.includes('fora do horario de atendimento') ||
    normalized.includes('horario ja passou') ||
    normalized.includes('data esta bloqueada') ||
    normalized.includes('dia de fechamento')
  );
}

function findRecentScheduleContextGuard(
  empresaId: string,
  messages: { role: string; content: string | null; preview: string; kind: string; audio_transcript?: string | null; audio_transcript_status?: string | null }[],
  now = new Date(),
): ScheduleContextGuard | null {
  const recent = messages.slice(-12);
  let start = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    const msg = recent[i];
    if (msg.role !== 'assistant') continue;
    const text = buildContentForModel(msg as any) || msg.preview || '';
    if (isScheduleGuardReply(text)) {
      start = i + 1;
      break;
    }
  }

  for (let i = recent.length - 1; i >= start; i--) {
    const msg = recent[i];
    const text = buildContentForModel(msg as any) || msg.preview || '';
    if (!text) continue;
    const result = evaluateScheduleContextText(empresaId, text, now);
    if (result) return result;
  }

  return null;
}

export const __aiScheduleGuardsForTests = {
  collectRequestedDateIsos,
  collectRequestedTimeMinutes,
  findBlockedDateFromCustomerText,
  findBusinessHoursIssueFromCustomerText,
  findBusinessHoursIssueForSchedule,
  findRecentScheduleContextGuard,
};

function buildBusinessHoursReply(issue: BusinessHoursIssue): string {
  const dateLabel = issue.date === toIsoBrazil(new Date())
    ? 'hoje'
    : isoToDisplayBR(issue.date);
  const windowText = issue.window
    ? `O atendimento funciona das ${issue.window.openLabel} às ${issue.window.closeLabel}.`
    : 'Esse dia está marcado como fechado.';

  if (issue.kind === 'closed_day') {
    const day = issue.dayLabel || 'esse dia';
    return `Para ${dateLabel}, não estamos aceitando pedidos porque ${day} é dia de fechamento. Posso te ajudar a escolher outro dia, antecipar para antes, deixar para depois ou chamar um atendente.`;
  }

  if (issue.kind === 'currently_closed') {
    const timeText = issue.timeMinutes !== undefined ? ` Agora são ${minutesToDisplay(issue.timeMinutes)}.` : '';
    return `Hoje já estamos fora do horário de atendimento.${timeText} ${windowText} Posso te ajudar a agendar para outro horário dentro desse período, escolher outro dia ou chamar um atendente.`;
  }

  if (issue.kind === 'past_time') {
    const requestedTime = issue.timeMinutes !== undefined ? minutesToDisplay(issue.timeMinutes) : 'esse horário';
    const nowText = issue.nowMinutes !== undefined ? ` Agora são ${minutesToDisplay(issue.nowMinutes)}.` : '';
    return `Esse horário já passou hoje: ${requestedTime}.${nowText} ${windowText} Posso te ajudar a escolher um horário futuro dentro do atendimento, outro dia ou chamar um atendente.`;
  }

  const requestedTime = issue.timeMinutes !== undefined ? ` às ${minutesToDisplay(issue.timeMinutes)}` : '';
  return `Para ${dateLabel}${requestedTime}, não estamos aceitando pedidos fora do horário de atendimento. ${windowText} Posso te ajudar a escolher outro horário dentro desse período, outro dia ou chamar um atendente.`;
}

async function sendBusinessHoursReply(
  jid: string,
  empresaId: string,
  issue: BusinessHoursIssue,
): Promise<string> {
  const reply = buildBusinessHoursReply(issue);
  await sendTextMessage(jid, reply, empresaId);
  await addAssistantMessage(jid, reply, undefined, empresaId);
  return reply;
}

let ai: OpenAI | null = null;

export function getAI(): OpenAI {
  if (!ai) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY not set');
    ai = new OpenAI({ apiKey: key });
  }
  return ai;
}

function getAvailableProducts(empresaId: string): { name: string; price: number; available: boolean }[] {
  return getConfig(empresaId).products.filter((p) => p.available);
}

/**
 * P1.24 — same strict Brazilian phone validation as in escalation.ts.
 * Aceita 10-11 dígitos (Brasil sem DDI, prepend 55) ou 12-13 dígitos
 * começando com 55. Tudo o mais retorna null pra que o caller reporte
 * "manager phone inválido". Antes números como "211999998888" passavam
 * e o gerente nunca recebia a notificação.
 */
function phoneToJid(phone: string): string | null {
  let digits = normalizePhoneNumber(phone);
  if (!digits) return null;
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (digits.length !== 12 && digits.length !== 13) return null;
  if (!digits.startsWith('55')) return null;
  return `${digits}@s.whatsapp.net`;
}

async function fetchUpcomingOrders(empresaId: string): Promise<string> {
  try {
    const supabase = getServiceSupabase();
    // FIX H5: Brazil timezone, not UTC — otherwise between 21h–23h59 BRT we'd
    // skip today and double-count tomorrow.
    const now = new Date();
    const today = toIsoBrazil(now);
    const in7Days = toIsoBrazil(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));

    const { data, error } = await supabase
      .from('zelochat_orders')
      .select('customer_name, customer_phone, items, pickup_date, pickup_time, status, total')
      .eq('empresa_id', empresaId)
      .gte('pickup_date', today)
      .lte('pickup_date', in7Days)
      .in('status', ['pending', 'preparing', 'ready'])
      .order('pickup_date', { ascending: true })
      .limit(20);

    if (error || !data || data.length === 0) return 'Nenhum pedido agendado nos próximos 7 dias.';

    // FIX H2: sanitize every user-supplied field before interpolating into the prompt.
    return data.map((o) => {
      const items = (o.items as { product: string; quantity: number }[])
        .map((i) => `${safeForPrompt(i.quantity, 10)}x ${safeForPrompt(i.product, 60)}`)
        .join(', ');
      return `- ${safeForPrompt(o.pickup_date, 10)} ${safeForPrompt(o.pickup_time, 10)} | ${safeForPrompt(o.customer_name, 60)} (${safeForPrompt(o.customer_phone, 20)}) | ${items} | R$${Number(o.total).toFixed(2)} | ${safeForPrompt(o.status, 20)}`;
    }).join('\n');
  } catch {
    return 'Agenda indisponível no momento.';
  }
}

async function fetchCustomerHistory(empresaId: string, customerPhone: string): Promise<string> {
  const digits = normalizePhoneNumber(customerPhone || '');
  if (!digits) return 'Cliente novo.';

  try {
    const supabase = getServiceSupabase();
    const { data, error } = await supabase
      .from('zelochat_orders')
      .select('items, pickup_date, pickup_time, status, total, customer_phone')
      .eq('empresa_id', empresaId)
      .order('pickup_date', { ascending: false })
      .limit(30);

    if (error || !data || data.length === 0) return 'Cliente novo.';

    const matches = data.filter((o) => {
      const rowDigits = normalizePhoneNumber(String(o.customer_phone ?? ''));
      return rowDigits && (rowDigits.endsWith(digits) || digits.endsWith(rowDigits));
    }).slice(0, 5);

    if (matches.length === 0) return 'Cliente novo.';

    // FIX H2: sanitize every user-supplied field before interpolating into the prompt.
    return matches.map((o) => {
      const items = (o.items as { product: string; quantity: number }[])
        .map((i) => `${safeForPrompt(i.quantity, 10)}x ${safeForPrompt(i.product, 60)}`)
        .join(', ');
      return `- ${safeForPrompt(o.pickup_date, 10)} ${safeForPrompt(o.pickup_time, 10)} | ${items} | R$${Number(o.total).toFixed(2)} | ${safeForPrompt(o.status, 20)}`;
    }).join('\n');
  } catch {
    return 'Histórico indisponível.';
  }
}

/**
 * Returns a short summary of any active (non-final) orders for this customer,
 * suitable for inclusion in the system prompt. Lets the AI answer status questions
 * without needing a tool call when the data is small.
 */
async function fetchActiveOrdersForCustomer(empresaId: string, customerPhone: string): Promise<string> {
  const digits = normalizePhoneNumber(customerPhone || '');
  if (!digits) return '(nenhum)';
  try {
    const supabase = getServiceSupabase();
    const { data, error } = await supabase
      .from('zelochat_orders')
      .select('id, customer_phone, items, pickup_date, pickup_time, status, total, driver_id')
      .eq('empresa_id', empresaId)
      .in('status', ['pending', 'preparing', 'ready', 'dispatched'])
      .order('pickup_date', { ascending: true })
      .limit(20);
    if (error || !data || data.length === 0) return '(nenhum)';
    const matches = data.filter((o) => {
      const rowDigits = normalizePhoneNumber(String(o.customer_phone ?? ''));
      return rowDigits && (rowDigits.endsWith(digits) || digits.endsWith(rowDigits));
    }).slice(0, 5);
    if (matches.length === 0) return '(nenhum)';
    return matches.map((o) => {
      const items = (o.items as { product: string; quantity: number }[])
        .map((i) => `${safeForPrompt(i.quantity, 10)}x ${safeForPrompt(i.product, 60)}`)
        .join(', ');
      const shortId = String(o.id).slice(0, 8).toUpperCase();
      return `- #${shortId} | ${safeForPrompt(o.pickup_date, 10)} ${safeForPrompt(o.pickup_time, 10)} | ${items} | R$${Number(o.total).toFixed(2)} | status: ${safeForPrompt(o.status, 20)}`;
    }).join('\n');
  } catch {
    return '(consulta indisponível)';
  }
}

/**
 * Looks up the customer's most recent order(s) — used by the consultar_pedido tool
 * so the AI can answer "qual o status do meu pedido?" without making up info.
 * Includes driver info when the order is dispatched.
 */
async function fetchOrderForCustomer(
  empresaId: string,
  customerPhone: string,
  shortId?: string,
): Promise<string> {
  try {
    const supabase = getServiceSupabase();
    let query = supabase
      .from('zelochat_orders')
      .select('id, customer_phone, items, pickup_date, pickup_time, status, total, payment_method, driver_id, created_at')
      .eq('empresa_id', empresaId)
      .order('created_at', { ascending: false })
      .limit(10);

    const { data, error } = await query;
    if (error || !data || data.length === 0) {
      return 'Nenhum pedido encontrado para esse cliente.';
    }

    const digits = normalizePhoneNumber(customerPhone || '');
    const ofThisCustomer = data.filter((o) => {
      const rowDigits = normalizePhoneNumber(String(o.customer_phone ?? ''));
      return rowDigits && digits && (rowDigits.endsWith(digits) || digits.endsWith(rowDigits));
    });

    let target = ofThisCustomer[0];
    if (shortId) {
      const wanted = shortId.toLowerCase().replace(/[^a-f0-9]/g, '').slice(0, 8);
      const matchByShortId = data.find((o) => String(o.id).toLowerCase().startsWith(wanted));
      if (matchByShortId) target = matchByShortId;
    }
    if (!target) return 'Não encontrei nenhum pedido recente desse cliente.';

    let driverName = '';
    if (target.driver_id) {
      // P0.22 — service-role client bypasses RLS, so the empresa_id filter is
      // MANDATORY here. Without it, a driver_id pointing at a different
      // empresa's row (data corruption, restored backup, future bug) would
      // leak that empresa's driver name into this customer's reply.
      const { data: driver } = await supabase
        .from('zelochat_drivers')
        .select('name')
        .eq('id', target.driver_id)
        .eq('empresa_id', empresaId)
        .maybeSingle();
      driverName = (driver as { name?: string } | null)?.name ?? '';
    }

    const items = (target.items as { product: string; quantity: number }[])
      .map((i) => `${safeForPrompt(i.quantity, 10)}x ${safeForPrompt(i.product, 60)}`)
      .join(', ');
    const shortIdOut = String(target.id).slice(0, 8).toUpperCase();
    const driverPart = driverName ? ` | Entregador: ${safeForPrompt(driverName, 60)}` : '';

    return `Pedido #${shortIdOut} | Status: ${safeForPrompt(target.status, 20)} | Retirada/Entrega: ${safeForPrompt(target.pickup_date, 10)} às ${safeForPrompt(target.pickup_time, 10)} | Itens: ${items} | Total: R$${Number(target.total).toFixed(2)}${driverPart}`;
  } catch (err) {
    console.error('[AI] fetchOrderForCustomer error:', err);
    return 'Não consegui consultar o pedido agora.';
  }
}

async function createOrderInDb(
  empresaId: string,
  args: {
    customerName: string;
    customerPhone: string;
    items: { product: string; quantity: number }[];
    pickupDate: string;
    pickupTime: string;
    paymentMethod?: string;
    total: number;
    orderType?: 'pickup' | 'delivery';
    deliveryAddress?: string;
    deliveryNeighborhood?: string;
    deliveryFee?: number;
    observations?: string;
  },
): Promise<string> {
  console.log('[AI] Creating order in DB for empresa:', empresaId, 'args:', JSON.stringify(args));
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('zelochat_orders')
    .insert({
      empresa_id: empresaId,
      customer_name: args.customerName,
      customer_phone: args.customerPhone || null,
      items: args.items,
      pickup_date: args.pickupDate,
      pickup_time: args.pickupTime,
      payment_method: args.paymentMethod || null,
      delivery_address: args.deliveryAddress || null,
      delivery_neighborhood: args.deliveryNeighborhood || null,
      delivery_fee: args.deliveryFee ?? null,
      observations: args.observations || null,
      driver_id: null,
      status: 'pending',
      total: args.total,
      source: 'whatsapp',
    })
    .select('id')
    .single();

  if (error) {
    console.error('[AI] Supabase order insert error:', error);
    throw new Error(`Falha ao criar pedido: ${error.message}`);
  }
  console.log('[AI] Order created successfully ID:', data?.id);
  return (data as { id: string }).id;
}

function normalizeNeighborhood(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

function resolveDeliveryFee(empresaId: string, neighborhood: string): number | null {
  const cfg = getConfig(empresaId);
  if (!cfg.deliveryConfig?.enabled || !cfg.deliveryConfig.neighborhoods.length) return null;
  const normalized = normalizeNeighborhood(neighborhood);

  // 1) Exact match
  let match = cfg.deliveryConfig.neighborhoods.find(
    (n) => normalizeNeighborhood(n.name) === normalized,
  );

  // 2) Config name starts with what the AI sent (ex: "marfrig" → "marfrig, jw (parque industrial)")
  if (!match) {
    match = cfg.deliveryConfig.neighborhoods.find((n) => {
      const c = normalizeNeighborhood(n.name);
      return c.startsWith(normalized + ',') || c.startsWith(normalized + ' ');
    });
  }

  // 3) What the AI sent starts with config name (ex: "marfrig 1" → "marfrig")
  if (!match) {
    match = cfg.deliveryConfig.neighborhoods.find((n) => {
      const c = normalizeNeighborhood(n.name);
      return normalized.startsWith(c + ' ') || normalized.startsWith(c + ',');
    });
  }

  // 4) Token match — any significant token (>3 chars) shared between config name and AI input
  if (!match) {
    match = cfg.deliveryConfig.neighborhoods.find((n) => {
      const configTokens = normalizeNeighborhood(n.name).split(/[\s,()]+/).filter(Boolean);
      const inputTokens = normalized.split(/[\s,()]+/).filter(Boolean);
      return configTokens.some((t) => t.length > 3 && inputTokens.includes(t));
    });
  }

  return match ? match.fee : null;
}

function buildCatalogHierarchyBlock(hierarchy: CatalogCategoriaGroup[] | undefined): string {
  if (!hierarchy || hierarchy.length === 0) return '';
  const lines: string[] = [];
  for (const cat of hierarchy) {
    const subs = cat.subcategorias.filter((s) => s.produtos.some((p) => p.available));
    const direto = cat.produtosDireto.filter((p) => p.available);
    if (subs.length === 0 && direto.length === 0) continue;
    lines.push(`  • ${cat.nome}`);
    for (const prod of direto) {
      lines.push(`    - ${prod.name} (R$ ${prod.price.toFixed(2)})`);
    }
    for (const sub of subs) {
      lines.push(`    ◦ ${sub.nome}`);
      for (const prod of sub.produtos.filter((p) => p.available)) {
        lines.push(`      - ${prod.name} (R$ ${prod.price.toFixed(2)})`);
      }
    }
  }
  if (lines.length === 0) return '';
  return `\n- Cardápio organizado por categoria:\n${lines.join('\n')}`;
}

function buildSystemInstruction(
  empresaId: string,
  customerPhone: string,
  customerHistory: string,
  triggers: TriggerRecord[],
  activeOrdersBlock: string,
): string {
  const cfg = getConfig(empresaId);

  const availableProducts = getAvailableProducts(empresaId)
    .map((p) => `${p.name} (R$ ${p.price.toFixed(2)})`).join(', ') || 'Cardápio não configurado';

  const catalogHierarchyStr = buildCatalogHierarchyBlock(cfg.catalogHierarchy);

  const blockedDates = getBlockedDates(empresaId);
  const blockedDatesStr = blockedDates.length > 0
    ? blockedDates.map((bd) => `${safeForPrompt(bd.date, 10)} (${safeForPrompt(bd.reason || 'sem motivo informado', 100)})`).join(', ')
    : 'Nenhuma';

  const dailyContextStr = cfg.dailyContext.length > 0
    ? `\n\nAVISOS DE HOJE:\n${cfg.dailyContext.map((c) => `- ${c.text}`).join('\n')}`
    : '';

  const now = new Date();
  const currentTimeBR = getBrazilTimeParts(now).label;
  const todayLabel = dayLabelBrazil(now);
  const isClosedToday = cfg.closedDays.includes(todayLabel);
  const operatingWindow = getOperatingWindow(empresaId);
  const operatingHoursStr = operatingWindow
    ? `${operatingWindow.openLabel}–${operatingWindow.closeLabel}`
    : (cfg.hours || 'Consulte a loja');
  const closedDayWarning = isClosedToday
    ? `\n\n⚠️ HOJE (${todayLabel}) É DIA DE FECHAMENTO. Informe educadamente que não estamos atendendo hoje e indique os dias em que abrimos: ${DAY_LABELS.filter((d) => !cfg.closedDays.includes(d)).join(', ')}. NÃO aceite pedidos para hoje.`
    : '';

  const todayISO = toIsoBrazil(now);
  const tomorrowISO = toIsoBrazil(new Date(now.getTime() + 86400000));
  const todayBR = isoToDisplayBR(todayISO);
  const tomorrowBR = isoToDisplayBR(tomorrowISO);
  const nextDays: string[] = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now.getTime() + i * 86400000);
    const iso = toIsoBrazil(d);
    nextDays.push(`${dayLabelBrazil(d)} = ${isoToDisplayBR(iso)} (${iso})`);
  }
  const nextDaysStr = nextDays.join(', ');

  const triggersBlock = triggers.length > 0
    ? triggers.map((t) => `- id=${t.id} [${t.kind}] "${t.name}": ${t.conditionDescription}`).join('\n')
    : '- (nenhum gatilho configurado)';

  return `Você é o assistente virtual da ${cfg.name || 'lanchonete'}, especialista em ${cfg.specialty || 'atendimento ao cliente'}.
Linguagem: informal, simpática, estilo WhatsApp brasileiro (emojis moderados).

DATA E HORA ATUAL (use SEMPRE, NUNCA invente datas ou anos):
- Agora é ${todayLabel}, ${todayBR}, ${currentTimeBR} no horário de Brasília (interno: ${todayISO} ${currentTimeBR})
- Amanhã é ${tomorrowBR} (interno: ${tomorrowISO})
- Próximos 7 dias: ${nextDaysStr}
- Ao interpretar datas relativas ("sábado", "semana que vem", "amanhã"), calcule SEMPRE a partir da data de hoje acima.
- Se o cliente disser apenas o dia da semana, confirme antes de criar o pedido: "Seria para [dia], [DD/MM/AAAA]?"

FORMATO DE DATAS E HORAS (OBRIGATÓRIO):
- Ao falar COM O CLIENTE, use SEMPRE o formato brasileiro: DD/MM/AAAA para datas e HH:MM para horários.
  Exemplos corretos: "25/04/2026", "às 14h", "às 09h30"
  Exemplos PROIBIDOS: "2026-04-25", "14:00", "9h00"
- Nas tool calls (criar_pedido), use o formato interno YYYY-MM-DD para pickupDate e HH:MM para pickupTime.

INFORMAÇÕES DA LANCHONETE:
- Cardápio disponível: ${availableProducts}${catalogHierarchyStr}
- Horário de funcionamento: ${operatingHoursStr}
- Dias fechados: ${cfg.closedDays.join(', ') || 'Nenhum'}
- Endereço: ${cfg.address || 'Consulte a loja'}
- Chave Pix: ${cfg.pixKey || 'Consulte a loja'}
- Datas bloqueadas (sem encomendas): ${blockedDatesStr}${dailyContextStr}${closedDayWarning}

REGRA OBRIGATÓRIA PARA HORÁRIO DE ATENDIMENTO:
- Use a data e hora atual acima em TODA resposta sobre pedidos.
- Se o cliente quiser pedir "agora", "hoje" ou sem deixar claro que é para outro dia/horário e agora estiver fora do horário ${operatingHoursStr}, informe imediatamente que estamos fora do horário e ofereça agendar outro horário, outro dia ou chamar um atendente.
- Se o cliente pedir retirada/entrega em horário fora de ${operatingHoursStr}, avise imediatamente. NÃO continue coletando produto, nome, pagamento, endereço ou observação.
- Se o cliente pedir para HOJE em um horário que já passou, mesmo que esteja dentro do horário de funcionamento, avise imediatamente que esse horário já passou e ofereça outro horário futuro ou outro dia.
- NUNCA chame criar_pedido com pickupTime fora do horário de funcionamento, pickupDate em dia fechado ou pickupDate=hoje com pickupTime no passado.

REGRA OBRIGATÓRIA PARA DATAS BLOQUEADAS:
- Se o cliente pedir, sugerir, confirmar ou perguntar sobre encomenda/pedido para uma data bloqueada, avise IMEDIATAMENTE que não aceitamos encomendas nessa data e diga o motivo cadastrado.
- Não continue coletando nome, pagamento, endereço ou observação para uma data bloqueada.
- Ofereça saídas claras: escolher outro dia, antecipar para antes, deixar para depois ou chamar um atendente.
- NUNCA chame criar_pedido com pickupDate em uma data bloqueada.

REGRAS DE CÁLCULO PARA "CENTOS" (MUITO IMPORTANTE):
- Produtos como "mini salgados" ou que tenham "Cento" no nome frequentemente têm o preço cadastrado por UNIDADE (ex: R$ 0.80 ou R$ 0.90).
- Se o cliente pedir um "Cento" (100 unidades), "Meio Cento" (50 unidades) ou múltiplos, você DEVE calcular o total multiplicando a quantidade REAL de salgados pelo valor da unidade no cardápio. (Ex: 1 cento = 100 x R$ 0.90 = R$ 90,00).
- Na tool criar_pedido, envie a quantidade TOTAL de unidades em "quantity" (ex: 100) e o valor total calculado corretamente em "total" (ex: 90.00). NUNCA cobre apenas R$ 0.90 por um cento inteiro.

HISTÓRICO DESTE CLIENTE (uso interno — NÃO revelar ao cliente):
${customerHistory}
IMPORTANTE: Use o histórico acima APENAS para personalizar o atendimento (ex: sugerir produtos já pedidos). NUNCA informe ao cliente quantos pedidos ele fez, valores anteriores ou qualquer dado do histórico. Essas informações são confidenciais.

PEDIDOS ATIVOS DESTE CLIENTE (em produção/aguardando retirada/em entrega):
${activeOrdersBlock}
Se o cliente perguntar sobre o status de UM pedido específico (ex: "cadê meu pedido?", "saiu pra entrega?"), CHAME consultar_pedido para obter o status atualizado e o nome do entregador (se já saiu para entrega). NÃO responda sobre status de pedido sem antes consultar.

GATILHOS ATIVOS (chame dispatch_trigger se a condição ocorrer):
${triggersBlock}

INSTRUÇÕES DE GATILHO:
- Chame dispatch_trigger NO MÁXIMO UMA VEZ por condição que ocorrer na conversa.
- Se for escalate_human, você NÃO escreve mais nada — o sistema cuida do handoff com o cliente.
- Se for notify_manager, continue a conversa normalmente após a notificação.

DIRETRIZES PERSONALIZADAS:
${cfg.aiInstructions || 'Siga o comportamento padrão de atendimento amigável.'}

${cfg.deliveryConfig?.enabled && cfg.deliveryConfig.neighborhoods.length > 0 ? `ENTREGA (DELIVERY):
- A lanchonete aceita pedidos de entrega nos seguintes bairros:
${cfg.deliveryConfig.neighborhoods.map((n) => `  • ${n.name}: R$ ${n.fee.toFixed(2)}`).join('\n')}
- Se o cliente mencionar "delivery", "entrega" ou pedir pra ser entregue, PERGUNTE o modo se ainda não souber: "Vai ser retirada ou entrega?"
- Para pedidos de ENTREGA, siga esta ordem:
  1. Peça o endereço completo. O cliente pode informar rua, número, referência ou nome de empresa — tudo é válido.
  2. Tente identificar qual bairro da lista corresponde ao endereço informado, mesmo que o cliente use nome informal, apelido, nome de empresa ou referência de rua. Escolha o bairro mais provável.
  3. Se não conseguir identificar nenhum bairro correspondente na lista, chame dispatch_trigger com escalate_human para que um atendente confirme a área. NUNCA diga ao cliente que não entregamos no endereço dele — apenas transfira.
  4. Se o cliente pedir parte retirada + parte entrega no mesmo pedido, chame dispatch_trigger com escalate_human.
  5. Inclua a taxa de entrega no total. Ex: subtotal R$30 + taxa R$5 = total R$35.
  6. Chame criar_pedido com orderType="delivery", deliveryAddress (endereço completo informado pelo cliente), deliveryNeighborhood (nome do bairro da lista que melhor corresponde) e deliveryFee (valor exato da lista acima).
- PROIBIDO inventar taxas. Use EXATAMENTE os valores listados acima.
- Para delivery agendado, coletar data/hora normalmente (igual à retirada).
` : `ENTREGA (DELIVERY):
- A lanchonete NÃO aceita entregas no momento. Todos os pedidos são para retirada.
- Se o cliente pedir entrega, informe educadamente e ofereça retirada no local.
`}
OBJETIVOS:
1. Responder dúvidas sobre cardápio, horários e disponibilidade.
2. Para pedidos, coletar: produto, quantidade, modo (retirada ou entrega), data, horário, nome do cliente E forma de pagamento. Para entrega: também endereço completo com bairro.
3. Se o cliente informar data relativa (ex: "sábado"), CONFIRME a data absoluta no formato BR: "Seria para sábado, [DD/MM/AAAA], às [HH]h?" e aguarde a resposta antes de prosseguir.
4. ANTES de chamar criar_pedido, faça SEMPRE esta pergunta UMA vez: "Gostaria de alterar algo, ou tem alguma observação a fazer? 😊". Isso evita mudanças depois que o pedido for confirmado, já que edição pós-confirmação precisa ser tratada por um humano. Se o cliente disser "não"/"nada"/"tá ok", envie observations: "" na tool. Se mencionar algo (ex: "sem cebola", "ponto da carne", "deixar na portaria", "trocar coca por guaraná"), envie em observations. NUNCA chame criar_pedido sem antes ter feito essa pergunta E recebido a resposta do cliente.
5. ASSIM QUE tiver TODOS os dados COLETADOS e a observação confirmada, CHAME a tool criar_pedido IMEDIATAMENTE E FIQUE EM SILÊNCIO.
6. PROIBIDO gerar texto de resumo do pedido (ex: "Aqui está o resumo: ... Posso finalizar?"). Ao chamar a tool criar_pedido, o sistema já envia um botão de confirmação automático com o resumo visual. Se você gerar texto, causará um erro no fluxo do cliente. Apenas chame a tool e não escreva mais NADA.
7. NUNCA ofereça enviar comprovante de Pix. O cliente é quem deve enviar após pagar.

IMPORTANTE: Respostas curtas e objetivas, como quem digita no celular.`.trim();
}

const CREATE_ORDER_TOOL: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'criar_pedido',
    description: 'Gera o resumo interativo do pedido para o cliente aprovar. Chame esta função IMEDIATAMENTE assim que coletar todos os dados necessários (produto, quantidade, data, horário, nome e pagamento), SEM pedir confirmação por texto antes.',
    parameters: {
      type: 'object',
      properties: {
        customerName: { type: 'string', description: 'Nome completo do cliente' },
        customerPhone: { type: 'string', description: 'Telefone do cliente com DDD (opcional — já capturado do WhatsApp)' },
        items: {
          type: 'array',
          description: 'Lista de itens do pedido',
          items: {
            type: 'object',
            properties: {
              product: { type: 'string', description: 'Nome do produto' },
              quantity: { type: 'number', description: 'Quantidade' },
            },
            required: ['product', 'quantity'],
          },
        },
        pickupDate: { type: 'string', description: 'Data de retirada/entrega no formato YYYY-MM-DD' },
        pickupTime: { type: 'string', description: 'Horário de retirada/entrega no formato HH:MM' },
        paymentMethod: { type: 'string', description: 'Forma de pagamento escolhida pelo cliente (ex: Pix, Dinheiro, Cartão)' },
        total: { type: 'number', description: 'Valor total do pedido em reais (inclui taxa de entrega se delivery)' },
        orderType: { type: 'string', enum: ['pickup', 'delivery'], description: 'Modo do pedido: pickup = retirada, delivery = entrega' },
        deliveryAddress: { type: 'string', description: 'Endereço completo de entrega (rua, número, bairro). Obrigatório se orderType=delivery.' },
        deliveryNeighborhood: { type: 'string', description: 'Bairro de entrega (só o bairro, ex: "Centro"). Obrigatório se orderType=delivery.' },
        deliveryFee: { type: 'number', description: 'Taxa de entrega em reais conforme tabela de bairros. Obrigatório se orderType=delivery.' },
        observations: {
          type: 'string',
          description: 'Observação livre do cliente sobre o pedido (ex: "sem cebola", "ponto da carne", "deixar na portaria"). String VAZIA "" significa que você JÁ perguntou e o cliente não tem observação. NUNCA chame esta tool sem antes ter perguntado: "Gostaria de alterar algo, ou tem alguma observação a fazer?"',
        },
      },
      required: ['customerName', 'items', 'pickupDate', 'pickupTime', 'paymentMethod', 'total', 'orderType', 'observations'],
    },
  },
};

const CONSULT_ORDER_TOOL: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'consultar_pedido',
    description: 'Consulta o status atual de um pedido deste cliente (pendente, em preparo, pronto, em entrega, entregue, cancelado) e o nome do entregador se já saiu para entrega. Use sempre que o cliente perguntar sobre o andamento ou status de um pedido. Se o cliente não citar o número do pedido, deixe orderShortId vazio para pegar o pedido mais recente.',
    parameters: {
      type: 'object',
      properties: {
        orderShortId: {
          type: 'string',
          description: 'Número curto do pedido (8 caracteres hex, ex: "A1B2C3D4"). Opcional — se vazio, retorna o pedido mais recente do cliente.',
        },
      },
      required: [],
    },
  },
};

const DISPATCH_TRIGGER_TOOL: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'dispatch_trigger',
    description: 'Dispara um gatilho configurado pelo dono quando sua condição ocorre na conversa.',
    parameters: {
      type: 'object',
      properties: {
        trigger_id: { type: 'string', description: 'ID do gatilho a disparar' },
        reason: { type: 'string', description: 'Resumo curto do que aconteceu na conversa' },
      },
      required: ['trigger_id', 'reason'],
    },
  },
};

/**
 * 🚨 CRITICAL — AI dispatch entry point
 *
 * The single ingress for all auto-replies. Every customer message that the
 * webhook decides to answer flows through here. Five layered guardrails are
 * woven into this function and breaking ANY of them re-introduces
 * customer-visible bugs we've already paid for in incident time:
 *
 *   1. Subscription gate (caller `index.ts` and `aiEnabled` here).
 *      Disabled empresas / paused replicas don't burn OpenAI quota.
 *
 *   2. Pending-order intent guardrail (P0.9 / P0.10): when a pending order
 *      exists and customer types ambiguous text, we route to
 *      confirm/cancel/edit instead of letting the AI re-call criar_pedido.
 *      The whitelist match here is INTENTIONALLY conservative — false
 *      negatives (fall through to "edit") are safe; false positives
 *      (auto-confirm/cancel) charged the customer twice.
 *
 *   3. Just-confirmed cooldown (P0.11): after a successful confirm, the
 *      next "Obrigado!" / "vlw" must NOT fire criar_pedido again. Both
 *      the in-memory `justConfirmedMap` and the
 *      `wasOrderRecentlyConfirmedInDb(...)` DB lookup must agree before
 *      we let the tool through. The DB fallback is what makes this
 *      survive restart / replica swap.
 *
 *   4. Catch-fallback for criar_pedido must NEVER call createOrderInDb or
 *      clearPendingOrder (Layer 2 of CLAUDE.md's 3-layer trap). The catch
 *      keeps the pending row in place and asks the customer to retry —
 *      the order is finalized only by `confirmPendingOrder`.
 *
 *   5. Conversation history is filtered to TEXT-ONLY user/assistant rows.
 *      Tool messages and tool_calls are dropped because every tool flow
 *      here completes within ONE OpenAI request — never persist-and-replay.
 *      If you ever add a multi-turn tool flow, you MUST stop filtering
 *      here, otherwise OpenAI rejects the next request.
 *
 * BUTTERFLY EFFECT — what cascades if you break this:
 *   • Duplicate orders (the original 2-day bug — hit prod twice already)
 *   • Wrong-confirm: customer typed "perfeito, mas troca a coca" → order
 *     auto-confirmed with original items
 *   • Wrong-cancel: "não, prefiro de manhã" → order silently cancelled
 *   • Cost runaway: cooldown bypass → AI re-runs criar_pedido on every
 *     "Obrigado", "valeu", emoji-reply
 *   • Cross-tenant leak: if the empresa filter slips through, customer
 *     A's profile data leaks into customer B's reply
 *
 * Always test the duplicate-order scenario from CLAUDE.md and the
 * affirmative/negative regex test cases (CODE_REVIEW.md §P0.9/P0.10) after
 * touching this function.
 */
export async function generateAndSendReply(
  jid: string,
  empresaId: string,
): Promise<string | null> {
  // P0.2 — empresaId is REQUIRED. Previously fell back to getBoundEmpresaId()
  // which is null/stale in multi-tenant deploys.
  if (!empresaId) {
    console.warn('[AI] Cannot generate reply — empresaId is required for jid:', jid);
    return null;
  }
  const resolvedEmpresaId = empresaId;

  // Global kill-switch — dono can disable the assistant without dropping the WhatsApp session.
  // Fail-closed: hydrate from DB on first webhook hit, and only proceed if aiEnabled is
  // explicitly `true`. `undefined` (DB query failed or empresa never seen) silences the AI
  // until the next message retries hydration. See configStore.ts for the rationale.
  await ensureAiSettingsHydrated(resolvedEmpresaId);
  if (getConfig(resolvedEmpresaId).aiEnabled !== true) {
    console.log(`[AI] Global AI disabled or not hydrated for empresa ${resolvedEmpresaId} — skipping reply to ${jid}`);
    return null;
  }

  const session = await getSession(jid, resolvedEmpresaId);
  if (!session) return null;

  // GUARDRAIL: if a pending order exists and the customer sent text (not a button click),
  // route affirmatives → confirm directly, negatives → cancel directly, ambiguous → edit.
  // This prevents the AI from being re-invoked and creating a duplicate pending order.
  const pendingForEdit = await getPendingOrder(jid, resolvedEmpresaId);
  if (pendingForEdit) {
    const lastMsg = session.messages.at(-1);
    const lastText = (lastMsg?.content ?? '').toLowerCase().trim();
    // Whitelist exact-match intent detection. The previous regex `^(certo|isso|...)`
    // matched partial prefixes — "certo, mas troca a coca" auto-confirmed; "não, prefiro
    // de manhã" auto-cancelled. We now normalize (strip accents + trailing punctuation
    // /emoji/whitespace) and check against a set of unambiguous tokens. Anything else
    // falls through to "ambiguous → edit", which is the correct behavior.
    const normalized = lastText
      .normalize('NFD')
      .replace(/\p{Mn}/gu, '')
      .replace(/[\s\p{P}\p{S}]+$/u, '');
    const isAffirmative = AFFIRMATIVE_INTENTS.has(normalized);
    const isNegative = NEGATIVE_INTENTS.has(normalized);

    if (isAffirmative) {
      console.log(`[AI] Pending order: affirmative text detected ("${lastText}") — auto-confirming`);
      await confirmPendingOrder(jid, resolvedEmpresaId);
      return 'confirmed';
    }
    if (isNegative) {
      console.log(`[AI] Pending order: negative text detected ("${lastText}") — auto-cancelling`);
      await cancelPendingOrder(jid, resolvedEmpresaId);
      return 'cancelled';
    }
    // Ambiguous text → treat as edit intent (clear pending, re-engage AI)
    console.log(`[AI] Pending order detected as edit-intent for ${jid} — clearing and re-engaging.`);
    await clearPendingOrder(jid, resolvedEmpresaId);
    const editAck = 'Beleza, vamos ajustar! Me conta o que mudou. 😊';
    await sendTextMessage(jid, editAck, resolvedEmpresaId);
    await addAssistantMessage(jid, editAck, undefined, resolvedEmpresaId);
    return editAck;
  }

  const lastUserMsgForDate = [...session.messages].reverse().find((m) => m.role === 'user');
  const lastUserTextForDate = lastUserMsgForDate
    ? (buildContentForModel(lastUserMsgForDate) || lastUserMsgForDate.preview || '')
    : '';
  const blockedDateFromMessage = lastUserTextForDate
    ? findBlockedDateFromCustomerText(resolvedEmpresaId, lastUserTextForDate)
    : null;
  if (blockedDateFromMessage) {
    console.log(`[AI] Blocking reply before OpenAI: requested blocked date ${blockedDateFromMessage.date} for empresa=${resolvedEmpresaId} jid=${jid}`);
    return sendBlockedDateReply(jid, resolvedEmpresaId, blockedDateFromMessage);
  }
  const recentScheduleContext = findRecentScheduleContextGuard(
    resolvedEmpresaId,
    session.messages,
  );
  if (recentScheduleContext?.type === 'blocked_date') {
    console.log(`[AI] Blocking reply before OpenAI: recent context has blocked date ${recentScheduleContext.blockedDate.date} for empresa=${resolvedEmpresaId} jid=${jid}`);
    return sendBlockedDateReply(jid, resolvedEmpresaId, recentScheduleContext.blockedDate);
  }
  if (recentScheduleContext?.type === 'business_hours') {
    console.log(`[AI] Blocking reply before OpenAI: recent context has invalid schedule for empresa=${resolvedEmpresaId} jid=${jid}`);
    return sendBusinessHoursReply(jid, resolvedEmpresaId, recentScheduleContext.issue);
  }
  const businessHoursIssueFromMessage = lastUserTextForDate
    ? findBusinessHoursIssueFromCustomerText(
        resolvedEmpresaId,
        lastUserTextForDate,
        new Date(),
        { checkCurrentMoment: recentScheduleContext?.type !== 'valid_schedule' },
      )
    : null;
  if (businessHoursIssueFromMessage) {
    console.log(`[AI] Blocking reply before OpenAI: requested outside business hours for empresa=${resolvedEmpresaId} jid=${jid}`);
    return sendBusinessHoursReply(jid, resolvedEmpresaId, businessHoursIssueFromMessage);
  }

  const [customerHistory, triggers, activeOrdersBlock] = await Promise.all([
    fetchCustomerHistory(resolvedEmpresaId, session.customerPhone),
    fetchActiveTriggers(resolvedEmpresaId),
    fetchActiveOrdersForCustomer(resolvedEmpresaId, session.customerPhone),
  ]);

  const systemInstruction = buildSystemInstruction(
    resolvedEmpresaId,
    session.customerPhone,
    customerHistory,
    triggers,
    activeOrdersBlock,
  );

  // Signal "typing" while we wait for the AI — non-blocking, ignore failures
  void sendPresence(jid, 'composing', 0, resolvedEmpresaId);

  try {
    const openai = getAI();

    // INVARIANT (review fix H3):
    // We forward only role=user / role=assistant TEXT messages to OpenAI from history.
    // We deliberately drop:
    //   - role=tool messages
    //   - role=assistant messages with tool_calls (we strip the tool_calls field too)
    // This is safe because every tool sequence we emit (criar_pedido, dispatch_trigger,
    // consultar_pedido) is completed within a SINGLE OpenAI request — the assistant's
    // tool_call message and the matching tool result are never persisted-then-replayed.
    // If you ever add a tool flow that spans multiple requests, you MUST stop filtering
    // here, otherwise OpenAI will reject the next request with "tool messages must
    // follow assistant messages with tool_calls".
    //
    // P1.20 — cap em últimas 60 mensagens (depois do filtro de role/content). Sem
    // cap, um cliente que chateia há meses gera um prompt gigantesco a cada
    // webhook, escalando custo/latência da OpenAI linearmente. 60 cobre ~30
    // turnos de conversa user↔assistant, o que é confortável mesmo pra fluxos
    // de pedido demorados (cardápio + perguntas + endereço + confirmação).
    // O system prompt JÁ inclui customerHistory, então perder turnos antigos
    // do prompt de runtime não perde memória do cliente.
    const HISTORY_CAP = 60;
    const filteredHistory = session.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .filter((m) => !!m.content); // skip tool-call-only assistant rows (content is null)
    const trimmedHistory = filteredHistory.length > HISTORY_CAP
      ? filteredHistory.slice(-HISTORY_CAP)
      : filteredHistory;

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemInstruction },
      ...trimmedHistory.map((m) => ({
        role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: buildContentForModel(m),
      })),
    ];

    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      tools: [CREATE_ORDER_TOOL, CONSULT_ORDER_TOOL, DISPATCH_TRIGGER_TOOL],
      tool_choice: 'auto',
    });

    // P2.21 — Escalation race condition: re-fetch auto_reply AFTER the OpenAI
    // round-trip completes. This is the last gate before any sendTextMessage call.
    // If the operator escalated the chat while the OpenAI request was in flight
    // (debounce fired → request started → operator clicked "take over" → request
    // returned), we abort here and discard the reply. Without this check the
    // AI reply would still ship and the operator's screen would show both their
    // "Vou te ajudar" and the AI's response simultaneously — broken UX.
    //
    // We re-fetch from DB (not from the in-memory session captured above) to get
    // the current state, not the snapshot from before the OpenAI call. The extra
    // Supabase round-trip (~5ms) is negligible compared to the OpenAI latency.
    try {
      const freshSession = await getSession(jid, resolvedEmpresaId);
      if (freshSession && (!freshSession.autoReply || freshSession.status === 'escalated')) {
        console.log(`[ai] aborted reply: auto_reply turned off mid-flight for empresa=${resolvedEmpresaId} jid=${jid}`);
        return null;
      }
    } catch (recheckErr) {
      // If the re-check itself fails, fail-closed: abort. We'd rather miss one
      // reply than send an unwanted AI message into an escalated conversation.
      console.warn('[AI] auto_reply re-check failed — aborting reply as a precaution:', recheckErr);
      return null;
    }

    const choice = response.choices[0];

    if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls?.length) {
      // P1.19 — apenas processamos o primeiro tool_call. Modelo raramente
      // emite múltiplos (tool_choice: 'auto' não força paralelo) mas se
      // emitir, o segundo é dropado silenciosamente — customer pode ficar
      // sem resposta que dependia do segundo. Por enquanto log de warning
      // pra monitorar; refactor pra processar todos em sequência fica pra
      // próximo sprint (envolve cuidado com order de side-effects:
      // criar_pedido → button vs dispatch_trigger → escalation são fluxos
      // mutuamente exclusivos no design atual).
      if (choice.message.tool_calls.length > 1) {
        const names = choice.message.tool_calls.map((tc) => tc.type === 'function' ? tc.function.name : 'unknown').join(', ');
        console.warn(`[AI] Model emitted ${choice.message.tool_calls.length} tool_calls; processing only the first. Names: ${names}`);
      }
      const toolCall = choice.message.tool_calls[0];

      if (toolCall.type === 'function' && toolCall.function.name === 'criar_pedido') {
        // GUARDRAIL: block duplicate criar_pedido if this customer had an order confirmed
        // recently. Fast path: in-memory map (same pod). Slow path: DB lookup against
        // zelochat_orders.created_at — survives restart and cross-pod routing.
        const confirmKey = `${resolvedEmpresaId}:${jid}`;
        const confirmedAt = justConfirmedMap.get(confirmKey);
        const inMemoryRecent = !!confirmedAt && Date.now() - confirmedAt < JUST_CONFIRMED_TTL_MS;
        const dbRecent = inMemoryRecent
          ? false
          : await wasOrderRecentlyConfirmedInDb(resolvedEmpresaId, session.customerPhone);
        if (inMemoryRecent || dbRecent) {
          const ageLog = inMemoryRecent
            ? `${Math.round((Date.now() - (confirmedAt as number)) / 1000)}s ago (memory)`
            : '< 5min (db)';
          console.log(`[AI] Blocking duplicate criar_pedido for ${jid} — order was confirmed ${ageLog}`);
          const dupMsg = 'Seu pedido já foi confirmado! 😊 Qualquer dúvida é só chamar.';
          await sendTextMessage(jid, dupMsg, resolvedEmpresaId);
          await addAssistantMessage(jid, dupMsg, undefined, resolvedEmpresaId);
          return dupMsg;
        }

        let replyText: string;
        try {

          const args = JSON.parse(toolCall.function.arguments) as {
            customerName: string;
            customerPhone: string;
            items: { product: string; quantity: number }[];
            pickupDate: string;
            pickupTime: string;
            paymentMethod: string;
            total: number;
            orderType?: 'pickup' | 'delivery';
            deliveryAddress?: string;
            deliveryNeighborhood?: string;
            deliveryFee?: number;
            observations?: string;
          };

          if (!args.customerPhone) args.customerPhone = session.customerPhone;
          const cfg = getConfig(resolvedEmpresaId);
          const normalizedPickupDate = normalizeIsoDateInput(args.pickupDate);
          if (normalizedPickupDate) args.pickupDate = normalizedPickupDate;
          const normalizedPickupTimeMinutes = parseTimeToMinutes(args.pickupTime);
          if (normalizedPickupTimeMinutes !== null) {
            args.pickupTime = minutesToDisplay(normalizedPickupTimeMinutes);
          }
          const blockedPickupDate = normalizedPickupDate
            ? getBlockedDateByIso(resolvedEmpresaId, normalizedPickupDate)
            : null;
          if (blockedPickupDate) {
            console.log(`[AI] Blocking criar_pedido: pickupDate ${blockedPickupDate.date} is blocked for empresa=${resolvedEmpresaId} jid=${jid}`);
            return sendBlockedDateReply(jid, resolvedEmpresaId, blockedPickupDate);
          }
          const businessHoursIssue = normalizedPickupDate
            ? findBusinessHoursIssueForSchedule(resolvedEmpresaId, normalizedPickupDate, args.pickupTime)
            : null;
          if (businessHoursIssue) {
            console.log(`[AI] Blocking criar_pedido: pickup schedule outside business hours for empresa=${resolvedEmpresaId} jid=${jid}`);
            return sendBusinessHoursReply(jid, resolvedEmpresaId, businessHoursIssue);
          }

          const available = getAvailableProducts(resolvedEmpresaId);

          // Recalculate products subtotal server-side — never trust the model's arithmetic
          const recalcSubtotal = args.items.reduce((sum, item) => {
            const product = available.find(
              (p) => p.name.toLowerCase() === item.product.toLowerCase(),
            );
            return sum + (product ? product.price * item.quantity : 0);
          }, 0);

          // For delivery: resolve fee from config, ignore whatever the AI sent
          let resolvedDeliveryFee: number | undefined;
          if (args.orderType === 'delivery' && args.deliveryNeighborhood) {
            const configFee = resolveDeliveryFee(resolvedEmpresaId, args.deliveryNeighborhood);
            if (configFee === null) {
              // Neighborhood not covered — escalate to human via the standard escalation flow
              // (flips session to 'escalated', auto_reply=false, notifies manager, sends handoff text).
              console.log(`[AI] Delivery neighborhood not covered: "${args.deliveryNeighborhood}" — escalating`);
              await addAssistantMessage(jid, null, [toolCall], resolvedEmpresaId);
              await addToolMessage(jid, 'Endereço de entrega fora da área coberta — escalado para humano', toolCall.id, resolvedEmpresaId);

              const lastUserMsg = [...session.messages].reverse().find((m) => m.role === 'user');
              await escalateSession(resolvedEmpresaId, jid, {
                triggerId: null,
                triggerKind: 'escalate_human',
                triggerName: 'Endereço de entrega fora da área',
                reasonCategory: 'custom',
                reasonText: `IA não conseguiu identificar o bairro "${args.deliveryNeighborhood}" na lista de áreas cobertas. Atendente humano deve confirmar a disponibilidade de entrega.`,
                customerMessageExcerpt: lastUserMsg ? (buildContentForModel(lastUserMsg) || lastUserMsg.preview) : null,
              });

              resetAiFailureCounter(resolvedEmpresaId, jid);
              return handoffMessageFor('custom');
            }
            if (args.deliveryFee !== undefined && args.deliveryFee !== configFee) {
              console.warn(`[AI] deliveryFee mismatch for ${args.deliveryNeighborhood}: AI sent ${args.deliveryFee}, config says ${configFee}. Using config.`);
            }
            resolvedDeliveryFee = configFee;
            args.deliveryFee = configFee;
          }

          if (recalcSubtotal > 0) {
            args.total = Math.round((recalcSubtotal + (resolvedDeliveryFee ?? 0)) * 100) / 100;
          }

          const unmatchedItems = args.items.filter((item) =>
            !available.find((p) => p.name.toLowerCase() === item.product.toLowerCase()),
          );
          if (unmatchedItems.length > 0) {
            const names = unmatchedItems.map((i) => i.product).join(', ');
            const notFoundMsg = `Desculpe, não encontrei no cardápio: ${names}. Pode verificar o nome do produto? 😊`;
            await sendTextMessage(jid, notFoundMsg, resolvedEmpresaId);
            await addAssistantMessage(jid, notFoundMsg, undefined, resolvedEmpresaId);
            return notFoundMsg;
          }

          // Sanitize the customer-supplied observation BEFORE interpolating it into the
          // button summary (which is a model-visible string + sent to the customer).
          // safeForPrompt strips \r\n and ` < > so a multi-line paste can't break the
          // summary layout or smuggle prompt-injection markers.
          //
          // P1.18 — sanitize EVERY user-controlled string field, not just observations.
          // Antes só observations passava por safeForPrompt; customerName,
          // deliveryAddress etc. iam raw pro DB. Em turnos posteriores essas strings
          // são lidas de volta pra construir context — uma quebra de linha ou
          // backtick num customerName virava prompt-injection. Quantity, total,
          // deliveryFee são numbers — não precisam.
          const sanitizedName = safeForPrompt(args.customerName, 120);
          const sanitizedAddress = args.deliveryAddress ? safeForPrompt(args.deliveryAddress, 250) : undefined;
          const sanitizedNeighborhood = args.deliveryNeighborhood ? safeForPrompt(args.deliveryNeighborhood, 80) : undefined;
          const sanitizedPickupTime = safeForPrompt(args.pickupTime, 20);
          const sanitizedPayment = args.paymentMethod ? safeForPrompt(args.paymentMethod, 40) : undefined;
          const sanitizedObs = args.observations ? safeForPrompt(args.observations, 300) : '';

          // Persist pending order to Supabase (review fix C2 — survives restarts).
          // UPSERT semantics ensure two simultaneous criar_pedido calls don't create
          // duplicate rows; the latest payload wins.
          await setPendingOrder({
            empresaId: resolvedEmpresaId,
            jid,
            customerName: sanitizedName,
            customerPhone: args.customerPhone,
            items: args.items,
            pickupDate: args.pickupDate,
            pickupTime: sanitizedPickupTime,
            paymentMethod: sanitizedPayment,
            total: args.total,
            toolCallId: toolCall.id,
            orderType: args.orderType || 'pickup',
            deliveryAddress: sanitizedAddress,
            deliveryNeighborhood: sanitizedNeighborhood,
            deliveryFee: args.deliveryFee,
            observations: sanitizedObs || undefined,
          });
          const itemsList = args.items.map((i) => `${i.quantity}x ${i.product}`).join(', ');
          const isDelivery = args.orderType === 'delivery';
          const scheduleLabel = isDelivery ? '🛵 Entrega' : '📅 Retirada';
          const deliveryLine = isDelivery && args.deliveryAddress
            ? `\n📍 ${args.deliveryAddress}\n🏘️ Taxa (${args.deliveryNeighborhood}): R$ ${(args.deliveryFee ?? 0).toFixed(2)}`
            : '';
          const obsLine = sanitizedObs ? `\n📝 Obs: ${sanitizedObs}` : '';
          const summary = `📦 ${itemsList}${deliveryLine}${obsLine}\n${scheduleLabel}: ${args.pickupDate} às ${args.pickupTime}\n💳 Pagamento: ${args.paymentMethod}\n💰 Total: R$ ${args.total.toFixed(2)}`;

          try {
            await sendButtonMessage(
              jid,
              `Confirmar pedido — ${args.customerName}`,
              summary,
              cfg.name || 'ZeloChat',
              [
                { id: 'CONFIRM_ORDER', displayText: '✅ Confirmar' },
                { id: 'CANCEL_ORDER', displayText: '❌ Cancelar' },
              ],
              resolvedEmpresaId,
            );

            // Persist the tool sequence in history for audit (not replayed to OpenAI — see H3 invariant).
            await addToolMessage(jid, `Aguardando confirmação do cliente: ${summary}`, toolCall.id, resolvedEmpresaId);
            await addAssistantMessage(jid, summary, [toolCall], resolvedEmpresaId);

            console.log(`[AI] Pending order queued for button confirmation: ${jid}`);
            return summary;
          } catch (btnErr) {
            // Whatsmiau sometimes returns a non-2xx status for sendButtons even when
            // the message IS queued and delivered to WhatsApp. The previous fallback
            // (auto-confirm + clear pending) caused duplicate orders: the customer
            // would still see the buttons, tap Confirmar, the router would no longer
            // have a pending row to act on, and the click would leak to the AI which
            // then created a SECOND order via criar_pedido.
            //
            // Safer behavior: keep the pending row, ask for text confirmation. If the
            // buttons WERE delivered, tapping Confirmar finds the pending row and runs
            // confirmPendingOrder cleanly — no duplicate. If they weren't, the customer
            // replies "Sim" and the router's soft-confirm path picks it up.
            console.warn('[AI] sendButtonMessage failed; keeping pending row and asking for text confirmation:', btnErr);
            const promptMsg = `Para confirmar, é só responder *Sim* — ou *Não* para cancelar.\n\n${summary}`;
            await sendTextMessage(jid, promptMsg, resolvedEmpresaId);
            await addToolMessage(jid, `Aguardando confirmação por texto: ${summary}`, toolCall.id, resolvedEmpresaId);
            await addAssistantMessage(jid, promptMsg, undefined, resolvedEmpresaId);
            return promptMsg;
          }
        } catch (err) {
          replyText = 'Desculpe, tive um problema ao registrar seu pedido. Pode tentar novamente em instantes? 🙏';
          console.error('[AI] Failed to create order:', err);
          // P1.22 — best-effort cleanup de pending row órfã. Se setPendingOrder
          // SUCESSO mas alguma coisa downstream (sendButtonMessage / addToolMessage
          // / addAssistantMessage) falhou, ficaria pending row em DB sem o
          // customer ter visto os botões — o próximo "sim" dele cairia no soft-
          // confirm sobre uma order pending fantasma. Apaga o pending pra forçar
          // o customer a refazer o fluxo. Se setPendingOrder NUNCA rodou, o
          // delete é no-op (idempotent).
          await clearPendingOrder(jid, resolvedEmpresaId).catch((cleanupErr) =>
            console.warn('[AI] orphan pending cleanup failed:', cleanupErr),
          );
        }

        await sendTextMessage(jid, replyText, resolvedEmpresaId);
        await addAssistantMessage(jid, replyText, undefined, resolvedEmpresaId);
        return replyText;
      }

      if (toolCall.type === 'function' && toolCall.function.name === 'consultar_pedido') {
        let parsed: { orderShortId?: string } = {};
        try { parsed = JSON.parse(toolCall.function.arguments); } catch { /* ignore */ }
        const statusInfo = await fetchOrderForCustomer(
          resolvedEmpresaId,
          session.customerPhone,
          parsed.orderShortId,
        );

        // Complete the tool call within the SAME OpenAI request — H3 invariant.
        const followUp = await openai.chat.completions.create({
          model: OPENAI_MODEL,
          messages: [
            ...messages,
            choice.message,
            { role: 'tool', tool_call_id: toolCall.id, content: statusInfo } as any,
          ],
        });

        // Persist the audit trail. Order matters: assistant(tool_calls) → tool → assistant(text).
        await addAssistantMessage(jid, null, [toolCall], resolvedEmpresaId);
        await addToolMessage(jid, statusInfo, toolCall.id, resolvedEmpresaId);

        const followText = followUp.choices[0]?.message?.content?.trim()
          || 'Consultei aqui — qualquer outra dúvida é só chamar! 😊';
        const cleanFollow = followText.replace(/<ALERT>.*?<\/ALERT>/g, '').trim();
        await sendTextMessage(jid, cleanFollow, resolvedEmpresaId);
        await addAssistantMessage(jid, cleanFollow, undefined, resolvedEmpresaId);
        console.log(`[AI] consultar_pedido answered for ${jid}`);
        return cleanFollow;
      }

      if (toolCall.type === 'function' && toolCall.function.name === 'dispatch_trigger') {
        let parsedArgs: { trigger_id?: string; reason?: string } = {};
        try {
          parsedArgs = JSON.parse(toolCall.function.arguments);
        } catch {
          /* fall through */
        }

        const triggerId = parsedArgs.trigger_id || '';
        const trig = isBuiltinTriggerId(triggerId)
          ? getBuiltinTrigger(triggerId)
          : triggers.find((t) => t.id === triggerId) ?? null;
        const reason = (parsedArgs.reason || '').trim() || 'condição atendida';
        const cfg = getConfig(resolvedEmpresaId);
        const managerJid = cfg.managerPhone ? phoneToJid(cfg.managerPhone) : null;

        if (!trig) {
          console.warn('[AI] Unknown trigger_id from model:', triggerId);
          const fallback = choice.message.content?.trim()
            || 'Tudo certo! Se precisar de algo mais, é só chamar. 😊';

          await addToolMessage(jid, `Erro: gatilho ${triggerId} não encontrado`, toolCall.id, resolvedEmpresaId);
          await addAssistantMessage(jid, fallback, [toolCall], resolvedEmpresaId);

          await sendTextMessage(jid, fallback, resolvedEmpresaId);
          resetAiFailureCounter(resolvedEmpresaId, jid);
          return fallback;
        }

        if (trig.kind === 'escalate_human') {
          // Persist the tool-call audit row first so OpenAI history stays consistent
          // (assistant tool_call must have a matching tool result row); escalateSession
          // takes over from there: status flip, manager notification, customer handoff.
          await addAssistantMessage(jid, null, [toolCall], resolvedEmpresaId);
          await addToolMessage(jid, 'Atendimento escalado para humano', toolCall.id, resolvedEmpresaId);

          const lastUserMsg = [...session.messages].reverse().find((m) => m.role === 'user');
          const reasonCategory: ReasonCategory = isBuiltinTriggerId(triggerId)
            ? (triggerId === 'builtin:offensive'
                ? 'offensive_language'
                : triggerId === 'builtin:explicit_human'
                  ? 'explicit_human_request'
                  : 'complaint')
            : categorizeReason(`${trig.name} ${trig.conditionDescription}`);

          await escalateSession(resolvedEmpresaId, jid, {
            triggerId: isBuiltinTriggerId(triggerId) ? null : trig.id,
            triggerKind: 'escalate_human',
            triggerName: trig.name,
            reasonCategory,
            reasonText: reason,
            // Use buildContentForModel so audio messages surface as the Whisper
            // transcript ([Áudio: "..."]) or a clean [Áudio] placeholder — never
            // the raw __ZELOCHAT_MEDIA__ structured payload.
            customerMessageExcerpt: lastUserMsg ? (buildContentForModel(lastUserMsg) || lastUserMsg.preview) : null,
          });

          resetAiFailureCounter(resolvedEmpresaId, jid);
          return handoffMessageFor(reasonCategory);
        }

        // notify_manager — alert and continue the conversation
        if (managerJid) {
          try {
            await sendTextMessage(
              managerJid,
              `🔔 *${safeForPrompt(trig.name, 80)}*\nCliente: ${safeForPrompt(session.customerName, 80)} (${safeForPrompt(session.customerPhone, 30)})\nMotivo: ${safeForPrompt(reason, 300)}`,
              resolvedEmpresaId,
            );
          } catch (err) {
            console.warn('[AI] Failed to notify manager (alert):', err);
          }
        } else {
          console.warn('[AI] notify_manager triggered but managerPhone not configured.');
        }

        const followUp = await openai.chat.completions.create({
          model: OPENAI_MODEL,
          messages: [
            ...messages,
            choice.message,
            { role: 'tool', tool_call_id: toolCall.id, content: 'gerente notificado' } as any,
          ],
        });
        
        await addAssistantMessage(jid, null, [toolCall], resolvedEmpresaId);
        await addToolMessage(jid, 'Gerente notificado', toolCall.id, resolvedEmpresaId);
        const followText = followUp.choices[0]?.message?.content?.trim()
          || 'Beleza! Já anotei aqui. 👍';
        const cleanFollow = followText.replace(/<ALERT>.*?<\/ALERT>/g, '').trim();
        await sendTextMessage(jid, cleanFollow, resolvedEmpresaId);
        await addAssistantMessage(jid, cleanFollow, undefined, resolvedEmpresaId);
        console.log(`[AI] Dispatched notify_manager (${trig.name}) for ${jid}`);
        resetAiFailureCounter(resolvedEmpresaId, jid);
        return cleanFollow;
      }
    }

    const replyText = choice.message.content || 'Desculpe, deu um erro aqui. Pode repetir?';
    const cleanReply = replyText.replace(/<ALERT>.*?<\/ALERT>/g, '').trim();

    await sendTextMessage(jid, cleanReply, resolvedEmpresaId);
    await addAssistantMessage(jid, cleanReply, undefined, resolvedEmpresaId);

    console.log(`[AI] Replied to ${jid}: ${cleanReply.slice(0, 80)}...`);
    resetAiFailureCounter(resolvedEmpresaId, jid);
    return cleanReply;
  } catch (error: any) {
    console.error('[AI] Error generating reply:', error);
    if (error?.response?.data) {
      console.error('[AI] OpenAI Error data:', JSON.stringify(error.response.data));
    }
    // Record the failure. If this hits the threshold (2 consecutive failures on
    // the same conversation), recordAiFailure escalates and returns
    // {escalated:true} — in that case we DO NOT send the generic apology, since
    // the customer already received the action-oriented handoff message.
    let suppressApology = false;
    try {
      const lastUserMsg = (await getSession(jid, resolvedEmpresaId))
        ?.messages.slice().reverse().find((m) => m.role === 'user');
      const result = await recordAiFailure(
        resolvedEmpresaId,
        jid,
        error?.message || 'unknown',
        lastUserMsg?.content ?? lastUserMsg?.preview ?? null,
      );
      suppressApology = result.escalated;
    } catch (failureErr) {
      console.warn('[AI] recordAiFailure threw:', failureErr);
    }

    if (!suppressApology) {
      const errMsg = 'Desculpe, tive um probleminha aqui. Pode repetir sua mensagem? 🙏';
      try {
        await sendTextMessage(jid, errMsg, resolvedEmpresaId);
        await addAssistantMessage(jid, errMsg, undefined, resolvedEmpresaId);
      } catch {
        // ignore secondary failure
      }
    }
    return null;
  }
}
