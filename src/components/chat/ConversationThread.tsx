import { memo } from 'react';
import { RefreshCw } from 'lucide-react';
import type { ChatAttachment, MessageStatus } from '../../types';
import { isRetryableOutboundFailure } from '../../domain/outbound';

export interface ConversationThreadMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string | null;
  timestamp: string;
  status?: MessageStatus;
  attachment?: ChatAttachment | null;
}

interface Props { messages: ConversationThreadMessage[]; onRetry?: (message: ConversationThreadMessage) => void; }

export const ConversationThread = memo(function ConversationThread({ messages, onRetry }: Props) {
  return <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4" aria-label="Histórico de mensagens">{messages.map((message) => <div key={`${message.sessionId}:${message.id}`} className={`flex ${message.role === 'assistant' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] ${message.role === 'assistant' ? 'bg-[var(--color-brand-soft)] text-[var(--color-ink)]' : 'bg-[var(--color-surface-muted)] text-[var(--color-ink)]'}`}><p className="whitespace-pre-wrap">{message.content || (message.attachment ? `Anexo: ${message.attachment.fileName}` : '')}</p><div className="mt-1 flex items-center justify-between gap-3 text-[10px] text-[var(--color-ink-faint)]"><time dateTime={message.timestamp}>{new Date(message.timestamp).toLocaleString('pt-BR')}</time>{isRetryableOutboundFailure(message.status) && onRetry && <button type="button" onClick={() => onRetry(message)} className="inline-flex min-h-[44px] items-center gap-1 px-2 font-medium text-[var(--color-alert)]" aria-label="Tentar enviar novamente"><RefreshCw className="h-3 w-3" />Tentar novamente</button>}</div></div></div>)}</div>;
});
