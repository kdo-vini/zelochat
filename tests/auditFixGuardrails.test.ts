// Static regression guardrails for the 2026-05-15 production audit fixes.
// These assertions avoid booting the backend, which can mutate Whatsmiau webhook config.
// Run via: npx tsx tests/auditFixGuardrails.test.ts

import { readFileSync } from 'node:fs';
import { assert, pass, fail } from './testHarness.js';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

console.log('\nAudit fix guardrails');

const tags = read('server/tags.ts');
assert(tags.includes('ensureTagBelongsToEmpresa'), 'tag writes validate tag ownership in service code');
assert(tags.includes("query.eq('id', sessionIdOrJid)"), 'UUID session inputs are resolved with empresa scope');
assert(tags.includes(".eq('empresa_id', empresaId);"), 'tag removal includes empresa scope');

const tagMigration = read('supabase/migrations/033_zelochat_session_tags_tenant_enforcement.sql');
assert(tagMigration.includes('zelochat_session_tags_session_empresa_fk'), 'migration enforces session/empresa FK');
assert(tagMigration.includes('zelochat_session_tags_tag_empresa_fk'), 'migration enforces tag/empresa FK');

const router = read('server/router.ts');
assert(router.includes('WEBHOOK_REQUIRE_TOKEN'), 'webhook has explicit strict-mode toggle env');
assert(router.includes("res.status(401).json({ error: 'webhook token required' })"), 'missing webhook token fails closed by default');
assert(router.includes('safeEqualString(headerToken, webhookToken)'), 'webhook token comparison is constant-time');
assert(router.includes('messageExistsByWhatsAppId'), 'fromMe echo skip checks database persistence');
assert(router.includes('createAssistantMessageIntent'), 'manual sends persist an outbound intent before WhatsApp send');
assert(router.includes('markAssistantMessageSendFailed'), 'manual send failures are persisted');
assert(router.includes('isRetryableOutboundFailure(message.outbound_status)'), 'retry route accepts legacy and canonical failed outbound statuses');
assert(router.includes('serializeManualSendError'), 'manual send provider failures return a controlled API error');
assert(!router.includes('...(payload.providerStatus ? { providerStatus: payload.providerStatus } : {})'), 'manual send errors do not expose provider status to the frontend');
for (const routeContext of ['send contact failed','send list failed','send location failed','send reaction failed','send poll failed']) {
  assert(router.includes(`sendFriendlyOutboundRouteError(res, '${routeContext}', error)`), `${routeContext} returns a friendly redacted error`);
}
assert(router.includes('WhatsApp sent, but failed to mark DB message as sent'), 'manual sends do not turn post-send DB status failures into 500s');

const whatsapp = read('server/whatsapp.ts');
assert(whatsapp.includes('toWhatsmiauNumber(jid)'), 'outbound sends pass phone digits to Whatsmiau instead of full JIDs');
assert(whatsapp.includes('extractWhatsmiauMessageId(res.data) ?? null'), 'manual outbound success returns only a real provider message id or null');
assert(whatsapp.includes('data?.data?.message?.key?.id'), 'Whatsmiau message id extraction accepts nested data.message.key.id responses');
assert(whatsapp.includes("err.code === 'ECONNABORTED'"), 'QR connect timeouts keep the instance in connecting state');

const messageHandler = read('server/messageHandler.ts');
assert(messageHandler.includes('messageExistsByWhatsAppId'), 'message existence helper exists for outbound echo repair');
assert(messageHandler.includes("error.code === '23505'"), 'outbound duplicate WhatsApp IDs are idempotent');
assert(messageHandler.includes('onAudioTranscriptionSettled'), 'audio transcription exposes settled callback');
assert(messageHandler.includes('shouldRearmAfterAudioTranscription'), 'audio re-arm eligibility guard exists');

const lifecycleMigration = read('supabase/migrations/034_zelochat_outbound_message_lifecycle.sql');
assert(lifecycleMigration.includes('outbound_status'), 'migration adds outbound lifecycle status');

const waApi = read('src/services/waApi.ts');
assert(waApi.includes('ChatSessionsQuery'), 'frontend sessions API accepts server-side query params');

const chatView = read('src/components/views/ChatView.tsx');
assert(chatView.includes('loadMoreSessions'), 'chat list can request additional server pages');
assert(chatView.includes('loadOlderMessages'), 'chat detail can request older message pages');
assert(chatView.includes('isRetryableOutboundFailure(message.status)'), 'failed_before_dispatch can be deleted/retried from Atendimento');
const messageBubble = read('src/components/views/MessageBubble.tsx');
assert(messageBubble.includes('isRetryableOutboundFailure(message.status)'), 'failed_before_dispatch renders retry/delete actions in the chat bubble');
const sessionsHook = read('src/hooks/useWhatsAppSessions.ts');
assert(sessionsHook.includes("value === 'failed_before_dispatch'"), 'WebSocket status normalization accepts canonical failed_before_dispatch');

const settingsView = read('src/components/views/SettingsView.tsx');
assert(settingsView.includes("data.status === 'connecting'"), 'WhatsApp QR UI keeps polling while the QR is being prepared');
assert(settingsView.includes('(!data.status && data.qr === null && !data.error)'), 'WhatsApp QR polling does not treat connecting/null-QR as connected');
assert(!/setError\([^)]*Whatsmiau/i.test(settingsView), 'customer-facing WhatsApp errors do not expose provider names');

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
