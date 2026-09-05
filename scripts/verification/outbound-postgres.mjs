import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// No host port, linked project, inherited DB URL or credentials. The verifier
// shares only this fresh container's isolated loopback network namespace.
const root = fileURLToPath(new URL('../../', import.meta.url));
const databaseUrl = 'postgresql://postgres:isolated-outbound-test@127.0.0.1:5432/zelochat_outbound_test';
const nonce = randomUUID();
const database = `zelochat-outbound-db-${nonce}`;
const verifier = `zelochat-outbound-probe-${nonce}`;
const image = 'zelochat-outbound-verifier:node24';
const deadline = Date.now() + 5 * 60_000;
const fixtureManifest = JSON.parse(readFileSync(new URL('./fixtures/outbound-base.manifest.json', import.meta.url), 'utf8'));
const fixtureSql = readFileSync(new URL('./fixtures/outbound-base.sql', import.meta.url), 'utf8');
if (createHash('sha256').update(fixtureSql.replaceAll('\r\n', '\n')).digest('hex') !== fixtureManifest.fixtureSha256Lf) {
  throw new Error('Outbound support fixture differs from its reviewed provenance manifest.');
}
const migrations = [
  '052_customer_campaigns.sql', '053_customer_outbound_jobs.sql', '054_customer_automations.sql',
  '055_campaign_queue_hardening.sql', '056_automation_limits_and_lease_terminal.sql',
  '058_automation_dispatch_jobs.sql', '059_automation_dispatch_lease_terminal.sql',
  '063_conversation_outbound_foundation.sql', '064_conversation_control_rpcs.sql',
  '065_conversation_outbound_claims.sql', '066_native_from_me_takeover.sql',
  '067_conversation_outbound_rolling_cleanup.sql', '20260831205926_fix_native_from_me_persistence.sql',
];
function docker(args, { input, timeout = 120_000 } = {}) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('Outbound PostgreSQL harness exceeded its five-minute deadline.');
  return execFileSync('docker', args, { cwd: root, windowsHide: true, encoding: 'utf8',
    input, timeout: Math.min(timeout, remaining), maxBuffer: 8 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
}
function applyFile(path) {
  const sql = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  const digest = createHash('sha256').update(sql.replaceAll('\r\n', '\n')).digest('hex');
  console.log(`Applying original SQL ${path} sha256=${digest}`);
  try {
    docker(['exec', '-i', database, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'zelochat_outbound_test'], { input: sql, timeout: 30_000 });
  } catch (error) {
    throw new Error(`SQL restore failed: ${path}\n${error.stderr || error.message}`, { cause: error });
  }
}
let primaryFailure;
try {
  docker(['build', '-f', 'scripts/verification/Dockerfile.outbound', '-t', image, 'scripts/verification']);
  docker(['run', '-d', '--name', database, '--network', 'none',
    '-e', 'POSTGRES_PASSWORD=isolated-outbound-test', '-e', 'POSTGRES_DB=zelochat_outbound_test', 'postgres:17-alpine']);
  const startupDeadline = Date.now() + 30_000;
  while (true) {
    try { docker(['exec', database, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'zelochat_outbound_test'], { timeout: 3_000 }); break; }
    catch (error) {
      if (Date.now() >= startupDeadline) throw new Error('Disposable PostgreSQL did not become ready.', { cause: error });
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  applyFile('scripts/verification/fixtures/outbound-base.sql');
  for (const migration of migrations) applyFile(`supabase/migrations/${migration}`);
  docker(['exec', '-i', database, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'zelochat_outbound_test'], {
    input: `create table public.outbound_disposable_fixture_marker(nonce uuid primary key); insert into public.outbound_disposable_fixture_marker values('${nonce}');`,
    timeout: 5_000,
  });
  console.log(docker(['run', '--name', verifier, '--network', `container:${database}`,
    '-v', `${root}:/work:ro`, '-e', `LOCAL_OUTBOUND_TEST_DATABASE_URL=${databaseUrl}`,
    '-e', `ZELOCHAT_OUTBOUND_FIXTURE_NONCE=${nonce}`, image,
    'node', 'tests/conversationOutboundRpc.integration.test.ts'], { timeout: 90_000 }));
} catch (error) {
  primaryFailure = error;
}
const cleanupFailures = [];
for (const name of [verifier, database]) {
  try {
    const exists = execFileSync('docker', ['container', 'ls', '-aq', '--filter', `name=^/${name}$`], { encoding: 'utf8', windowsHide: true, timeout: 10_000 }).trim();
    if (exists) execFileSync('docker', ['rm', '-f', name], { stdio: 'pipe', windowsHide: true, timeout: 15_000 });
  } catch (error) { cleanupFailures.push(error); }
}
if (primaryFailure || cleanupFailures.length) {
  throw new AggregateError([...(primaryFailure ? [primaryFailure] : []), ...cleanupFailures], 'Outbound PostgreSQL verification or cleanup failed.');
}
console.log('OUTBOUND_POSTGRES_VERIFIED: original migrations, PostgreSQL 17, three concurrent races and ACL. Both disposable containers removed.');
