import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const databaseUrl = process.env.LOCAL_OUTBOUND_TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('conversationOutboundRpc integration: SKIP (LOCAL_OUTBOUND_TEST_DATABASE_URL ausente)');
  process.exit(0);
}
const parsed = new URL(databaseUrl);
assert(['localhost', '127.0.0.1', '::1'].includes(parsed.hostname), 'O teste RPC aceita somente Postgres local.');
try { execFileSync('psql', ['--version'], { stdio: 'ignore' }); } catch { throw new Error('psql é obrigatório quando LOCAL_OUTBOUND_TEST_DATABASE_URL está configurada.'); }

const run = (sql: string): string => execFileSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql], { encoding: 'utf8' }).trim();
const execAsync = promisify(execFile);
const suffix = `${Date.now()}-${process.pid}`;
const remoteJid = `integration-${suffix}@s.whatsapp.net`;
const setup = run(`
  with company as (select id from public.empresa_perfil order by id limit 1),
  control as (
    insert into public.zelochat_conversation_ai_control (empresa_id, identity_key, mode, epoch, changed_source)
    select id, 'integration:${suffix}', 'ai', 7, 'integration_test' from company returning id, empresa_id
  ), job as (
    insert into public.zelochat_outbound_jobs
      (empresa_id, job_type, idempotency_key, phone_snapshot, message, status, conversation_control_id,
       conversation_jid, outbound_origin, takeover_policy, payload, payload_fingerprint, control_epoch)
    select empresa_id, 'conversation', 'integration:${suffix}', '5511999999999', 'teste', 'queued', id,
      '${remoteJid}', 'ai_auto', 'preserve_ai', '{"kind":"text","text":"teste"}'::jsonb, repeat('a',64), 7
    from control returning id, empresa_id, conversation_control_id
  ) select empresa_id || '|' || conversation_control_id || '|' || id from job;
`);
assert(setup, 'O banco local precisa conter ao menos uma empresa de teste.');
const [empresaId, controlId, jobId] = setup.split('|');

try {
  // Capture the same stale candidate a worker could have read before entering the claim RPC.
  assert.equal(run(`select id from public.zelochat_outbound_jobs where id='${jobId}' and status='queued'`), jobId);
  const pauseSql = `begin; select public.zelochat_conversation_control_rollout_gate();
    update public.zelochat_conversation_ai_control set mode='human', epoch=8 where id='${controlId}' and empresa_id='${empresaId}';
    select pg_sleep(1); commit;`;
  const pausing = execAsync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-At', '-c', pauseSql]);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const claiming = execAsync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-At', '-c', `select count(*) from public.claim_zelochat_outbound_job('integration-a', 30);`]);
  const [, firstClaim] = await Promise.all([pausing, claiming]);
  assert.equal(firstClaim.stdout.trim(), '0');
  assert.equal(run(`select count(*) from public.claim_zelochat_outbound_job('integration-b', 30)`), '0');
  assert.equal(run(`select status || '|' || coalesce(suppression_reason,'') from public.zelochat_outbound_jobs where id='${jobId}'`), 'cancelled|paused');
} finally {
  run(`delete from public.zelochat_outbound_jobs where id='${jobId}'; delete from public.zelochat_conversation_ai_control where id='${controlId}' and empresa_id='${empresaId}';`);
}
console.log('conversationOutboundRpc integration: ok');
