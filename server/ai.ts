import { OpenAI } from 'openai';
import { getSession, addAssistantMessage } from './messageHandler.js';
import { getSocket } from './whatsapp.js';

const OPENAI_MODEL = 'gpt-4o-mini';

let ai: OpenAI | null = null;

function getAI(): OpenAI {
  if (!ai) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY not set');
    ai = new OpenAI({ apiKey: key });
  }
  return ai;
}

/**
 * Builds the client system instruction for the AI.
 * Simplified server-side version — uses hardcoded business info for now.
 * TODO: Share state with frontend or load from a config file.
 */
function buildSystemInstruction(): string {
  return `
    Você é o assistente virtual da lanchonete Casa dos Salgados, especialista em Coxinhas e salgados variados.
    Sua linguagem deve ser informal, simpática e típica de WhatsApp brasileiro (pode usar emojis, mas sem exagero).

    INFORMAÇÕES DA LANCHONETE:
    - Cardápio Disponível: Coxinha de Frango (R$ 6,50), Coxinha Cremosa (R$ 7,00), Kibe (R$ 6,50), Enroladinho (R$ 6,50), Risole (R$ 6,50), Pastel (R$ 7,50), Coca-Cola 2L (R$ 12,00), Coca-Cola Zero Lata (R$ 6,00)
    - Horário: Segunda a Sábado, 9h às 18h
    - Fechado: Domingo
    - Encomendas: Qualquer quantidade, retirada no local.

    DIRETRIZES PERSONALIZADAS:
    Você é o assistente virtual da lanchonete Casa dos Salgados. Responda clientes pelo WhatsApp. Linguagem informal e simpática estilo BR.

    OBJETIVOS:
    1. Responder dúvidas sobre o cardápio e horários.
    2. Coletar dados para encomendas: Produto, Quantidade, Data de retirada, Nome e Telefone.
    3. Se o cliente pedir em uma data bloqueada ou domingo, explique educadamente o MOTIVO.
    4. NUNCA confirme uma encomenda sem ter coletado: produto, quantidade, data de retirada, nome e telefone do cliente.

    IMPORTANTE: Mantenha as respostas curtas e objetivas, como se estivesse digitando no celular.
  `.trim();
}

/**
 * Generates an AI reply for a customer session and sends it via WhatsApp.
 */
export async function generateAndSendReply(jid: string): Promise<string | null> {
  const session = getSession(jid);
  if (!session) return null;

  const sock = getSocket();
  if (!sock) return null;

  const systemInstruction = buildSystemInstruction();

  try {
    const openai = getAI();
    const messages: any[] = [
      { role: 'system', content: systemInstruction },
      ...session.messages.map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content
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

    // Send via Baileys
    await sock.sendMessage(jid, { text: cleanReply });

    // Store in session
    addAssistantMessage(jid, cleanReply);

    console.log(`[AI] Replied to ${jid}: ${cleanReply.slice(0, 80)}...`);
    return cleanReply;
  } catch (error) {
    console.error('[AI] Error generating reply:', error);
    return null;
  }
}
