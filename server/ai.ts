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
}

const pendingOrders = new Map<string, PendingOrder>();

export function getPendingOrder(jid: string): PendingOrder | undefined {
  return pendingOrders.get(jid);
}

export function clearPendingOrder(jid: string): void {
  pendingOrders.delete(jid);
}

export async function confirmPendingOrder(jid: string): Promise<void> {
  console.log('[AI] confirmPendingOrder called for JID:', jid);
  const pending = pendingOrders.get(jid);
  if (!pending) {
    console.warn('[AI] confirmPendingOrder: No pending order found for JID:', jid);
    return;
  }
  pendingOrders.delete(jid);

  try {
    const orderId = await createOrderInDb(pending.empresaId, pending);
    const shortId = orderId.slice(0, 8).toUpperCase();
    const itemsList = pending.items.map((i) => `${i.quantity}x ${i.product}`).join(', ');
    const cfg = getConfig(pending.empresaId);
    const reply = `✅ Pedido confirmado! Número: *#${shortId}*\n\n📦 ${itemsList}\n📅 Retirada: ${pending.pickupDate} às ${pending.pickupTime}\n💳 Pagamento: ${pending.paymentMethod || 'Não informado'}\n💰 Total: R$ ${pending.total.toFixed(2)}\n\nPagamento via Pix: *${cfg.pixKey || 'consulte a loja'}*\n\nQualquer dúvida é só chamar! 😊`;
    await sendTextMessage(jid, reply);
    await addAssistantMessage(jid, reply, undefined, pending.empresaId);
    broadcast({ type: 'order_created', data: { orderId, empresaId: pending.empresaId } });
    console.log(`[AI] Confirmed pending order #${shortId} for ${jid}`);
  } catch (err) {
    console.error('[AI] Failed to confirm pending order:', err);
    const errMsg = 'Desculpe, tive um problema ao registrar seu pedido. Pode tentar novamente? 🙏';
    await sendTextMessage(jid, errMsg);
    await addAssistantMessage(jid, errMsg, undefined, pending.empresaId);
  }
}

export async function cancelPendingOrder(jid: string, empresaId: string): Promise<void> {
  pendingOrders.delete(jid);
  const reply = 'Tudo bem! Pedido cancelado. Se quiser fazer outro, é só me chamar 😊';
  await sendTextMessage(jid, reply);
  await addAssistantMessage(jid, reply, undefined, empresaId);
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
    const today = new Date().toISOString().split('T')[0];
    const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

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

    return data.map((o) => {
      const items = (o.items as { product: string; quantity: number }[])
        .map((i) => `${i.quantity}x ${i.product}`)
        .join(', ');
      return `- ${o.pickup_date} ${o.pickup_time} | ${o.customer_name} (${o.customer_phone}) | ${items} | R$${Number(o.total).toFixed(2)} | ${o.status}`;
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

    return matches.map((o) => {
      const items = (o.items as { product: string; quantity: number }[])
        .map((i) => `${i.quantity}x ${i.product}`)
        .join(', ');
      return `- ${o.pickup_date} ${o.pickup_time} | ${items} | R$${Number(o.total).toFixed(2)} | ${o.status}`;
    }).join('\n');
  } catch {
    return 'Histórico indisponível.';
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
): string {
  const cfg = getConfig(empresaId);

  const availableProducts = cfg.products.filter((p) => p.available)
    .map((p) => `${p.name} (R$ ${p.price.toFixed(2)})`).join(', ') || 'Cardápio não configurado';

  const catalogHierarchyStr = buildCatalogHierarchyBlock(cfg.catalogHierarchy);

  const blockedDatesStr = cfg.blockedDates.length > 0
    ? cfg.blockedDates.map((bd) => `${bd.date} (${bd.reason})`).join(', ')
    : 'Nenhuma';

  const dailyContextStr = cfg.dailyContext.length > 0
    ? `\n\nAVISOS DE HOJE:\n${cfg.dailyContext.map((c) => `- ${c.text}`).join('\n')}`
    : '';

  const todayLabelRaw = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', weekday: 'short',
  }).format(new Date()).toLowerCase();
  const todayLabelMap: Record<string, string> = {
    'dom.': 'Dom', 'seg.': 'Seg', 'ter.': 'Ter', 'qua.': 'Qua',
    'qui.': 'Qui', 'sex.': 'Sex', 'sáb.': 'Sáb',
  };
  const todayLabel = todayLabelMap[todayLabelRaw] ?? todayLabelRaw;
  const isClosedToday = cfg.closedDays.includes(todayLabel);
  const closedDayWarning = isClosedToday
    ? `\n\n⚠️ HOJE (${todayLabel}) É DIA DE FECHAMENTO. Informe educadamente que não estamos atendendo hoje e indique os dias em que abrimos: ${DAY_LABELS.filter((d) => !cfg.closedDays.includes(d)).join(', ')}. NÃO aceite pedidos para hoje.`
    : '';

  // Build full current date context — use Brazil timezone so Railway (UTC) never skips a day
  const now = new Date();
  function toIsoBrazil(d: Date): string {
    // Format in Brazil timezone (America/Sao_Paulo = UTC-3 / UTC-2 DST)
    const parts = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(d);
    const y = parts.find(p => p.type === 'year')?.value ?? '';
    const mo = parts.find(p => p.type === 'month')?.value ?? '';
    const dy = parts.find(p => p.type === 'day')?.value ?? '';
    return `${y}-${mo}-${dy}`;
  }
  function dayLabelBrazil(d: Date): string {
    const dow = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', weekday: 'short',
    }).format(d);
    // Map pt-BR short names to our DAY_LABELS array
    const map: Record<string, string> = {
      'dom.': 'Dom', 'seg.': 'Seg', 'ter.': 'Ter', 'qua.': 'Qua',
      'qui.': 'Qui', 'sex.': 'Sex', 'sáb.': 'Sáb',
    };
    return map[dow.toLowerCase()] ?? dow;
  }

  const todayISO = toIsoBrazil(now);
  const tomorrowISO = toIsoBrazil(new Date(now.getTime() + 86400000));
  const nextDays: string[] = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now.getTime() + i * 86400000);
    nextDays.push(`${dayLabelBrazil(d)} = ${toIsoBrazil(d)}`);
  }
  const nextDaysStr = nextDays.join(', ');

  const triggersBlock = triggers.length > 0
    ? triggers.map((t) => `- id=${t.id} [${t.kind}] "${t.name}": ${t.conditionDescription}`).join('\n')
    : '- (nenhum gatilho configurado)';

  return `Você é o assistente virtual da ${cfg.name || 'lanchonete'}, especialista em ${cfg.specialty || 'atendimento ao cliente'}.
Linguagem: informal, simpática, estilo WhatsApp brasileiro (emojis moderados).

DATA E HORA ATUAL (use SEMPRE, NUNCA invente datas ou anos):
- Hoje é ${todayLabel}, ${todayISO}
- Amanhã é ${tomorrowISO}
- Próximos 7 dias: ${nextDaysStr}
- Ao interpretar datas relativas ("sábado", "semana que vem", "amanhã"), calcule SEMPRE a partir da data de hoje acima.
- Se o cliente disser apenas o dia da semana, confirme antes de criar o pedido: "Seria para [dia], [YYYY-MM-DD]?"

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
3. Se o cliente informar data relativa (ex: "sábado"), CONFIRME a data absoluta: "Seria para sábado, [YYYY-MM-DD]?" e aguarde confirmação antes de criar o pedido.
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

  const [customerHistory, triggers] = await Promise.all([
    fetchCustomerHistory(resolvedEmpresaId, session.customerPhone),
    fetchActiveTriggers(resolvedEmpresaId),
  ]);

  const systemInstruction = buildSystemInstruction(
    resolvedEmpresaId,
    session.customerPhone,
    customerHistory,
    triggers,
  );

  // Signal "typing" while we wait for the AI — non-blocking, ignore failures
  void sendPresence(jid, 'composing');

  // Guard: if there is a pending order for this JID waiting for button confirmation,
  // do NOT send messages to the AI — it would create a duplicate order.
  if (getPendingOrder(jid)) {
    console.log(`[AI] Skipping AI reply for ${jid} — pending order awaiting button confirmation`);
    return null;
  }

  try {
    const openai = getAI();

    // Build messages array, correctly handling tool/system/assistant roles
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemInstruction },
      ...session.messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: m.content ? parseStructuredMessage(m.kind === 'text' ? m.content : m.preview).contentForModel : '',
        })),
    ];

    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      tools: [CREATE_ORDER_TOOL, DISPATCH_TRIGGER_TOOL],
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

          // Recalculate total server-side — never trust the model's arithmetic
          const recalcTotal = args.items.reduce((sum, item) => {
            const product = cfg.products.find(
              (p) => p.name.toLowerCase() === item.product.toLowerCase() && p.available,
            );
            return sum + (product ? product.price * item.quantity : 0);
          }, 0);
          if (recalcTotal > 0) args.total = Math.round(recalcTotal * 100) / 100;

          // Store as pending and send native button confirmation
          pendingOrders.set(jid, { empresaId: resolvedEmpresaId, jid, ...args });
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
            
            // CRITICAL: Must record both the tool result AND the assistant's tool call in history.
            // Otherwise, OpenAI will error on the next user message due to inconsistent history.
            await addToolMessage(jid, `Aguardando confirmação do cliente: ${summary}`, toolCall.id, resolvedEmpresaId);
            await addAssistantMessage(jid, summary, [toolCall], resolvedEmpresaId);

            console.log(`[AI] Pending order queued for button confirmation: ${jid}`);
            return summary;
          } catch (btnErr) {
            // Fallback: buttons not supported — confirm immediately via text
            console.warn('[AI] sendButtonMessage failed, confirming directly:', btnErr);
            pendingOrders.delete(jid);
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
          
          await addToolMessage(jid, 'Atendimento escalado para humano', toolCall.id, resolvedEmpresaId);
          await addAssistantMessage(jid, handoff, [toolCall], resolvedEmpresaId);
          
          await sendTextMessage(jid, handoff);
          if (managerJid) {
            try {
              await sendTextMessage(
                managerJid,
                `🆘 *Atendimento humano* — ${trig.name}\nCliente: ${session.customerName} (${session.customerPhone})\nMotivo: ${reason}\nAuto-resposta desativada.`,
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
              `🔔 *${trig.name}*\nCliente: ${session.customerName} (${session.customerPhone})\nMotivo: ${reason}`,
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
        
        await addToolMessage(jid, 'Gerente notificado', toolCall.id, resolvedEmpresaId);
        await addAssistantMessage(jid, null, [toolCall], resolvedEmpresaId);
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
