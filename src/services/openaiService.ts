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

const MAX_CONTENT_CHARS_PER_MSG = 3_000;

function contentForInternalAi(message: ChatMessage): string {
  const raw = message.content ?? message.preview ?? '';
  if (raw.length <= MAX_CONTENT_CHARS_PER_MSG) return raw;
  return raw.slice(0, MAX_CONTENT_CHARS_PER_MSG) + '…[truncado]';
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
  const availableProducts = state.products
    .filter(p => p.available && (!p.stockControlled || Number(p.stockQuantity ?? 0) > 0))
    .map(p => `${p.name} (R$ ${p.price.toFixed(2)}${p.stockControlled ? `; estoque atual: ${Math.max(0, Math.floor(Number(p.stockQuantity ?? 0)))}` : ''})`)
    .join(", ");
  const blockedDatesStr = state.blockedDates.length > 0
    ? state.blockedDates.map(bd => `${bd.date} (Motivo: ${bd.reason})`).join(", ")
    : "Nenhuma data bloqueada no momento.";

  const alertsStr = '';

  const systemInstruction = `
    Você é o assistente virtual da lanchonete ${state.businessInfo.name}, especialista em ${state.businessInfo.specialty}.
    Sua linguagem deve ser informal, simpática e típica de WhatsApp brasileiro (pode usar emojis, mas sem exagero).

    INFORMAÇÕES DA LANCHONETE:
    - Cardápio Disponível: ${availableProducts}
    - Horário: ${state.businessInfo.openTime}–${state.businessInfo.closeTime}
    - Fechado: ${state.businessInfo.closedDays.join(", ")}
    - Encomendas: Qualquer quantidade, retirada no local.
    - Datas Bloqueadas: ${blockedDatesStr} (NÃO aceite encomendas nessas datas e explique o EXATO motivo para o cliente).${alertsStr}

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

export interface ManualOrderDraftSuggestion {
  customerName?: string;
  customerPhone?: string;
  pickupDate?: string;
  pickupTime?: string;
  deliveryAddress?: string;
  paymentMethod?: string;
  observations?: string;
  items?: Array<{ product?: string; quantity?: number }>;
  total?: number | string;
}

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

export async function getManualOrderDraftSuggestion(
  history: ChatMessage[],
  options: {
    customerName?: string;
    customerPhone?: string;
  } = {},
): Promise<ManualOrderDraftSuggestion> {
  const historyMessages = history
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .filter((message) => !!contentForInternalAi(message).trim())
    .slice(-30)
    .map((message) => ({
      role: message.role === 'user' ? 'user' : 'assistant',
      content: contentForInternalAi(message),
    }));

  const nowContext = getBrazilNowContext();
  const customerName = options.customerName?.trim() || '';
  const customerPhone = options.customerPhone?.trim() || '';

  const systemInstruction = `
    Voce ajuda um atendente humano a montar um pedido manual com base na conversa do WhatsApp.

    CONTEXTO:
    - ${nowContext}
    - Nome atual do cliente no painel: ${customerName || 'nao informado'}
    - Telefone atual do cliente no painel: ${customerPhone || 'nao informado'}

    REGRAS:
    - Retorne APENAS um objeto JSON valido.
    - Extraia somente dados explicitamente ditos pelo cliente ou ja resumidos com alta confianca no historico.
    - Nao invente produto, quantidade, total, endereco, data, horario ou forma de pagamento.
    - Se faltar alguma informacao, devolva string vazia "" ou array vazio.
    - Se o cliente apenas agradecer, se despedir ou encerrar a conversa depois de um resumo do pedido, considere que nao houve nova observacao.
    - pickupDate deve sair em YYYY-MM-DD.
    - pickupTime deve sair em HH:MM.
    - total deve sair como numero em reais. Se nao der para confiar, use 0.
    - observations deve conter somente a observacao do pedido. Se o cliente nao tiver observacao, use "".
    - Em items, mantenha apenas itens com product preenchido e quantity > 0.

    FORMATO OBRIGATORIO:
    {
      "customerName": "",
      "customerPhone": "",
      "pickupDate": "",
      "pickupTime": "",
      "deliveryAddress": "",
      "paymentMethod": "",
      "observations": "",
      "items": [{ "product": "", "quantity": 1 }],
      "total": 0
    }
  `;

  const content = await callAI(
    [
      { role: 'system', content: systemInstruction },
      ...historyMessages,
      {
        role: 'user',
        content: 'Monte um rascunho de pedido manual com base nesta conversa.',
      },
    ],
    0.2,
    'json',
  );

  const cleaned = content.replace(/```json/gi, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(cleaned) as ManualOrderDraftSuggestion;
  return {
    customerName: typeof parsed.customerName === 'string' ? parsed.customerName.trim() : '',
    customerPhone: typeof parsed.customerPhone === 'string' ? parsed.customerPhone.trim() : '',
    pickupDate: typeof parsed.pickupDate === 'string' ? parsed.pickupDate.trim() : '',
    pickupTime: typeof parsed.pickupTime === 'string' ? parsed.pickupTime.trim() : '',
    deliveryAddress: typeof parsed.deliveryAddress === 'string' ? parsed.deliveryAddress.trim() : '',
    paymentMethod: typeof parsed.paymentMethod === 'string' ? parsed.paymentMethod.trim() : '',
    observations: typeof parsed.observations === 'string' ? parsed.observations.trim() : '',
    items: Array.isArray(parsed.items)
      ? parsed.items
          .map((item) => ({
            product: typeof item?.product === 'string' ? item.product.trim() : '',
            quantity: typeof item?.quantity === 'number' && Number.isFinite(item.quantity) ? item.quantity : 0,
          }))
          .filter((item) => item.product && item.quantity > 0)
      : [],
    total: typeof parsed.total === 'number' || typeof parsed.total === 'string' ? parsed.total : 0,
  };
}
