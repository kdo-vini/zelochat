import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startupCheckMode } from '../server/runtime/startupCheck.js';

test('only the exact explicit CLI flag enables the HTTP image check', () => {
  assert.equal(startupCheckMode(['node', 'server/index.ts', '--check-startup-http']), 'http');
  for (const argument of ['--check-startup-http=true', '--check-startup-http=1', 'check-startup-http',
    '--check-startup-http-extra', '/?check-startup-http=1', 'ZELOCHAT_CHECK_STARTUP_HTTP=1']) {
    assert.equal(startupCheckMode(['node', 'server/index.ts', argument]), null);
  }
  assert.equal(startupCheckMode(['node', 'server/index.ts']), null);
});

test('preserves the one-shot startup check and its exit when both flags are present', () => {
  assert.equal(startupCheckMode(['--check-startup']), 'exit');
  assert.equal(startupCheckMode(['--check-startup-http', '--check-startup']), 'exit');
});
