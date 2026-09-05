import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { inspectDeployment, waitForDeployment } from '../scripts/verify-deployment.mjs';

const sha = '1234567890abcdef1234567890abcdef12345678';
const short = sha.slice(0, 12);
const baseUrl = 'https://fixture.invalid';
function fixtureRecords(overrides: Record<string, [string, string]> = {}): Record<string, [string, string]> {
  return {
    '/build-info.json': [JSON.stringify({ sourceCommit: sha, version: short }), 'application/json'],
    '/api/version': [JSON.stringify({ sourceCommit: sha, version: short }), 'application/json'],
    '/': ['<html><script type="module" src="/assets/index-abcdefgh.js"></script><link href="/assets/index-abcdefgh.css"></html>', 'text/html'],
    '/assets/index-abcdefgh.js': ['import("./AppShell-12345678.js");', 'application/javascript'],
    '/assets/index-abcdefgh.css': ['body{}', 'text/css'],
    '/assets/AppShell-12345678.js': [`const version="${short}";`, 'application/javascript'],
    ...overrides,
  };
}
function fixture(overrides: Record<string, [string, string]> = {}) {
  const records = fixtureRecords(overrides);
  const fetchImpl: typeof fetch = async (input, options) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(options?.redirect, 'error');
    assert.equal(options?.method || 'GET', 'GET');
    assert.ok(options?.signal);
    const row = records[url.pathname];
    return new Response(row?.[0] || '', { status: row ? 200 : 404, headers: { 'content-type': row?.[1] || 'text/html' } });
  };
  return fetchImpl;
}

test('verifies both complete SHAs and the version in a referenced lazy bundle', async () => {
  const result = await inspectDeployment({ baseUrl, expectedSha: sha, fetchImpl: fixture() });
  assert.equal(result.assets, 3);
  assert.equal(result.sourceCommit, sha);
});

test('rejects split backend/frontend revisions', async () => {
  await assert.rejects(inspectDeployment({ baseUrl, expectedSha: sha, fetchImpl: fixture({
    '/api/version': [JSON.stringify({ sourceCommit: 'a'.repeat(40), version: 'a'.repeat(12) }), 'application/json'],
  }) }), /expected.*received/);
});

test('rejects stale frontend metadata even when the backend release is current', async () => {
  await assert.rejects(inspectDeployment({ baseUrl, expectedSha: sha, fetchImpl: fixture({
    '/build-info.json': [JSON.stringify({ sourceCommit: 'a'.repeat(40), version: 'a'.repeat(12) }), 'application/json'],
  }) }), /build-info.json: expected.*received/);
});

for (const path of ['/build-info.json', '/api/version']) {
  test(`rejects a wrong display version with the correct SHA in ${path}`, async () => {
    await assert.rejects(inspectDeployment({ baseUrl, expectedSha: sha, fetchImpl: fixture({
      [path]: [JSON.stringify({ sourceCommit: sha, version: 'old-version' }), 'application/json'],
    }) }), /expected.*received.*old-version/);
  });
}

test('rejects a missing lazy asset even if metadata is current', async () => {
  await assert.rejects(inspectDeployment({ baseUrl, expectedSha: sha, fetchImpl: fixture({
    '/assets/index-abcdefgh.js': [`const version="${short}"; import("./missing-12345678.js");`, 'application/javascript'],
  }) }), /HTTP 404/);
});

test('follows referenced chunks with a query and fragment suffix', async () => {
  const result = await inspectDeployment({ baseUrl, expectedSha: sha, fetchImpl: fixture({
    '/assets/index-abcdefgh.js': ['import("./AppShell-12345678.js?v=1#module");', 'application/javascript'],
  }) });
  assert.equal(result.assets, 3);
});

test('rejects a missing lazy chunk with a query even when the entry contains the current version', async () => {
  await assert.rejects(inspectDeployment({ baseUrl, expectedSha: sha, fetchImpl: fixture({
    '/assets/index-abcdefgh.js': [`const version="${short}"; import("./missing-12345678.js?v=1#module");`, 'application/javascript'],
  }) }), /missing-12345678.js.*HTTP 404/);
});

test('rejects SPA fallback HTML served under a JavaScript URL', async () => {
  await assert.rejects(inspectDeployment({ baseUrl, expectedSha: sha, fetchImpl: fixture({
    '/assets/AppShell-12345678.js': [`<html>${short}</html>`, 'text/html'],
  }) }), /content type/);
});

test('rejects stale JS despite current metadata', async () => {
  await assert.rejects(inspectDeployment({ baseUrl, expectedSha: sha, fetchImpl: fixture({
    '/assets/AppShell-12345678.js': ['const version="old";', 'application/javascript'],
  }) }), /does not contain baked version/);
});

test('does not follow assets from another origin', async () => {
  await assert.rejects(inspectDeployment({ baseUrl, expectedSha: sha, fetchImpl: fixture({
    '/': ['<script src="https://other.invalid/assets/index-abcdefgh.js"></script>', 'text/html'],
  }) }), /no local JavaScript/);
});

test('bounds a real response whose headers arrive but body stalls by the global deadline', async () => {
  const server = createServer((_req, response) => { response.writeHead(200); response.write('{'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    await assert.rejects(inspectDeployment({ baseUrl: `http://127.0.0.1:${address.port}`, expectedSha: sha, deadline: Date.now() + 500 }), /\/build-info.json \[body\].*(abort|timeout|deadline)/i);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('enforces the production five-second read limit through a real unfinished HTTP body', async () => {
  const server = createServer((_req, response) => { response.writeHead(200); response.write('{'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const started = Date.now();
  try {
    await assert.rejects(inspectDeployment({ baseUrl: `http://127.0.0.1:${address.port}`, expectedSha: sha,
      deadline: started + 12_000,
    }), /\/build-info.json \[body\].*(abort|timeout)/i);
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 4_000 && elapsed < 9_000, `read deadline took ${elapsed}ms`);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('identifies the failed endpoint, connection phase and original cause', async () => {
  const cause = Object.assign(new Error('connection timed out'), { code: 'UND_ERR_CONNECT_TIMEOUT' });
  const failure = new TypeError('fetch failed', { cause });
  await assert.rejects(inspectDeployment({ baseUrl, expectedSha: sha, fetchImpl: async () => { throw failure; } }), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /fixture\.invalid\/build-info.json \[request\].*fetch failed.*UND_ERR_CONNECT_TIMEOUT/);
    assert.equal(error.cause, failure);
    return true;
  });
});

test('rejects an invalid expected SHA before issuing a request or retry', async () => {
  let inspected = false;
  await assert.rejects(waitForDeployment({ baseUrl, expectedSha: 'missing', timeoutMs: 50, pollMs: 1,
    inspect: async () => { inspected = true; throw new Error('must not inspect'); }, log: () => {},
  }), /complete 40-character Git SHA/);
  assert.equal(inspected, false);
});

test('recovers from a transient connection failure by repeating only public GET checks', async () => {
  const methods: string[] = [];
  const logs: string[] = [];
  const healthyFetch = fixture();
  let calls = 0;
  const fetchImpl: typeof fetch = async (input, options) => {
    methods.push(options?.method || 'GET');
    if (++calls === 1) throw new TypeError('fetch failed', {
      cause: Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }),
    });
    return healthyFetch(input, options);
  };
  const result = await waitForDeployment({ baseUrl, expectedSha: sha, timeoutMs: 1_000, pollMs: 1,
    inspect: args => inspectDeployment({ ...args, fetchImpl }), log: message => logs.push(message),
  });
  assert.equal(result.sourceCommit, sha);
  assert.equal(result.assets, 3);
  assert.equal(calls, 7);
  assert.ok(methods.every(method => method === 'GET'));
  assert.match(logs[0], /build-info.json \[request\].*ECONNRESET/);
  assert.match(logs.at(-1)!, /Production verified/);
});

test('never turns a persistently mixed release green while retrying real verification', async () => {
  const logs: string[] = [];
  const fetchImpl = fixture({
    '/api/version': [JSON.stringify({ sourceCommit: 'a'.repeat(40), version: 'a'.repeat(12) }), 'application/json'],
  });
  await assert.rejects(waitForDeployment({ baseUrl, expectedSha: sha, timeoutMs: 75, pollMs: 5,
    inspect: args => inspectDeployment({ ...args, fetchImpl }), log: message => logs.push(message),
  }), /did not converge/);
  assert.ok(logs.length >= 2);
  // The final read may consume the remaining deadline; the mismatch must still
  // have been observed and must never be reported as a verified deployment.
  assert.ok(logs.some(message => /\/api\/version: expected.*received/.test(message)));
  assert.ok(logs.every(message => !message.includes('Production verified')));
});

test('fails explicitly when production never converges and retries only checks', async () => {
  let calls = 0;
  await assert.rejects(waitForDeployment({ baseUrl, expectedSha: sha, timeoutMs: 35, pollMs: 5,
    inspect: async () => { calls++; throw new Error('old release'); }, log: () => {},
  }), /did not converge.*old release/);
  assert.ok(calls >= 2);
});

async function withHttpFixture(failure: 'disconnect' | 'mixed' | 'missing-lazy',
  run: (baseUrl: string, requests: { path: string; method: string }[]) => Promise<void>) {
  const records = fixtureRecords();
  const requests: { path: string; method: string }[] = [];
  const server = createServer((request, response) => {
    const path = new URL(request.url!, baseUrl).pathname;
    requests.push({ path, method: request.method! });
    if (failure === 'disconnect' && requests.length === 1) { response.destroy(); return; }
    let row = records[path];
    if (failure === 'mixed' && path === '/api/version' && requests.filter(r => r.path === path).length === 1) {
      row = [JSON.stringify({ sourceCommit: 'a'.repeat(40), version: 'a'.repeat(12) }), 'application/json'];
    }
    if (failure === 'missing-lazy' && path === '/assets/index-abcdefgh.js') {
      row = [`const version="${short}"; import("./missing-12345678.js?v=1#module");`, 'application/javascript'];
    }
    response.writeHead(row ? 200 : 404, { 'content-type': row?.[1] || 'text/plain' });
    response.end(row?.[0] || 'Not found');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try { await run(`http://127.0.0.1:${address.port}`, requests); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}

for (const failure of ['disconnect', 'mixed'] as const) {
  test(`recovers from ${failure} over real HTTP only after checking both services and all chunks`, async () => {
    const logs: string[] = [];
    await withHttpFixture(failure, async (baseUrl, requests) => {
      const result = await waitForDeployment({ baseUrl, expectedSha: sha, timeoutMs: 3_000, pollMs: 5,
        log: message => logs.push(message),
      });
      assert.equal(result.sourceCommit, sha);
      assert.equal(result.assets, 3);
      assert.equal(requests.filter(r => r.path === '/build-info.json').length, 2);
      assert.ok(requests.every(r => r.method === 'GET'));
      assert.ok(requests.some(r => r.path === '/assets/AppShell-12345678.js'));
      assert.match(logs[0], /Awaiting production/);
      assert.match(logs.at(-1)!, /Production verified/);
    });
  });
}

test('rejects a missing queried lazy chunk over real HTTP despite a current entry version', async () => {
  await withHttpFixture('missing-lazy', async (baseUrl, requests) => {
    await assert.rejects(inspectDeployment({ baseUrl, expectedSha: sha }), /missing-12345678.js \[headers\]: HTTP 404/);
    assert.ok(requests.some(r => r.path === '/assets/missing-12345678.js'));
  });
});
