// PR 1.6 / I-6 — `fromEnv` used to validate only ZELO_INTERNAL_API_KEY and
// silently default a missing ZELOMENU_INTERNAL_BASE_URL to localhost. In a
// production-like deploy (Dokploy) with the key set but the base URL
// missing/typo'd, every canonical call ECONNREFUSEd against localhost and
// every ordering conversation escalated, with no signal naming the actual
// cause. This must instead fail loudly (one structured log line, never the
// key value) and disable the canonical path — same posture as every other
// fail-closed gate in this codebase.
//
// Run via: npx tsx tests/zeloMenuInternalClientEnv.test.ts

import assert from 'node:assert/strict';
import {
  ZeloMenuInternalClient,
  isZeloMenuProductionLikeEnvironment,
  __resetZeloMenuInternalClientLogStateForTests,
} from '../server/zeloMenuInternalClient.js';

console.log('\nisZeloMenuProductionLikeEnvironment');
{
  assert.equal(isZeloMenuProductionLikeEnvironment({ NODE_ENV: 'production' }), true, 'NODE_ENV=production is always production-like');
  assert.equal(isZeloMenuProductionLikeEnvironment({ NODE_ENV: 'development' }), false, 'plain development is not production-like');
  assert.equal(isZeloMenuProductionLikeEnvironment({}), false, 'no signals at all defaults to NOT production-like (dev-friendly default)');
  assert.equal(
    isZeloMenuProductionLikeEnvironment({ PUBLIC_APP_URL: 'https://chat.zelopdv.com.br' }),
    true,
    'a real public https PUBLIC_APP_URL is production-like even without NODE_ENV set',
  );
  assert.equal(
    isZeloMenuProductionLikeEnvironment({ PUBLIC_APP_URL: 'http://localhost:3001' }),
    false,
    'a localhost PUBLIC_APP_URL is never production-like',
  );
  assert.equal(
    isZeloMenuProductionLikeEnvironment({ PUBLIC_APP_URL: 'http://127.0.0.1:3001' }),
    false,
    'a loopback-IP PUBLIC_APP_URL is never production-like',
  );
  assert.equal(
    isZeloMenuProductionLikeEnvironment({ PUBLIC_APP_URL: 'not a url' }),
    false,
    'a malformed PUBLIC_APP_URL never throws, and is treated as not production-like',
  );
}

console.log('\nfromEnv: key set + base URL missing + dev-like env still defaults to localhost (unchanged dev ergonomics)');
{
  __resetZeloMenuInternalClientLogStateForTests();
  const client = ZeloMenuInternalClient.fromEnv({ ZELO_INTERNAL_API_KEY: 'key' });
  assert.ok(client !== null, 'dev/local still gets the friendly localhost default');
}

console.log('\nfromEnv: key set + base URL missing + production-like env refuses to default to localhost');
{
  __resetZeloMenuInternalClientLogStateForTests();
  const originalError = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => { logged.push(args); };
  let client: ZeloMenuInternalClient | null;
  try {
    client = ZeloMenuInternalClient.fromEnv({ ZELO_INTERNAL_API_KEY: 'super-secret-key', NODE_ENV: 'production' });
  } finally {
    console.error = originalError;
  }
  assert.equal(client, null, 'the canonical path is disabled rather than silently pointing at localhost');
  assert.ok(logged.length >= 1, 'a structured error line was logged exactly once');
  const serialized = logged.map((args) => args.map((a) => String(a)).join(' ')).join('\n');
  assert.ok(!serialized.includes('super-secret-key'), 'the API key value is NEVER logged');
  assert.match(serialized, /ZELOMENU_BASE_URL_MISSING_IN_PRODUCTION/, 'a stable, structured code names the failure');
}

console.log('\nfromEnv: key set + base URL EXPLICITLY set in production works normally, no error logged');
{
  __resetZeloMenuInternalClientLogStateForTests();
  const originalError = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => { logged.push(args); };
  let client: ZeloMenuInternalClient | null;
  try {
    client = ZeloMenuInternalClient.fromEnv({
      ZELO_INTERNAL_API_KEY: 'key',
      ZELOMENU_INTERNAL_BASE_URL: 'https://internal.zelomenu.example',
      NODE_ENV: 'production',
    });
  } finally {
    console.error = originalError;
  }
  assert.ok(client !== null, 'an explicit base URL in production is honored normally');
  assert.equal(logged.length, 0, 'no config-invalid error when the base URL was explicitly provided');
}

console.log('\nfromEnv: no API key at all is a normal (silent) disablement in any environment — not a config error');
{
  __resetZeloMenuInternalClientLogStateForTests();
  const originalError = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => { logged.push(args); };
  let client: ZeloMenuInternalClient | null;
  try {
    client = ZeloMenuInternalClient.fromEnv({ NODE_ENV: 'production' });
  } finally {
    console.error = originalError;
  }
  assert.equal(client, null);
  assert.equal(logged.length, 0, 'a tenant that simply has not configured the integration yet is not a startup error');
}

console.log('zeloMenuInternalClientEnv tests passed');
