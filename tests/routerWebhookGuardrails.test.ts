import { readFileSync } from 'node:fs';
import { assert, assertIncludes, runSuite } from './testHarness.js';

const router = readFileSync('server/router.ts', 'utf8');

function indexOfOrFail(text: string): number {
  const idx = router.indexOf(text);
  assert(idx >= 0, `found marker: ${text}`);
  return idx;
}

await runSuite('Router webhook/order guardrails', [
  {
    name: 'known webhook instance accepts missing token during registration rollout',
    run: () => {
      assertIncludes(router, "const strictWebhookToken = (process.env.WEBHOOK_REQUIRE_TOKEN ?? '').toLowerCase();", 'strict token flag is opt-in');
      assertIncludes(router, "res.status(401).json({ error: 'webhook token required' });", 'strict missing-token rejection still exists');
      assertIncludes(router, "accepting during webhook registration rollout", 'missing token is accepted for known instances while webhooks are repaired');
    },
  },
  {
    name: 'hard button path returns before dispatching to AI',
    run: () => {
      const hardStart = indexOfOrFail('const isHardConfirm = buttonId ===');
      const hardBranch = indexOfOrFail('if (isHardConfirm || isHardCancel)');
      const hardReturn = router.indexOf('return;', hardBranch);
      const dispatch = indexOfOrFail('dispatchIncomingMessage(data, empresaId);');
      assert(hardStart < hardBranch, 'hard confirm flags are computed before branch');
      assert(hardBranch < hardReturn && hardReturn < dispatch, 'hard button branch returns before dispatchIncomingMessage');
    },
  },
  {
    name: 'no-pending hard confirm replies idempotently and never falls through',
    run: () => {
      const noPending = indexOfOrFail('No pending — order already finalized or never existed');
      const ack = indexOfOrFail('Seu pedido já foi confirmado! ✅ Qualquer dúvida é só chamar 😊');
      const branchReturn = router.indexOf('return;', ack);
      const dispatch = indexOfOrFail('dispatchIncomingMessage(data, empresaId);');
      assert(noPending < ack, 'idempotent no-pending branch is documented before ack');
      assert(ack < branchReturn && branchReturn < dispatch, 'idempotent hard-confirm reply returns before AI dispatch');
    },
  },
  {
    name: 'retry suppression happens before no-pending acknowledgement',
    run: () => {
      const prev = indexOfOrFail('const prevHandledAt = recentlyHandled.get(handledKey);');
      const isRetry = indexOfOrFail('const isRetry = !!prevHandledAt');
      const retryReturn = indexOfOrFail('hard-button retry suppressed');
      const pending = indexOfOrFail('const pending = await getPendingOrder(remoteJid, empresaId);');
      assert(prev < isRetry && isRetry < retryReturn && retryReturn < pending, 'retry suppression precedes pending lookup');
    },
  },
  {
    name: 'soft confirm only accepts exact Sim/Nao tokens',
    run: () => {
      assertIncludes(router, "const isSoftConfirm = normalized === 'sim' || normalized === 's';", 'soft confirm exact whitelist is present');
      assertIncludes(router, "const isSoftCancel = normalized === 'nao' || normalized === 'n';", 'soft cancel exact whitelist is present');
      assertIncludes(router, "replace(/[\\s\\p{P}\\p{S}]+$/u, '')", 'soft normalize strips only trailing punctuation/symbols');
      assert(!/const\s+normalized\s*=\s*msgText[\s\S]{0,500}replace\(\/\[\^a-z\]\/g/.test(router), 'old digit-stripping normalization is absent from executable soft-confirm code');
    },
  },
  {
    name: 'Pix-required pending order blocks confirm and asks for receipt',
    run: () => {
      const hardPix = router.indexOf('pendingOrderRequiresPixReceipt(pending)');
      const hardReceipt = router.indexOf('await sendPixReceiptRequiredMessage(remoteJid, empresaId);', hardPix);
      const hardConfirm = router.indexOf('await confirmPendingOrder(remoteJid, empresaId);', hardPix);
      assert(hardPix >= 0 && hardReceipt > hardPix && hardConfirm > hardReceipt, 'hard confirm checks Pix receipt before confirming');

      const softBranch = router.indexOf('Soft confirmation keywords');
      const softPix = router.indexOf('pendingOrderRequiresPixReceipt(pending)', softBranch);
      const softReceipt = router.indexOf('await sendPixReceiptRequiredMessage(remoteJid, empresaId);', softPix);
      const softConfirm = router.indexOf('await confirmPendingOrder(remoteJid, empresaId);', softPix);
      assert(softPix > softBranch && softReceipt > softPix && softConfirm > softReceipt, 'soft confirm checks Pix receipt before confirming');
    },
  },
]);
