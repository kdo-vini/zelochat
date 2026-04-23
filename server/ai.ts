import { OpenAI } from 'openai';
import { getSession, addAssistantMessage } from './messageHandler.js';
import { sendTextMessage } from './whatsapp.js';
import { getConfig } from './configStore.js';
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

/**
 * Builds the system instruction for the AI using live business config synced from the frontend.
 */
function buildSystemInstruction(): string {
  const cfg = getConfig();
  const availableProducts = cfg.products.filter(p => p.available)
    .map(p => `${p.name} (R$ ${p.price.toFixed(2)})`).join(', ') || 'Cardápio não configurado';
  const blockedDatesStr = cfg.blockedDates.length > 0
    ? cfg.blockedDates.map(bd => `${bd.date} (Motivo: ${bd.reason})`).join(', ')
    : 'Nenhuma data bloqueada';
  const dailyContextStr = cfg.dailyContext.length > 0
    ? `\n\nAVISOS DE HOJE:\n${cfg.dailyContext.map(c => `- ${c.text}`).join('\n')}`
    : '';

  return `
    Você é o assistente virtual da lanchonete ${cfg.name}, especialista em ${cfg.specialty}.
    Sua linguagem deve ser informal, simpática e típica de WhatsApp brasileiro (pode usar emojis, mas sem exagero).

    INFORMAÇÕES DA LANCHONETE:
    - Cardápio Disponível: ${availableProducts}
    - Horário: ${cfg.hours}
    - Fechado: ${cfg.closedDays.join(', ')}
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

/**
 * Generates an AI reply for a customer session and sends it via WhatsApp.
 */
export async function generateAndSendReply(jid: string): Promise<string | null> {
  const session = await getSession(jid);
  if (!session) return null;

  const systemInstruction = buildSystemInstruction();

  try {
    const openai = getAI();
    const messages: any[] = [
      { role: 'system', content: systemInstruction },
      ...session.messages.map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: parseStructuredMessage(m.kind === 'text' ? m.content : m.preview).contentForModel,
      }))
    ];

    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: messages,
      temperature: 0.7,
    });

    const replyText = response.choices[0].message.content || 'Desculpe, deu um erro aqui. Pode repetir?';

    // Clean any <ALERT> tags before sending to WhatsApp
    const cleanReply = replyText.replace(/<ALERT>.*?<\/ALERT>/g, '').trim();

    await sendTextMessage(jid, cleanReply);

    // Store in session
    await addAssistantMessage(jid, cleanReply);

    console.log(`[AI] Replied to ${jid}: ${cleanReply.slice(0, 80)}...`);
    return cleanReply;
  } catch (error) {
    console.error('[AI] Error generating reply:', error);
    return null;
  }
}
