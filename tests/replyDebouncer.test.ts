// Standalone test for the 3-stage reply debouncer.
// Exercises timer state machine in isolation — sendPresence/markAsRead calls
// inside the module swallow errors, so fake empresaId/jid is fine.
//
// Run from zelochat/: npx tsx tests/replyDebouncer.test.ts

import { setTimeout } from 'node:timers/promises';
import { assert, pass, fail } from './testHarness.js';

// Set short delays BEFORE module loads (it reads env at init).
process.env.AI_DEBOUNCE_READ_MS = '50';
process.env.AI_DEBOUNCE_TYPING_MS = '50';
process.env.AI_DEBOUNCE_REPLY_MS = '50';
process.env.ZELOCHAT_DISABLE_WHATSAPP_NETWORK = '1';

const { scheduleReply: scheduleReplyWithPermit, cancelPendingReply } = await import('../server/replyDebouncer.js');
const testPermit = {
  empresaId: 'test-empresa',
  conversationControlId: 'test-control',
  remoteJid: 'test@s.whatsapp.net',
  epoch: '1',
  triggerMessageId: 'test-message',
};
const scheduleReply = (args: Omit<Parameters<typeof scheduleReplyWithPermit>[0], 'permit'>) =>
  scheduleReplyWithPermit({ ...args, permit: { ...testPermit, empresaId: args.empresaId, remoteJid: args.jid } });

const TOTAL_MS = 150; // 50 + 50 + 50
const SETTLE_MS = 100;

console.log('\nTest 1: single message → fires once after ~150ms');
{
  let fireCount = 0;
  let firedAt = 0;
  const startedAt = Date.now();
  scheduleReply({
    empresaId: 'e1',
    jid: 'j1',
    messageId: 'm1',
    fire: async () => {
      fireCount++;
      firedAt = Date.now() - startedAt;
    },
  });
  await setTimeout(TOTAL_MS + SETTLE_MS);
  assert(fireCount === 1, `fire called exactly once (got ${fireCount})`);
  assert(firedAt >= TOTAL_MS - 20, `fired at >= ${TOTAL_MS}ms (got ${firedAt}ms)`);
  assert(firedAt <= TOTAL_MS + SETTLE_MS, `fired before timeout (got ${firedAt}ms)`);
}

console.log('\nTest 2: 3 rapid messages → fires once with the LATEST callback');
{
  const calls: string[] = [];
  scheduleReply({ empresaId: 'e2', jid: 'j2', messageId: 'm1', fire: async () => { calls.push('cb-m1'); } });
  await setTimeout(30);
  scheduleReply({ empresaId: 'e2', jid: 'j2', messageId: 'm2', fire: async () => { calls.push('cb-m2'); } });
  await setTimeout(30);
  scheduleReply({ empresaId: 'e2', jid: 'j2', messageId: 'm3', fire: async () => { calls.push('cb-m3'); } });
  await setTimeout(TOTAL_MS + SETTLE_MS);
  assert(calls.length === 1, `fire called once (got ${calls.length})`);
  assert(calls[0] === 'cb-m3', `latest callback used (got "${calls[0]}")`);
}

console.log('\nTest 3: rapid burst total time > TOTAL_MS but each gap < TOTAL_MS → fires once after burst');
{
  let fireCount = 0;
  const startedAt = Date.now();
  let firedAt = 0;
  for (let i = 0; i < 5; i++) {
    scheduleReply({
      empresaId: 'e3',
      jid: 'j3',
      messageId: `m${i}`,
      fire: async () => {
        fireCount++;
        firedAt = Date.now() - startedAt;
      },
    });
    await setTimeout(50); // each new msg arrives within the 150ms window → reset
  }
  // Last scheduleReply at t=200ms. fire should happen at t=200+150=350ms.
  await setTimeout(TOTAL_MS + SETTLE_MS);
  assert(fireCount === 1, `fire called once even after 5 resets (got ${fireCount})`);
  assert(firedAt >= 350 - 20, `fire delayed by burst (got ${firedAt}ms, expected ~350ms)`);
}

console.log('\nTest 4: cancelPendingReply during window → fire NOT called');
{
  let fireCount = 0;
  scheduleReply({ empresaId: 'e4', jid: 'j4', messageId: 'm1', fire: async () => { fireCount++; } });
  await setTimeout(30);
  cancelPendingReply('e4', 'j4');
  await setTimeout(TOTAL_MS + SETTLE_MS);
  assert(fireCount === 0, `fire NOT called after cancel (got ${fireCount})`);
}

console.log('\nTest 5: distinct (empresa, jid) keys are isolated');
{
  let fireA = 0;
  let fireB = 0;
  let fireC = 0;
  scheduleReply({ empresaId: 'eA', jid: 'jA', messageId: 'm1', fire: async () => { fireA++; } });
  scheduleReply({ empresaId: 'eA', jid: 'jB', messageId: 'm1', fire: async () => { fireB++; } });
  scheduleReply({ empresaId: 'eB', jid: 'jA', messageId: 'm1', fire: async () => { fireC++; } });
  await setTimeout(TOTAL_MS + SETTLE_MS);
  assert(fireA === 1 && fireB === 1 && fireC === 1, `all 3 keys fired independently (a=${fireA} b=${fireB} c=${fireC})`);
}

console.log('\nTest 6: cancel of non-existent key → no throw');
{
  let threw = false;
  try {
    cancelPendingReply('ghost', 'ghost');
  } catch {
    threw = true;
  }
  assert(!threw, 'no-op on missing key');
}

console.log('\nTest 7: messageId undefined → fire still happens (markAsRead silently skipped)');
{
  let fireCount = 0;
  scheduleReply({
    empresaId: 'e_noid',
    jid: 'j_noid',
    messageId: undefined,
    fire: async () => { fireCount++; },
  });
  await setTimeout(TOTAL_MS + SETTLE_MS);
  assert(fireCount === 1, `fire happens even without messageId (got ${fireCount})`);
}

console.log('\nTest 8: fire callback that throws → caught (does not crash next cycles)');
{
  let secondCycleFired = false;
  scheduleReply({
    empresaId: 'e7',
    jid: 'j7',
    messageId: 'm1',
    fire: async () => {
      throw new Error('boom');
    },
  });
  await setTimeout(TOTAL_MS + SETTLE_MS);
  // Now schedule a second reply on the same key — should still work.
  scheduleReply({
    empresaId: 'e7',
    jid: 'j7',
    messageId: 'm2',
    fire: async () => {
      secondCycleFired = true;
    },
  });
  await setTimeout(TOTAL_MS + SETTLE_MS);
  assert(secondCycleFired, 'next cycle on same key works after thrown error');
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
