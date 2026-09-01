// Guards the Supabase egress fix: the outbound worker must poll slowly while
// the queue is empty, wake immediately when this process enqueues a job, and
// never spend a separate API request on release_zelochat_expired_leases
// (the claim RPC already runs it).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OutboundQueue, type OutboundJobStore } from '../server/outbound/queue.js';
import { OutboundWorker } from '../server/outbound/worker.js';
import { registerOutboundWorkerWaker, wakeOutboundWorker } from '../server/outbound/wake.js';

const watchdog = setTimeout(() => { console.error('outboundWorkerPolling hung'); process.exit(1); }, 10_000);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let claims = 0;
const store: OutboundJobStore = {
  async insert() { throw new Error('unused'); },
  async claim() { claims++; return null; },
  async startTransport() { return false; },
  async markSent() { return false; },
  async markDeliveryUncertain() { return false; },
  async markFailed() { return false; },
  async defer() { return false; },
  async markSuppressed() { return false; },
  async releaseExpired() {},
};

const transport = {
  async prepare(job: any) { return { job, request: { url: 'test://unused', body: '{}', headers: {} } }; },
  async send() { return { state: 'sent' as const, providerMessageId: 'unused' }; },
};
const worker = new OutboundWorker({ queue: new OutboundQueue(store), transport });
const IDLE_MS = 5_000;
const ACTIVE_MS = 10;
const ACTIVE_WINDOW_MS = 120;

// 1. Empty queue at start: exactly one claim, then the idle interval.
worker.start(ACTIVE_MS, 1, { idleIntervalMs: IDLE_MS, activeWindowMs: ACTIVE_WINDOW_MS });
await sleep(200);
assert.equal(claims, 1, 'idle worker must poll only once per idle interval');

// 2. A wake claims immediately and keeps the fast interval for the active window.
registerOutboundWorkerWaker(() => worker.wake());
wakeOutboundWorker();
await sleep(80);
assert(claims >= 3, `expected fast polling right after wake, got ${claims}`);

// 3. After the active window the worker returns to the idle interval.
await sleep(ACTIVE_WINDOW_MS + 60);
const settled = claims;
await sleep(200);
assert.equal(claims, settled, 'worker must fall back to the idle interval after the active window');

// 4. Concurrent wakes while a tick is in flight do not stack timers.
wakeOutboundWorker(); wakeOutboundWorker(); wakeOutboundWorker();
await sleep(40);
assert(claims <= settled + 4, `wakes must coalesce, got ${claims - settled} claims`);

// 5. stop() cancels polling.
worker.stop();
registerOutboundWorkerWaker(null);
const stopped = claims;
await sleep(80);
assert.equal(claims, stopped, 'stop() must cancel the scheduled poll');
wakeOutboundWorker(); // no registered waker: must be a harmless no-op

// 6. Source-level guard: no per-tick release RPC against Supabase.
const workerSource = readFileSync('server/outbound/worker.ts', 'utf8');
assert(!workerSource.includes("rpc('release_zelochat_expired_leases')"), 'claim_zelochat_outbound_job already releases expired leases');
for (const file of ['server/conversationOutbound.ts', 'server/campaigns/service.ts', 'server/automations/sweeper.ts', 'server/zelomenuCartSessions.ts']) {
  assert(readFileSync(file, 'utf8').includes('wakeOutboundWorker()'), `${file} enqueues jobs and must wake the worker`);
}

console.log('outboundWorkerPolling: ok');
clearTimeout(watchdog);
process.exit(0);
