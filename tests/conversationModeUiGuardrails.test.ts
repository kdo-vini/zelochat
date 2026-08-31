import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ChatMessage, ChatSession } from '../src/types.js';
import {
  applyConversationModeChanged,
  normalizeMessageStatus,
  upsertMessage,
  type ConversationModeChangedPayload,
} from '../src/hooks/useWhatsAppSessions.js';

const baseSession = (id: string): ChatSession => ({
  id,
  customerName: id,
  customerPhone: '5511999999999',
  lastMessage: '',
  lastMessageTime: '2026-08-30T12:00:00.000Z',
  unreadCount: 0,
  messages: [],
  status: 'active',
  autoReply: true,
  conversationMode: 'ai',
  conversationEpoch: '7',
});

const takeover: ConversationModeChangedPayload = {
  sessionIds: ['jid-a', 'jid-b'],
  mode: 'human',
  epoch: '9007199254740993',
  source: 'zelochat_operator',
  changedAt: '2026-08-30T12:01:00.000Z',
};

{
  const previous = [baseSession('jid-a'), baseSession('jid-b'), baseSession('jid-c')];
  const next = applyConversationModeChanged(previous, takeover);

  for (const id of takeover.sessionIds) {
    const session = next.find((candidate) => candidate.id === id);
    assert.equal(session?.conversationMode, 'human', `${id} enters human mode`);
    assert.equal(session?.autoReply, false, `${id} cannot keep AI enabled after takeover`);
    assert.equal(session?.conversationEpoch, '9007199254740993', 'bigint epoch stays lossless as a string');
    assert.equal(session?.takeoverSource, 'zelochat_operator');
    assert.equal(session?.takeoverAt, takeover.changedAt);
  }
  assert.strictEqual(next[2], previous[2], 'unrelated conversations keep referential identity');
}

{
  const manual = applyConversationModeChanged([baseSession('jid-a')], takeover);
  const resumed = applyConversationModeChanged(manual, {
    ...takeover,
    mode: 'ai',
    epoch: '9007199254740994',
    source: 'resume',
  });
  assert.equal(resumed[0].conversationMode, 'ai');
  assert.equal(resumed[0].autoReply, true, 'only an explicit resume event re-enables AI');
  assert.equal(resumed[0].takeoverSource, null);
  assert.equal(resumed[0].takeoverAt, null);
}

{
  assert.equal(normalizeMessageStatus('failed'), 'failed_before_dispatch', 'rolling legacy failed is presented canonically');
  assert.equal(normalizeMessageStatus('preparing'), 'preparing');
  assert.equal(normalizeMessageStatus('dispatch_started'), 'dispatch_started');
  assert.equal(normalizeMessageStatus('delivery_uncertain'), 'delivery_uncertain');
}

{
  const pending: ChatMessage = {
    id: 'message-queued',
    role: 'assistant',
    content: 'Olá',
    preview: 'Olá',
    timestamp: '2026-08-30T12:02:00.000Z',
    kind: 'text',
    status: 'queued',
  };
  const fromWebSocket: ChatMessage = {
    ...pending,
    waMessageId: 'wa-1',
    status: 'sent',
  };
  const messages = upsertMessage([pending], fromWebSocket);
  assert.equal(messages.length, 1, 'WebSocket never appends a duplicate backend message id');
  assert.equal(messages[0].status, 'sent');
  assert.equal(messages[0].waMessageId, 'wa-1');
}

const wsSource = readFileSync(new URL('../server/ws.ts', import.meta.url), 'utf8');
const hookSource = readFileSync(new URL('../src/hooks/useWhatsAppSessions.ts', import.meta.url), 'utf8');
const chatSource = readFileSync(new URL('../src/components/views/ChatView.tsx', import.meta.url), 'utf8');
const bubbleSource = readFileSync(new URL('../src/components/views/MessageBubble.tsx', import.meta.url), 'utf8');
const customerSource = readFileSync(new URL('../src/components/customers/CustomerMessagesTab.tsx', import.meta.url), 'utf8');
const waApiSource = readFileSync(new URL('../src/services/waApi.ts', import.meta.url), 'utf8');
const customerApiSource = readFileSync(new URL('../src/services/customerApi.ts', import.meta.url), 'utf8');

assert.match(wsSource, /export interface ConversationModeChanged/);
assert.match(hookSource, /type:\s*'conversation_mode_changed'/);
assert.match(chatSource, /Conversa assumida automaticamente após sua mensagem\./);
assert.match(chatSource, /Manual/);

for (const source of [bubbleSource, customerSource]) {
  assert.match(source, /Enviando…/);
  assert.match(source, /Mensagem não enviada\./);
  assert.match(source, /Não foi possível confirmar a entrega\./);
  assert.match(source, /Enviar uma nova cópia/);
  assert.match(source, /Estamos confirmando um envio anterior\./);
}

assert.match(bubbleSource, /ConfirmModal/);
assert.doesNotMatch(bubbleSource, /delivery_uncertain[\s\S]{0,300}Tentar novamente/);
assert.match(waApiSource, /Promise<ManualSendResult>/);
assert.match(customerApiSource, /status:\s*CustomerSendStatus/);
assert.match(hookSource, /messageId/);

console.log('conversation mode and outbound UI guardrails passed');
