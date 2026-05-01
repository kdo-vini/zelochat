import { ZeloState, ChatMessage } from "../types";
import { API_BASE, apiFetch } from "../config";
import { supabase } from "./supabaseClient";

async function callAI(
  messages: { role: string; content: string }[],
  temperature = 0.7,
  responseFormat?: 'json'
): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('AI proxy error: not authenticated');

  const res = await apiFetch(`${API_BASE}/api/ai/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ messages, temperature, responseFormat }),
  });
  if (!res.ok) throw new Error(`AI proxy error: ${res.status}`);
  const data = await res.json() as { content: string };
  return data.content;
}

function contentForInternalAi(message: ChatMessage): string {
  return message.content ?? message.preview ?? '';
}

function getBrazilNowContext(): string {
  const now = new Date();
  const date = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(now);
  const time = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
  return `Data e hora atuais em Brasília: ${date}, ${time}. Use este ano e esta data como referência. Ignore datas antigas do histórico.`;
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

  const alertsStr = '';

  const systemInstruction = `
    Você é o assistente virtual da lanchonete ${state.businessInfo.name}, especialista em ${state.businessInfo.specialty}.
    Sua linguagem deve ser informal, simpática e típica de WhatsApp brasileiro (pode usar emojis, mas sem exagero).

    INFORMAÇÕES DA LANCHONETE:
    - Cardápio Disponível: ${availableProducts}
    - Horário: ${state.businessInfo.openTime}–${state.businessInfo.closeTime}
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
      ...history.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: contentForInternalAi(m) })),
      { role: "user", content: userInput }
    ];

    return await callAI(messages, 0.7);
  } catch (error) {
    console.error("[openaiService] getClientResponse failed:", error);
    return "Ops, tive um probleminha técnico. Pode tentar de novo?";
  }
}

/**
 * Gera um prompt mestre inicial usando IA — chamado pelo botão ✨ no Cérebro IA.
 */
export async function generateAgentInstructions(hint?: string): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('AI proxy error: not authenticated');

  const res = await apiFetch(`${API_BASE}/api/ai/generate-instructions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ hint: hint?.trim() || undefined }),
  });
  if (!res.ok) throw new Error(`AI generate error: ${res.status}`);
  const data = await res.json() as { instructions: string };
  return data.instructions || '';
}

/**
 * Agente 2: Construção do Contexto Diário (Uso Interno)
 */
/**
 * Simulador do atendimento automatico, sem WhatsApp e sem escrita no banco.
 */
export interface SimulateAtendimentoPayload {
  customerMessage: string;
  customerName?: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  configOverride?: {
    aiInstructions?: string;
    storeName?: string;
  };
}

export interface SimulateAtendimentoResult {
  reply: string;
  toolCallsMade: string[];
  wouldCreateOrder: boolean;
  simulationNote: string;
}

export async function simulateAtendimento(
  payload: SimulateAtendimentoPayload,
): Promise<SimulateAtendimentoResult> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('AI simulate error: not authenticated');

  const res = await apiFetch(`${API_BASE}/api/ai/simulate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || `AI simulate error: ${res.status}`);
  }
  return await res.json() as SimulateAtendimentoResult;
}

/**
 * Agente 2: Construcao do Contexto Diario (Uso Interno)
 */
export async function getOwnerResponse(managerInput: string): Promise<string[]> {
  const nowContext = getBrazilNowContext();
  const systemInstruction = `
    Você é um classificador de comandos gerenciais para a lanchonete ZeloChat.
    O gerente digitou um recado/aviso operacional em linguagem natural (ex: falta de estoque, mudança de horário de hoje).
    Sua função é APENAS extrair do texto as diretrizes imperativas e diretas que a IA de Atendimento a Clientes deve seguir.

    CONTEXTO ATUAL:
    - ${nowContext}

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
  const nowContext = getBrazilNowContext();
  const systemInstruction = `
    Você é o Assistente de Gestão Geral da Lanchonete ZeloChat.
    Você conversa com a dona da lanchonete para realizar configurações estruturais do sistema, como bloquear dias no calendário.

    CONTEXTO ATUAL OBRIGATÓRIO:
    - ${nowContext}
    - Ao interpretar "hoje", "amanhã", "sexta", "dia 1" ou qualquer data relativa, use SEMPRE o contexto atual acima.
    - Se o histórico trouxer anos antigos, como 2023, ignore para cálculo de novas ações.

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
      ...history.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: contentForInternalAi(m) })),
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

type ManualChatAssistMode = 'improve' | 'reply';

export async function getManualChatAssistSuggestion(
  history: ChatMessage[],
  options: {
    mode: ManualChatAssistMode;
    draft?: string;
    customerName?: string;
  },
): Promise<string> {
  const { mode, draft, customerName } = options;
  const trimmedDraft = draft?.trim() ?? '';
  const historyMessages = history
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .filter((message) => !!contentForInternalAi(message).trim())
    .slice(-20)
    .map((message) => ({
      role: message.role === 'user' ? 'user' : 'assistant',
      content: contentForInternalAi(message),
    }));

  const nowContext = getBrazilNowContext();
  const customerLine = customerName?.trim()
    ? `Nome do cliente no chat: ${customerName.trim()}.`
    : 'Nome do cliente indisponível.';

  const systemInstruction = mode === 'improve'
    ? `
      Você é um assistente de escrita para atendimento manual no WhatsApp de uma lanchonete brasileira.
      Sua tarefa é MELHORAR a mensagem escrita pelo atendente humano, sem parecer um robô.

      CONTEXTO:
      - ${nowContext}
      - ${customerLine}

      REGRAS:
      - Preserve a intenção da mensagem original.
      - Corrija erros, melhore clareza e deixe mais simpática.
      - Mantenha tom humano, natural e curto, típico de WhatsApp.
      - Não invente informações que não estejam no histórico nem no rascunho.
      - Não use markdown, aspas, listas, nem explicações sobre o que você fez.
      - Retorne APENAS a mensagem final pronta para colar e enviar.
    `
    : `
      Você é um assistente de sugestão para atendimento manual no WhatsApp de uma lanchonete brasileira.
      Sua tarefa é SUGERIR uma resposta para o atendente humano com base no histórico da conversa.

      CONTEXTO:
      - ${nowContext}
      - ${customerLine}

      REGRAS:
      - Considere o histórico inteiro antes de responder.
      - Escreva uma resposta curta, educada, natural e humana.
      - Não invente preço, prazo, produto ou regra que não apareça no histórico.
      - Se faltar contexto para cravar algo, responda pedindo a informação que falta de forma simpática.
      - Não use markdown, aspas, listas, nem explicações sobre o raciocínio.
      - Retorne APENAS a mensagem final pronta para colar e enviar.
    `;

  const messages = [
    { role: 'system', content: systemInstruction },
    ...historyMessages,
  ];

  if (mode === 'improve') {
    messages.push({
      role: 'user',
      content: `Melhore esta mensagem do atendente, mantendo a intenção original:\n${trimmedDraft}`,
    });
  } else {
    messages.push({
      role: 'user',
      content: 'Sugira a próxima resposta do atendente para este cliente com base no histórico.',
    });
  }

  return callAI(messages, 0.4);
}
