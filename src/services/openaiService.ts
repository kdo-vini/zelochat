import { ZeloState, ChatMessage } from "../types";
import { API_BASE } from "../config";

async function callAI(
  messages: { role: string; content: string }[],
  temperature = 0.7,
  responseFormat?: 'json'
): Promise<string> {
  const res = await fetch(`${API_BASE}/api/ai/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, temperature, responseFormat }),
  });
  if (!res.ok) throw new Error(`AI proxy error: ${res.status}`);
  const data = await res.json() as { content: string };
  return data.content;
}

/**
 * Agente 1: Atendimento ao Cliente (WhatsApp Style)
 */
export async function getClientResponse(
  state: ZeloState,
  history: ChatMessage[],
  userInput: string
) {
  const availableProducts = state.products.filter(p => p.available).map(p => `${p.name} (R$ ${p.price.toFixed(2)})`).join(", ");
  const blockedDatesStr = state.blockedDates.length > 0
    ? state.blockedDates.map(bd => `${bd.date} (Motivo: ${bd.reason})`).join(", ")
    : "Nenhuma data bloqueada no momento.";

  const dailyContextStr = state.dailyContext && state.dailyContext.length > 0
    ? `\n\nATENÇÃO - BASE DE CONHECIMENTO MOMENTÂNEA (AVISOS DE HOJE):\n${state.dailyContext.map(c => `- ${c.text}`).join('\n')}\n!!! VOCÊ DEVE OBEDECER E INFORMAR O CLIENTE SOBRE ESTAS REGRAS ACIMA SE O ASSUNTO FOR MENCIONADO !!!`
    : '';

  const activeAlerts = state.alertTriggers?.filter(t => t.active) || [];
  const alertsStr = activeAlerts.length > 0
    ? `\n\nGATILHOS DE ALERTA ATIVOS:\n${activeAlerts.map(t => `- ID: ${t.id} | Condição: ${t.name}`).join('\n')}\n\nREGRA CRÍTICA DE ALERTAS: Se a conversa do cliente atingir a condição descrita em algum dos gatilhos ativos, adicione o texto exato <ALERT>ID_DO_GATILHO</ALERT> no final da sua resposta (escondido do usuário). Exemplo: <ALERT>at-1</ALERT>`
    : '';

  const systemInstruction = `
    Você é o assistente virtual da lanchonete ${state.businessInfo.name}, especialista em ${state.businessInfo.specialty}.
    Sua linguagem deve ser informal, simpática e típica de WhatsApp brasileiro (pode usar emojis, mas sem exagero).

    INFORMAÇÕES DA LANCHONETE:
    - Cardápio Disponível: ${availableProducts}
    - Horário: ${state.businessInfo.hours}
    - Fechado: ${state.businessInfo.closedDays.join(", ")}
    - Encomendas: Qualquer quantidade, retirada no local.
    - Datas Bloqueadas: ${blockedDatesStr} (NÃO aceite encomendas nessas datas e explique o EXATO motivo para o cliente).${dailyContextStr}${alertsStr}

    DIRETRIZES PERSONALIZADAS:
    ${state.aiInstructions || "Siga o comportamento padrão de atendimento amigável."}

    OBJETIVOS:
    1. Responder dúvidas sobre o cardápio e horários.
    2. Coletar dados para encomendas: Produto, Quantidade, Data de retirada, Nome e Telefone.
    3. Se o cliente pedir em uma data bloqueada ou domingo, explique educadamente o MOTIVO e diga que não estamos aceitando para esse dia.

    IMPORTANTE: Mantenha as respostas curtas e objetivas, como se estivesse digitando no celular.
  `;

  try {
    const messages = [
      { role: "system", content: systemInstruction },
      ...history.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content })),
      { role: "user", content: userInput }
    ];

    return await callAI(messages, 0.7);
  } catch (error) {
    console.error("[openaiService] getClientResponse failed:", error);
    return "Ops, tive um probleminha técnico. Pode tentar de novo?";
  }
}

/**
 * Agente 2: Construção do Contexto Diário (Uso Interno)
 */
export async function getOwnerResponse(managerInput: string): Promise<string[]> {
  const systemInstruction = `
    Você é um classificador de comandos gerenciais para a lanchonete ZeloChat.
    O gerente digitou um recado/aviso operacional em linguagem natural (ex: falta de estoque, mudança de horário de hoje).
    Sua função é APENAS extrair do texto as diretrizes imperativas e diretas que a IA de Atendimento a Clientes deve seguir.

    REGRAS DE RETORNO:
    - Retorne APENAS um array JSON de strings com os "bullet points" extraídos. Zero formatação Markdown antes/depois do JSON.
    - Seja direto, claro e afirmativo.

    EXEMPLOS:
    Input: "Faltou massa hoje, nao tem coxinha nem risole, e avisa que vamos fechar as 16h hoje"
    Output: ["ESTOQUE ESGOTADO: Coxinha e Risole. Não venda.", "HORÁRIO ALTERADO: Fecharemos às 16h hoje."]
  `;

  try {
    const text = await callAI([
      { role: "system", content: systemInstruction },
      { role: "user", content: managerInput }
    ], 0);

    try {
      const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleaned) as string[];
    } catch(e) {
      console.error("[openaiService] getOwnerResponse parse failed:", e);
      return [managerInput];
    }
  } catch (error) {
    console.error("[openaiService] getOwnerResponse failed:", error);
    return [managerInput];
  }
}

/**
 * Agente 3: Gestão Geral (Conversacional interno)
 */
export async function getGeneralManagerResponse(
  history: ChatMessage[],
  userInput: string
) {
  const systemInstruction = `
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

    Mapeie os dias do mês corretamente baseando-se no contexto atual. Formate datas sempre YYYY-MM-DD no payload.
  `;

  try {
    const messages = [
      { role: "system", content: systemInstruction },
      ...history.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content })),
      { role: "user", content: userInput }
    ];

    const text = await callAI(messages, 0, 'json');

    try {
      return JSON.parse(text) as { reply: string; actions: unknown[] };
    } catch (e) {
      console.error("[openaiService] getGeneralManagerResponse parse failed:", e);
      return { reply: "Erro ao decodificar minha própria ação.", actions: [] };
    }
  } catch (error) {
    console.error("[openaiService] getGeneralManagerResponse failed:", error);
    return { reply: "Tive um erro ao processar seu comando.", actions: [] };
  }
}
