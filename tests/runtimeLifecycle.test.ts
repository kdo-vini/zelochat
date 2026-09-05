import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import express from 'express';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createPeriodicTask } from '../server/runtime/periodicTask.js';
import { installShutdown } from '../server/runtime/shutdown.js';
import { mapConcurrent } from '../server/runtime/concurrency.js';
import { createFetchWithDeadline } from '../server/runtime/httpDeadline.js';
import { OutboundWorker } from '../server/outbound/worker.js';
import { OutboundQueue } from '../server/outbound/queue.js';
import { verifyBuildVersion } from '../build-meta.mjs';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function gate() { let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve; }); return { promise, release }; }

test('periodic task never overlaps and stop drains the active cycle', async () => {
  const pending = gate(); let calls = 0;
  const task = createPeriodicTask(async () => { calls++; await pending.promise; }, { initialDelayMs: 0, intervalMs: 5 });
  await sleep(30);
  assert.equal(calls, 1);
  let stopped = false;
  const stopping = task.stop().then(() => { stopped = true; });
  await sleep(15); assert.equal(stopped, false);
  pending.release(); await stopping;
  await sleep(20); assert.equal(calls, 1);
});

test('stop cancels the startup timer; failed cycles still reschedule', async () => {
  let calls = 0; let errors = 0;
  const cancelled = createPeriodicTask(async () => { calls++; }, { initialDelayMs: 10, intervalMs: 5 });
  await cancelled.stop(); await sleep(20); assert.equal(calls, 0);
  const task = createPeriodicTask(async () => { calls++; throw new Error('expected'); }, { initialDelayMs: 0, intervalMs: 5, onError: () => { errors++; } });
  await sleep(30); await task.stop(); assert.ok(calls >= 2); assert.equal(errors, calls);
});

test('concurrent mapping bounds allocation and preserves result order', async () => {
  let active = 0; let max = 0;
  const result = await mapConcurrent(Array.from({ length: 20 }, (_, i) => i), 1_000_000, async (i) => {
    max = Math.max(max, ++active); await sleep(2); active--; return i * 2;
  });
  assert.equal(max, 8); assert.deepEqual(result, Array.from({ length: 20 }, (_, i) => i * 2));
});

test('worker stop awaits all bounded claims even when another claim fails', async () => {
  const pending = gate(); let calls = 0;
  const worker = new OutboundWorker({ queue: {} as OutboundQueue, transport: {
    async prepare() { throw new Error('unused'); },
    async send() { throw new Error('unused'); },
  } });
  worker.runOnce = async () => { if (++calls === 1) throw new Error('expected claim failure'); await pending.promise; return false; };
  worker.start(10, 1_000_000);
  let stopped = false;
  const stopping = worker.stop().then(() => { stopped = true; });
  await sleep(10); assert.equal(calls, 8); assert.equal(stopped, false);
  pending.release(); await stopping; await sleep(20); assert.equal(calls, 8);
});

test('shutdown stops listening, drains once, and has a deadline for stuck work', async () => {
  const server = createServer(); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const pending = gate(); const exits: number[] = []; let stops = 0;
  const control = installShutdown(server, { stop: async () => { stops++; await pending.promise; }, closeConnections: () => {}, timeoutMs: 500, exit: (code) => { exits.push(code); } });
  const first = control.shutdown(); assert.equal(control.shutdown(), first);
  await sleep(10); assert.equal(server.listening, false); assert.deepEqual(exits, []);
  pending.release(); await first; assert.equal(stops, 1); assert.deepEqual(exits, [0]); control.dispose();
  const blockedServer = createServer(); await new Promise<void>((resolve) => blockedServer.listen(0, '127.0.0.1', resolve));
  const blocked = installShutdown(blockedServer, { stop: () => new Promise(() => {}), closeConnections: () => {}, timeoutMs: 20, exit: (code) => { exits.push(code); } });
  await blocked.shutdown(); assert.deepEqual(exits, [0, 1]); blocked.dispose();
});

test('HTTP deadline aborts a response body that never completes', async () => {
  const server = createServer((_req, res) => { res.writeHead(200); res.write('{'); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as { port: number };
    const response = await createFetchWithDeadline(100)(`http://127.0.0.1:${address.port}`);
    assert.equal(response.status, 200);
    await assert.rejects(response.text(), /abort|timeout/i);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test('shutdown isolates synchronous close errors and drains late HTTP work', async () => {
  const admitted = gate(); const finishRequest = gate(); const background = gate(); const exits: number[] = [];
  const server = createServer(async (_req, res) => { admitted.release(); await finishRequest.promise; res.end('ok'); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const response = fetch(`http://127.0.0.1:${address.port}`, { headers: { Connection: 'close' } }).then((res) => res.text());
  await admitted.promise;
  let drainCalled = false;
  const control = installShutdown(server, {
    stop: async () => {}, closeConnections: () => { throw new Error('expected close failure'); },
    drain: async () => { drainCalled = true; await background.promise; },
    timeoutMs: 1_000, exit: (code) => { exits.push(code); },
  });
  const stopping = control.shutdown();
  await sleep(10); assert.equal(drainCalled, false); assert.deepEqual(exits, []);
  finishRequest.release(); assert.equal(await response, 'ok');
  await sleep(10); assert.equal(drainCalled, true); assert.deepEqual(exits, []);
  background.release(); await stopping; assert.deepEqual(exits, [1]); control.dispose();
});

test('build version rejects stale overrides and non-Git versions', () => {
  const sha = 'a'.repeat(40);
  assert.equal(verifyBuildVersion(sha, undefined), sha);
  assert.equal(verifyBuildVersion(sha, sha.slice(0, 12)), sha);
  for (const value of ['old-version', '${SOURCE_COMMIT}', 'b'.repeat(40)]) assert.throws(() => verifyBuildVersion(sha, value), /differs/);
  assert.throws(() => verifyBuildVersion('dev', undefined), /real Git/);
});

test('updated query parser preserves ordinary nested query and form fields', async () => {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.post('/', (req, res) => res.json({ query: req.query, body: req.body }));
  const server = createServer(app); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${address.port}/?filter[status]=pending&tags[]=one&tags[]=two`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Connection: 'close' },
      body: 'customer[name]=Teste&items[0][quantity]=2',
    });
    assert.deepEqual(await response.json(), { query: { filter: { status: 'pending' }, tags: ['one', 'two'] }, body: { customer: { name: 'Teste' }, items: [{ quantity: '2' }] } });
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test('production metadata accepts CRLF checkout but rejects changed or ignored source', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zelochat-build-version-'));
  const command = resolve('build-meta.mjs');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  try {
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src/example.ts'), 'export const value = 1;\n');
    writeFileSync(join(dir, '.gitignore'), 'src/ignored.ts\n');
    git('init', '--quiet'); git('config', 'core.autocrlf', 'false'); git('add', '.');
    git('-c', 'user.name=Build test', '-c', 'user.email=build-test@localhost', 'commit', '--quiet', '-m', 'fixture');
    writeFileSync(join(dir, 'src/example.ts'), 'export const value = 1;\r\n');
    execFileSync(process.execPath, [command], { cwd: dir, env: { ...process.env, PUBLIC_APP_VERSION: '' }, stdio: 'pipe' });
    assert.equal(JSON.parse(readFileSync(join(dir, 'build-info.json'), 'utf8')).sourceCommit, git('rev-parse', 'HEAD').toString().trim());
    writeFileSync(join(dir, 'src/example.ts'), 'export const value = 2;\n');
    assert.throws(() => execFileSync(process.execPath, [command], { cwd: dir, stdio: 'pipe' }));
    writeFileSync(join(dir, 'src/example.ts'), 'export const value = 1;\n');
    writeFileSync(join(dir, 'src/ignored.ts'), 'export const extra = 1;\n');
    assert.throws(() => execFileSync(process.execPath, [command], { cwd: dir, stdio: 'pipe' }));
  } finally {
    assert.ok(resolve(dir).startsWith(`${resolve(tmpdir())}${sep}zelochat-build-version-`));
    rmSync(dir, { recursive: true, force: true });
  }
});
