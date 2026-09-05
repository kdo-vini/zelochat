import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tsxCli = fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url));

const testFiles = readdirSync(new URL('.', import.meta.url)).filter(f => f.endsWith('.test.ts'));
const integrationFiles = testFiles.filter(f => f.endsWith('.integration.test.ts'));
const tests = testFiles
  .filter(f => !f.endsWith('.integration.test.ts'))
  .sort()
  .map((f) => `tests/${f}`);

if (!existsSync(tsxCli)) {
  console.error(`tsx CLI not found at ${tsxCli}. Run npm install first.`);
  process.exit(1);
}

let failures = 0;
console.log(`Running ${tests.length} unit files. ${integrationFiles.length} integration file(s) run separately in the isolated PostgreSQL job.`);
const testEnv = { ...process.env };
for (const name of ['DATABASE_URL', 'SUPABASE_DB_URL', 'LOCAL_OUTBOUND_TEST_DATABASE_URL', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY', 'STRIPE_SECRET_KEY', 'WHATSMIAU_API_KEY', 'ZELO_INTERNAL_API_KEY']) delete testEnv[name];

for (const testFile of tests) {
  console.log(`\n===== ${testFile} =====`);
  const result = spawnSync(process.execPath, ['--import', 'tsx/esm', testFile], {
    stdio: 'inherit',
    env: {
      ...testEnv,
      WHATSMIAU_DISABLE_WEBHOOK_REGISTER: '1',
      ZELOCHAT_DISABLE_WHATSAPP_NETWORK: '1',
      DOTENV_CONFIG_PATH: join(tmpdir(), 'zelochat-tests-absent.env'),
    },
    timeout: 90_000,
  });
  if (result.status !== 0) {
    failures++;
    console.error(`\n${testFile} failed with exit code ${result.status ?? 'unknown'}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} test file(s) failed.`);
  process.exit(1);
}

console.log(`\n${tests.length} unit test files passed. ${integrationFiles.length} integration file(s) excluded; check the separate PostgreSQL job.`);
