// Verifies the AI_DEBOUNCE_DISABLED=1 kill switch falls back to a single
// 1500ms debounce (legacy pre-2026-05 behavior) with no read/typing presence.
//
// Run from zelochat/: npx tsx tests/replyDebouncer-disabled.test.ts

process.env.AI_DEBOUNCE_DISABLED = '1';
process.env.ZELOCHAT_DISABLE_WHATSAPP_NETWORK = '1';
// These are ignored when disabled, but set them to detect leakage.
process.env.AI_DEBOUNCE_READ_MS = '50';
process.env.AI_DEBOUNCE_TYPING_MS = '50';
process.env.AI_DEBOUNCE_REPLY_MS = '50';

const { scheduleReply, cancelPendingReply } = await import('../server/replyDebouncer.js');

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log('  PASS', msg);
    pass++;
  } else {
    console.log('  FAIL', msg);
    fail++;
  }
}

console.log('Test 1 (disabled): single fire after ~1500ms, NOT 150ms');
{
  let fireCount = 0;
  let firedAt = 0;
  const startedAt = Date.now();
  scheduleReply({
    empresaId: 'd1',
    jid: 'd1',
    messageId: 'm1',
    fire: async () => {
      fireCount++;
      firedAt = Date.now() - startedAt;
    },
  });
  await sleep(1700);
  assert(fireCount === 1, `fire called once (got ${fireCount})`);
  assert(firedAt >= 1400, `fired near 1500ms (got ${firedAt}ms) — confirms 3-stage timing was bypassed`);
  assert(firedAt <= 1700, `fired before 1700ms (got ${firedAt}ms)`);
}

console.log('\nTest 2 (disabled): rapid burst still coalesces to 1 fire');
{
  const calls: string[] = [];
  scheduleReply({ empresaId: 'd2', jid: 'd2', messageId: 'm1', fire: async () => { calls.push('m1'); } });
  await sleep(200);
  scheduleReply({ empresaId: 'd2', jid: 'd2', messageId: 'm2', fire: async () => { calls.push('m2'); } });
  await sleep(200);
  scheduleReply({ empresaId: 'd2', jid: 'd2', messageId: 'm3', fire: async () => { calls.push('m3'); } });
  await sleep(1700);
  assert(calls.length === 1, `single fire across burst (got ${calls.length})`);
  assert(calls[0] === 'm3', `latest callback used (got "${calls[0]}")`);
}

console.log('\nTest 3 (disabled): cancelPendingReply still works');
{
  let fireCount = 0;
  scheduleReply({ empresaId: 'd3', jid: 'd3', messageId: 'm1', fire: async () => { fireCount++; } });
  await sleep(200);
  cancelPendingReply('d3', 'd3');
  await sleep(1700);
  assert(fireCount === 0, `cancelled in disabled-mode (got ${fireCount})`);
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
