import assert from 'node:assert/strict';
import type { AiTurnPermit, TakeoverSource } from '../server/conversationControl.js';
import {
  confirmPendingOrderUnderPermit,
  enqueueAutomatedText,
  runAiModelStep,
} from '../server/ai.js';
import {
  tryHandleAiWhatsAppOrdering,
  resolveConfirmation,
  type OrderingClient,
} from '../server/aiWhatsAppOrdering.js';
import { ZeloMenuInternalError } from '../server/zeloMenuInternalClient.js';
import type { OrderingSnapshot } from '../src/domain/aiWhatsAppOrdering.js';
import type { StoredSession } from '../server/messageHandler.js';

class Deferred<T> {
  readonly promise: Promise<T>;
  private resolvePromise!: (value: T) => void;

  constructor() {
    this.promise = new Promise<T>((resolve) => {
      this.resolvePromise = resolve;
    });
  }

  resolve(value: T): void {
    this.resolvePromise(value);
  }
}

const permit: AiTurnPermit = {
  empresaId: '00000000-0000-4000-8000-000000000001',
  conversationControlId: '00000000-0000-4000-8000-000000000002',
  remoteJid: '5511999999999@s.whatsapp.net',
  epoch: '7',
  triggerMessageId: '00000000-0000-4000-8000-000000000003',
};

{
  let current = true;
  let inserts = 0;
  let pendingDeletes = 0;
  const enteredTransaction = new Deferred<void>();
  const releaseTransaction = new Deferred<void>();
  const confirmation = confirmPendingOrderUnderPermit(permit, 'pending-1', async ({ idempotencyKey }) => {
    assert.equal(idempotencyKey, `ai-pending:${permit.triggerMessageId}:pending-1`);
    enteredTransaction.resolve();
    await releaseTransaction.promise;
    if (!current) return null;
    inserts += 1;
    pendingDeletes += 1;
    return 'order-1';
  });
  await enteredTransaction.promise;
  current = false;
  releaseTransaction.resolve();
  assert.equal(await confirmation, null, 'takeover intercalado suprime transação pending');
  assert.equal(inserts, 0, 'takeover intercalado cria zero pedido');
  assert.equal(pendingDeletes, 0, 'takeover intercalado não consome pending');
}

for (const source of [
  'zelochat_operator',
  'native_whatsapp',
  'explicit_manual_toggle',
  'escalation',
] satisfies TakeoverSource[]) {
  let current = true;
  let modelCalls = 0;
  let jobWrites = 0;
  const model = new Deferred<{ text: string }>();

  const turn = runAiModelStep(
    permit,
    `model:${source}`,
    async () => {
      modelCalls += 1;
      return model.promise;
    },
    async () => current,
  );

  await Promise.resolve();
  current = false; // claimHumanTakeover(source) advanced the durable epoch.
  model.resolve({ text: 'Resposta antiga' });

  const reply = await turn;
  if (reply) {
    await enqueueAutomatedText({
      permit,
      text: reply.text,
      origin: 'ai_auto',
      purpose: `race-${source}`,
    }, {
      isPermitCurrent: async () => current,
      dispatch: async () => {
        jobWrites += 1;
        return { state: 'queued', jobId: 'job-1', messageId: 'message-1' };
      },
    });
  }

  assert.equal(modelCalls, 1, `${source}: model iniciou antes do takeover`);
  assert.equal(reply, null, `${source}: resposta antiga foi descartada`);
  assert.equal(jobWrites, 0, `${source}: nenhum job AI foi criado`);
}

{
  let modelCalls = 0;
  const result = await runAiModelStep(
    permit,
    'pre-model guard',
    async () => {
      modelCalls += 1;
      return { text: 'não deve rodar' };
    },
    async () => false,
  );
  assert.equal(result, null);
  assert.equal(modelCalls, 0, 'permit revogado bloqueia antes do modelo');
}

for (const purpose of ['tool-followup', 'trigger-fallback', 'pix-helper', 'pending-confirm']) {
  let jobWrites = 0;
  const result = await enqueueAutomatedText({
    permit,
    text: `Mensagem de ${purpose}`,
    origin: purpose === 'tool-followup' ? 'ai_followup' : 'ai_auto',
    purpose,
  }, {
    isPermitCurrent: async () => false,
    dispatch: async () => {
      jobWrites += 1;
      return { state: 'queued', jobId: 'job-1', messageId: 'message-1' };
    },
  });
  assert.equal(result, null, `${purpose}: helper falha fechado`);
  assert.equal(jobWrites, 0, `${purpose}: zero write automático e zero job AI`);
}

for (const context of ['pending-pix-validator', 'active-order-pix-validator']) {
  let current = true;
  let mutations = 0;
  const validator = new Deferred<{ approved: boolean }>();
  const validation = runAiModelStep(permit, context, () => validator.promise, async () => current);
  await Promise.resolve();
  current = false;
  validator.resolve({ approved: true });
  const result = await validation;
  if (result) mutations += 1;
  assert.equal(result, null, `${context}: resultado externo obsoleto é descartado`);
  assert.equal(mutations, 0, `${context}: zero mutação após takeover durante validador`);
}

// ---------------------------------------------------------------------------
// C5 / FN I3, PR I-2, I-16, 1.22-1.24, 1.24 — races for the NEW canonical
// (ZeloMenu) ordering handler, not just the legacy `zelochat_pending_orders`
// path above. Item 1.24 flagged that this whole file exercised only the
// legacy path (`confirmPendingOrderUnderPermit`); these blocks race
// `tryHandleAiWhatsAppOrdering` and `resolveConfirmation` — the same
// primitives production actually calls — via the injectable
// `permitCheck`/`draftPlanner`/`client` seams added for exactly this
// purpose. No Supabase is configured in this test process, so every
// scenario below is one where the takeover is detected and the turn returns
// (or throws suppressed) BEFORE any real database call would have run —
// `sendSummary`/`sendNextRequirement`'s own `getSession` call is real
// Supabase and is only reached on the SUCCESS path, so races that land
// after a successful mutation (PR I-16's "after update/before pointer
// persistence", "before outbound") are covered by code inspection
// (`assertPermitCurrent` inside `persistPointer`/`dispatchAiPayload`, both
// called before any DB/network write) rather than end to end here —
// consistent with this suite's existing no-Supabase-mocking convention
// (see Task A's equivalent note on `shouldRearmAfterAudioTranscription`).
// ---------------------------------------------------------------------------

function raceSnapshot(overrides: Partial<OrderingSnapshot> = {}): OrderingSnapshot {
  return {
    orderingId: 'ord-race',
    empresaId: permit.empresaId,
    remoteJid: permit.remoteJid,
    state: 'cart_open',
    revision: 3,
    cart: { items: [{ productId: 1, productName: 'Marmita', baseUnitPrice: 20, selectedModifiers: [], modifierDeltaTotal: 0, quantity: 1, unitPrice: 20, lineTotal: 20 }] },
    customer: { name: 'Cliente' },
    fulfillment: { type: 'pickup', asap: true },
    payment: { pixReceiptRequired: false, pixReceiptApproved: false },
    pricing: { subtotal: 20, deliveryFee: 0, discount: 0, total: 20 },
    revalidation: { checkedAt: new Date(0).toISOString(), ok: true, issues: [] },
    confirmationAction: null,
    requiresReview: false,
    order: null,
    ...overrides,
  };
}

function raceSession(text: string): StoredSession {
  return {
    id: 'race-session',
    customerName: 'Cliente',
    customerPhone: permit.remoteJid.split('@')[0],
    lastMessage: text,
    lastMessageTime: new Date(0).toISOString(),
    unreadCount: 0,
    messages: [{
      id: 'race-message',
      waMessageId: 'race-message',
      role: 'user',
      content: text,
      preview: text,
      timestamp: new Date(0).toISOString(),
      kind: 'text',
    }],
    status: 'active',
    autoReply: true,
  };
}

const raceCatalog = {
  total: 1,
  ambiguous: false,
  results: [{ productId: 1, publicName: 'Marmita', currentPrice: 20, matchReason: 'name', ambiguous: false }],
};

// Race 1 — takeover lands AFTER the planner ran but BEFORE `updateDraft` is
// called. The permit re-check immediately ahead of the mutation (added for
// PR I-16) must catch it — the customer's own draft edit must never reach
// ZeloMenu once a human has the conversation.
{
  let updateDraftCalls = 0;
  let permitCheckCalls = 0;
  let takeoverLanded = false;
  const client: OrderingClient = {
    searchCatalog: async () => raceCatalog,
    updateDraft: async () => { updateDraftCalls += 1; throw new Error('must not mutate after takeover'); },
    confirmDraft: async () => { throw new Error('unused'); },
    cancelDraft: async () => { throw new Error('unused'); },
    getOrdering: async () => { throw new Error('unused'); },
  };
  const draftPlanner = async () => {
    // Simulates the human takeover landing while the model was "thinking".
    takeoverLanded = true;
    return { items: [{ productId: 1, quantity: 1 }] };
  };
  const result = await tryHandleAiWhatsAppOrdering(
    permit.remoteJid, permit.empresaId, raceSession('quero uma marmita'), permit, { menuUrl: null, storeOpen: null },
    { client, draftPlanner, permitCheck: async () => { permitCheckCalls += 1; return !takeoverLanded; } },
  );
  assert.equal(updateDraftCalls, 0, 'takeover after the planner must block the update mutation entirely');
  assert.equal(result.handled, true, 'a suppressed turn is still "handled" (no fallback to the generic model)');
  assert.equal(result.response, undefined, 'a suppressed turn sends nothing to the customer');
  assert.ok(permitCheckCalls >= 1, 'the permit was actually re-checked before the mutation');
}

// Race 2 — the LOCAL permit check passes (no local takeover detected yet)
// but the AUTHORITY itself rejects the mutation as revoked. `AI_TURN_REVOKED`
// must be a clean suppression: no retry, no customer message, no escalation.
{
  let updateDraftCalls = 0;
  const client: OrderingClient = {
    searchCatalog: async () => raceCatalog,
    updateDraft: async () => { updateDraftCalls += 1; throw new ZeloMenuInternalError('AI_TURN_REVOKED', 409, 'req'); },
    confirmDraft: async () => { throw new Error('unused'); },
    cancelDraft: async () => { throw new Error('unused'); },
    getOrdering: async () => { throw new Error('unused'); },
  };
  const draftPlanner = async () => ({ items: [{ productId: 1, quantity: 1 }] });
  const result = await tryHandleAiWhatsAppOrdering(
    permit.remoteJid, permit.empresaId, raceSession('quero uma marmita'), permit, { menuUrl: null, storeOpen: null },
    { client, draftPlanner, permitCheck: async () => true },
  );
  assert.equal(updateDraftCalls, 1, 'the authority is asked once; a revoked epoch is never retried');
  assert.equal(result.handled, true);
  assert.equal(result.response, undefined, 'AI_TURN_REVOKED is a clean suppression: no customer message, no escalation');
}

// Race 3 — on the CONFIRM path: takeover lands between the customer's tap
// and `resolveConfirmation` actually running. `confirmDraft` — this
// conversation's one money-moving call — must never fire.
{
  let confirmCalls = 0;
  let permitCheckCalls = 0;
  const client: OrderingClient = {
    searchCatalog: async () => { throw new Error('unused'); },
    updateDraft: async () => { throw new Error('unused'); },
    confirmDraft: async () => { confirmCalls += 1; throw new Error('must not confirm after takeover'); },
    cancelDraft: async () => { throw new Error('unused'); },
    getOrdering: async () => { throw new Error('unused'); },
  };
  const current = raceSnapshot({
    revision: 3,
    confirmationAction: { type: 'confirm_order', token: 'race-token', revision: 3, expiresAt: new Date(Date.now() + 60_000).toISOString() },
  });
  await assert.rejects(
    () => resolveConfirmation(current, client, permit.empresaId, permit.remoteJid, 'm-race-1', permit, 'race-token', 3, async () => {
      permitCheckCalls += 1;
      return false; // a human already took over between the summary and this confirm
    }),
    (error: unknown) => (error as { constructor: { name: string } })?.constructor?.name === 'OrderingSuppressedError',
    'a takeover right before confirmDraft suppresses cleanly (no order, no customer message)',
  );
  assert.equal(confirmCalls, 0, 'a takeover landing right before confirmDraft must block the mutation entirely');
  assert.ok(permitCheckCalls >= 1, 'the permit was actually re-checked before the confirm mutation');
}

// Race 4 — on the CONFIRM path, the AUTHORITY revokes mid-flight: the
// generic "error.current -> retry updateDraft" recovery must NEVER fire for
// `AI_TURN_REVOKED` (it used to retry with the SAME, now-revoked, epoch).
{
  let confirmCalls = 0;
  let updateDraftCalls = 0;
  const current = raceSnapshot({
    revision: 4,
    confirmationAction: { type: 'confirm_order', token: 'race-token-2', revision: 4, expiresAt: new Date(Date.now() + 60_000).toISOString() },
  });
  const client: OrderingClient = {
    searchCatalog: async () => { throw new Error('unused'); },
    updateDraft: async () => { updateDraftCalls += 1; throw new Error('must not retry a revoked epoch'); },
    confirmDraft: async () => { confirmCalls += 1; throw new ZeloMenuInternalError('AI_TURN_REVOKED', 409, 'req', current); },
    cancelDraft: async () => { throw new Error('unused'); },
    getOrdering: async () => { throw new Error('unused'); },
  };
  await assert.rejects(
    () => resolveConfirmation(current, client, permit.empresaId, permit.remoteJid, 'm-race-2', permit, 'race-token-2', 4, async () => true),
    (error: unknown) => error instanceof ZeloMenuInternalError && error.code === 'AI_TURN_REVOKED',
    'AI_TURN_REVOKED propagates for the caller to suppress cleanly',
  );
  assert.equal(confirmCalls, 1, 'confirmDraft is attempted once');
  assert.equal(updateDraftCalls, 0, 'AI_TURN_REVOKED must never trigger the generic error.current retry with the same (revoked) epoch');
}

console.log('aiTakeoverRace: ok');
