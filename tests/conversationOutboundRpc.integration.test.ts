import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

const databaseUrl = process.env.LOCAL_OUTBOUND_TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('conversationOutboundRpc integration: SKIP (LOCAL_OUTBOUND_TEST_DATABASE_URL ausente)');
  process.exit(0);
}
const parsed = new URL(databaseUrl);
assert(['localhost', '127.0.0.1', '::1'].includes(parsed.hostname), 'O teste RPC aceita somente Postgres local.');
try { execFileSync('psql', ['--version'], { stdio: 'ignore' }); } catch { throw new Error('psql é obrigatório quando LOCAL_OUTBOUND_TEST_DATABASE_URL está configurada.'); }

const run = (sql: string): string => execFileSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql], { encoding: 'utf8' }).trim();
type Session = { child: ChildProcessWithoutNullStreams; write(sql: string): void; waitFor(token: string): Promise<string>; close(): Promise<void> };
const sessionChildren = new Set<ChildProcessWithoutNullStreams>();
function openSession(applicationName: string): Session {
  const child = spawn('psql', [databaseUrl!, '-qAt', '-v', 'ON_ERROR_STOP=1'], { env: { ...process.env, PGAPPNAME: applicationName }, stdio: ['pipe', 'pipe', 'pipe'] });
  sessionChildren.add(child);
  let output = ''; let errorOutput = ''; const waiters: Array<{ token: string; resolve(value: string): void; reject(error: Error): void }> = [];
  const flush = () => { for (const waiter of [...waiters]) if (output.includes(waiter.token)) { waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(output); } };
  child.stdout.on('data', (chunk) => { output += String(chunk); flush(); });
  child.stderr.on('data', (chunk) => { errorOutput += String(chunk); });
  child.on('exit', (code) => { sessionChildren.delete(child); if (code && waiters.length) for (const waiter of waiters.splice(0)) waiter.reject(new Error(`psql ${applicationName} saiu ${code}: ${errorOutput}`)); });
  return {
    child,
    write(sql) { child.stdin.write(`${sql}\n`); },
    waitFor(token) { if (output.includes(token)) return Promise.resolve(output); return new Promise((resolve, reject) => waiters.push({ token, resolve, reject })); },
    close() { child.stdin.end('\\q\n'); return new Promise((resolve, reject) => child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`psql ${applicationName} saiu ${code}: ${errorOutput}`)))); },
  };
}

async function waitForDatabaseLock(applicationName: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (run(`select count(*) from pg_stat_activity where application_name='${applicationName}' and wait_event_type='Lock'`) === '1') return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`${applicationName} não bloqueou no lock esperado.`);
}

const suffix = `${Date.now()}-${process.pid}`;
const remoteJid = `5511999999999@s.whatsapp.net`;
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
const reset = () => run(`update public.zelochat_conversation_ai_control set mode='ai', epoch=7, hold_job_id=null, hold_reason=null where id='${controlId}' and empresa_id='${empresaId}'; update public.zelochat_outbound_jobs set status='queued', attempts=0, lease_owner=null, lease_expires_at=null, suppression_reason=null, transport_started_at=null, control_epoch=7 where id='${jobId}';`);

try {
  // Order 1: takeover owns the control row so claim passes candidate discovery,
  // blocks at the authoritative control lock, then observes human mode/epoch.
  assert.equal(run(`select id from public.zelochat_outbound_jobs where id='${jobId}' and status='queued'`), jobId);
  const takeoverFirst = openSession(`takeover-first-${suffix}`);
  takeoverFirst.write(`begin; select 1 from public.zelochat_conversation_ai_control where id='${controlId}' for update; update public.zelochat_conversation_ai_control set mode='human',epoch=8 where id='${controlId}'; select 'TAKEOVER_LOCKED';`);
  await takeoverFirst.waitFor('TAKEOVER_LOCKED');
  const claimBlocked = openSession(`claim-blocked-${suffix}`);
  claimBlocked.write(`select 'CLAIM_PID:' || pg_backend_pid(); select 'CLAIM_RESULT:' || count(*) from public.claim_zelochat_outbound_job('integration-a',30);`);
  await claimBlocked.waitFor('CLAIM_PID:'); await waitForDatabaseLock(`claim-blocked-${suffix}`);
  takeoverFirst.write('commit;'); await claimBlocked.waitFor('CLAIM_RESULT:0');
  await Promise.all([takeoverFirst.close(), claimBlocked.close()]);
  assert.equal(run(`select status || '|' || coalesce(suppression_reason,'') from public.zelochat_outbound_jobs where id='${jobId}'`), 'cancelled|paused');

  // Order 2: claim linearizes first, but takeover wins before starter; starter blocks then refuses stale snapshot.
  reset();
  assert.equal(run(`select count(*) from public.claim_zelochat_outbound_job('integration-b',30)`), '1');
  const takeoverBeforeStart = openSession(`takeover-before-start-${suffix}`);
  takeoverBeforeStart.write(`begin; select public.zelochat_conversation_control_rollout_gate(); select 1 from public.zelochat_conversation_ai_control where id='${controlId}' for update; update public.zelochat_conversation_ai_control set mode='human',epoch=8 where id='${controlId}'; select 'TAKEOVER_BEFORE_START';`);
  await takeoverBeforeStart.waitFor('TAKEOVER_BEFORE_START');
  const staleStart = openSession(`stale-start-${suffix}`);
  staleStart.write(`select 'START_PID:' || pg_backend_pid(); select 'START_RESULT:' || public.start_zelochat_outbound_transport('${jobId}','${empresaId}','integration-b');`);
  await staleStart.waitFor('START_PID:'); await waitForDatabaseLock(`stale-start-${suffix}`);
  takeoverBeforeStart.write('commit;'); await staleStart.waitFor('START_RESULT:false');
  await Promise.all([takeoverBeforeStart.close(), staleStart.close()]);
  assert.equal(run(`select status || '|' || coalesce(suppression_reason,'') from public.zelochat_outbound_jobs where id='${jobId}'`), 'cancelled|paused');

  // Opposite order: starter owns the gate first and is authorized; takeover waits until dispatch_started commits.
  reset();
  assert.equal(run(`select count(*) from public.claim_zelochat_outbound_job('integration-c',30)`), '1');
  const startFirst = openSession(`start-first-${suffix}`);
  startFirst.write(`begin; select 'START_FIRST_RESULT:' || public.start_zelochat_outbound_transport('${jobId}','${empresaId}','integration-c'); select 'START_FIRST_LOCKED';`);
  await startFirst.waitFor('START_FIRST_LOCKED'); assert((await startFirst.waitFor('START_FIRST_RESULT:true')).includes('START_FIRST_RESULT:true'));
  const takeoverBlocked = openSession(`takeover-blocked-${suffix}`);
  takeoverBlocked.write(`select 'TAKEOVER_PID:' || pg_backend_pid(); begin; select public.zelochat_conversation_control_rollout_gate(); update public.zelochat_conversation_ai_control set mode='human',epoch=8 where id='${controlId}'; commit; select 'TAKEOVER_DONE';`);
  await takeoverBlocked.waitFor('TAKEOVER_PID:'); await waitForDatabaseLock(`takeover-blocked-${suffix}`);
  startFirst.write('commit;'); await takeoverBlocked.waitFor('TAKEOVER_DONE');
  await Promise.all([startFirst.close(), takeoverBlocked.close()]);
  assert.equal(run(`select status from public.zelochat_outbound_jobs where id='${jobId}'`), 'dispatch_started');
} finally {
  for (const child of sessionChildren) child.kill();
  run(`delete from public.zelochat_outbound_jobs where id='${jobId}'; delete from public.zelochat_conversation_ai_control where id='${controlId}' and empresa_id='${empresaId}';`);
}
console.log('conversationOutboundRpc integration: ok');
