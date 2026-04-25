import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions.js';
import { OpenAI } from 'openai';
import { getSession, addAssistantMessage, addToolMessage, setAutoReply } from './messageHandler.js';
import { sendTextMessage, sendButtonMessage, sendPresence } from './whatsapp.js';
import { getConfig, type CatalogCategoriaGroup } from './configStore.js';
import { getBoundEmpresaId, getServiceSupabase } from './supabase.js';
import { parseStructuredMessage, normalizePhoneNumber } from '../src/domain/chat.js';
import { fetchActiveTriggers, type TriggerRecord } from './triggers.js';
import { broadcast } from './ws.js';

const OPENAI_MODEL = 'gpt-4o-mini';
const PENDING_ORDER_TTL_MIN = 30;

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
      .select('empresa_id, remote_jid, customer_name, customer_phone, items, pickup_date, pickup_time, payment_method, total, tool_call_id')
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
    const errMsg = 'Desculpe, tive um problema momentâneo. Toque em "✅ Confirmar" de novo, por favor. 🙏';
    await sendTextMessage(jid, errMsg);
    await addAssistantMessage(jid, errMsg, undefined, pending.empresaId);
    return;
  }

  await clearPendingOrder(jid, pending.empresaId);

  const shortId = orderId.slice(0, 8).toUpperCase();
  const itemsList = pending.items.map((i) => `${i.quantity}x ${i.product}`).join(', ');
  const cfg = getConfig(pending.empresaId);
  const reply = `✅ Pedido confirmado! Número: *#${shortId}*\n\n📦 ${itemsList}\n📅 Retirada: ${pending.pickupDate} às ${pending.pickupTime}\n💳 Pagamento: ${pending.paymentMethod || 'Não informado'}\n💰 Total: R$ ${pending.total.toFixed(2)}\n\nPagamento via Pix: *${cfg.pixKey || 'consulte a loja'}*\n\nQualquer dúvida é só chamar! 😊`;
  await sendTextMessage(jid, reply);
  await addAssistantMessage(jid, reply, undefined, pending.empresaId);
  broadcast({ type: 'order_created', data: { orderId, empresaId: pending.empresaId } });
  console.log(`[AI] Confirmed pending order #${shortId} for ${jid}`);
}

export async function cancelPendingOrder(jid: string, empresaId: string): Promise<void> {
  await clearPendingOrder(jid, empresaId);
  const reply = 'Tudo bem! Pedido cancelado. Se quiser fazer outro, é só me chamar 😊';
  await sendTextMessage(jid, reply);
  await addAssistantMessage(jid, reply, undefined, empresaId);
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

function phoneToJid(phone: string): string | null {
  let digits = normalizePhoneNumber(phone);
  if (!digits) return null;
  if (digits.length >= 10 && digits.length <= 11) digits = `55${digits}`;
  if (digits.length < 12) return null;
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
      const { data: driver } = await supabase
        .from('zelochat_drivers')
        .select('name')
        .eq('id', target.driver_id)
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
      delivery_address: null,
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

  const blockedDatesStr = cfg.blockedDates.length > 0
    ? cfg.blockedDates.map((bd) => `${bd.date} (${bd.reason})`).join(', ')
    : 'Nenhuma';

  const dailyContextStr = cfg.dailyContext.length > 0
    ? `\n\nAVISOS DE HOJE:\n${cfg.dailyContext.map((c) => `- ${c.text}`).join('\n')}`
    : '';

  const now = new Date();
  const todayLabel = dayLabelBrazil(now);
  const isClosedToday = cfg.closedDays.includes(todayLabel);
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
- Hoje é ${todayLabel}, ${todayBR} (interno: ${todayISO})
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
- Horário de funcionamento: ${cfg.hours || 'Consulte a loja'}
- Dias fechados: ${cfg.closedDays.join(', ') || 'Nenhum'}
- Endereço: ${cfg.address || 'Consulte a loja'}
- Chave Pix: ${cfg.pixKey || 'Consulte a loja'}
- Datas bloqueadas (sem encomendas): ${blockedDatesStr}${dailyContextStr}${closedDayWarning}

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

OBJETIVOS:
1. Responder dúvidas sobre cardápio, horários e disponibilidade.
2. Para encomendas, coletar: produto, quantidade, data de retirada, horário, nome do cliente E forma de pagamento.
3. Se o cliente informar data relativa (ex: "sábado"), CONFIRME a data absoluta no formato BR: "Seria para sábado, [DD/MM/AAAA], às [HH]h?" e aguarde confirmação antes de criar o pedido.
4. ASSIM QUE tiver TODOS os dados confirmados (produto, quantidade, data exata, horário, nome, pagamento), CHAME criar_pedido IMEDIATAMENTE.
5. NUNCA gere um resumo pedindo confirmação em texto — o botão de confirmação no sistema já faz isso.
6. NUNCA ofereça enviar comprovante de Pix. O cliente é quem deve enviar após pagar.

IMPORTANTE: Respostas curtas e objetivas, como quem digita no celular.`.trim();
}

const CREATE_ORDER_TOOL: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'criar_pedido',
    description: 'Cria um novo pedido no sistema quando o cliente confirmar todos os dados necessários.',
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
        pickupDate: { type: 'string', description: 'Data de retirada no formato YYYY-MM-DD' },
        pickupTime: { type: 'string', description: 'Horário de retirada no formato HH:MM' },
        paymentMethod: { type: 'string', description: 'Forma de pagamento escolhida pelo cliente (ex: Pix, Dinheiro, Cartão)' },
        total: { type: 'number', description: 'Valor total do pedido em reais' },
      },
      required: ['customerName', 'items', 'pickupDate', 'pickupTime', 'paymentMethod', 'total'],
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

export async function generateAndSendReply(
  jid: string,
  empresaId?: string,
): Promise<string | null> {
  const resolvedEmpresaId = empresaId ?? getBoundEmpresaId();
  if (!resolvedEmpresaId) {
    console.warn('[AI] Cannot generate reply — no empresa bound for jid:', jid);
    return null;
  }

  // Global kill-switch — dono can disable the assistant without dropping the WhatsApp session.
  if (getConfig(resolvedEmpresaId).aiEnabled === false) {
    console.log(`[AI] Global AI disabled for empresa ${resolvedEmpresaId} — skipping reply to ${jid}`);
    return null;
  }

  const session = await getSession(jid, resolvedEmpresaId);
  if (!session) return null;

  // FIX H4: if there is a pending order and the customer typed text instead of clicking
  // the confirm/cancel button, treat it as edit intent — clear the pending state and let
  // the AI handle the new turn. Otherwise the message would be silently dropped.
  const pendingForEdit = await getPendingOrder(jid, resolvedEmpresaId);
  if (pendingForEdit) {
    console.log(`[AI] Pending order detected as text-during-pending for ${jid} — clearing and re-engaging.`);
    await clearPendingOrder(jid, resolvedEmpresaId);
    const editAck = 'Beleza, vamos ajustar! Me conta o que mudou. 😊';
    await sendTextMessage(jid, editAck);
    await addAssistantMessage(jid, editAck, undefined, resolvedEmpresaId);
    return editAck;
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
  void sendPresence(jid, 'composing');

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
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemInstruction },
      ...session.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .filter((m) => !!m.content) // skip tool-call-only assistant rows (content is null)
        .map((m) => ({
          role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: m.content ? parseStructuredMessage(m.kind === 'text' ? m.content : m.preview).contentForModel : '',
        })),
    ];

    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      tools: [CREATE_ORDER_TOOL, CONSULT_ORDER_TOOL, DISPATCH_TRIGGER_TOOL],
      tool_choice: 'auto',
    });

    const choice = response.choices[0];

    if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls?.length) {
      const toolCall = choice.message.tool_calls[0];

      if (toolCall.type === 'function' && toolCall.function.name === 'criar_pedido') {
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
          };

          if (!args.customerPhone) args.customerPhone = session.customerPhone;
          const cfg = getConfig(resolvedEmpresaId);
          const available = getAvailableProducts(resolvedEmpresaId);

          // Recalculate total server-side — never trust the model's arithmetic
          const recalcTotal = args.items.reduce((sum, item) => {
            const product = available.find(
              (p) => p.name.toLowerCase() === item.product.toLowerCase(),
            );
            return sum + (product ? product.price * item.quantity : 0);
          }, 0);
          if (recalcTotal > 0) args.total = Math.round(recalcTotal * 100) / 100;

          const unmatchedItems = args.items.filter((item) =>
            !available.find((p) => p.name.toLowerCase() === item.product.toLowerCase()),
          );
          if (unmatchedItems.length > 0) {
            const names = unmatchedItems.map((i) => i.product).join(', ');
            const notFoundMsg = `Desculpe, não encontrei no cardápio: ${names}. Pode verificar o nome do produto? 😊`;
            await sendTextMessage(jid, notFoundMsg);
            await addAssistantMessage(jid, notFoundMsg, undefined, resolvedEmpresaId);
            return notFoundMsg;
          }

          // Persist pending order to Supabase (review fix C2 — survives restarts).
          // UPSERT semantics ensure two simultaneous criar_pedido calls don't create
          // duplicate rows; the latest payload wins.
          await setPendingOrder({
            empresaId: resolvedEmpresaId,
            jid,
            customerName: args.customerName,
            customerPhone: args.customerPhone,
            items: args.items,
            pickupDate: args.pickupDate,
            pickupTime: args.pickupTime,
            paymentMethod: args.paymentMethod,
            total: args.total,
            toolCallId: toolCall.id,
          });
          const itemsList = args.items.map((i) => `${i.quantity}x ${i.product}`).join(', ');
          const summary = `📦 ${itemsList}\n📅 ${args.pickupDate} às ${args.pickupTime}\n💳 Pagamento: ${args.paymentMethod}\n💰 R$ ${args.total.toFixed(2)}`;

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
            );

            // Persist the tool sequence in history for audit (not replayed to OpenAI — see H3 invariant).
            await addToolMessage(jid, `Aguardando confirmação do cliente: ${summary}`, toolCall.id, resolvedEmpresaId);
            await addAssistantMessage(jid, summary, [toolCall], resolvedEmpresaId);

            console.log(`[AI] Pending order queued for button confirmation: ${jid}`);
            return summary;
          } catch (btnErr) {
            // Fallback: buttons not supported — confirm immediately via text
            console.warn('[AI] sendButtonMessage failed, confirming directly:', btnErr);
            await clearPendingOrder(jid, resolvedEmpresaId);
            const orderId = await createOrderInDb(resolvedEmpresaId, args);
            const shortId = orderId.slice(0, 8).toUpperCase();
            replyText = `✅ Pedido confirmado! Número: *#${shortId}*\n\n📦 ${itemsList}\n📅 Retirada: ${args.pickupDate} às ${args.pickupTime}\n💳 Pagamento: ${args.paymentMethod}\n💰 Total: R$ ${args.total.toFixed(2)}\n\nPagamento via Pix: *${cfg.pixKey || 'consulte a loja'}*\n\nQualquer dúvida é só chamar! 😊`;
          }
        } catch (err) {
          replyText = 'Desculpe, tive um problema ao registrar seu pedido. Pode tentar novamente em instantes? 🙏';
          console.error('[AI] Failed to create order:', err);
        }

        await sendTextMessage(jid, replyText);
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
        await sendTextMessage(jid, cleanFollow);
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

        const trig = triggers.find((t) => t.id === parsedArgs.trigger_id);
        const reason = (parsedArgs.reason || '').trim() || 'condição atendida';
        const cfg = getConfig(resolvedEmpresaId);
        const managerJid = cfg.managerPhone ? phoneToJid(cfg.managerPhone) : null;

        if (!trig) {
          console.warn('[AI] Unknown trigger_id from model:', parsedArgs.trigger_id);
          const fallback = choice.message.content?.trim()
            || 'Tudo certo! Se precisar de algo mais, é só chamar. 😊';
          
          await addToolMessage(jid, `Erro: gatilho ${parsedArgs.trigger_id} não encontrado`, toolCall.id, resolvedEmpresaId);
          await addAssistantMessage(jid, fallback, [toolCall], resolvedEmpresaId);
          
          await sendTextMessage(jid, fallback);
          return fallback;
        }

        if (trig.kind === 'escalate_human') {
          await setAutoReply(jid, false, resolvedEmpresaId);
          const handoff = 'Entendi! Vou chamar um atendente pra te ajudar com isso. Só um instante 🙏';
          
          await addAssistantMessage(jid, handoff, [toolCall], resolvedEmpresaId);
          await addToolMessage(jid, 'Atendimento escalado para humano', toolCall.id, resolvedEmpresaId);
          
          await sendTextMessage(jid, handoff);
          if (managerJid) {
            try {
              await sendTextMessage(
                managerJid,
                `🆘 *Atendimento humano* — ${safeForPrompt(trig.name, 80)}\nCliente: ${safeForPrompt(session.customerName, 80)} (${safeForPrompt(session.customerPhone, 30)})\nMotivo: ${safeForPrompt(reason, 300)}\nAuto-resposta desativada.`,
              );
            } catch (err) {
              console.warn('[AI] Failed to notify manager (escalate):', err);
            }
          } else {
            console.warn('[AI] Escalation triggered but managerPhone not configured.');
          }
          console.log(`[AI] Escalated to human (${trig.name}) for ${jid}`);
          return handoff;
        }

        // notify_manager — alert and continue the conversation
        if (managerJid) {
          try {
            await sendTextMessage(
              managerJid,
              `🔔 *${safeForPrompt(trig.name, 80)}*\nCliente: ${safeForPrompt(session.customerName, 80)} (${safeForPrompt(session.customerPhone, 30)})\nMotivo: ${safeForPrompt(reason, 300)}`,
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
        await sendTextMessage(jid, cleanFollow);
        await addAssistantMessage(jid, cleanFollow, undefined, resolvedEmpresaId);
        console.log(`[AI] Dispatched notify_manager (${trig.name}) for ${jid}`);
        return cleanFollow;
      }
    }

    const replyText = choice.message.content || 'Desculpe, deu um erro aqui. Pode repetir?';
    const cleanReply = replyText.replace(/<ALERT>.*?<\/ALERT>/g, '').trim();

    await sendTextMessage(jid, cleanReply);
    await addAssistantMessage(jid, cleanReply, undefined, resolvedEmpresaId);

    console.log(`[AI] Replied to ${jid}: ${cleanReply.slice(0, 80)}...`);
    return cleanReply;
  } catch (error: any) {
    console.error('[AI] Error generating reply:', error);
    if (error?.response?.data) {
      console.error('[AI] OpenAI Error data:', JSON.stringify(error.response.data));
    }
    const errMsg = 'Desculpe, tive um probleminha aqui. Pode repetir sua mensagem? 🙏';
    try {
      await sendTextMessage(jid, errMsg);
      await addAssistantMessage(jid, errMsg, undefined, resolvedEmpresaId);
    } catch {
      // ignore secondary failure
    }
    return null;
  }
}
