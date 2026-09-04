// PR I-5 — ZeloMenu unavailability must trip a circuit breaker instead of
// letting every conversation escalate independently and flood the manager
// with one notification per conversation. Fake-clock test: no real timers,
// no network, no Supabase.
//
// Run via: npx tsx tests/orderingCircuitBreaker.test.ts

import assert from 'node:assert/strict';
import { createOrderingCircuitBreaker } from '../server/orderingCircuitBreaker.js';

console.log('\nStays closed under the threshold');
{
  let now = 0;
  const breaker = createOrderingCircuitBreaker({ threshold: 5, windowMs: 60_000, openMs: 30_000, now: () => now });
  const key = 'empresa-1';
  const opened: boolean[] = [];
  for (let i = 0; i < 4; i++) {
    now += 1_000;
    opened.push(breaker.recordFailure(key));
  }
  assert.deepEqual(opened, [false, false, false, false], 'fewer than the threshold never opens the breaker');
  assert.equal(breaker.isOpen(key), false);
}

console.log('\nOpens exactly once on the 5th consecutive failure inside the window, and only that call reports it');
{
  let now = 0;
  const breaker = createOrderingCircuitBreaker({ threshold: 5, windowMs: 60_000, openMs: 30_000, now: () => now });
  const key = 'empresa-1';
  const opened: boolean[] = [];
  for (let i = 0; i < 5; i++) {
    now += 1_000;
    opened.push(breaker.recordFailure(key));
  }
  assert.deepEqual(opened, [false, false, false, false, true], 'only the failure that crosses the threshold reports true');
  assert.equal(breaker.isOpen(key), true, 'the breaker is open immediately after the 5th failure');
}

console.log('\nWhile open, further failures never re-open or re-report (one notification per opening)');
{
  let now = 0;
  const breaker = createOrderingCircuitBreaker({ threshold: 5, windowMs: 60_000, openMs: 30_000, now: () => now });
  const key = 'empresa-1';
  for (let i = 0; i < 5; i++) { now += 1_000; breaker.recordFailure(key); }
  assert.equal(breaker.isOpen(key), true);
  now += 5_000;
  const againOpened = breaker.recordFailure(key);
  assert.equal(againOpened, false, 'a failure recorded while already open must not report a second opening');
  assert.equal(breaker.isOpen(key), true, 'still open — the extra failure did not extend or reset anything observable');
}

console.log('\nCloses again after openMs elapses, and can re-open independently afterward');
{
  let now = 0;
  const breaker = createOrderingCircuitBreaker({ threshold: 5, windowMs: 60_000, openMs: 30_000, now: () => now });
  const key = 'empresa-1';
  for (let i = 0; i < 5; i++) { now += 1_000; breaker.recordFailure(key); }
  assert.equal(breaker.isOpen(key), true);
  now += 30_000; // openMs elapses
  assert.equal(breaker.isOpen(key), false, 'breaker closes on its own once openMs has elapsed');
  // A fresh run of 5 consecutive failures can open it again, independently.
  const opened: boolean[] = [];
  for (let i = 0; i < 5; i++) { now += 1_000; opened.push(breaker.recordFailure(key)); }
  assert.deepEqual(opened, [false, false, false, false, true], 'the breaker can trip again after a prior opening has closed');
}

console.log('\nA success resets the consecutive-failure streak (no partial credit toward the threshold)');
{
  let now = 0;
  const breaker = createOrderingCircuitBreaker({ threshold: 5, windowMs: 60_000, openMs: 30_000, now: () => now });
  const key = 'empresa-1';
  for (let i = 0; i < 4; i++) { now += 1_000; breaker.recordFailure(key); }
  now += 1_000;
  breaker.recordSuccess(key);
  const opened: boolean[] = [];
  for (let i = 0; i < 4; i++) { now += 1_000; opened.push(breaker.recordFailure(key)); }
  assert.deepEqual(opened, [false, false, false, false], 'the streak was reset by the success — 4 more failures alone never opens it');
}

console.log('\nFailures outside the sliding window do not count toward the threshold');
{
  let now = 0;
  const breaker = createOrderingCircuitBreaker({ threshold: 5, windowMs: 60_000, openMs: 30_000, now: () => now });
  const key = 'empresa-1';
  for (let i = 0; i < 4; i++) { now += 1_000; breaker.recordFailure(key); }
  now += 70_000; // well past the 60s window — the first 4 failures have aged out
  const opened: boolean[] = [];
  for (let i = 0; i < 4; i++) { now += 1_000; opened.push(breaker.recordFailure(key)); }
  assert.deepEqual(opened, [false, false, false, false], 'stale failures outside the window never accumulate toward the threshold');
}

console.log('\nEach key (empresa) has an independent breaker — one tenant\'s outage never trips another\'s');
{
  let now = 0;
  const breaker = createOrderingCircuitBreaker({ threshold: 5, windowMs: 60_000, openMs: 30_000, now: () => now });
  for (let i = 0; i < 5; i++) { now += 1_000; breaker.recordFailure('empresa-a'); }
  assert.equal(breaker.isOpen('empresa-a'), true);
  assert.equal(breaker.isOpen('empresa-b'), false, 'a different empresa key is never affected by another key\'s failures');
}

console.log('orderingCircuitBreaker tests passed');
