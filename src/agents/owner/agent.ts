import { ai, GEMINI_MODEL } from '../shared/gemini';

const SYSTEM_INSTRUCTION = `
  Você é um classificador de comandos gerenciais para a lanchonete ZeloChat.
  O gerente digitou um recado/aviso operacional em linguagem natural (ex: falta de estoque, mudança de horário de hoje).
  Sua função é APENAS extrair do texto as diretrizes imperativas e diretas que a IA de Atendimento a Clientes deve seguir.

  REGRAS DE RETORNO:
  - Retorne APENAS um array JSON de strings com os "bullet points" extraídos. Zero formatação Markdown antes/depois do JSON.
  - Seja direto, claro e afirmativo.

  EXEMPLOS:
  Input: "Faltou massa hoje, nao tem coxinha nem risole, e avisa que vamos fechar as 16h hoje"
  Output: ["ESTOQUE ESGOTADO: Coxinha e Risole. Não venda.", "HORÁRIO ALTERADO: Fecharemos às 16h hoje."]
`.trim();

export async function getOwnerDailyResponse(managerInput: string): Promise<string[]> {
  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: managerInput }] }],
      config: { systemInstruction: SYSTEM_INSTRUCTION, responseMimeType: 'application/json' },
    });

    try {
      let text = response.text || '[]';
      text = text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(text);
    } catch (e) {
      console.error('Parse error in owner daily agent:', e);
      return [managerInput];
    }
  } catch (error) {
    console.error('Gemini Owner Error:', error);
    return [managerInput];
  }
}
