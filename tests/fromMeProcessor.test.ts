import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFromMeProcessor, type FromMeProcessorDependencies } from '../server/fromMeProcessor.js';

const jid = '5511999999999@s.whatsapp.net';
const event = (id: string, text = 'Resposta humana') => ({
  key: { id, remoteJid: jid, fromMe: true },
  message: { conversation: text },
  messageTimestamp: 1_788_102_000,
});

function harness(overrides: Partial<FromMeProcessorDependencies> = {}) {
  const calls: string[] = [];
  const deps: FromMeProcessorDependencies = {
    lookupEvidence: async () => ({}),
    recordNativeTakeover: async () => ({
      inserted: true, takeoverApplied: true, messageId: 'message-native', jobId: 'job-native',
      conversationControlId: 'control-1', mode: 'human', epoch: '8', remoteJids: [jid],
    }),
    repairServerEcho: async () => { calls.push('repair'); },
    holdPendingCorrelation: async () => { calls.push('hold'); },
    cancelPendingReply: () => { calls.push('cancel'); },
    broadcast: (type) => { calls.push(`broadcast:${type}`); },
    ...overrides,
  };
  return { calls, process: createFromMeProcessor(deps) };
}

{
  let persisted = 0;
  const { calls, process } = harness({ recordNativeTakeover: async () => {
    persisted += 1;
    return { inserted: true, takeoverApplied: true, messageId: 'm1', jobId: 'j1', conversationControlId: 'c1', mode: 'human', epoch: '2', remoteJids: [jid] };
  } });
  const result = await process({ empresaId: 'empresa-1', data: event('native-auth'), authStatus: 'token_match', rawEventId: 'raw-1', mode: 'enforce' });
  assert.equal(result.kind, 'native_human');
  assert.equal(persisted, 1);
  assert.deepEqual(calls, ['cancel', 'broadcast:message_sent', 'broadcast:conversation_mode_changed']);
}

{
  let writes = 0;
  const { process } = harness({
    lookupEvidence: async () => { writes += 1; return {}; },
    recordNativeTakeover: async () => { writes += 1; throw new Error('must not persist'); },
  });
  const result = await process({ empresaId: 'empresa-1', data: event('forged'), authStatus: 'token_missing', rawEventId: 'raw-2' });
  assert.deepEqual(result, { kind: 'shadow_unauthenticated' });
  assert.equal(writes, 0);
}

{
  const { calls, process } = harness({ lookupEvidence: async (input) => ({
    pendingJob: { id: 'pending-1', payloadFingerprint: input.fingerprint, providerMessageId: null },
  }) });
  await assert.rejects(
    () => process({ empresaId: 'empresa-1', data: event('same-content'), authStatus: 'token_match', rawEventId: 'raw-3', mode: 'enforce' }),
    /FROM_ME_PENDING_CORRELATION/,
  );
  assert.deepEqual(calls, ['hold']);
}

{
  let nativeWrites = 0;
  const { calls, process } = harness({
    lookupEvidence: async () => ({ providerJob: { id: 'job-a', messageId: 'message-a' } }),
    recordNativeTakeover: async () => { nativeWrites += 1; throw new Error('must not persist'); },
  });
  const result = await process({ empresaId: 'empresa-1', data: event('echo-a'), authStatus: 'token_match', rawEventId: 'raw-4', mode: 'enforce' });
  assert.equal(result.kind, 'server_echo');
  assert.equal(nativeWrites, 0);
  assert.deepEqual(calls, ['repair']);
}

{
  let writes = 0;
  const { process } = harness({ recordNativeTakeover: async () => { writes += 1; throw new Error('must stay shadow'); } });
  const result = await process({ empresaId: 'empresa-1', data: event('shadow-default'), authStatus: 'token_match', rawEventId: 'raw-5' });
  assert.deepEqual(result, { kind: 'shadow_rollout' });
  assert.equal(writes, 0);
}

console.log('fromMeProcessor: ok');

const sql = readFileSync(new URL('../supabase/migrations/066_native_from_me_takeover.sql', import.meta.url), 'utf8');
assert.match(sql, /record_zelochat_native_outbound_takeover/i);
assert.match(sql, /on conflict \(empresa_id, wa_message_id\) where wa_message_id is not null do nothing/i);
assert.match(sql, /'human_native_whatsapp'/i);
assert.match(sql, /claim_zelochat_webhook_replay[\s\S]*for update skip locked/i);
assert.match(sql, /auth_status text/i);
assert.match(sql, /correlation_state text/i);
assert.match(sql, /security definer[\s\S]*set search_path = public, pg_temp/i);
assert.doesNotMatch(sql, /grant execute[^;]+to (anon|authenticated)/i);

const nativeRpc = sql.slice(
  sql.indexOf('create or replace function public.record_zelochat_native_outbound_takeover'),
  sql.indexOf('create or replace function public.hold_zelochat_from_me_correlation'),
);
assert.match(nativeRpc, /hold_reason = 'from_me_pending_correlation'[\s\S]*hold_job_id is not null/i);
assert.match(nativeRpc, /provider_message_id is not null[\s\S]*provider_message_id <> p_wa_message_id/i);
assert.match(nativeRpc, /from public\.zelochat_outbound_jobs[\s\S]*for update/i);
assert.match(nativeRpc, /hold_reason = case[\s\S]*v_release_correlation_hold[\s\S]*c\.hold_job_id = v_correlated_job_id then null[\s\S]*else c\.hold_reason/i);
assert.match(nativeRpc, /hold_job_id = case[\s\S]*v_release_correlation_hold[\s\S]*c\.hold_job_id = v_correlated_job_id then null[\s\S]*else c\.hold_job_id/i);
assert.ok(
  nativeRpc.indexOf("if found then\n    if v_job_id is null") < nativeRpc.indexOf("v_release_correlation_hold :="),
  'idempotent redelivery returns before evaluating or clearing a correlation hold',
);
