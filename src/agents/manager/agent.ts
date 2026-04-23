import { ChatMessage } from '../../types/chat';
import { ManagerAgentResponse } from './types';
import { ai, GEMINI_MODEL } from '../shared/gemini';

const SYSTEM_INSTRUCTION = `
  Você é o Assistente de Gestão Geral da Lanchonete ZeloChat.
  Você conversa com a dona da lanchonete para realizar configurações estruturais do sistema, como bloquear dias no calendário.

  REGRA DE BLOQUEIO DE CALENDÁRIO:
  - A dona pode pedir para bloquear dias (ex: "não vamos abrir dia x, y e z").
  - Se a dona não informar O MOTIVO do bloqueio na mesma frase, você deve PERGUNTAR antes de efetuar a ação. NÃO DEVOLVA AÇÃO SE NÃO TIVER O MOTIVO.
  - O motivo será revelado aos clientes se eles tentarem pedir nesta data, então ele deve ser claro e profissional.

  REGRAS DE RETORNO (JSON OBRIGATÓRIO):
  Responda em formato JSON contendo DOIS CAMPOS:
  1. "reply": A sua resposta de texto para a dona.
  2. "actions": Um array de objetos de ações a executar (vazio [] se não houver ação ou se ainda estiver aguardando o motivo).

  Tipos de Action suportados:
  - { "type": "BLOCK_DATE", "payload": { "date": "YYYY-MM-DD", "reason": "Motivo claro" } }
  - { "type": "SET_PRODUCT_AVAILABILITY", "payload": { "name": "Nome do produto", "available": false } }

  Mapeie os dias do mês corretamente baseando-se no contexto atual (Estamos prestando serviço para Abril de 2026). Formate datas sempre YYYY-MM-DD no payload.
`.trim();

export async function getManagerResponse(
  history: ChatMessage[],
  userInput: string
): Promise<ManagerAgentResponse> {
  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        ...history.map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] })),
        { role: 'user', parts: [{ text: userInput }] },
      ],
      config: { systemInstruction: SYSTEM_INSTRUCTION, responseMimeType: 'application/json' },
    });

    try {
      let text = response.text || '{"reply": "Não entendi", "actions": []}';
      text = text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(text);
    } catch (e) {
      return { reply: 'Erro ao decodificar minha própria ação.', actions: [] };
    }
  } catch (error) {
    console.error('Gemini Manager Error:', error);
    return { reply: 'Tive um erro ao processar seu comando.', actions: [] };
  }
}
