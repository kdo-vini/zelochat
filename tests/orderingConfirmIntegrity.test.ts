/**
 * C3 — confirm ordering and integrity (PR C-4, C-5, 1.14, 1.15).
 *
 * Fault-injection coverage for `resolveConfirmation`'s revision-staleness
 * gate (PR C-5: "a stale Confirmar button confirms the current revision")
 * and static source-order checks for the persist-before-send sequencing
 * (PR C-4: "confirm mutates ZeloMenu, then the customer message is sent
 * later, behind a dedupe marker that already fired").
 *
 * Run via: npx tsx tests/orderingConfirmIntegrity.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveConfirmation, type OrderingClient } from '../server/aiWhatsAppOrdering.js';
import { ZeloMenuInternalError } from '../server/zeloMenuInternalClient.js';
import type { AiTurnPermit } from '../server/conversationControl.js';
import type { OrderingSnapshot } from '../src/domain/aiWhatsAppOrdering.js';

function snapshot(overrides: Partial<OrderingSnapshot> = {}): OrderingSnapshot {
  return {
    orderingId: '11111111-1111-4111-8111-111111111111',
    empresaId: '22222222-2222-4222-8222-222222222222',
    remoteJid: '5511999999999@s.whatsapp.net',
    state: 'cart_open',
    revision: 5,
    cart: { items: [] },
    customer: { name: 'Ana', phone: '5511999999999' },
    fulfillment: { type: 'pickup', asap: true },
    payment: { declaredMethod: 'pix', pixReceiptRequired: false, pixReceiptApproved: false },
    pricing: { subtotal: 20, deliveryFee: 0, discount: 0, total: 20 },
    revalidation: { checkedAt: new Date(0).toISOString(), ok: true, issues: [] },
    confirmationAction: { type: 'confirm_order', token: 'fresh-token', revision: 5, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    requiresReview: false,
    order: null,
    ...overrides,
  };
}

const fakePermit: AiTurnPermit = {
  empresaId: snapshot().empresaId,
  conversationControlId: 'simulation-control',
  remoteJid: snapshot().remoteJid,
  epoch: '0',
  triggerMessageId: 'simulation-message',
};

// No Supabase configured in this test process — inject an always-current
// check for scenarios that reach `resolveConfirmation`'s permit re-check
// (C5 / PR I-2). Takeover races against this SAME check live in
// tests/aiTakeoverRace.test.ts.
const alwaysCurrentPermit = async () => true;

// ---------------------------------------------------------------------------
// 1. A mismatched expectedRevision NEVER calls confirmDraft — the draft
//    moved since the customer was shown this token, so refuse and re-send
//    the CURRENT summary instead of confirming unseen content.
// ---------------------------------------------------------------------------
{
  let confirmCalls = 0;
  const client: OrderingClient = {
    searchCatalog: async () => { throw new Error('unused'); },
    updateDraft: async () => { throw new Error('unused'); },
    confirmDraft: async () => { confirmCalls += 1; throw new Error('must not be called'); },
    cancelDraft: async () => { throw new Error('unused'); },
    getOrdering: async () => { throw new Error('unused'); },
  };
  const current = snapshot({ revision: 7 }); // draft has moved on since revision 5 was shown
  const outcome = await resolveConfirmation(current, client, current.empresaId, current.remoteJid, 'm1', fakePermit, 'fresh-token', 5, alwaysCurrentPermit);
  assert.equal(confirmCalls, 0, 'a stale expectedRevision must never call confirmDraft');
  assert.equal(outcome.kind, 'summary', 'a stale confirm re-sends the current summary instead of confirming');
  assert.equal(outcome.snapshot.revision, 7, 'the re-sent summary reflects the CURRENT draft, not the stale one');
}

// ---------------------------------------------------------------------------
// 2. A matching expectedRevision confirms exactly once.
// ---------------------------------------------------------------------------
{
  let confirmCalls = 0;
  const confirmedSnapshot = snapshot({ state: 'confirmed', order: { id: 'ord-1', status: 'accepted', alreadyConfirmed: true, revision: 5 } });
  const client: OrderingClient = {
    searchCatalog: async () => { throw new Error('unused'); },
    updateDraft: async () => { throw new Error('unused'); },
    confirmDraft: async () => { confirmCalls += 1; return confirmedSnapshot; },
    cancelDraft: async () => { throw new Error('unused'); },
    getOrdering: async () => { throw new Error('unused'); },
  };
  const current = snapshot({ revision: 5 });
  const outcome = await resolveConfirmation(current, client, current.empresaId, current.remoteJid, 'm1', fakePermit, 'fresh-token', 5, alwaysCurrentPermit);
  assert.equal(confirmCalls, 1, 'a matching expectedRevision confirms exactly once');
  assert.equal(outcome.kind, 'confirmed');
}

// ---------------------------------------------------------------------------
// 3. No expectedRevision (a button delivered before this fix shipped, or a
//    legacy pointer with no stored revision) preserves the OLD behavior —
//    confirmDraft still runs. Backward compatible, additive rollout.
// ---------------------------------------------------------------------------
{
  let confirmCalls = 0;
  const confirmedSnapshot = snapshot({ state: 'confirmed', order: { id: 'ord-2', status: 'accepted', alreadyConfirmed: true, revision: 5 } });
  const client: OrderingClient = {
    searchCatalog: async () => { throw new Error('unused'); },
    updateDraft: async () => { throw new Error('unused'); },
    confirmDraft: async () => { confirmCalls += 1; return confirmedSnapshot; },
    cancelDraft: async () => { throw new Error('unused'); },
    getOrdering: async () => { throw new Error('unused'); },
  };
  const current = snapshot({ revision: 5 });
  const outcome = await resolveConfirmation(current, client, current.empresaId, current.remoteJid, 'm1', fakePermit, 'fresh-token', undefined, alwaysCurrentPermit);
  assert.equal(confirmCalls, 1, 'omitting expectedRevision does not block a confirm (backward compatible)');
  assert.equal(outcome.kind, 'confirmed');
}

// ---------------------------------------------------------------------------
// 4. Staleness is checked BEFORE the TIMEOUT/INDISPONIVEL reconciliation path
//    even runs — a stale confirm must never touch the network at all.
// ---------------------------------------------------------------------------
{
  let getOrderingCalls = 0;
  const client: OrderingClient = {
    searchCatalog: async () => { throw new Error('unused'); },
    updateDraft: async () => { throw new Error('unused'); },
    confirmDraft: async () => { throw new ZeloMenuInternalError('TIMEOUT', 503, 'req'); },
    cancelDraft: async () => { throw new Error('unused'); },
    getOrdering: async () => { getOrderingCalls += 1; throw new Error('must not reconcile a confirm that was never attempted'); },
  };
  const current = snapshot({ revision: 9 });
  const outcome = await resolveConfirmation(current, client, current.empresaId, current.remoteJid, 'm1', fakePermit, 'fresh-token', 5, alwaysCurrentPermit);
  assert.equal(getOrderingCalls, 0, 'a stale confirm never reaches the confirmDraft call, so there is nothing to reconcile');
  assert.equal(outcome.kind, 'summary');
}

// ---------------------------------------------------------------------------
// Static ordering checks (PR C-4): "persist the state transition, THEN
// enqueue the confirmation" — the reverse order is exactly what let a
// customer-visible dedupe marker fire while the confirmation text was still
// unsent. Mirrors the source-order assertion style already used by
// tests/routerWebhookGuardrails.test.ts for this same 3-layer-trap class of
// invariant (no Supabase mocking exists in this suite to assert it any
// other way).
// ---------------------------------------------------------------------------
{
  const source = readFileSync(new URL('../server/aiWhatsAppOrdering.ts', import.meta.url), 'utf8');
  const confirmedBranch = source.indexOf("const text = 'Pedido confirmado e enviado para a loja.");
  assert.ok(confirmedBranch >= 0, 'found the confirmed-outcome branch');
  const persistCall = source.indexOf('await persistPointer(permit, outcome.snapshot,', confirmedBranch);
  const sendCall = source.indexOf('await sendText(permit, text, `confirmed:', confirmedBranch);
  assert.ok(persistCall > confirmedBranch && sendCall > persistCall, 'the confirmed pointer is persisted BEFORE the confirmation text is enqueued');
}

// ---------------------------------------------------------------------------
// Static ordering checks (PR C-4): router.ts must not record a canonical
// button click as "handled" (the in-memory dedupe key) until `complete()`
// (the confirm/cancel/alter reply — for confirm, the ZeloMenu mutation
// already ran inside the handler by the time it returns) has ALSO
// succeeded. Otherwise a throw in `complete()` leaves the dedupe key set
// with no reply ever sent, and a webhook retry finds "already handled" and
// skips silently forever.
// ---------------------------------------------------------------------------
{
  const routerSource = readFileSync(new URL('../server/router.ts', import.meta.url), 'utf8');
  const occurrences = [...routerSource.matchAll(/handleCanonicalButtonOnce\(\s*canonicalButtonMessageIds,\s*exactKey,/g)];
  assert.equal(occurrences.length, 2, 'both canonical-button call sites (the top-level button dispatch and the C1 typed Cancelar/Alterar routing) are present');
  for (const match of occurrences) {
    const handlerStart = match.index ?? 0;
    const handlerEnd = routerSource.indexOf('));', handlerStart);
    const handlerBody = routerSource.slice(handlerStart, handlerEnd);
    assert.match(handlerBody, /if \(result\.handled\) await result\.complete\?\.\(\);/, 'complete() is awaited INSIDE the deduped handler, before the dedupe key can be recorded');
  }
}

console.log('orderingConfirmIntegrity tests passed');
