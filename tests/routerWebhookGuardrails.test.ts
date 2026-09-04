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
    name: 'raw event is durable before ACK and fromMe processing is awaited with auth context',
    run: () => {
      const raw = indexOfOrFail('const rawEventId = await recordRawWebhookEvent(instance, empresaId, req.body, authStatus);');
      const durableGuard = indexOfOrFail('if (!rawEventId) {');
      const ack = indexOfOrFail('res.json({ ok: true });');
      const process = indexOfOrFail('await processWebhookEvent(empresaId, req.body, { authStatus, rawEventId });');
      assert(raw < durableGuard && durableGuard < ack && ack < process, 'durability guard precedes success ACK and async processing follows it');
      assertIncludes(router, "res.status(503).json({ error: 'Não foi possível receber esta atualização agora.' });", 'raw persistence failure asks the provider to retry without exposing internals');
      assertIncludes(router, 'await processFromMeUpsert({', 'fromMe processor is awaited instead of fire-and-forget persistence');
      assert(!router.includes('handleOutboundMessage(data, empresaId).catch'), 'legacy fire-and-forget fromMe persistence is removed');
    },
  },
  {
    name: 'hard button path returns before dispatching to AI',
    run: () => {
      const hardStart = indexOfOrFail('const isHardConfirm = buttonId ===');
      const hardBranch = indexOfOrFail('if (isHardConfirm || isHardCancel)');
      const hardReturn = router.indexOf('return;', hardBranch);
      // NOTE: the FN C4/PR C-3 canonical-pointer routing (added ahead of this
      // legacy branch) also calls `dispatchIncomingMessage` — search past this
      // branch's own return so this still targets the bottom-of-function
      // catch-all dispatch the legacy short-circuit must precede.
      const dispatch = router.indexOf('dispatchIncomingMessage(data, empresaId);', hardReturn);
      assert(dispatch >= 0, 'found the bottom-of-function catch-all dispatch');
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
      // See the note in the previous test — search past this branch's own
      // return so this targets the bottom-of-function catch-all dispatch.
      const dispatch = router.indexOf('dispatchIncomingMessage(data, empresaId);', branchReturn);
      assert(dispatch >= 0, 'found the bottom-of-function catch-all dispatch');
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
    name: 'hard button display text is exact and does not catch natural language',
    run: () => {
      assertIncludes(router, 'selectedDisplayText', 'button display text is considered when provider omits selectedButtonId');
      assertIncludes(router, "buttonTextNormalized === 'confirmar pedido'", 'confirmar pedido display label is accepted');
      assertIncludes(router, "buttonTextNormalized === 'cancelar pedido'", 'cancelar pedido display label is accepted');
      assert(!router.includes("buttonTextNormalized.startsWith('confirmar '"), 'natural confirm phrases are not hard-confirmed');
      assert(!router.includes("buttonTextNormalized.startsWith('cancelar '"), 'partial cancel phrases are not hard-cancelled');
    },
  },
  {
    name: 'canonical pointer routes typed Confirmar/Cancelar/Alterar before the legacy short-circuit (FN C4 / PR C-3 / 1.35)',
    run: () => {
      const canonicalCheck = indexOfOrFail('const canonicalPointer = canonicalCheckSession ? findLatestOrderingState(canonicalCheckSession.messages) : null;');
      const legacyBranch = indexOfOrFail('if (isHardConfirm || isHardCancel) {');
      assert(canonicalCheck < legacyBranch, 'canonical-pointer routing runs before the legacy hard-button short-circuit');
      const confirmDispatch = indexOfOrFail('console.log(`[WebhookTrace] canonical_text_confirm empresa=${empresaId} jid=${redactJid(remoteJid)}`);');
      const confirmReturn = router.indexOf('return;', confirmDispatch);
      assert(confirmDispatch < legacyBranch && confirmReturn > confirmDispatch && confirmReturn < legacyBranch,
        'a typed Confirmar with an open canonical draft flows through the real ordering pipeline and returns before the legacy idempotent reply');
      assertIncludes(router, 'const canonicalButtonId = isAlterText ? AI_ORDER_ALTER_BUTTON : AI_ORDER_CANCEL_BUTTON;', 'typed Cancelar/Alterar with an open canonical draft route to the equivalent canonical button action');
      assertIncludes(router, 'buttonId: canonicalButtonId,', 'the canonical cancel/alter routing calls the real button handler with the resolved canonical id');
    },
  },
  {
    name: 'canonical routing is a no-op with no pointer — legacy body stays byte-for-byte',
    run: () => {
      // The legacy idempotent reply and getPendingOrder lookup still exist,
      // untouched, guarded behind the SAME entry condition as before.
      assertIncludes(router, 'const pending = await getPendingOrder(remoteJid, empresaId);', 'legacy pending lookup is untouched');
      assertIncludes(router, "await enqueueAutomatedText({ permit, text: ack, origin: 'ai_auto', purpose: 'hard-confirm-idempotent' });", 'legacy idempotent ack path is untouched');
      // The new block only ever mutates/dispatches inside `if (canonicalPointer)`
      // — everything before that is a read-only getSession call.
      const guardStart = indexOfOrFail('if ((isHardConfirm || isHardCancel || isAlterText) && !(buttonId && parseOrderingButton(buttonId))) {');
      const sessionRead = indexOfOrFail('const canonicalCheckSession = await getSession(remoteJid, empresaId);');
      const pointerGuard = indexOfOrFail('if (canonicalPointer) {');
      assert(guardStart < sessionRead && sessionRead < pointerGuard, 'the canonical check reads the session before deciding whether to act, so a null pointer changes nothing');
    },
  },
  {
    name: 'Pix-required pending order blocks confirm and asks for receipt',
    run: () => {
      const hardPix = router.indexOf('pendingOrderRequiresPixReceipt(pending)');
      const hardReceipt = router.indexOf('await sendPixReceiptRequiredMessage(remoteJid, empresaId, permit);', hardPix);
      const hardConfirm = router.indexOf('await confirmPendingOrder(remoteJid, empresaId, permit);', hardPix);
      assert(hardPix >= 0 && hardReceipt > hardPix && hardConfirm > hardReceipt, 'hard confirm checks Pix receipt before confirming');

      const softBranch = router.indexOf('Soft confirmation keywords');
      const softPix = router.indexOf('pendingOrderRequiresPixReceipt(pending)', softBranch);
      const softReceipt = router.indexOf('await sendPixReceiptRequiredMessage(remoteJid, empresaId, permit);', softPix);
      const softConfirm = router.indexOf('await confirmPendingOrder(remoteJid, empresaId, permit);', softPix);
      assert(softPix > softBranch && softReceipt > softPix && softConfirm > softReceipt, 'soft confirm checks Pix receipt before confirming');
    },
  },
]);
