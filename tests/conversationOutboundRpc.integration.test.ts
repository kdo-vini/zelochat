import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const databaseUrl = process.env.LOCAL_OUTBOUND_TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('conversationOutboundRpc integration: SKIP (use the explicit disposable SQL job)');
  process.exit(0);
}
assert.equal(databaseUrl, 'postgresql://postgres:isolated-outbound-test@127.0.0.1:5432/zelochat_outbound_test',
  'Use scripts/verification/outbound-postgres.mjs and its fresh isolated database.');
const nonce = process.env.ZELOCHAT_OUTBOUND_FIXTURE_NONCE || '';
assert.match(nonce, /^[a-f0-9-]{36}$/, 'Disposable harness nonce required');
const deadline = Date.now() + 60_000;
const pgEnv = { ...process.env, PGCONNECT_TIMEOUT: '3', PGOPTIONS: '-c statement_timeout=8000 -c idle_in_transaction_session_timeout=15000' };
function remaining() {
  const ms = deadline - Date.now();
  assert(ms > 0, 'SQL integration exceeded its 60-second deadline');
  return ms;
}
const run = (sql: string, role = 'service_role'): string => execFileSync('psql',
  [databaseUrl, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', 'set role ' + role + '; ' + sql],
  { encoding: 'utf8', env: pgEnv, windowsHide: true, timeout: Math.min(8_000, remaining()), stdio: 'pipe' }).trim();

type Session = { child: ChildProcessWithoutNullStreams; write(sql: string): void; waitFor(token: string): Promise<string>; close(): Promise<void> };
const sessions = new Set<Session>();
function openSession(applicationName: string): Session {
  const child = spawn('psql', [databaseUrl!, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
    { env: { ...pgEnv, PGAPPNAME: applicationName }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let output = '', errorOutput = '', closed = false;
  const done = new Promise<void>((resolve) => child.once('close', () => { closed = true; resolve(); }));
  child.on('error', (error) => { errorOutput += error.message; });
  child.stdin.on('error', (error) => { errorOutput += error.message; });
  child.stdout.on('data', (chunk) => { output += String(chunk); });
  child.stderr.on('data', (chunk) => { errorOutput += String(chunk); });
  const session: Session = {
    child,
    write(sql) { assert(!closed && !child.stdin.destroyed, 'psql closed: ' + errorOutput); child.stdin.write(sql + '\n'); },
    async waitFor(token) {
      const stop = Date.now() + Math.min(5_000, remaining());
      while (Date.now() < stop) {
        if (output.includes(token)) return output;
        assert(!closed, applicationName + ' closed before ' + token + ': ' + errorOutput);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('Timed out waiting for ' + applicationName + '/' + token + '; stdout=' + output + '; stderr=' + errorOutput);
    },
    async close() {
      if (!closed && !child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end('rollback;\n\\q\n');
      await Promise.race([done, new Promise((resolve) => setTimeout(resolve, 1_000))]);
      if (!closed) { child.kill('SIGTERM'); await Promise.race([done, new Promise((resolve) => setTimeout(resolve, 500))]); }
      if (!closed) { child.kill('SIGKILL'); await Promise.race([done, new Promise((resolve) => setTimeout(resolve, 500))]); }
      assert(closed, 'Failed to close psql ' + applicationName);
      sessions.delete(session);
    },
  };
  sessions.add(session);
  session.write('set role service_role;');
  return session;
}
async function waitForDatabaseLock(applicationName: string): Promise<void> {
  const stop = Date.now() + Math.min(5_000, remaining());
  while (Date.now() < stop) {
    if (run("select count(*) from pg_stat_activity where application_name='" + applicationName + "' and wait_event_type='Lock'", 'postgres') === '1') return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(applicationName + ' did not wait on the expected database lock.');
}

const suffix = `${Date.now()}-${process.pid}`;
const ownerId = randomUUID();
const fixtureEmpresaId = randomUUID();
const remoteJid = `5511999999999@s.whatsapp.net`;
assert.equal(run(`select current_database()='zelochat_outbound_test'
  and current_setting('server_version_num')::integer between 170000 and 179999
  and exists(select 1 from public.outbound_disposable_fixture_marker where nonce='${nonce}')
  and not exists(select 1 from public.empresa_perfil)
  and not exists(select 1 from public.zelochat_outbound_jobs)`, 'postgres'), 't', 'Fresh PostgreSQL17 fixture and nonce required');
const setup = run(`
  insert into auth.users(id) values('${ownerId}');
  insert into public.empresa_perfil(id,user_id,nome_exibicao) values('${fixtureEmpresaId}','${ownerId}','Disposable outbound test');
  with company as (select '${fixtureEmpresaId}'::uuid as id),
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
`, 'postgres');
assert(setup, 'The test must create its own company fixture.');
const [empresaId, controlId, jobId] = setup.split('|');
const reset = () => run(`update public.zelochat_conversation_ai_control set mode='ai', epoch=7, hold_job_id=null, hold_reason=null where id='${controlId}' and empresa_id='${empresaId}'; update public.zelochat_outbound_jobs set status='queued', attempts=0, lease_owner=null, lease_expires_at=null, suppression_reason=null, transport_started_at=null, control_epoch=7 where id='${jobId}';`);

let primaryFailure: unknown;
try {
  for (const role of ['anon', 'authenticated']) {
    for (const signature of ['claim_zelochat_outbound_job(text,integer)', 'start_zelochat_outbound_transport(uuid,uuid,text)', 'zelochat_conversation_control_lock_gate()']) {
      assert.equal(run(`select has_function_privilege('${role}','public.${signature}','execute')`, 'postgres'), 'f');
      assert.equal(run(`select has_function_privilege('service_role','public.${signature}','execute')`, 'postgres'), 't');
    }
    assert.throws(() => run("select count(*) from public.claim_zelochat_outbound_job('unauthorized',30)", role), /permission denied/);
  }
  assert.equal(run(`select status from public.zelochat_outbound_jobs where id='${jobId}'`), 'queued');
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
  takeoverBeforeStart.write(`begin; select public.zelochat_conversation_control_lock_gate(); select 1 from public.zelochat_conversation_ai_control where id='${controlId}' for update; update public.zelochat_conversation_ai_control set mode='human',epoch=8 where id='${controlId}'; select 'TAKEOVER_BEFORE_START';`);
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
  takeoverBlocked.write(`select 'TAKEOVER_PID:' || pg_backend_pid(); begin; select public.zelochat_conversation_control_lock_gate(); update public.zelochat_conversation_ai_control set mode='human',epoch=8 where id='${controlId}'; commit; select 'TAKEOVER_DONE';`);
  await takeoverBlocked.waitFor('TAKEOVER_PID:'); await waitForDatabaseLock(`takeover-blocked-${suffix}`);
  startFirst.write('commit;'); await takeoverBlocked.waitFor('TAKEOVER_DONE');
  await Promise.all([startFirst.close(), takeoverBlocked.close()]);
  assert.equal(run(`select status from public.zelochat_outbound_jobs where id='${jobId}'`), 'dispatch_started');
} catch (error) {
  primaryFailure = error;
}
const cleanupFailures: unknown[] = [];
for (const session of [...sessions]) { try { await session.close(); } catch (error) { cleanupFailures.push(error); } }
try {
  run(`delete from public.zelochat_outbound_jobs where id='${jobId}';
    delete from public.zelochat_conversation_ai_control where id='${controlId}' and empresa_id='${empresaId}';
    delete from public.empresa_perfil where id='${fixtureEmpresaId}' and user_id='${ownerId}';
    delete from auth.users where id='${ownerId}';`, 'postgres');
} catch (error) { cleanupFailures.push(error); }
if (primaryFailure || cleanupFailures.length) throw new AggregateError([...(primaryFailure ? [primaryFailure] : []), ...cleanupFailures], 'Outbound RPC proof or cleanup failed');
console.log('conversationOutboundRpc integration: PostgreSQL17 three real concurrent service-role races, ACL and own-tenant cleanup passed');
