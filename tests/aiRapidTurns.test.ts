// FN I2 — rapid-turn rate limiting must coalesce, never silently drop.
// Run via: npx tsx tests/aiRapidTurns.test.ts

import assert from 'node:assert/strict';
import { createAutoReplyRateLimiter } from '../server/autoReplyRateLimit.js';

console.log('\nFour turns in 60s: three allowed, the 4th gets a bounded retryAfterMs (no message lost)');
{
  let now = 0;
  const limiter = createAutoReplyRateLimiter({ now: () => now });
  const key = 'empresa-1:5511999999999@s.whatsapp.net';

  const outcomes: Array<{ allowed: boolean; retryAfterMs?: number }> = [];
  for (let i = 0; i < 4; i++) {
    now += 5_000; // messages spaced 5s apart, well inside the 60s window
    outcomes.push(limiter.check(key));
  }

  assert.deepEqual(outcomes.map((o) => o.allowed), [true, true, true, false], 'exactly 3 allowed, the 4th capped');
  assert.equal(typeof outcomes[3].retryAfterMs, 'number', 'a capped turn always carries a retryAfterMs — never a silent, unrecoverable drop');
  assert.ok(outcomes[3].retryAfterMs! > 0 && outcomes[3].retryAfterMs! <= 60_000, 'retryAfterMs is bounded by the window');
}

console.log('\nA capped turn becomes allowed again once its own window has elapsed (guaranteed later turn)');
{
  let now = 0;
  const limiter = createAutoReplyRateLimiter({ now: () => now });
  const key = 'empresa-1:5511999999999@s.whatsapp.net';

  for (let i = 0; i < 3; i++) { now += 1_000; limiter.check(key); }
  now += 1_000;
  const capped = limiter.check(key);
  assert.equal(capped.allowed, false);

  // Advance exactly past the retryAfterMs the limiter itself reported.
  now += capped.retryAfterMs!;
  const retried = limiter.check(key);
  assert.equal(retried.allowed, true, 'the coalesced retry succeeds once the window resets — the 4th message is never permanently lost');
}

console.log('\nDifferent contacts never share a window (per-contact key)');
{
  let now = 0;
  const limiter = createAutoReplyRateLimiter({ now: () => now });
  for (let i = 0; i < 3; i++) { now += 1_000; limiter.check('empresa-1:jidA'); }
  const stillFreshContact = limiter.check('empresa-1:jidB');
  assert.equal(stillFreshContact.allowed, true, 'a different contact is not affected by another contact hitting the cap');
}

console.log('\nA fresh window after the previous one fully expired starts uncapped');
{
  let now = 0;
  const limiter = createAutoReplyRateLimiter({ now: () => now, windowMs: 60_000, maxPerWindow: 3 });
  const key = 'empresa-1:jid';
  for (let i = 0; i < 3; i++) { now += 1_000; limiter.check(key); }
  now += 61_000; // window fully elapsed, no message sent during the gap
  const freshWindow = limiter.check(key);
  assert.equal(freshWindow.allowed, true);
}

console.log('\naiRapidTurns tests passed');
