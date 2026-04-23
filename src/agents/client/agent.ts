import { ChatMessage } from '../../types/chat';
import { ClientContext } from './types';
import { buildClientSystemInstruction } from './prompt';
import { ai, GEMINI_MODEL } from '../shared/gemini';

export async function getClientResponse(
  ctx: ClientContext,
  history: ChatMessage[],
  userInput: string,
  now: Date = new Date()
): Promise<string> {
  const systemInstruction = buildClientSystemInstruction(ctx, now);

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        ...history.map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] })),
        { role: 'user', parts: [{ text: userInput }] },
      ],
      config: { systemInstruction, temperature: 0.7 },
    });
    return response.text || 'Desculpe, deu um erro aqui. Pode repetir?';
  } catch (error) {
    console.error('Gemini Client Error:', error);
    return 'Ops, tive um probleminha técnico. Pode tentar de novo?';
  }
}
