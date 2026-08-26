import type { ChatAttachment, ChatMessage, MessageStatus } from '../types';

export interface CustomerMessageSession { id: string; messages: Array<Pick<ChatMessage, 'id' | 'timestamp'> & Partial<Pick<ChatMessage, 'content' | 'preview' | 'role' | 'kind' | 'status' | 'attachment'>>>; }
export interface CustomerMessageItem { sessionId: string; message: CustomerMessageSession['messages'][number]; }
export interface CustomerMessagePermission { pessoasVisualizar: boolean; clientesComunicar: boolean; }

export function isPrimaryWhatsAppJid(jid: string | null | undefined): boolean {
  return /^\d{10,15}@s\.whatsapp\.net$/u.test(jid?.trim() ?? '') && !/^status\d*/u.test(jid?.trim() ?? '');
}

export function aggregateCustomerMessages(sessions: CustomerMessageSession[]): CustomerMessageItem[] {
  const seen = new Set<string>();
  const items: CustomerMessageItem[] = [];
  for (const session of sessions) for (const message of session.messages) {
    const key = `${session.id}:${message.id}`;
    if (seen.has(key)) continue;
    seen.add(key); items.push({ sessionId: session.id, message });
  }
  return items.slice().sort((a, b) => a.message.timestamp.localeCompare(b.message.timestamp));
}

export function paginateCustomerMessages(items: CustomerMessageItem[], limit = 30, cursor: string | null): { items: CustomerMessageItem[]; nextCursor: string | null; hasMore: boolean } {
  const start = cursor ? Math.max(0, items.findIndex((item) => item.message.id === cursor) + 1) : 0;
  const page = items.slice(start, start + Math.min(Math.max(limit, 1), 100));
  const hasMore = start + page.length < items.length;
  return { items: page, hasMore, nextCursor: hasMore && page.length ? page[page.length - 1].message.id : null };
}

export function canReadCustomerMessages(permissions: CustomerMessagePermission): boolean { return permissions.pessoasVisualizar; }
export function canSendCustomerMessage(permissions: CustomerMessagePermission): boolean { return permissions.pessoasVisualizar && permissions.clientesComunicar; }

export function createPendingOutboundMessage(id: string, sessionId: string, content: string, timestamp = new Date().toISOString(), attachment?: ChatAttachment): ChatMessage & { status: MessageStatus } {
  return { id, role: 'assistant', content, preview: content, timestamp, kind: attachment?.type ?? 'text', attachment, status: 'sending' };
}

export function markOutboundSent<T extends { status?: MessageStatus; waMessageId?: string | null }>(message: T, waMessageId: string): T { return { ...message, status: 'sent', waMessageId }; }
export function markOutboundFailed<T extends { status?: MessageStatus }>(message: T, _reason: string): T { return { ...message, status: 'failed' }; }
