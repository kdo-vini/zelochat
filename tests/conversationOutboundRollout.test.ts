import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  resolveConversationOutboundEngineMode,
  type ConversationOutboundEngineMode,
} from '../server/outbound/rollout.js';
import {
  getConversationOutboundMetricsSnapshot,
  recordConversationOutboundMetric,
  resetConversationOutboundMetricsForTests,
} from '../server/outbound/observability.js';
import { startOutboundWorker } from '../server/outbound/worker.js';

const shadow: ConversationOutboundEngineMode = resolveConversationOutboundEngineMode('empresa-a', {});
assert.equal(shadow, 'shadow', 'missing configuration must fail safe to shadow');
assert.equal(resolveConversationOutboundEngineMode('empresa-a', { CONVERSATION_OUTBOUND_ENGINE_MODE: 'enforce' }), 'enforce');
assert.equal(resolveConversationOutboundEngineMode('empresa-a', { CONVERSATION_OUTBOUND_ENGINE_MODE: 'invalid' }), 'shadow');
assert.equal(resolveConversationOutboundEngineMode('empresa-a', {
  CONVERSATION_OUTBOUND_ENGINE_MODE: 'shadow',
  CONVERSATION_OUTBOUND_ENGINE_ENFORCE_EMPRESAS: 'empresa-b, empresa-a',
}), 'enforce');
assert.equal(resolveConversationOutboundEngineMode('empresa-c', {
  CONVERSATION_OUTBOUND_ENGINE_MODE: 'shadow',
  CONVERSATION_OUTBOUND_ENGINE_ENFORCE_EMPRESAS: 'empresa-b, empresa-a',
}), 'shadow');
assert.equal(resolveConversationOutboundEngineMode('empresa-a', { FROM_ME_NATIVE_MODE: 'enforce' }), 'enforce', 'rolling env remains compatible');

resetConversationOutboundMetricsForTests();
recordConversationOutboundMetric('from_me_would_takeover', { source: 'human_native_whatsapp' });
recordConversationOutboundMetric('from_me_would_correlate', { decision: 'server_echo' });
recordConversationOutboundMetric('ai_stale_suppressed', { reason: 'stale_epoch' });
const metrics = getConversationOutboundMetricsSnapshot();
assert.equal(metrics['from_me_would_takeover|source=human_native_whatsapp'], 1);
assert.equal(metrics['from_me_would_correlate|decision=server_echo'], 1);
assert.equal(metrics['ai_stale_suppressed|reason=stale_epoch'], 1);

const migration = readFileSync(new URL('../supabase/migrations/067_conversation_outbound_rolling_cleanup.sql', import.meta.url), 'utf8');
assert.match(migration, /drop constraint if exists zelochat_outbound_jobs_idempotency_key_key/i);
assert.match(migration, /zelochat_outbound_jobs_empresa_idempotency_key/i);
assert.match(migration, /set status = 'failed_before_dispatch'[\s\S]*where status = 'failed'/i);
assert.match(migration, /set outbound_status = 'failed_before_dispatch'[\s\S]*where outbound_status = 'failed'/i);
assert.doesNotMatch(migration, /drop table|truncate/i);
assert.match(migration, /trg_zelochat_outbound_job_rolling_bridge/i);
assert.match(migration, /CONVERSATION_OUTBOUND_ROLLING_DRAIN_NOT_CONFIRMED/i);

const previousWorkerDisabled = process.env.CONVERSATION_OUTBOUND_WORKER_DISABLED;
process.env.CONVERSATION_OUTBOUND_WORKER_DISABLED = '1';
try {
  assert.equal(startOutboundWorker(), null, 'kill switch must not construct a queue, start claims or mutate queued jobs');
} finally {
  if (previousWorkerDisabled == null) delete process.env.CONVERSATION_OUTBOUND_WORKER_DISABLED;
  else process.env.CONVERSATION_OUTBOUND_WORKER_DISABLED = previousWorkerDisabled;
}

console.log('conversationOutboundRollout: ok');
