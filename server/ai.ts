import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import { OpenAI } from 'openai';
import { getSession, addAssistantMessage } from './messageHandler.js';
import { sendTextMessage } from './whatsapp.js';
import { getConfig } from './configStore.js';
import { getBoundEmpresaId } from './supabase.js';
import { parseStructuredMessage } from '../src/domain/chat.ts';

const OPENAI_MODEL = 'gpt-4o-mini';

let ai: OpenAI | null = null;

export function getAI(): OpenAI {
  if (!ai) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY not set');
    ai = new OpenAI({ apiKey: key });
  }
  return ai;
}

function buildSystemInstruction(empresaId: string): string {
  const cfg = getConfig(empresaId);
  const availableProducts = cfg.products.filter(p => p.available)
    .map(p => `${p.name} (R$ ${p.price.toFixed(2)})`).join(', ') || 'Cardápio não configurado';
  const blockedDatesStr = cfg.blockedDates.length > 0
    ? cfg.blockedDates.map(bd => `${bd.date} (Motivo: ${bd.reason})`).join(', ')
    : 'Nenhuma data bloqueada';
  const dailyContextStr = cfg.dailyContext.length > 0
    ? `\n\nAVISOS DE HOJE:\n${cfg.dailyContext.map(c => `- ${c.text}`).join('\n')}`
    : '';

  return `
    Você é o assistente virtual da lanchonete ${cfg.name || 'da loja'}, especialista em ${cfg.specialty || 'atendimento'}.
    Sua linguagem deve ser informal, simpática e típica de WhatsApp brasileiro (pode usar emojis, mas sem exagero).

    INFORMAÇÕES DA LANCHONETE:
    - Cardápio Disponível: ${availableProducts}
    - Horário: ${cfg.hours || 'Consulte a loja'}
    - Fechado: ${cfg.closedDays.join(', ') || 'Consulte a loja'}
    - Encomendas: Qualquer quantidade, retirada no local.
    - Datas Bloqueadas: ${blockedDatesStr} (NÃO aceite encomendas nessas datas).${dailyContextStr}

    DIRETRIZES PERSONALIZADAS:
    ${cfg.aiInstructions || 'Siga o comportamento padrão de atendimento amigável.'}

    OBJETIVOS:
    1. Responder dúvidas sobre o cardápio e horários.
    2. Coletar dados para encomendas: Produto, Quantidade, Data de retirada, Nome e Telefone.
    3. NUNCA confirme uma encomenda sem coletar: produto, quantidade, data de retirada, nome e telefone.

    IMPORTANTE: Mantenha as respostas curtas e objetivas, como se estivesse digitando no celular.
  `.trim();
}

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

  const systemInstruction = buildSystemInstruction(resolvedEmpresaId);

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
    });

    const replyText = response.choices[0].message.content || 'Desculpe, deu um erro aqui. Pode repetir?';
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
