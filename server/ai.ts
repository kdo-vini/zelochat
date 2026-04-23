import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions.js';
import { OpenAI } from 'openai';
import { getSession, addAssistantMessage, setAutoReply } from './messageHandler.js';
import { sendTextMessage } from './whatsapp.js';
import { getConfig } from './configStore.js';
import { getBoundEmpresaId, getServiceSupabase } from './supabase.js';
import { parseStructuredMessage, normalizePhoneNumber } from '../src/domain/chat.ts';
import { fetchActiveTriggers, type TriggerRecord } from './triggers.js';

const OPENAI_MODEL = 'gpt-4o-mini';

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
    total: number;
  },
): Promise<string> {
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
      delivery_address: null,
      driver_id: null,
      status: 'pending',
      total: args.total,
      source: 'whatsapp',
    })
    .select('id')
    .single();

  if (error) throw new Error(`Falha ao criar pedido: ${error.message}`);
  return (data as { id: string }).id;
}

function buildSystemInstruction(
  empresaId: string,
  upcomingOrders: string,
  customerPhone: string,
  customerHistory: string,
  triggers: TriggerRecord[],
): string {
  const cfg = getConfig(empresaId);

  const availableProducts = cfg.products.filter((p) => p.available)
    .map((p) => `${p.name} (R$ ${p.price.toFixed(2)})`).join(', ') || 'Cardápio não configurado';

  const blockedDatesStr = cfg.blockedDates.length > 0
    ? cfg.blockedDates.map((bd) => `${bd.date} (${bd.reason})`).join(', ')
    : 'Nenhuma';

  const dailyContextStr = cfg.dailyContext.length > 0
    ? `\n\nAVISOS DE HOJE:\n${cfg.dailyContext.map((c) => `- ${c.text}`).join('\n')}`
    : '';

  const todayLabel = DAY_LABELS[new Date().getDay()];
  const isClosedToday = cfg.closedDays.includes(todayLabel);
  const closedDayWarning = isClosedToday
    ? `\n\n⚠️ HOJE (${todayLabel}) É DIA DE FECHAMENTO. Informe educadamente que não estamos atendendo hoje e indique os dias em que abrimos: ${DAY_LABELS.filter((d) => !cfg.closedDays.includes(d)).join(', ')}. NÃO aceite pedidos para hoje.`
    : '';

  const triggersBlock = triggers.length > 0
    ? triggers.map((t) => `- id=${t.id} [${t.kind}] "${t.name}": ${t.conditionDescription}`).join('\n')
    : '- (nenhum gatilho configurado)';

  return `Você é o assistente virtual da ${cfg.name || 'lanchonete'}, especialista em ${cfg.specialty || 'atendimento ao cliente'}.
Linguagem: informal, simpática, estilo WhatsApp brasileiro (emojis moderados).

INFORMAÇÕES DA LANCHONETE:
- Cardápio disponível: ${availableProducts}
- Horário de funcionamento: ${cfg.hours || 'Consulte a loja'}
- Dias fechados: ${cfg.closedDays.join(', ') || 'Nenhum'}
- Endereço: ${cfg.address || 'Consulte a loja'}
- Chave Pix: ${cfg.pixKey || 'Consulte a loja'}
- Datas bloqueadas (sem encomendas): ${blockedDatesStr}${dailyContextStr}${closedDayWarning}

AGENDA — PEDIDOS DOS PRÓXIMOS 7 DIAS:
${upcomingOrders}

HISTÓRICO DESTE CLIENTE (${customerPhone || 'sem telefone'}):
${customerHistory}

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
2. Para encomendas, coletar OBRIGATORIAMENTE: produto, quantidade, data de retirada, horário, nome completo e telefone.
3. Quando o cliente CONFIRMAR um pedido com todos os dados coletados, chamar a função criar_pedido.
4. NUNCA confirme um pedido sem ter: produto, quantidade, data, horário, nome e telefone.
5. Após criar o pedido, informar o número de confirmação e instruções de pagamento (Pix: ${cfg.pixKey || 'consulte a loja'}).

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
        customerPhone: { type: 'string', description: 'Telefone do cliente com DDD' },
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
        total: { type: 'number', description: 'Valor total do pedido em reais' },
      },
      required: ['customerName', 'customerPhone', 'items', 'pickupDate', 'pickupTime', 'total'],
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

  const session = await getSession(jid, resolvedEmpresaId);
  if (!session) return null;

  const [upcomingOrders, customerHistory, triggers] = await Promise.all([
    fetchUpcomingOrders(resolvedEmpresaId),
    fetchCustomerHistory(resolvedEmpresaId, session.customerPhone),
    fetchActiveTriggers(resolvedEmpresaId),
  ]);

  const systemInstruction = buildSystemInstruction(
    resolvedEmpresaId,
    upcomingOrders,
    session.customerPhone,
    customerHistory,
    triggers,
  );

  try {
    const openai = getAI();
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemInstruction },
      ...session.messages.map((m) => ({
        role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: parseStructuredMessage(m.kind === 'text' ? m.content : m.preview).contentForModel,
      })),
    ];

    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.7,
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
            total: number;
          };

          const orderId = await createOrderInDb(resolvedEmpresaId, args);
          const shortId = orderId.slice(0, 8).toUpperCase();
          const itemsList = args.items.map((i) => `${i.quantity}x ${i.product}`).join(', ');
          const cfg = getConfig(resolvedEmpresaId);

          replyText = `✅ Pedido confirmado! Número: *#${shortId}*\n\n📦 ${itemsList}\n📅 Retirada: ${args.pickupDate} às ${args.pickupTime}\n💰 Total: R$ ${args.total.toFixed(2)}\n\nPagamento via Pix: *${cfg.pixKey || 'consulte a loja'}*\n\nQualquer dúvida é só chamar! 😊`;

          console.log(`[AI] Created order #${shortId} for ${jid}`);
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
          await sendTextMessage(jid, fallback);
          await addAssistantMessage(jid, fallback, undefined, resolvedEmpresaId);
          return fallback;
        }

        if (trig.kind === 'escalate_human') {
          await setAutoReply(jid, false, resolvedEmpresaId);
          const handoff = 'Entendi! Vou chamar um atendente pra te ajudar com isso. Só um instante 🙏';
          await sendTextMessage(jid, handoff);
          await addAssistantMessage(jid, handoff, undefined, resolvedEmpresaId);
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
          temperature: 0.7,
          messages: [
            ...messages,
            choice.message,
            { role: 'tool', tool_call_id: toolCall.id, content: 'gerente notificado' },
          ],
        });
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
  } catch (error) {
    console.error('[AI] Error generating reply:', error);
    return null;
  }
}
