// Static regression guardrails for the 2026-05-15 production audit fixes.
// These assertions avoid booting the backend, which can mutate Whatsmiau webhook config.
// Run via: npx tsx tests/auditFixGuardrails.test.ts

import { readFileSync } from 'node:fs';
import { assert, pass, fail } from './testHarness.js';
import { classifyFromMe, type ExtractedFromMeMessage } from '../server/fromMe.js';

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
// fromMe echo dedup moved from server/router.ts (messageExistsByWhatsAppId,
// long retired) to server/fromMe.ts + server/fromMeProcessor.ts. classifyFromMe
// is a pure function, so we can exercise the actual guarantee behaviorally:
// a message the DB already has a row for is skipped as a duplicate, and one
// with no DB evidence is recorded as a fresh native takeover.
const sampleFromMeMessage: ExtractedFromMeMessage = {
  waMessageId: 'wamid-guardrail-1',
  remoteJid: '5511999999999@s.whatsapp.net',
  payload: { kind: 'text', text: 'Oi' },
  jobPayload: { kind: 'text', text: 'Oi' },
  messageContent: 'Oi',
  preview: 'Oi',
  sentAt: new Date().toISOString(),
  fingerprint: 'guardrail-fingerprint',
  protocolArtifact: false,
};
assert(
  classifyFromMe(sampleFromMeMessage, { existingMessage: { origin: null, jobId: null } }).kind === 'duplicate',
  'fromMe echo skip checks database persistence',
);
assert(
  classifyFromMe(sampleFromMeMessage, {}).kind === 'native_human',
  'fromMe message with no DB persistence evidence is recorded as a new native takeover, not skipped',
);
const fromMeProcessor = read('server/fromMeProcessor.ts');
assert(
  fromMeProcessor.includes(".eq('wa_message_id', input.waMessageId)"),
  'fromMe echo classification is fed evidence from a real zelochat_messages lookup by WhatsApp message id',
);

// Manual sends (POST /api/send) moved from a synchronous in-route send to the
// durable outbound-job pipeline: server/conversationOutbound.ts persists the
// job (via the begin_zelochat_human_outbound RPC) before returning, and the
// actual WhatsApp transport call only happens later, from the background
// worker in server/outbound/worker.ts.
const conversationOutbound = read('server/conversationOutbound.ts');
const outboundWorker = read('server/outbound/worker.ts');
const outboundQueue = read('server/outbound/queue.ts');
const sendRouteStart = router.indexOf("router.post('/api/send',");
const sendRouteEnd = router.indexOf("router.post('/api/send-contact'");
assert(sendRouteStart !== -1 && sendRouteEnd > sendRouteStart, 'manual send route (/api/send) exists in router.ts');
const sendRouteBlock = router.slice(sendRouteStart, sendRouteEnd);
assert(
  sendRouteBlock.includes('dispatchConversationOutbound({') && !/\b(sendTextMessage|sendMediaMessage|sendWhatsAppAudio)\s*\(/.test(sendRouteBlock),
  'manual send route never calls WhatsApp transport directly — it only dispatches to the outbound pipeline',
);
assert(
  conversationOutbound.includes('job = await deps.beginHumanOutbound({') && conversationOutbound.includes("rpc('begin_zelochat_human_outbound'"),
  'manual sends persist an outbound intent before WhatsApp send',
);
assert(
  outboundWorker.indexOf('this.deps.queue.startTransport(job)') < outboundWorker.indexOf('this.transport.send({'),
  'the WhatsApp transport call only happens after the queued job has already recorded a dispatch_started DB state',
);

// A manual send that fails before the transport attempt (bad payload, no
// recipient) is persisted via markFailed — not dropped in memory.
assert(
  outboundQueue.includes('async failBeforeDispatch(job: OutboundJob, reason: string): Promise<boolean> {')
    && outboundQueue.includes('return succeeded(await this.store.markFailed(job.id, reason, null, job.empresaId, job.leaseOwner));'),
  'manual send failures are persisted',
);
assert(
  outboundWorker.includes("await this.deps.queue.failBeforeDispatch(job, cause instanceof Error ? cause.message : 'Payload inválido para envio.');"),
  'a manual send that fails before transport starts is persisted as failed_before_dispatch, not silently dropped',
);
assert(router.includes('isRetryableOutboundFailure(message.outbound_status)'), 'retry route accepts legacy and canonical failed outbound statuses');
assert(router.includes('serializeManualSendError'), 'manual send provider failures return a controlled API error');
assert(!router.includes('...(payload.providerStatus ? { providerStatus: payload.providerStatus } : {})'), 'manual send errors do not expose provider status to the frontend');
for (const routeContext of ['send contact failed','send list failed','send location failed','send reaction failed','send poll failed']) {
  assert(router.includes(`sendFriendlyOutboundRouteError(res, '${routeContext}', error)`), `${routeContext} returns a friendly redacted error`);
}
// The literal "WhatsApp sent, but failed to mark DB message as sent" string
// (and the synchronous send-then-DB-write it described) is gone with the old
// in-route send. Its replacement: a DB failure after the transport call has
// already started (which covers "WhatsApp actually sent, then the completing
// DB write failed") is caught and persisted as delivery_uncertain, and the
// manual-send route maps that to a 202 with a friendly message — never a 500.
assert(
  outboundWorker.includes('if (transportStarted) {')
    && outboundWorker.includes("await this.deps.queue.deliveryUncertain({ ...job, status: 'dispatch_started' }, reason);"),
  'a DB failure after the WhatsApp transport call started is persisted as delivery_uncertain instead of crashing the worker',
);
assert(
  router.includes("res.status(status === 'queued' || status === 'delivery_uncertain' ? 202 : 200).json(body);"),
  'manual sends do not turn post-send DB status failures into 500s',
);

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
