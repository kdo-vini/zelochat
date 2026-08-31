import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

assert.equal(existsSync('server/outbound/rollout.ts'), false, 'the outbound engine must not have a rollout module');

const processor = readFileSync('server/fromMeProcessor.ts', 'utf8');
assert.doesNotMatch(processor, /shadow_rollout|resolveConversationOutboundEngineMode|mode\?:\s*'shadow'\s*\|\s*'enforce'/i);
assert.match(processor, /authStatus !== 'token_match'/, 'native takeover still requires authenticated webhook evidence');

const replay = readFileSync('server/webhookReplayWorker.ts', 'utf8');
assert.doesNotMatch(replay, /resolveConversationOutboundEngineMode|CONVERSATION_OUTBOUND_ENGINE_ENFORCE_EMPRESAS|hasEnforcedTenant/);
assert.match(replay, /processFromMeUpsert\(\{ empresaId: event\.empresaId, data: event\.payload\?\.data, authStatus: event\.authStatus, rawEventId: event\.id \}\)/);

const worker = readFileSync('server/outbound/worker.ts', 'utf8');
assert.doesNotMatch(worker, /CONVERSATION_OUTBOUND_WORKER_DISABLED|worker disabled by emergency rollout switch/);

const controlSql = readFileSync('supabase/migrations/064_conversation_control_rpcs.sql', 'utf8');
assert.match(controlSql, /zelochat_conversation_control_lock_gate/);
assert.doesNotMatch(controlSql, /zelochat_conversation_control_rollout_gate|rollout_gate/);

const cleanupSql = readFileSync('supabase/migrations/067_conversation_outbound_rolling_cleanup.sql', 'utf8');
assert.doesNotMatch(cleanupSql, /CONVERSATION_OUTBOUND_ROLLING_DRAIN_NOT_CONFIRMED|DO NOT APPLY DURING INITIAL ROLLOUT/i);

console.log('conversationOutboundAlwaysOn: ok');
