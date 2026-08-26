import { assert, runSuite } from './testHarness.js';
import {
  aggregateCustomerMessages,
  canSendCustomerMessage,
  createPendingOutboundMessage,
  isPrimaryWhatsAppJid,
  resolveCustomerSessionId,
  resolveLatestCustomerSessionId,
  markOutboundFailed,
  markOutboundSent,
  paginateCustomerMessages,
  type CustomerMessagePermission,
} from '../src/domain/customerMessages.ts';

const permissions: CustomerMessagePermission = { pessoasVisualizar: true, clientesComunicar: true };

await runSuite('customer messages', [
  { name: 'aggregates all sessions while preserving each session id', run: () => { const result = aggregateCustomerMessages([{ id: 's-2', messages: [{ id: 'm-2', timestamp: '2026-01-02T00:00:00Z', content: 'dois' }] }, { id: 's-1', messages: [{ id: 'm-1', timestamp: '2026-01-01T00:00:00Z', content: 'um' }] }]); assert(result[0].sessionId === 's-1' && result[1].sessionId === 's-2', 'messages are timeline ordered'); assert(result[0].message.id === 'm-1', 'message identity is preserved'); } },
  { name: 'accepts only a primary valid WhatsApp jid', run: () => { assert(isPrimaryWhatsAppJid('5514999999999@s.whatsapp.net'), 'primary jid is accepted'); assert(!isPrimaryWhatsAppJid('status@broadcast'), 'broadcast jid is rejected'); assert(!isPrimaryWhatsAppJid('5514999999999@g.us'), 'group jid is rejected'); } },
  { name: 'returns a session id instead of a remote jid for Atendimento', run: () => { assert(resolveCustomerSessionId([{ id: 'session-1' }], 'session-1') === 'session-1', 'known message session is returned'); assert(resolveCustomerSessionId([{ id: 'session-1' }], '5514999999999@s.whatsapp.net') === null, 'remote jid is never treated as a session id'); } },
  { name: 'returns the latest real session for Atendimento', run: () => { assert(resolveLatestCustomerSessionId([{ id: 'old' }, { id: 'latest' }], [{ sessionId: 'old' }, { sessionId: 'latest' }]) === 'latest', 'latest message session wins'); } },
  { name: 'persists outbound lifecycle through sent or failed', run: () => { const pending = createPendingOutboundMessage('m-new', 's-1', 'Oi', '2026-01-03T00:00:00Z'); assert(pending.status === 'sending', 'new outbound message starts sending'); assert(markOutboundSent(pending, 'wa-1').status === 'sent', 'successful send becomes sent'); assert(markOutboundFailed(pending, 'não enviado').status === 'failed', 'failed send becomes retryable'); } },
  { name: 'paginates aggregate without losing session identity', run: () => { const items = aggregateCustomerMessages([{ id: 's-1', messages: [{ id: 'm-1', timestamp: '2026-01-01T00:00:00Z', content: 'um' }, { id: 'm-2', timestamp: '2026-01-02T00:00:00Z', content: 'dois' }] }]); const page = paginateCustomerMessages(items, 1, null); assert(page.items.length === 1 && page.hasMore && page.nextCursor === 'm-1', 'page cursor points to the last message'); assert(canSendCustomerMessage(permissions) && !canSendCustomerMessage({ pessoasVisualizar: true, clientesComunicar: false }), 'send requires clientes.comunicar'); } },
]);
