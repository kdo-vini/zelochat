import type { ChatMessage } from '../types';
import type { OrderFocusRequest } from './orderFocus';

export type ChatEventTone = 'success' | 'pending' | 'warning' | 'info' | 'danger';

export type ChatEventCardData = {
  kind:
    | 'tool_generic'
    | 'tool_error'
    | 'pending_confirmation'
    | 'pending_text_confirmation'
    | 'pending_pix_receipt'
    | 'pending_order_echo'
    | 'zelomenu_order_received'
    | 'order_confirmed'
    | 'order_already_confirmed'
    | 'escalated'
    | 'manager_notified';
  title: string;
  subtitle?: string;
  badge?: string;
  tone: ChatEventTone;
  lines: string[];
  focusRequest?: OrderFocusRequest;
  actionLabel?: string;
  sendFailed?: boolean;
};

function stripSendFailurePrefix(text: string): { cleanText: string; sendFailed: boolean } {
  const marker = '[FALHA NO ENVIO — reenviar manualmente]';
  if (!text.startsWith(marker)) return { cleanText: text.trim(), sendFailed: false };
  return {
    cleanText: text.slice(marker.length).trim(),
    sendFailed: true,
  };
}

function cleanLine(line: string): string {
  return line.trim();
}

function splitNonEmptyLines(text: string): string[] {
  return text
    .split('\n')
    .map(cleanLine)
    .filter(Boolean);
}

function stripPrefix(text: string, prefix: string): string {
  if (!text.startsWith(prefix)) return text;
  return text.slice(prefix.length).trim();
}

function parseMoney(value: string): number | undefined {
  const normalized = value
    .replace(/\s/g, '')
    .replace(/[R$]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOrderContextFromLines(
  lines: string[],
  customerPhone?: string,
): OrderFocusRequest | undefined {
  const joined = lines.join('\n');
  const shortIdMatch = joined.match(/#([A-Z0-9]{6,8})/i);
  const scheduleMatch = joined.match(
    /(?:📅\s*Retirada|🛵\s*Entrega):\s*(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})\s+às\s+(\d{2}:\d{2})/i,
  );
  const totalMatch = joined.match(/💰\s*Total:\s*R\$\s*([0-9.,]+)/i);

  const pickupDate = (() => {
    const raw = scheduleMatch?.[1];
    if (!raw) return undefined;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const [day, month, year] = raw.split('/');
    if (!day || !month || !year) return undefined;
    return `${year}-${month}-${day}`;
  })();

  const focusRequest: OrderFocusRequest = {
    source: 'chat',
    shortId: shortIdMatch?.[1]?.toUpperCase(),
    customerPhone,
    pickupDate,
    pickupTime: scheduleMatch?.[2],
    total: totalMatch ? parseMoney(totalMatch[1]) : undefined,
  };

  return focusRequest.shortId || focusRequest.customerPhone || focusRequest.pickupDate || focusRequest.pickupTime || Number.isFinite(focusRequest.total)
    ? focusRequest
    : undefined;
}

function parsePendingSummary(
  rawText: string,
  prefix: string,
  customerPhone?: string,
): Pick<ChatEventCardData, 'lines' | 'focusRequest'> {
  const summary = stripPrefix(rawText, prefix);
  const lines = splitNonEmptyLines(summary);
  return {
    lines,
    focusRequest: parseOrderContextFromLines(lines, customerPhone),
  };
}

function getToolCallNames(message: ChatMessage): string[] {
  return Array.isArray(message.tool_calls)
    ? message.tool_calls
      .map((toolCall) => {
        if (!toolCall || typeof toolCall !== 'object') return null;
        const maybeName = (toolCall as { function?: { name?: unknown } }).function?.name;
        return typeof maybeName === 'string' ? maybeName : null;
      })
      .filter((name): name is string => Boolean(name))
    : [];
}

export function parseChatEventCard(
  message: ChatMessage,
  customerPhone?: string,
): ChatEventCardData | null {
  if (message.kind !== 'text') return null;

  const rawText = (message.content ?? '').trim();
  const { cleanText, sendFailed } = stripSendFailurePrefix(rawText);
  const toolCallNames = getToolCallNames(message);
  const hasCreateOrderTool = toolCallNames.includes('criar_pedido');

  if (message.role === 'assistant' && hasCreateOrderTool && !cleanText) {
    return null;
  }

  if (message.role === 'assistant' && hasCreateOrderTool && cleanText.startsWith('📦')) {
    const lines = splitNonEmptyLines(cleanText);
    return {
      kind: 'pending_order_echo',
      title: 'Pedido enviado para conferência',
      subtitle: 'A IA montou o resumo neste ponto da conversa. Veja os cards seguintes para o status atual.',
      tone: 'pending',
      lines,
      focusRequest: parseOrderContextFromLines(lines, customerPhone),
      sendFailed,
    };
  }

  if (message.role === 'assistant' && cleanText.startsWith('✅ Pedido confirmado!')) {
    const lines = splitNonEmptyLines(cleanText)
      .slice(1)
      .filter((line) => !/^Qualquer dúvida/i.test(line));
    const focusRequest = parseOrderContextFromLines(splitNonEmptyLines(cleanText), customerPhone);
    return {
      kind: 'order_confirmed',
      title: sendFailed
        ? 'Pedido confirmado, mas a mensagem falhou'
        : 'Pedido confirmado pelo cliente',
      subtitle: sendFailed
        ? 'O pedido entrou na produção, mas a confirmação não chegou ao cliente.'
        : 'O pedido já entrou na fila de produção.',
      badge: focusRequest?.shortId ? `#${focusRequest.shortId}` : undefined,
      tone: sendFailed ? 'warning' : 'success',
      lines,
      focusRequest,
      actionLabel: 'Conferir pedido',
      sendFailed,
    };
  }

  if (message.role === 'assistant' && cleanText.startsWith('✅ Pedido recebido pelo cardápio!')) {
    const lines = splitNonEmptyLines(cleanText)
      .slice(1);
    const focusRequest = parseOrderContextFromLines(splitNonEmptyLines(cleanText), customerPhone);
    const waitingPayment = /comprovante do pix/i.test(cleanText);
    return {
      kind: 'zelomenu_order_received',
      title: sendFailed
        ? 'Pedido recebido, mas a mensagem falhou'
        : 'Pedido recebido pelo cardápio',
      subtitle: sendFailed
        ? 'O carrinho foi confirmado, mas a orientação não chegou ao cliente.'
        : waitingPayment
          ? 'Aguardando comprovante Pix antes da conferência da loja.'
          : 'Aguardando conferência da loja. Ainda não entrou na produção.',
      badge: focusRequest?.shortId ? `#${focusRequest.shortId}` : undefined,
      tone: sendFailed ? 'warning' : waitingPayment ? 'warning' : 'pending',
      lines,
      focusRequest,
      sendFailed,
    };
  }

  if (message.role === 'assistant' && cleanText.startsWith('Seu pedido já foi confirmado!')) {
    return {
      kind: 'order_already_confirmed',
      title: 'Pedido já confirmado',
      subtitle: 'Esse toque do cliente não abriu um pedido novo. O sistema só confirmou o que já existia.',
      tone: 'info',
      lines: splitNonEmptyLines(cleanText),
      focusRequest: customerPhone ? { source: 'chat', customerPhone } : undefined,
      actionLabel: customerPhone ? 'Conferir pedido' : undefined,
    };
  }

  if (message.role !== 'tool' || !cleanText) return null;

  if (cleanText.startsWith('Aguardando confirmação do cliente:')) {
    const parsed = parsePendingSummary(cleanText, 'Aguardando confirmação do cliente:', customerPhone);
    return {
      kind: 'pending_confirmation',
      title: 'Resumo enviado para confirmação',
      subtitle: 'Este card registra a etapa de conferência. Se o cliente confirmou depois, o pedido já aparece na produção.',
      tone: 'pending',
      ...parsed,
    };
  }

  if (cleanText.startsWith('Aguardando confirmação por texto:')) {
    const parsed = parsePendingSummary(cleanText, 'Aguardando confirmação por texto:', customerPhone);
    return {
      kind: 'pending_text_confirmation',
      title: 'Resumo enviado para confirmação por texto',
      subtitle: 'Este card registra a etapa de conferência por texto. Veja os cards seguintes para o status atual.',
      tone: 'warning',
      ...parsed,
    };
  }

  if (cleanText.startsWith('Aguardando comprovante Pix:')) {
    const parsed = parsePendingSummary(cleanText, 'Aguardando comprovante Pix:', customerPhone);
    return {
      kind: 'pending_pix_receipt',
      title: 'Comprovante Pix solicitado',
      subtitle: 'Este card registra a solicitação do comprovante. Veja os cards seguintes para o status atual.',
      tone: 'warning',
      ...parsed,
    };
  }

  if (cleanText === 'Atendimento escalado para humano') {
    return {
      kind: 'escalated',
      title: 'Atendimento escalado',
      subtitle: 'A conversa foi transferida para atendimento humano.',
      tone: 'danger',
      lines: [],
    };
  }

  if (cleanText === 'Gerente notificado') {
    return {
      kind: 'manager_notified',
      title: 'Gerente notificado',
      subtitle: 'A IA disparou um aviso interno e o atendimento pode continuar normalmente.',
      tone: 'info',
      lines: [],
    };
  }

  if (cleanText.startsWith('Erro:') || cleanText.startsWith('Quantidade ambígua:')) {
    return {
      kind: 'tool_error',
      title: 'Ação interna com atenção',
      subtitle: 'A IA encontrou uma trava e deixou esse rastro para o operador.',
      tone: 'danger',
      lines: splitNonEmptyLines(cleanText),
    };
  }

  return {
    kind: 'tool_generic',
    title: 'Ação interna registrada',
    subtitle: 'Resultado de uma ferramenta usada pela IA durante o atendimento.',
    tone: 'info',
    lines: splitNonEmptyLines(cleanText),
  };
}
