import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const tsxCli = fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url));

const tests = readdirSync(new URL('.', import.meta.url))
  .filter((f) => f.endsWith('.test.ts'))
  .sort()
  .map((f) => `tests/${f}`);

if (!existsSync(tsxCli)) {
  console.error(`tsx CLI not found at ${tsxCli}. Run npm install first.`);
  process.exit(1);
}

let failures = 0;

for (const testFile of tests) {
  console.log(`\n===== ${testFile} =====`);
  const result = spawnSync(process.execPath, [tsxCli, testFile], {
    stdio: 'inherit',
    env: {
      ...process.env,
      WHATSMIAU_DISABLE_WEBHOOK_REGISTER: '1',
      ZELOCHAT_DISABLE_WHATSAPP_NETWORK: '1',
    },
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

console.log('\nAll unit test files passed.');
