import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createConversationControl } from '../server/conversationControl.js';
import { createConversationOutboundDispatcher } from '../server/conversationOutbound.js';
import { createFromMeProcessor, type FromMeProcessorDependencies } from '../server/fromMeProcessor.js';

type JobStatus = 'queued' | 'sent' | 'failed_before_dispatch';

function fakeControlRpc() {
  let mode: 'ai' | 'human' = 'ai';
  let epoch = 0;
  let eventCount = 0;

  const row = () => ({
    conversation_control_id: '00000000-0000-4000-8000-000000000011',
    mode,
    epoch: String(epoch),
    changed_at: '2026-08-30T12:00:00.000Z',
  });

  return {
    state: () => ({ mode, epoch, eventCount }),
    rpc: async (name: string) => {
      if (name === 'ensure_zelochat_conversation_control') return { data: [row()], error: null };
      if (name === 'advance_zelochat_ai_epoch_for_inbound') {
        return { data: [row()], error: null };
      }
      if (name === 'pause_zelochat_ai_for_human') {
        const changed = mode !== 'human';
        if (changed) {
          mode = 'human';
          epoch += 1;
          eventCount += 1;
        }
        return { data: [row()], error: null };
      }
      if (name === 'resume_zelochat_ai') {
        const changed = mode !== 'ai';
        if (changed) {
          mode = 'ai';
          epoch += 1;
          eventCount += 1;
        }
        return { data: [row()], error: null };
      }
      if (name === 'check_zelochat_ai_epoch') {
        return { data: mode === 'ai', error: null };
      }
      throw new Error(`RPC inesperada: ${name}`);
    },
  };
}

async function testTakeoverInvalidatesAiAcrossCanonicalJids() {
  const fake = fakeControlRpc();
  const cancelled: string[] = [];
  const control = createConversationControl({
    rpc: fake.rpc as never,
    resolveFamilyJids: async () => ['5511999999999@s.whatsapp.net', '123456789@lid'],
    cancelPendingReply: (_empresaId, jid) => { cancelled.push(jid); },
  });

  const permit = await control.beginAiTurn({
    empresaId: 'empresa-1',
    remoteJid: '5511999999999@s.whatsapp.net',
    inboundMessageId: 'inbound-1',
  });
  const takeover = await control.claimHumanTakeover({
    empresaId: 'empresa-1',
    remoteJid: '123456789@lid',
    actorUserId: 'user-1',
    source: 'zelochat_operator',
  });

  assert.equal(takeover.mode, 'human');
  assert.equal(await control.isAiPermitCurrent(permit), false);
  assert.deepEqual(cancelled.sort(), ['123456789@lid', '5511999999999@s.whatsapp.net']);

  const resumed = await control.resumeAiConversation({
    empresaId: 'empresa-1',
    remoteJid: '5511999999999@s.whatsapp.net',
    actorUserId: 'user-1',
  });
  assert.equal(resumed.mode, 'ai');
  assert.equal(fake.state().eventCount, 2);
}

async function testRepeatedHumanRequestHasOneEpochAndOneJob() {
  const fake = fakeControlRpc();
  const jobs = new Map<string, Record<string, unknown>>();
  let createdJobs = 0;
  let cancelledDebounces = 0;

  const dispatcher = createConversationOutboundDispatcher({
    sendWaitMs: 0,
    beginHumanOutbound: async (input) => {
      const existing = jobs.get(input.idempotencyKey);
      if (existing) return { ...existing, takeoverApplied: false } as never;

      const before = fake.state().epoch;
      await fake.rpc('pause_zelochat_ai_for_human');
      createdJobs += 1;
      const job = {
        id: '00000000-0000-4000-8000-000000000099',
        messageId: '00000000-0000-4000-8000-000000000088',
        empresaId: input.empresaId,
        origin: 'human_zelochat',
        remoteJid: input.remoteJid,
        idempotencyKey: input.idempotencyKey,
        status: 'sent' as JobStatus,
        controlEpoch: String(fake.state().epoch),
        payload: input.payload,
        payloadFingerprint: input.payloadFingerprint,
        takeoverApplied: before !== fake.state().epoch,
        providerMessageId: 'provider-message-1',
      };
      jobs.set(input.idempotencyKey, job);
      return job as never;
    },
    enqueueAiOutbound: async () => { throw new Error('não deveria enfileirar IA'); },
    enqueueSystemOutbound: async () => { throw new Error('não deveria enfileirar sistema'); },
    readJob: async (jobId) => [...jobs.values()].find((job) => job.id === jobId) as never,
    cancelPendingReply: () => { cancelledDebounces += 1; },
    fingerprintPayload: async () => 'fingerprint-human-1',
  });

  const request = {
    origin: 'human_zelochat' as const,
    empresaId: 'empresa-1',
    remoteJid: '5511999999999@s.whatsapp.net',
    actorUserId: 'user-1',
    takeoverPolicy: 'take_over' as const,
    idempotencyKey: 'http-request-1',
    payload: { kind: 'text' as const, text: 'Olá!' },
  };
  const first = await dispatcher.dispatchConversationOutbound(request);
  const second = await dispatcher.dispatchConversationOutbound(request);

  assert.equal(first.jobId, second.jobId);
  assert.equal(createdJobs, 1);
  assert.equal(fake.state().epoch, 1);
  assert.equal(fake.state().eventCount, 1);
  assert.equal(cancelledDebounces, 1);
}

async function testNativeFromMeRequiresStrongEvidence() {
  let takeoverWrites = 0;
  let correlationHolds = 0;
  const event = (id: string) => ({
    key: { id, remoteJid: '5511999999999@s.whatsapp.net', fromMe: true },
    message: { conversation: 'Mensagem nativa' },
    messageTimestamp: 1_788_091_200,
  });
  const dependencies: FromMeProcessorDependencies = {
    lookupEvidence: async ({ waMessageId, fingerprint }) => {
      if (waMessageId === 'echo-1') return { providerJob: { id: 'job-1', messageId: 'message-1' } };
      if (waMessageId === 'pending-1') {
        return { pendingJob: { id: 'job-2', payloadFingerprint: fingerprint, providerMessageId: null } };
      }
      return {};
    },
    ensureConversationSession: async () => {},
    recordNativeTakeover: async () => {
      takeoverWrites += 1;
      return {
        inserted: true,
        takeoverApplied: true,
        messageId: 'message-native',
        jobId: 'job-native',
        conversationControlId: 'control-1',
        mode: 'human',
        epoch: '1',
        remoteJids: ['5511999999999@s.whatsapp.net'],
      };
    },
    repairServerEcho: async () => undefined,
    holdPendingCorrelation: async () => { correlationHolds += 1; },
    cancelPendingReply: () => undefined,
    broadcast: () => undefined,
  };
  const processor = createFromMeProcessor(dependencies);

  const unauthenticated = await processor({
    empresaId: 'empresa-1', data: event('native-without-token'), authStatus: 'token_missing',
  });
  assert.equal(unauthenticated.kind, 'unauthenticated');
  assert.equal(takeoverWrites, 0);

  const echo = await processor({ empresaId: 'empresa-1', data: event('echo-1'), authStatus: 'token_match' });
  assert.equal(echo.kind, 'server_echo');
  assert.equal(takeoverWrites, 0);

  await assert.rejects(
    processor({ empresaId: 'empresa-1', data: event('pending-1'), authStatus: 'token_match' }),
    /FROM_ME_PENDING_CORRELATION/,
  );
  assert.equal(correlationHolds, 1);
  assert.equal(takeoverWrites, 0);

  const native = await processor({ empresaId: 'empresa-1', data: event('native-1'), authStatus: 'token_match' });
  assert.equal(native.kind, 'native_human');
  assert.equal(takeoverWrites, 1);
}

function testTaskElevenArtifactsAndRaceMatrix() {
  const root = process.cwd();
  const sqlPath = path.join(root, 'supabase/verification/conversation_outbound_engine.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  assert.match(sql, /\bBEGIN\s*;/i);
  assert.match(sql, /\bROLLBACK\s*;/i);
  assert.match(sql, /pause_zelochat_ai_for_human/i);
  assert.match(sql, /resume_zelochat_ai/i);
  assert.match(sql, /claim_zelochat_outbound_job/i);
  assert.match(sql, /record_zelochat_native_outbound_takeover/i);
  assert.match(sql, /ACTOR_NOT_IN_TENANT/i);
  assert.match(sql, /exception when unique_violation/i);
  assert.match(sql, /WA_MESSAGE_ID_SAME_TENANT_DUPLICATE_ACCEPTED/i);
  assert.match(sql, /WA_MESSAGE_ID_CROSS_TENANT_SCOPE_FAILED/i);

  const requiredEvidence: Array<[string, RegExp[]]> = [
    ['tests/aiTakeoverRace.test.ts', [/native_whatsapp/i, /modelCalls/i, /jobWrites/i]],
    ['tests/conversationOutboundWorker.test.ts', [/dispatch_started/i, /delivery_uncertain/i]],
    ['tests/conversationOutbound.test.ts', [/failed_before_dispatch/i, /preserve_ai/i, /same-key/i]],
    ['tests/fromMeProcessor.test.ts', [/server_echo/i, /pendingJob/i, /token_missing/i]],
    ['tests/conversationOutboundRpc.integration.test.ts', [/Order 1/i, /Order 2/i, /Opposite order/i]],
    ['tests/manualOutboundRoutes.test.ts', [/same-http-intent/i, /idempotency/i]],
    ['tests/qa-human-takeover.spec.ts', [/autoReply: false/i, /status: 'active'/i, /escalatedAt: null/i, /messageJobId/i, /\[200, 202\]/i]],
    ['tests/qa-native-from-me.spec.ts', [/human_native_whatsapp/i, /beforeMessageIds/i, /status: 'active'/i]],
  ];

  for (const [relativePath, patterns] of requiredEvidence) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    for (const pattern of patterns) {
      assert.match(source, pattern, `${relativePath} deve preservar evidência para ${pattern}`);
    }
  }
}

await testTakeoverInvalidatesAiAcrossCanonicalJids();
await testRepeatedHumanRequestHasOneEpochAndOneJob();
await testNativeFromMeRequiresStrongEvidence();
testTaskElevenArtifactsAndRaceMatrix();

console.log('conversation outbound integration tests: ok');
