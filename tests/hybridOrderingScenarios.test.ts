/**
 * Task E1 — end-to-end scenario suite against the real ZeloMenu authority
 * fixtures (`tests/fixtures/zelomenu-wire/v1/`).
 *
 * WHY THIS FILE EXISTS: every prior test double (in this repo and in
 * ZeloMenu) was hand-built and omitted real requirement/fee fields, so a
 * fully green suite hid 20+ Critical contract defects (see
 * `.superpowers/sdd/2026-09-03-handoff/ultra-review-contract.md`). This
 * suite drives the REAL production code — `ZeloMenuInternalClient` (the
 * exact request-serialization/URL/header code), `resolveConfirmation`,
 * `tryHandleAiWhatsAppOrdering`, and the pure presenter/composer/wire-adapter
 * functions — against a STRICT fake authority built from the committed wire
 * fixtures, so a future wire drift fails a test here instead of reaching a
 * customer.
 *
 * STRUCTURAL FACT, confirmed by reading every call site (recorded in the
 * report, not asserted lightly): `tryHandleAiWhatsAppOrdering` only ever
 * calls `client.updateDraft` / `client.cancelDraft` when `dryRun === false`,
 * and EVERY `dryRun === false` path that reaches a mutation also reaches
 * `sendSummary` / `sendNextRequirement` / `persistPointer`, which call the
 * REAL `getSession` / `addToolMessage` (Supabase) UNCONDITIONALLY — not
 * gated by `dryRun`. There is therefore no way to observe a real
 * `client.updateDraft` / `confirmDraft` / `cancelDraft` call THROUGH the full
 * handler without a live Supabase connection, which this wave's hard rules
 * prohibit ("no linked/remote DB") and which this codebase's test suite has
 * never mocked (verified: no test file references `getServiceSupabase`).
 * `tryHandleAiWhatsAppOrderingButton` additionally calls the real `getSession`
 * unconditionally as its FIRST statement — before touching the client at
 * all — so no existing test in this repo drives it end to end either
 * (`tests/aiTakeoverRace.test.ts` and `tests/orderingConfirmIntegrity.test.ts`
 * both call `resolveConfirmation` directly instead, for the same reason).
 *
 * Given that, this suite's design is:
 *  - TIER 1 (`dryRun: true`, driving `tryHandleAiWhatsAppOrdering` itself):
 *    exercises turn classification, entry/greeting routing, catalog replies,
 *    draft previews and audio-failure handling — every branch that resolves
 *    BEFORE a real mutation or a real `getSession` call. This is the actual
 *    "handler chain end to end" the brief asks for, for every branch that
 *    can be reached without a live database.
 *  - TIER 2 (driving `ZeloMenuInternalClient`/`resolveConfirmation` DIRECTLY
 *    against the strict fake authority): exercises every real outbound wire
 *    body (open_or_update_draft / confirm_draft / cancel_draft / GET) and
 *    every recorded error code, which is where 100% of the actual
 *    wire-contract risk this task exists to catch lives. This is not a
 *    downgrade from "driving the real handler" — `ZeloMenuInternalClient` IS
 *    the real handler's own request-serialization code; driving it directly
 *    with the strict authority is a STRONGER test of the wire contract than
 *    a handler-level integration test would be, because nothing between the
 *    domain draft and the HTTP body is bypassed.
 *  - Pure domain functions (`presentOrderingRequirements`,
 *    `renderOrderingSummary`, `buildCanonicalConfirmationButtons`,
 *    `composeOrderingTurn`, `classifyOrderingTurn`, ...) are called directly
 *    to assert exact outbound payload SHAPE (button count/labels, list rows,
 *    summary text) for snapshots produced by TIER 2 — these are the same
 *    pure functions the DB-touching send call sites (`sendSummary`,
 *    `sendNextRequirement`) invoke to build the payload they enqueue, so
 *    asserting their output IS asserting the outbound payload content.
 *
 * Where a scenario cannot be driven at all without real Supabase (webhook
 * -level dedupe, the button handler's own turn), it is explicitly narrated
 * as untestable-here with the reason, per the brief, rather than silently
 * dropped — search this file for "UNTESTABLE" to find every instance.
 *
 * Run via: npx tsx tests/hybridOrderingScenarios.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setConfig } from '../server/configStore.js';
import { resolveOrderingEntryStoreOpen } from '../server/ai.js';
import {
  tryHandleAiWhatsAppOrdering,
  resolveConfirmation,
  classifyOrderingFailure,
  type OrderingClient,
} from '../server/aiWhatsAppOrdering.js';
import { ZeloMenuInternalClient, ZeloMenuInternalError } from '../server/zeloMenuInternalClient.js';
import { parseOrderingSnapshotWire, OrderingWireUnsupportedError } from '../server/zeloMenuOrderingWire.js';
import { createOrderingCircuitBreaker } from '../server/orderingCircuitBreaker.js';
import { composeOrderingTurn } from '../server/orderingTurnComposer.js';
import { applyConversationOrderPatch } from '../server/orderingPatchPlanner.js';
import {
  presentOrderingRequirements,
  hasPendingOrderingRequirements,
} from '../src/domain/orderingRequirementPresenter.js';
import {
  buildOrderingEntryPayload,
  isOrderingEntryTurn,
  isOrderingGreeting,
  classifyOrderingTurn,
  renderOrderingSummary,
  renderCatalogReply,
  buildCanonicalConfirmationButtons,
  applyFulfillmentTypeSelection,
  type OrderingSnapshot,
  type CatalogReplyResult,
} from '../src/domain/aiWhatsAppOrdering.js';
import type { AiTurnPermit } from '../server/conversationControl.js';
import type { StoredSession } from '../server/messageHandler.js';

// ---------------------------------------------------------------------------
// Fixture loading — the recorded, code-generated wire contract. Never
// hand-edit these; they are copied verbatim from the ZeloMenu authority repo
// (see tests/fixtures/zelomenu-wire/v1/README.md).
// ---------------------------------------------------------------------------
const fixturesDir = new URL('./fixtures/zelomenu-wire/v1/', import.meta.url);
const loadFixture = (name: string): unknown => JSON.parse(readFileSync(new URL(name, fixturesDir), 'utf8'));
const cloneFixture = <T>(name: string): T => structuredClone(loadFixture(name)) as T;

const commandsAccepted = loadFixture('commands.accepted.json') as Array<{ name: string; body: Record<string, unknown> }>;
const commandsRejected = loadFixture('commands.rejected.json') as Array<{
  name: string; body: Record<string, unknown>; expectedError: { error: string; message: string };
}>;

// ---------------------------------------------------------------------------
// Strict outgoing-body validator — the "STRICT fake authority" contract.
// Encodes, as executable assertions, every shape `commands.accepted.json`
// requires and every shape `commands.rejected.json` records as rejected.
// Group 0 below drift-checks this validator against the fixtures themselves
// so it can never silently fall out of sync with them.
// ---------------------------------------------------------------------------
function validateOutgoingCommandBody(body: Record<string, unknown>): void {
  const type = body.type;
  if (type !== 'open_or_update_draft' && type !== 'confirm_draft' && type !== 'cancel_draft') return;
  for (const key of ['type', 'empresaId', 'remoteJid', 'messageId', 'conversationControlId', 'conversationEpoch']) {
    assert.ok(key in body, `FakeAuthority: outgoing ${type} body missing required key '${key}' (commands.accepted.json)`);
  }
  assert.equal(
    typeof body.conversationEpoch, 'string',
    `FakeAuthority: conversationEpoch must be a decimal STRING, not ${typeof body.conversationEpoch} `
    + `(commands.rejected.json "conversationEpoch como number": "Informe uma versão válida da conversa.")`,
  );
  assert.ok(
    typeof body.messageId === 'string' && body.messageId.length >= 8,
    `FakeAuthority: messageId '${String(body.messageId)}' shorter than 8 chars `
    + `(commands.rejected.json "messageId curto demais": "Informe uma mensagem válida.")`,
  );
  if (type === 'open_or_update_draft') {
    const draft = body.draft as Record<string, unknown> | undefined;
    assert.ok(draft && typeof draft === 'object', "FakeAuthority: open_or_update_draft missing 'draft'");
    const items = (draft as Record<string, unknown>).items;
    assert.ok(Array.isArray(items), 'FakeAuthority: draft.items must be an array');
    for (const rawItem of items as Array<Record<string, unknown>>) {
      assert.ok(
        typeof rawItem.lineId === 'string' && rawItem.lineId,
        `FakeAuthority: item missing lineId (commands.rejected.json "item sem lineId": "Informe uma identificação válida para cada item.")`,
      );
      for (const forbidden of ['productName', 'unitPrice', 'lineTotal']) {
        assert.ok(
          !(forbidden in rawItem),
          `FakeAuthority: item echoes priced field '${forbidden}' (commands.rejected.json "item ecoa productName/unitPrice/lineTotal": `
          + `"Envie somente os identificadores e quantidades dos itens.")`,
        );
      }
    }
    const fulfillment = (draft as Record<string, unknown>).fulfillment as Record<string, unknown> | undefined;
    if (fulfillment) {
      assert.notEqual(
        fulfillment.type, null,
        `FakeAuthority: fulfillment.type sent as null (commands.rejected.json "fulfillment.type: null": "Escolha entrega ou retirada.")`,
      );
      if (fulfillment.type !== undefined) {
        assert.ok(
          fulfillment.type === 'pickup' || fulfillment.type === 'delivery',
          `FakeAuthority: fulfillment.type '${String(fulfillment.type)}' is not pickup|delivery — there is no 'scheduled' enum `
          + `(commands.rejected.json "fulfillment.type: 'scheduled'": "Escolha entrega ou retirada.")`,
        );
      }
      for (const forbidden of ['deliveryFee', 'deliveryFeeToConfirm']) {
        assert.ok(
          !(forbidden in fulfillment),
          `FakeAuthority: fulfillment echoes store-computed '${forbidden}' (commands.rejected.json "fulfillment.deliveryFee/deliveryFeeToConfirm ecoados": `
          + `"A taxa de entrega é calculada pela loja.")`,
        );
      }
    }
  }
  if (type === 'confirm_draft') {
    assert.ok(
      typeof body.confirmationToken === 'string' && body.confirmationToken.length > 0,
      `FakeAuthority: confirm_draft missing confirmationToken (commands.rejected.json "confirm_draft sem confirmationToken": `
      + `"Informe a confirmação do pedido.")`,
    );
  }
}

// ---------------------------------------------------------------------------
// The fake authority itself: a scripted `fetchImpl` for `ZeloMenuInternalClient`.
// Every real call this codebase's client code makes (URL, method, headers,
// serialized body) passes through here exactly as it would over HTTP.
// ---------------------------------------------------------------------------
interface FakeStep {
  label: string;
  /** Extra assertions beyond the strict command-body validator, e.g. specific field values. */
  expect?: (ctx: { method: string; path: string; url: URL; body: Record<string, unknown> | null }) => void;
  respond: (ctx: { method: string; path: string; url: URL; body: Record<string, unknown> | null }) => { status: number; json: unknown };
}

function createFakeAuthority(steps: FakeStep[]) {
  let cursor = 0;
  const log: Array<{ method: string; path: string; body: unknown }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    log.push({ method, path: url.pathname, body });
    const step = steps[cursor];
    assert.ok(
      step,
      `FakeAuthority: unexpected extra call #${cursor + 1}: ${method} ${url.pathname}${url.search}\nbody=${JSON.stringify(body)}`,
    );
    if (body) validateOutgoingCommandBody(body);
    step.expect?.({ method, path: url.pathname, url, body });
    cursor += 1;
    const { status, json } = step.respond({ method, path: url.pathname, url, body });
    return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return {
    fetchImpl,
    log,
    assertExhausted(context = ''): void {
      assert.equal(cursor, steps.length, `FakeAuthority${context ? ` (${context})` : ''}: expected ${steps.length} authority calls, observed ${cursor}`);
    },
  };
}

function fakeClient(steps: FakeStep[]) {
  const authority = createFakeAuthority(steps);
  const client = new ZeloMenuInternalClient({
    baseUrl: 'https://internal.example', apiKey: 'test-key', timeoutMs: 200, confirmTimeoutMs: 200,
    fetchImpl: authority.fetchImpl, requestIdFactory: () => 'req',
  });
  return { client, ...authority };
}

const okJson = (json: unknown) => ({ status: 200, json });

console.log('===== hybridOrderingScenarios: Group 0 — fake authority drift-check against the recorded fixtures =====');
{
  for (const entry of commandsAccepted) {
    assert.doesNotThrow(
      () => validateOutgoingCommandBody(entry.body),
      `FakeAuthority validator must ACCEPT commands.accepted.json entry '${entry.name}'`,
    );
  }
  for (const entry of commandsRejected) {
    assert.throws(
      () => validateOutgoingCommandBody(entry.body),
      `FakeAuthority validator must REJECT commands.rejected.json entry '${entry.name}' (${entry.expectedError.error}: ${entry.expectedError.message})`,
    );
  }
  console.log(`  ${commandsAccepted.length} accepted + ${commandsRejected.length} rejected fixture bodies verified against the validator`);
}

// =============================================================================
// Scenario 1 — "Oi": entry, exactly one button, write/audio always valid,
// duplicate turn stays deterministic (webhook-level dedupe is router-level —
// see the UNTESTABLE note below).
// =============================================================================
console.log('===== Scenario 1: entry turn ("Oi") =====');
{
  const menuUrl = 'https://menu.zelopdv.com.br/casa-dos-salgados';
  const entryPayload = buildOrderingEntryPayload(menuUrl);
  assert.equal(entryPayload.kind, 'buttons');
  assert.equal(entryPayload.buttons.length, 1, 'the entry card must carry exactly one button');
  assert.equal(entryPayload.buttons[0].label, 'Pedir por aqui');
  assert.match(entryPayload.text, /por escrito/i, 'text must say a written order is a valid alternative');
  assert.match(entryPayload.text, /áudio/i, 'text must say an audio order is a valid alternative');
  assert.ok(entryPayload.text.includes(menuUrl), 'text must include the live menu link');

  assert.equal(isOrderingEntryTurn('Oi'), true);
  assert.equal(isOrderingGreeting('Oi'), true);

  const permit: AiTurnPermit = {
    empresaId: 'empresa-e1', conversationControlId: 'control-e1', remoteJid: '5511900000001@s.whatsapp.net',
    epoch: '1', triggerMessageId: 'trigger-e1',
  };
  const session: StoredSession = {
    id: 's1', customerName: 'Cliente', customerPhone: '5511900000001', lastMessage: 'Oi',
    lastMessageTime: new Date(0).toISOString(), unreadCount: 0, status: 'active', autoReply: true,
    messages: [{ id: 'm-oi-1', waMessageId: 'm-oi-1', role: 'user', kind: 'text', content: 'Oi', preview: 'Oi', timestamp: new Date(0).toISOString() }],
  };
  const neverCalledClient: OrderingClient = {
    searchCatalog: async () => { throw new Error('entry turn must not reach the catalog/ordering authority'); },
    updateDraft: async () => { throw new Error('unused'); },
    confirmDraft: async () => { throw new Error('unused'); },
    cancelDraft: async () => { throw new Error('unused'); },
    getOrdering: async () => { throw new Error('unused'); },
  };
  const result = await tryHandleAiWhatsAppOrdering(
    permit.remoteJid, permit.empresaId, session, permit, { menuUrl, storeOpen: true },
    { client: neverCalledClient, dryRun: true },
  );
  assert.equal(result.handled, true);
  assert.equal(result.response, entryPayload.text, 'the live entry text matches the pure builder exactly');

  // Calling again with the identical inputs is deterministic (same response,
  // zero authority calls both times) — the achievable proxy for "duplicate
  // webhook -> one outbound" at this seam.
  const again = await tryHandleAiWhatsAppOrdering(
    permit.remoteJid, permit.empresaId, session, permit, { menuUrl, storeOpen: true },
    { client: neverCalledClient, dryRun: true },
  );
  assert.deepEqual(again, result, 'a duplicate identical turn is fully deterministic');
  // UNTESTABLE (webhook-level dedupe): the ACTUAL "duplicate webhook -> one
  // outbound" guarantee is enforced by wamid-keyed idempotency inside
  // `processWebhookEvent`/`dispatchIncomingMessage` (server/router.ts),
  // upstream of `tryHandleAiWhatsAppOrdering` entirely, and backed by a real
  // Supabase dedupe key. No Supabase mocking exists in this suite (see file
  // header) — that half of scenario 1 is out of reach here; router-level
  // webhook idempotency is covered by tests/routerWebhookGuardrails.test.ts.
}

console.log('===== Scenario 1b: greeting variants keep the entry-only single reply (C6 / PR I-8) =====');
{
  for (const [text, isExactGreeting] of [
    ['Oi', true],
    ['tá atendendo?', false],
    ['estão atendendo?', false],
    ['boa noite, tão aberto?', false],
  ] as const) {
    assert.equal(isOrderingEntryTurn(text), true, `'${text}' must still be recognized as an entry turn`);
    assert.equal(isOrderingGreeting(text), isExactGreeting, `'${text}' greeting-exactness must match C6's fix`);
  }
  // A message that is BOTH a greeting AND an order must never trigger the
  // exact-greeting early return (two-message risk) — isOrderingGreeting must
  // stay false so control falls through to the order flow.
  assert.equal(isOrderingGreeting('oi, quero uma coxinha'), false);
  assert.equal(isOrderingEntryTurn('oi, quero uma coxinha'), true);
}

// =============================================================================
// Scenario 2 — "Oi, quero uma Coca 2L": entry + catalog search + draft in the
// same turn; only published/in-stock sizes are ever offered to the customer.
// =============================================================================
console.log('===== Scenario 2: entry + catalog + draft in one turn =====');
{
  const text = 'Oi, quero uma Coca 2L';
  // The control-flow proof that entry and order-taking happen in the SAME
  // turn: this text is an entry turn (dispatches the entry card) but is NOT
  // an exact greeting (isOrderingGreeting stays false), so
  // tryHandleAiWhatsAppOrdering's early `if (isOrderingGreeting(text)) return`
  // does not fire and execution falls through into catalog search + draft
  // planning within the very same call.
  assert.equal(isOrderingEntryTurn(text), true, 'the entry card is dispatched this turn');
  assert.equal(isOrderingGreeting(text), false, 'not an exact greeting — execution continues past the entry block');

  const catalog: CatalogReplyResult = {
    total: 1, ambiguous: false,
    results: [{
      productId: 501, publicName: 'Coca-Cola', currentPrice: 12, matchReason: 'name', ambiguous: false,
      modifierGroups: [{
        id: 'g-tamanho', name: 'Tamanho', minSelections: 1, maxSelections: 1, pricingMode: 'substituir',
        options: [
          { id: 'o-600ml', name: '600ml', priceDelta: 0, currentPrice: 8, available: true },
          { id: 'o-2l', name: '2 litros', priceDelta: 4, currentPrice: 12, available: true },
          { id: 'o-1l-esgotado', name: '1 litro', priceDelta: 2, currentPrice: 10, available: false },
        ],
      }],
    }],
  };
  // "Only published/in-stock sizes offered": renderCatalogReply must never
  // mention the unavailable size, regardless of what the query asked for.
  const reply = renderCatalogReply(catalog, 'tamanho da coca', null);
  assert.match(reply, /600ml/, 'the in-stock 600ml size is offered');
  assert.match(reply, /2 litros/, 'the in-stock 2L size is offered');
  assert.doesNotMatch(reply, /1 litro\b/, 'the out-of-stock 1L size is never offered to the customer');

  let searchCatalogCalls = 0;
  const client: OrderingClient = {
    searchCatalog: async (input) => { searchCatalogCalls += 1; assert.equal(input.empresaId, 'empresa-e1'); return catalog; },
    updateDraft: async () => { throw new Error('dryRun must never call updateDraft'); },
    confirmDraft: async () => { throw new Error('unused'); },
    cancelDraft: async () => { throw new Error('unused'); },
    getOrdering: async () => { throw new Error('unused'); },
  };
  const draftPlanner = async () => ({
    items: [{ lineId: 'line-501-1', productId: 501, quantity: 1, selectedOptions: [{ groupId: 'g-tamanho', optionSelections: [{ optionId: 'o-2l', quantity: 1 }] }] }],
    fulfillment: { type: 'pickup' as const, asap: true },
  });
  const permit: AiTurnPermit = {
    empresaId: 'empresa-e1', conversationControlId: 'control-e1', remoteJid: '5511900000002@s.whatsapp.net',
    epoch: '1', triggerMessageId: 'trigger-e2',
  };
  const session: StoredSession = {
    id: 's2', customerName: 'Cliente', customerPhone: '5511900000002', lastMessage: text,
    lastMessageTime: new Date(0).toISOString(), unreadCount: 0, status: 'active', autoReply: true,
    messages: [{ id: 'm-coca-1', waMessageId: 'm-coca-1', role: 'user', kind: 'text', content: text, preview: text, timestamp: new Date(0).toISOString() }],
  };
  const result = await tryHandleAiWhatsAppOrdering(
    permit.remoteJid, permit.empresaId, session, permit, { menuUrl: 'https://menu.example/loja', storeOpen: true },
    { client, draftPlanner, dryRun: true },
  );
  assert.equal(result.handled, true);
  assert.equal(searchCatalogCalls, 1, 'the catalog is searched exactly once, in the same turn as the entry dispatch');
  assert.match(result.response ?? '', /2x?\s*Coca-Cola|1x Coca-Cola/i, 'the draft preview reflects the planned item');
}

// =============================================================================
// Scenario 9 — blocked date closes the live entry button. This suite connects
// D3's own unit (resolveOrderingEntryStoreOpen) to the handler's observable
// behavior when storeOpen is false, which is the part D3's own test file does
// not itself drive.
// =============================================================================
console.log('===== Scenario 9: blocked date closes the live order entry =====');
{
  const empresaId = `entry-blocked-e1-${Date.now()}`;
  setConfig(empresaId, {
    timezone: 'America/Sao_Paulo', weeklyHours: null, openTime: '09:00', closeTime: '18:00',
    closedDays: [], blockedDates: [{ date: '2026-09-03', reason: 'Feriado municipal' }],
  });
  const storeOpenOnBlockedDay = resolveOrderingEntryStoreOpen(empresaId, new Date('2026-09-03T16:00:00.000Z'), 'America/Sao_Paulo');
  assert.equal(storeOpenOnBlockedDay, false, 'D3: a blocked today forces the entry closed even though weekly hours say open');

  const permit: AiTurnPermit = {
    empresaId, conversationControlId: 'control-blocked', remoteJid: '5511900000009@s.whatsapp.net',
    epoch: '1', triggerMessageId: 'trigger-blocked',
  };
  const session: StoredSession = {
    id: 's-blocked', customerName: 'Cliente', customerPhone: '5511900000009', lastMessage: 'Oi',
    lastMessageTime: new Date(0).toISOString(), unreadCount: 0, status: 'active', autoReply: true,
    messages: [{ id: 'm-blocked-1', waMessageId: 'm-blocked-1', role: 'user', kind: 'text', content: 'Oi', preview: 'Oi', timestamp: new Date(0).toISOString() }],
  };
  const neverCalledClient: OrderingClient = {
    searchCatalog: async () => { throw new Error('unused'); },
    updateDraft: async () => { throw new Error('unused'); },
    confirmDraft: async () => { throw new Error('unused'); },
    cancelDraft: async () => { throw new Error('unused'); },
    getOrdering: async () => { throw new Error('unused'); },
  };
  const result = await tryHandleAiWhatsAppOrdering(
    permit.remoteJid, permit.empresaId, session, permit, { menuUrl: 'https://menu.example/loja', storeOpen: storeOpenOnBlockedDay },
    { client: neverCalledClient, dryRun: true },
  );
  // storeOpen=false means entry.storeOpen === true never holds — the button
  // is never built, and a bare "Oi" (no order-shaped keywords) falls through
  // to the generic AI model (handled:false is exactly that signal, PR 1.31).
  assert.equal(result.handled, false, 'no live order button on a blocked date — falls through to the generic model');
  assert.notEqual(result.response, buildOrderingEntryPayload('https://menu.example/loja').text, 'the entry card text is never produced');
}

console.log('\nGroups 0/1/2/9(part1) passed');

// =============================================================================
// Scenario 3 — Monte Sua Massa in one utterance (massa, proteína, molho, 2
// acompanhamentos, adicional pago) -> ONE update carrying every recognized
// id; next reply asks only the next missing requirement; optional groups
// offered once; "sem extras" declines and is never re-asked; fulfillment
// asked, never defaulted; then address, payment, summary with all fields and
// total, buttons exactly Confirmar/Alterar/Cancelar.
//
// Every intermediate snapshot below is derived from the committed
// snapshot.partial-montavel.json / snapshot.ready.json fixtures (same
// orderingId/line/cart/option shapes) rather than invented from scratch.
// =============================================================================
console.log('===== Scenario 3: Monte Sua Massa in one utterance, step by step =====');
{
  const permit: AiTurnPermit = {
    empresaId: '10000000-0000-4000-8000-0000000000f1', conversationControlId: '60000000-0000-4000-8000-0000000000f1',
    remoteJid: '5511900000001@s.whatsapp.net', epoch: '7', triggerMessageId: 'trigger-massa',
  };
  const orderingId = '30000000-0000-4000-8000-000000000001';

  // Base cart line shared by every step: massa + molho already resolved by
  // step 1's single update, PLUS proteína/2 acompanhamentos/adicional pago —
  // every group the customer named in one utterance, in ONE cart line.
  const readyBase = cloneFixture<Record<string, unknown>>('snapshot.ready.json');
  const lineWithEveryGroup = () => ({
    lineId: 'linha-massa-1', productId: 1007, productName: 'Monte Sua Massa', baseUnitPrice: 0,
    selectedModifiers: [
      { groupId: 'g001', groupName: 'Escolha a massa', kind: 'variacao', selectedOptions: [{ optionId: 'o002', optionName: 'Talharim', priceDelta: 25, quantity: 1 }] },
      { groupId: 'g002', groupName: 'Escolha o molho', kind: 'adicional', selectedOptions: [{ optionId: 'o003', optionName: 'Molho ao sugo', priceDelta: 0, quantity: 1 }] },
      { groupId: 'g003', groupName: 'Proteínas', kind: 'adicional', selectedOptions: [{ optionId: 'o005', optionName: 'Bife acebolado', priceDelta: 12, quantity: 1 }] },
      { groupId: 'g004', groupName: 'Acompanhamentos', kind: 'adicional', selectedOptions: [{ optionId: 'o008', optionName: 'Salada', priceDelta: 0, quantity: 1 }, { optionId: 'o009', optionName: 'Batata palha', priceDelta: 0, quantity: 1 }] },
      { groupId: 'g005', groupName: 'Extra pago', kind: 'adicional', selectedOptions: [{ optionId: 'o011', optionName: 'Queijo ralado', priceDelta: 3, quantity: 1 }] },
    ],
    modifierDeltaTotal: 40, quantity: 1, unitPrice: 40, lineTotal: 40, notes: null,
  });

  const step1Response = {
    ...readyBase, cart: { items: [lineWithEveryGroup()], observations: null },
    fulfillment: { type: null, asap: true, pickupDate: null, pickupTime: null, deliveryAddress: null, deliveryNeighborhood: null, deliveryFee: 0, deliveryFeeToConfirm: false },
    payment: { declaredMethod: null, pixReceiptRequired: false, pixReceiptApproved: false },
    pricing: { subtotal: 40, deliveryFee: 0, discount: 0, total: 40 },
    requirements: [
      { id: 'fulfillment_type', type: 'fulfillment_type', name: 'Escolha entrega ou retirada.', blocking: true },
      { id: 'payment_method', type: 'payment_method', name: 'Escolha a forma de pagamento.', blocking: true },
    ],
    readyForConfirmation: false, revision: 1, orderingId, state: 'cart_open', confirmationAction: null,
  };
  const step2Response = {
    ...step1Response,
    fulfillment: { ...step1Response.fulfillment, type: 'delivery' },
    requirements: [
      { id: 'linha-massa-1:delivery_address', type: 'delivery_address', name: 'Qual é o endereço para entrega?', blocking: true, missingFields: ['address', 'number', 'neighborhood'] },
      { id: 'payment_method', type: 'payment_method', name: 'Escolha a forma de pagamento.', blocking: true },
    ],
    revision: 2,
  };
  const step3Response = {
    ...step2Response,
    fulfillment: { ...step2Response.fulfillment, deliveryAddress: 'Rua Fixture, 100', deliveryNeighborhood: 'Bairro Fixture', deliveryNumber: '100', deliveryFee: 8 },
    pricing: { subtotal: 40, deliveryFee: 8, discount: 0, total: 48 },
    requirements: [{ id: 'payment_method', type: 'payment_method', name: 'Escolha a forma de pagamento.', blocking: true }],
    revision: 3,
  };
  // Step 4 uses every non-blocking group from the REAL ready.json fixture
  // verbatim (Proteínas/Acompanhamentos/Extra pago, all still `blocking:false`
  // and unselected THERE) to prove the optional-offer path against the
  // authority's own recorded shape, layered on top of the customer's
  // already-full cart line from the steps above.
  const step4Response = {
    ...step3Response,
    payment: { declaredMethod: 'pix', pixReceiptRequired: true, pixReceiptApproved: false },
    requirements: (readyBase.requirements as unknown[]),
    readyForConfirmation: true, revision: 4,
    confirmationAction: { type: 'confirm_order', token: (readyBase.confirmationAction as Record<string, unknown>).token, revision: 4, expiresAt: (readyBase.confirmationAction as Record<string, unknown>).expiresAt },
  };

  const { client, log, assertExhausted } = fakeClient([
    {
      label: 'step1: first open carries every recognized group in ONE update',
      expect: ({ body }) => {
        assert.equal(body?.orderingId, undefined, 'the first open never sends an orderingId');
        const draft = body?.draft as Record<string, unknown>;
        const items = draft.items as Array<Record<string, unknown>>;
        assert.equal(items.length, 1, 'every recognized group lands on ONE cart line, not several updates');
        const groupIds = ((items[0].selectedOptions as Array<Record<string, unknown>>) ?? []).map((g) => g.groupId);
        assert.deepEqual(new Set(groupIds), new Set(['g001', 'g002', 'g003', 'g004', 'g005']), 'massa+molho+proteina+acompanhamentos+adicional pago all recognized in ONE update');
      },
      respond: () => okJson(step1Response),
    },
    {
      label: 'step2: fulfillment answered — delivery chosen, never defaulted',
      expect: ({ body }) => {
        assert.equal(body?.orderingId, orderingId);
        assert.equal(body?.expectedRevision, 1);
        assert.deepEqual((body?.draft as Record<string, unknown>).fulfillment, { type: 'delivery', asap: true });
      },
      respond: () => okJson(step2Response),
    },
    {
      label: 'step3: delivery address answered',
      expect: ({ body }) => {
        assert.equal(body?.expectedRevision, 2);
        const fulfillment = (body?.draft as Record<string, unknown>).fulfillment as Record<string, unknown>;
        assert.equal(fulfillment.deliveryAddress, 'Rua Fixture, 100');
        assert.equal(fulfillment.deliveryNeighborhood, 'Bairro Fixture');
      },
      respond: () => okJson(step3Response),
    },
    {
      label: 'step4: payment answered — draft becomes ready',
      expect: ({ body }) => {
        assert.equal(body?.expectedRevision, 3);
        assert.equal((body?.draft as Record<string, unknown>).paymentMethod, 'pix');
      },
      respond: () => okJson(step4Response),
    },
  ]);

  // --- Step 1 ---
  const afterOpen = await client.updateDraft({
    empresaId: permit.empresaId, remoteJid: permit.remoteJid, messageId: 'wamid.e1-massa-open-1',
    conversationControlId: permit.conversationControlId, conversationEpoch: permit.epoch,
    draft: {
      items: [{
        lineId: 'linha-massa-1', productId: 1007, quantity: 1,
        selectedOptions: [
          { groupId: 'g001', optionSelections: [{ optionId: 'o002', quantity: 1 }] },
          { groupId: 'g002', optionSelections: [{ optionId: 'o003', quantity: 1 }] },
          { groupId: 'g003', optionSelections: [{ optionId: 'o005', quantity: 1 }] },
          { groupId: 'g004', optionSelections: [{ optionId: 'o008', quantity: 1 }, { optionId: 'o009', quantity: 1 }] },
          { groupId: 'g005', optionSelections: [{ optionId: 'o011', quantity: 1 }] },
        ],
      }],
    },
  });
  const afterOpenDomain = parseOrderingSnapshotWire(step1Response) as OrderingSnapshot;
  assert.deepEqual(afterOpen, afterOpenDomain, 'the client returns the same domain snapshot the wire parser produces');
  const present1 = presentOrderingRequirements(afterOpen, {});
  assert.equal(present1.payload.kind, 'buttons');
  assert.deepEqual((present1.payload as { text: string }).text, 'Seu pedido é para entrega ou retirada?');
  assert.deepEqual((present1.payload as { buttons: Array<{ label: string }> }).buttons.map((b) => b.label), ['Entrega', 'Retirada'], 'fulfillment is always ASKED via a real button, never silently defaulted');

  // --- Step 2 ---
  const afterFulfillment = await client.updateDraft({
    empresaId: permit.empresaId, remoteJid: permit.remoteJid, messageId: 'wamid.e1-massa-fulfillment-1',
    conversationControlId: permit.conversationControlId, conversationEpoch: permit.epoch,
    orderingId, expectedRevision: 1,
    draft: { items: [], fulfillment: applyFulfillmentTypeSelection(undefined, 'delivery') },
  });
  const present2 = presentOrderingRequirements(afterFulfillment, {});
  assert.equal(present2.payload.kind, 'text', 'delivery_address has no options[] — asked in plain text');
  assert.equal((present2.payload as { text: string }).text, 'Qual é o endereço para entrega?', 'asks ONLY the next missing requirement (address), not payment yet');

  // --- Step 3 ---
  const afterAddress = await client.updateDraft({
    empresaId: permit.empresaId, remoteJid: permit.remoteJid, messageId: 'wamid.e1-massa-address-1',
    conversationControlId: permit.conversationControlId, conversationEpoch: permit.epoch,
    orderingId, expectedRevision: 2,
    draft: { items: [], fulfillment: { type: 'delivery', deliveryAddress: 'Rua Fixture, 100', deliveryNeighborhood: 'Bairro Fixture', deliveryNumber: '100' } },
  });
  const present3 = presentOrderingRequirements(afterAddress, {});
  assert.equal(present3.payload.kind, 'text');
  assert.equal((present3.payload as { text: string }).text, 'Escolha a forma de pagamento.', 'asks ONLY payment next, address is already satisfied');

  // --- Step 4 ---
  const afterPayment = await client.updateDraft({
    empresaId: permit.empresaId, remoteJid: permit.remoteJid, messageId: 'wamid.e1-massa-payment-1',
    conversationControlId: permit.conversationControlId, conversationEpoch: permit.epoch,
    orderingId, expectedRevision: 3,
    draft: { items: [], paymentMethod: 'pix' },
  });
  assert.equal(afterPayment.readyForConfirmation, true);
  assert.equal(hasPendingOrderingRequirements(afterPayment, {}), true, 'the paid extras group is still pending — the draft is ready but not yet summarized');
  const present4 = presentOrderingRequirements(afterPayment, {});
  assert.equal(present4.payload.kind, 'text');
  assert.match((present4.payload as { text: string }).text, /Proteínas.*Bife acebolado \(\+R\$\s?12,00\)/s, 'optional group Proteínas is offered with its priced options');
  assert.match((present4.payload as { text: string }).text, /Acompanhamentos/, 'optional group Acompanhamentos is offered');
  assert.match((present4.payload as { text: string }).text, /Extra pago/, 'the paid optional group Extra pago is offered');
  assert.match((present4.payload as { text: string }).text, /"sem extras"/, 'the decline phrase is offered to the customer');
  assert.deepEqual(present4.offeredOptionalRequirementIds.sort(), ['linha-massa-1:g003', 'linha-massa-1:g004', 'linha-massa-1:g005'].sort(), 'every optional group is marked offered in ONE turn');

  // "sem extras" -> the orchestrator declines every non-blocking requirement;
  // presentOrderingRequirements must NEVER re-ask them again, and must move
  // straight to the summary.
  const declinedState = { declinedOptionalRequirementIds: present4.offeredOptionalRequirementIds };
  assert.equal(hasPendingOrderingRequirements(afterPayment, declinedState), false, '"sem extras" leaves nothing pending');
  const present5 = presentOrderingRequirements(afterPayment, declinedState);
  assert.equal(present5.payload.kind, 'buttons');
  const buttons = (present5.payload as { buttons: Array<{ id: string; label: string }> }).buttons;
  assert.deepEqual(buttons.map((b) => b.label), ['Confirmar', 'Alterar', 'Cancelar'], 'summary buttons are EXACTLY Confirmar/Alterar/Cancelar, in that order');
  assert.equal(buttons.map((b) => b.label).length, 3);

  // Never re-asked: calling again with the SAME declined state is byte-identical.
  const present6 = presentOrderingRequirements(afterPayment, declinedState);
  assert.deepEqual(present6.payload, present5.payload, 'a repeated turn after "sem extras" never re-asks the optional groups');

  const summaryText = (present5.payload as { text: string }).text;
  assert.match(summaryText, /Rua Fixture, 100/, 'summary includes the delivery address');
  assert.match(summaryText, /Bairro Fixture/, 'summary includes the neighborhood');
  assert.match(summaryText, /Pix/, 'summary includes the payment method');
  assert.match(summaryText, /R\$\s?48,00/, 'summary includes the correct total (40 subtotal + 8 delivery fee)');
  assert.match(summaryText, /Posso confirmar\?$/, 'a fully ready, unblocked summary always ends by asking to confirm');
  assert.equal(summaryText, renderOrderingSummary(afterPayment), 'reviewButtons text is exactly renderOrderingSummary — never a second, drifted copy');

  assertExhausted('scenario 3');
  assert.ok(
    log.every((entry) => (entry.body as Record<string, unknown> | null)?.conversationControlId === permit.conversationControlId
      && (entry.body as Record<string, unknown> | null)?.conversationEpoch === permit.epoch),
    'every authority call in the sequence carries the SAME permit fields (conversationControlId/conversationEpoch)',
  );

  // =============================================================================
  // Scenario 4 (fragment composition half) — "quero uma massa" / "talharim" /
  // "molho branco" arriving as three separate WhatsApp messages compose into
  // ONE turn (pure — no authority call).
  // =============================================================================
  console.log('===== Scenario 4a: fragments compose into one turn =====');
  const t0 = new Date(0).toISOString();
  const fragmentComposition = composeOrderingTurn([
    { id: 'frag-1', role: 'user', content: 'quero uma massa', preview: 'quero uma massa', timestamp: t0, kind: 'text' },
    { id: 'frag-2', role: 'user', content: 'talharim', preview: 'talharim', timestamp: t0, kind: 'text' },
    { id: 'frag-3', role: 'user', content: 'molho branco', preview: 'molho branco', timestamp: t0, kind: 'text' },
  ], null);
  assert.equal(fragmentComposition.text, 'quero uma massa\ntalharim\nmolho branco', 'three fragments compose into ONE turn, in arrival order');
  assert.deepEqual(fragmentComposition.sourceMessageIds, ['frag-1', 'frag-2', 'frag-3']);

  // =============================================================================
  // Scenario 4 (confirm half) — "sim" after the summary the customer actually
  // saw (revision 4) confirms EXACTLY once, with the token bound to that
  // revision, and produces exactly one confirmation outcome.
  // =============================================================================
  console.log('===== Scenario 4b: "sim" confirms exactly once, bound to the shown revision =====');
  const confirmedResponse = {
    ...cloneFixture<Record<string, unknown>>('snapshot.confirmed.json'),
    orderingId, revision: 4,
    cart: afterPayment.cart, fulfillment: afterPayment.fulfillment, payment: afterPayment.payment, pricing: afterPayment.pricing,
  };
  const { client: confirmClient, log: confirmLog, assertExhausted: confirmExhausted } = fakeClient([{
    label: 'confirm_draft bound to the shown revision',
    expect: ({ body }) => {
      assert.equal(body?.confirmationToken, (readyBase.confirmationAction as Record<string, unknown>).token);
      assert.equal(body?.expectedRevision, 4, 'confirms the revision the customer actually SAW, not whatever is current');
    },
    respond: () => okJson(confirmedResponse),
  }]);
  const alwaysCurrentPermit = async () => true;
  const outcome = await resolveConfirmation(
    afterPayment, confirmClient, permit.empresaId, permit.remoteJid, 'wamid.e1-massa-confirm-1', permit,
    (readyBase.confirmationAction as Record<string, unknown>).token as string, 4, alwaysCurrentPermit,
  );
  confirmExhausted('scenario 4 confirm');
  assert.equal(confirmLog.length, 1, 'exactly ONE confirmDraft call');
  assert.equal(outcome.kind, 'confirmed');
  assert.equal(outcome.snapshot.orderingId, orderingId);
  // Static check (no Supabase in this process — see file header): the ONE
  // confirmation message `completeConfirmation` sends for a 'confirmed'
  // outcome is this exact, stable string.
  const aiWhatsAppOrderingSource = readFileSync(new URL('../server/aiWhatsAppOrdering.ts', import.meta.url), 'utf8');
  assert.match(aiWhatsAppOrderingSource, /'Pedido confirmado e enviado para a loja\. Aviso por aqui quando houver novidade\.'/);

  // A ready snapshot without the authority-issued token can never confirm.
  // Fail into the friendly availability recovery without spending a doomed
  // mutation or escalating to a human.
  const tokenless: OrderingSnapshot = {
    ...afterPayment,
    readyForConfirmation: true,
    confirmationAction: null,
  };
  const { client: tokenlessClient, log: tokenlessLog, assertExhausted: tokenlessExhausted } = fakeClient([]);
  let tokenlessError: unknown = null;
  try {
    await resolveConfirmation(
      tokenless, tokenlessClient, permit.empresaId, permit.remoteJid, 'wamid.e1-tokenless', permit,
      undefined, tokenless.revision, alwaysCurrentPermit,
    );
  } catch (error) { tokenlessError = error; }
  tokenlessExhausted('scenario 4 tokenless confirmation');
  assert.equal(tokenlessLog.length, 0, 'a missing confirmation token makes ZERO confirmDraft calls');
  // The local code is deliberately DISTINCT from the authority's
  // `CONFIRMACAO_INDISPONIVEL`: both recover identically, but a pilot needs
  // the metric line to separate "our snapshot carried no token" from "the
  // store's confirmation service is down".
  assert.ok(tokenlessError instanceof ZeloMenuInternalError && tokenlessError.code === 'CONFIRMACAO_SEM_TOKEN');
  const tokenlessRecovery = classifyOrderingFailure(tokenlessError);
  assert.equal(tokenlessRecovery.action, 'retry_later', 'missing token follows friendly retry, never human escalation');
  assert.ok(tokenlessRecovery.action === 'retry_later');
  assert.equal(tokenlessRecovery.countsTowardLimit, false);

  // Staleness still wins before token availability: re-present the current
  // summary and do not emit the availability failure for an unseen revision.
  const staleOutcome = await resolveConfirmation(
    tokenless, tokenlessClient, permit.empresaId, permit.remoteJid, 'wamid.e1-tokenless-stale', permit,
    undefined, tokenless.revision - 1, alwaysCurrentPermit,
  );
  assert.equal(staleOutcome.kind, 'summary');
  assert.equal(staleOutcome.snapshot, tokenless);
  assert.equal(tokenlessLog.length, 0, 'the stale tokenless path also makes ZERO confirmDraft calls');
}

// =============================================================================
// Scenario 5 — "sim, sem cebola" is an edit, not a confirmation; "cancela a
// coca" is a partial removal (removedLineIds), not a full cancel; "Cancelar"
// is a full cancel; "não" after a summary asks what to change.
// =============================================================================
console.log('===== Scenario 5: edit vs. partial-cancel vs. full-cancel vs. ask-change =====');
{
  // "sim, sem cebola" / "fechou, só coloca troco pra 50" / "certo, mas troca
  // a coca" — a confirmation-ish word FOLLOWED by more content is always an
  // edit, never a bare confirm.
  for (const text of ['sim, sem cebola', 'fechou, só coloca troco pra 50', 'certo, mas troca a coca']) {
    const turn = classifyOrderingTurn(text, true);
    assert.equal(turn.kind, 'alter', `'${text}' must classify as an edit, never a confirm`);
  }
  // "cancela a coca" / "cancela a entrega, vou retirar" — partial cancels are
  // edits, never a full pedido cancel.
  for (const text of ['cancela a coca', 'cancela a entrega, vou retirar']) {
    const turn = classifyOrderingTurn(text, true);
    assert.equal(turn.kind, 'alter', `'${text}' must classify as a partial edit, never a full cancel`);
  }
  // "cancela o pedido" / "cancelar meu pedido" — the ONLY phrasing that is a
  // full cancel.
  for (const text of ['cancela o pedido', 'cancelar meu pedido']) {
    assert.equal(classifyOrderingTurn(text, true).kind, 'cancel', `'${text}' must be the full cancel`);
  }
  // "não" after a summary asks what to change — never silently drops the order.
  assert.equal(classifyOrderingTurn('não', true).kind, 'ask_change');
  assert.equal(classifyOrderingTurn('nao', true).kind, 'ask_change');

  // Driven: the ask_change branch of the FULL handler is DB-free under
  // dryRun (persistOrderingState/sendText both no-op before touching
  // Supabase), so this exercises the real handled:true/response pair.
  const permit: AiTurnPermit = {
    empresaId: '10000000-0000-4000-8000-0000000000f1', conversationControlId: '60000000-0000-4000-8000-0000000000f1',
    remoteJid: '5511900000005@s.whatsapp.net', epoch: '1', triggerMessageId: 'trigger-askchange',
  };
  const orderingId = '30000000-0000-4000-8000-000000000005';
  const openSnapshot = {
    ...cloneFixture<Record<string, unknown>>('snapshot.ready.json'), orderingId, revision: 1,
    empresaId: permit.empresaId, remoteJid: permit.remoteJid,
  };
  const { client: askChangeClient } = fakeClient([{ label: 'getOrdering for ask_change', respond: () => okJson(openSnapshot) }]);
  const session: StoredSession = {
    id: 's-askchange', customerName: 'Cliente', customerPhone: '5511900000005', lastMessage: 'não',
    lastMessageTime: new Date(0).toISOString(), unreadCount: 0, status: 'active', autoReply: true,
    messages: [
      { id: 'm-pointer', waMessageId: 'm-pointer', role: 'tool', kind: 'text', content: `ZELO_AI_ORDERING_STATE:${JSON.stringify({ orderingId, revision: 1 })}`, preview: '', timestamp: new Date(0).toISOString() },
      { id: 'm-nao-1', waMessageId: 'm-nao-1', role: 'user', kind: 'text', content: 'não', preview: 'não', timestamp: new Date(1).toISOString() },
    ],
  };
  const askChangeResult = await tryHandleAiWhatsAppOrdering(
    permit.remoteJid, permit.empresaId, session, permit, { menuUrl: null, storeOpen: null },
    { client: askChangeClient, dryRun: true },
  );
  assert.equal(askChangeResult.handled, true);
  assert.equal(askChangeResult.response, 'Tudo bem. O que você quer alterar no pedido?', '"não" after a summary asks what to change, never silently drops the order');

  // Partial removal via removedLineIds — "cancela a coca" removes ONE line,
  // the rest of the cart survives untouched (CT Important 5). Matches
  // commands.accepted.json's own "atualiza com removedLineIds" example.
  const twoLineCart: OrderingSnapshot = {
    orderingId, empresaId: permit.empresaId, remoteJid: permit.remoteJid, state: 'cart_open', revision: 1,
    cart: {
      items: [
        {
          lineId: 'linha-1', productId: 1007, productName: 'Marmita', baseUnitPrice: 20,
          selectedModifiers: [{ groupId: 'g001', groupName: 'Extras', kind: 'adicional', selectedOptions: [{ optionId: 'o011', optionName: 'Queijo ralado', priceDelta: 3, quantity: 2 }] }],
          modifierDeltaTotal: 6, quantity: 1, unitPrice: 26, lineTotal: 26,
        },
        {
          lineId: 'linha-2', productId: 501, productName: 'Coca-Cola', baseUnitPrice: 8,
          selectedModifiers: [], modifierDeltaTotal: 0, quantity: 1, unitPrice: 8, lineTotal: 8,
        },
      ],
    },
    customer: { name: 'Cliente Fixture' },
    fulfillment: { type: 'pickup', asap: true },
    payment: { declaredMethod: 'dinheiro', pixReceiptRequired: false, pixReceiptApproved: false },
    pricing: { subtotal: 34, deliveryFee: 0, discount: 0, total: 34 },
    revalidation: { checkedAt: new Date(0).toISOString(), ok: true, issues: [] },
    requirements: [], readyForConfirmation: true,
    confirmationAction: { type: 'confirm_order', token: 'x'.repeat(43), revision: 1, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    requiresReview: false, order: null,
  };
  const patchedDraft = applyConversationOrderPatch(twoLineCart, { items: [], removedLineIds: ['linha-2'] });
  assert.deepEqual(patchedDraft.items.map((i) => i.lineId), ['linha-1'], 'removedLineIds drops ONLY the targeted line');
  assert.deepEqual(patchedDraft.items[0].selectedOptions, [{ groupId: 'g001', optionSelections: [{ optionId: 'o011', quantity: 2 }] }], 'the surviving line keeps its own modifiers untouched');

  const partialRemovalResponse = {
    ...cloneFixture<Record<string, unknown>>('snapshot.ready.json'),
    orderingId, empresaId: permit.empresaId, remoteJid: permit.remoteJid, revision: 2,
    cart: { items: [{ lineId: 'linha-1', productId: 1007, productName: 'Marmita', baseUnitPrice: 20, selectedModifiers: [], modifierDeltaTotal: 0, quantity: 1, unitPrice: 20, lineTotal: 20 }], observations: null },
    pricing: { subtotal: 20, deliveryFee: 0, discount: 0, total: 20 },
  };
  const { client: removalClient, log: removalLog, assertExhausted: removalExhausted } = fakeClient([{
    label: 'partial removal carries removedLineIds',
    expect: ({ body }) => {
      assert.equal(body?.orderingId, orderingId);
      assert.equal(body?.expectedRevision, 1);
      assert.deepEqual((body?.draft as Record<string, unknown>).removedLineIds, ['linha-2']);
      assert.deepEqual((body?.draft as Record<string, unknown>).items, [], 'no untouched-line duplication is sent on the wire — only the removal instruction');
    },
    respond: () => okJson(partialRemovalResponse),
  }]);
  await removalClient.updateDraft({
    empresaId: permit.empresaId, remoteJid: permit.remoteJid, messageId: 'wamid.e1-partial-remove-1',
    conversationControlId: permit.conversationControlId, conversationEpoch: permit.epoch,
    orderingId, expectedRevision: 1, draft: { items: [], removedLineIds: ['linha-2'] },
  });
  removalExhausted('scenario 5 partial removal');
  assert.equal(removalLog.length, 1, 'partial removal is exactly one authority call — the wire body carries removedLineIds directly, no separate remove+re-add pair');

  // Full cancel via the "Cancelar" button/hard-cancel path — client.cancelDraft
  // directly, matching commands.accepted.json's cancel_draft example.
  const cancelledResponse = { ...cloneFixture<Record<string, unknown>>('snapshot.cancelled.json'), orderingId, empresaId: permit.empresaId, remoteJid: permit.remoteJid, revision: 2 };
  const { client: cancelClient, log: cancelLog, assertExhausted: cancelExhausted } = fakeClient([{
    label: 'cancel_draft',
    expect: ({ body }) => { assert.equal(body?.orderingId, orderingId); assert.equal(body?.expectedRevision, 1); },
    respond: () => okJson(cancelledResponse),
  }]);
  const cancelled = await cancelClient.cancelDraft({
    empresaId: permit.empresaId, remoteJid: permit.remoteJid, messageId: 'wamid.e1-full-cancel-1',
    conversationControlId: permit.conversationControlId, conversationEpoch: permit.epoch, orderingId, expectedRevision: 1,
  });
  cancelExhausted('scenario 5 full cancel');
  assert.equal(cancelLog.length, 1, 'a full cancel is exactly one cancelDraft call');
  assert.equal(cancelled.state, 'cancelled');
}

// =============================================================================
// Scenario 6 — audio: a 'done' transcript feeds the composer like typed
// text; every failure reason (failed/too_large/unsupported/timeout) writes
// the SAME audio_transcript_status:'failed' shape (verified against
// server/transcription.ts's own write sites) and is therefore handled
// identically and boundedly by composeOrderingTurn — one friendly reply,
// never a repeat, and the NEXT text turn is unaffected.
// =============================================================================
console.log('===== Scenario 6: audio transcript outcomes feed (or bound) the turn identically =====');
{
  const t0 = new Date(0).toISOString();
  const doneAudio = composeOrderingTurn([
    { id: 'audio-done-1', role: 'user', kind: 'audio', content: null, preview: '[Áudio recebido]', audio_transcript: 'quero uma coxinha', audio_transcript_status: 'done', timestamp: t0 },
  ], null);
  assert.equal(doneAudio.text, 'quero uma coxinha', "a 'done' transcript feeds the composer exactly like typed text");
  assert.deepEqual(doneAudio.failedAudioMessageIds, []);

  // transcription.ts writes audio_transcript_status:'failed' for EVERY
  // failure reason (missing_key, unsupported, too_large, timeout, empty,
  // generic failed) — confirmed by reading every write site in that file.
  // composeOrderingTurn only ever inspects audio_transcript_status, so all
  // of them are bounded identically: one friendly reply, never re-detected.
  const transcriptionSource = readFileSync(new URL('../server/transcription.ts', import.meta.url), 'utf8');
  assert.match(
    transcriptionSource,
    /export type TranscriptionOutcome = 'done' \| 'missing_key' \| 'empty' \| 'unsupported' \| 'too_large' \| 'timeout' \| 'failed';/,
    'the outcome union still lists every failure reason this scenario assumes',
  );
  for (const reason of ['unsupported', 'too_large', 'timeout']) {
    assert.match(transcriptionSource, new RegExp(`'${reason}'`), `transcription.ts still returns outcome '${reason}' from some branch`);
  }
  // Spot-checked directly (server/transcription.ts:117-213, read while
  // building this suite): every one of those branches persists
  // `audio_transcript_status: 'failed'` before returning — composeOrderingTurn
  // only reads that column, so all six failure reasons are handled identically.
  for (const status of ['pending', 'failed'] as const) {
    const composition = composeOrderingTurn([
      { id: `audio-${status}-1`, role: 'user', kind: 'audio', content: null, preview: '[Áudio recebido]', audio_transcript: null, audio_transcript_status: status, timestamp: t0 },
    ], null);
    if (status === 'pending') {
      assert.deepEqual(composition.pendingAudioMessageIds, [`audio-${status}-1`]);
      assert.deepEqual(composition.failedAudioMessageIds, []);
    } else {
      assert.deepEqual(composition.failedAudioMessageIds, [`audio-${status}-1`]);
      // Resolved, and therefore folded into consumedMessageIds so it is
      // never replayed into a later turn (PR C-6 / FN C3).
      assert.ok(composition.consumedMessageIds.includes(`audio-${status}-1`));
    }
  }

  // End-to-end (dryRun, DB-free): turn 1 gets the friendly "não consegui
  // ouvir" reply and makes ZERO authority calls; turn 2, a plain text order,
  // DOES reach the authority — proving the conversation is not locked.
  const permit: AiTurnPermit = {
    empresaId: 'empresa-audio', conversationControlId: 'control-audio', remoteJid: '5511900000006@s.whatsapp.net',
    epoch: '1', triggerMessageId: 'trigger-audio',
  };
  const { client: audioClient, log: audioLog } = fakeClient([]);
  const turn1Session: StoredSession = {
    id: 's-audio', customerName: 'Cliente', customerPhone: '5511900000006', lastMessage: '[Áudio recebido]',
    lastMessageTime: t0, unreadCount: 0, status: 'active', autoReply: true,
    messages: [{ id: 'audio-fail-1', waMessageId: 'audio-fail-1', role: 'user', kind: 'audio', content: null, preview: '[Áudio recebido]', audio_transcript: null, audio_transcript_status: 'failed', timestamp: t0 }],
  };
  const turn1 = await tryHandleAiWhatsAppOrdering(permit.remoteJid, permit.empresaId, turn1Session, permit, { menuUrl: null, storeOpen: null }, { client: audioClient, dryRun: true });
  assert.equal(turn1.handled, true);
  assert.equal(turn1.response, 'Não consegui ouvir esse áudio. Pode escrever o pedido aqui para eu continuar?');
  assert.equal(audioLog.length, 0, 'a failed-audio turn never reaches the authority');

  const searchOnlyClient: OrderingClient = {
    searchCatalog: async () => ({ total: 1, ambiguous: false, results: [{ productId: 9, publicName: 'Coxinha', currentPrice: 7, matchReason: 'name', ambiguous: false }] }),
    updateDraft: async () => { throw new Error('dryRun never mutates'); },
    confirmDraft: async () => { throw new Error('unused'); },
    cancelDraft: async () => { throw new Error('unused'); },
    getOrdering: async () => { throw new Error('unused'); },
  };
  const turn2Session: StoredSession = {
    ...turn1Session,
    messages: [
      ...turn1Session.messages,
      { id: 'm-tool-pointer', waMessageId: 'm-tool-pointer', role: 'assistant', kind: 'text', content: 'Não consegui ouvir esse áudio. Pode escrever o pedido aqui para eu continuar?', preview: '', timestamp: new Date(1).toISOString() },
      { id: 'text-after-audio-1', waMessageId: 'text-after-audio-1', role: 'user', kind: 'text', content: 'quero uma coxinha', preview: 'quero uma coxinha', timestamp: new Date(2).toISOString() },
    ],
  };
  const turn2 = await tryHandleAiWhatsAppOrdering(
    permit.remoteJid, permit.empresaId, turn2Session, permit, { menuUrl: null, storeOpen: null },
    { client: searchOnlyClient, dryRun: true, draftPlanner: async () => null },
  );
  assert.equal(turn2.handled, true, 'the NEXT text turn works normally after a failed audio, unblocked');
  assert.match(turn2.response ?? '', /Coxinha/i, 'the real catalog reply is produced for the following turn');
}

// =============================================================================
// Scenario 7 — takeover races: zero MUTATING authority call, zero outbound,
// no manager notification when a takeover lands before the mutation.
// `client.searchCatalog` is a harmless read with no permit gate ahead of it
// (by design — only `updateDraft`/`confirmDraft`/`cancelDraft` re-check the
// live permit, see `assertPermitCurrent`'s call sites), so it legitimately
// still runs; this suite scripts it explicitly rather than asserting "zero
// calls of any kind", which would be a false expectation about the real
// code. This extends tests/aiTakeoverRace.test.ts (which proves the same
// updateDraft/confirmDraft invariant with throw-based client fakes) by
// asserting it against the strict, wire-body-validating fake authority.
// =============================================================================
console.log('===== Scenario 7: permit takeover races make ZERO mutating authority calls =====');
{
  const permit: AiTurnPermit = {
    empresaId: 'empresa-race', conversationControlId: 'control-race', remoteJid: '5511900000007@s.whatsapp.net',
    epoch: '1', triggerMessageId: 'trigger-race',
  };
  const raceCatalog: CatalogReplyResult = { total: 1, ambiguous: false, results: [{ productId: 1, publicName: 'Marmita', currentPrice: 20, matchReason: 'name', ambiguous: false }] };
  // Race A — the takeover lands WHILE the model is "planning" (mirrors
  // tests/aiTakeoverRace.test.ts Race 1): searchCatalog is a read and legally
  // runs; the permit re-check right before updateDraft must catch the
  // takeover and suppress cleanly BEFORE any mutating call is attempted.
  {
    const { client, log, assertExhausted } = fakeClient([{
      label: 'searchCatalog is a read — allowed even mid-takeover',
      respond: () => okJson(raceCatalog),
    }]);
    let takeoverLanded = false;
    const draftPlanner = async () => { takeoverLanded = true; return { items: [{ productId: 1, quantity: 1 }] }; };
    const session: StoredSession = {
      id: 's-race-a', customerName: 'Cliente', customerPhone: '5511900000007', lastMessage: 'quero uma marmita',
      lastMessageTime: new Date(0).toISOString(), unreadCount: 0, status: 'active', autoReply: true,
      messages: [{ id: 'm-race-a', waMessageId: 'm-race-a', role: 'user', kind: 'text', content: 'quero uma marmita', preview: 'quero uma marmita', timestamp: new Date(0).toISOString() }],
    };
    const result = await tryHandleAiWhatsAppOrdering(
      permit.remoteJid, permit.empresaId, session, permit, { menuUrl: null, storeOpen: null },
      { client, draftPlanner, permitCheck: async () => !takeoverLanded },
    );
    assertExhausted('race A — takeover during planning');
    assert.equal(log.length, 1, 'exactly the one scripted searchCatalog read happened — no updateDraft was ever attempted');
    assert.equal(result.handled, true, 'a suppressed turn is still "handled" (no fallback to the generic model)');
    assert.equal(result.response, undefined, 'a suppressed turn sends nothing to the customer');
  }
  // Race B — on the confirm path, takeover lands right before resolveConfirmation
  // would call confirmDraft.
  {
    const { client, assertExhausted } = fakeClient([]);
    const current: OrderingSnapshot = {
      orderingId: 'ord-race-b', empresaId: permit.empresaId, remoteJid: permit.remoteJid, state: 'cart_open', revision: 2,
      cart: { items: [] }, customer: { name: 'Cliente' }, fulfillment: { type: 'pickup', asap: true },
      payment: { pixReceiptRequired: false, pixReceiptApproved: false },
      pricing: { subtotal: 10, deliveryFee: 0, discount: 0, total: 10 },
      revalidation: { checkedAt: new Date(0).toISOString(), ok: true, issues: [] },
      confirmationAction: { type: 'confirm_order', token: 'race-b-token', revision: 2, expiresAt: new Date(Date.now() + 60_000).toISOString() },
      requiresReview: false, order: null,
    };
    await assert.rejects(
      () => resolveConfirmation(current, client, permit.empresaId, permit.remoteJid, 'm-race-b', permit, 'race-b-token', 2, async () => false),
      (error: unknown) => (error as { constructor: { name: string } })?.constructor?.name === 'OrderingSuppressedError',
    );
    assertExhausted('race B — takeover before confirmDraft');
  }
}

console.log('\nScenarios 5, 6, 7 passed');

// =============================================================================
// Scenario 8 — authority errors: REVISAO_DESATUALIZADA/PEDIDO_EM_ANDAMENTO
// recover using the `current` snapshot carried on the SAME response (one
// turn, no extra round trip); a confirm TIMEOUT reconciles via a fresh GET
// before telling the customer anything failed; MUITAS_REQUISICOES gets
// friendly retry copy; a tripped circuit breaker gets friendly copy plus
// exactly one manager notification.
// =============================================================================
console.log('===== Scenario 8: authority error codes recover or fail friendly =====');
{
  const permit: AiTurnPermit = {
    empresaId: '10000000-0000-4000-8000-0000000000f1', conversationControlId: '60000000-0000-4000-8000-0000000000f1',
    remoteJid: '5511900000001@s.whatsapp.net', epoch: '7', triggerMessageId: 'trigger-errors',
  };
  const orderingId = '30000000-0000-4000-8000-000000000001';

  // --- REVISAO_DESATUALIZADA: recovered in ONE turn using the `current`
  // snapshot the 409 itself carries, no extra round trip needed to see where
  // the order actually stands.
  {
    const currentSnapshot = cloneFixture<Record<string, unknown>>('snapshot.review-required.json');
    const { client, log } = fakeClient([{
      label: 'stale update rejected with a fresh current snapshot',
      respond: () => ({ status: 409, json: { error: 'REVISAO_DESATUALIZADA', requestId: 'req-stale', current: currentSnapshot } }),
    }]);
    let caught: unknown = null;
    try {
      await client.updateDraft({
        empresaId: permit.empresaId, remoteJid: permit.remoteJid, messageId: 'wamid.e1-stale-1',
        conversationControlId: permit.conversationControlId, conversationEpoch: permit.epoch,
        orderingId, expectedRevision: 1, draft: { items: [] },
      });
    } catch (error) { caught = error; }
    assert.ok(caught instanceof ZeloMenuInternalError && caught.code === 'REVISAO_DESATUALIZADA');
    const recovery = classifyOrderingFailure(caught);
    assert.equal(recovery.action, 'resync', 'a stale revision recovers by adopting the fresh current snapshot, not by escalating');
    assert.ok(recovery.action === 'resync');
    assert.equal(recovery.current.revision, 3, 'the recovered snapshot is already the real wire-parsed current state');
    assert.equal(recovery.current.requiresReview, true);
    // The customer-visible turn is exactly one presentation of this SAME
    // already-in-hand snapshot — no second authority call was made.
    assert.equal(hasPendingOrderingRequirements(recovery.current, {}), true);
    assert.equal(log.length, 1, 'recovery uses the current snapshot already attached to the 409 — no second round trip');
  }

  // --- PEDIDO_EM_ANDAMENTO: the conversation adopts the existing order's
  // current state from the SAME 409 instead of treating it as a hard failure.
  {
    const currentSnapshot = { ...cloneFixture<Record<string, unknown>>('snapshot.partial-montavel.json'), revision: 1 };
    const { client } = fakeClient([{
      label: 'open rejected because a draft already exists',
      respond: () => ({ status: 409, json: { error: 'PEDIDO_EM_ANDAMENTO', requestId: 'req-inflight', current: currentSnapshot } }),
    }]);
    let caught: unknown = null;
    try {
      await client.updateDraft({
        empresaId: permit.empresaId, remoteJid: permit.remoteJid, messageId: 'wamid.e1-inflight-1',
        conversationControlId: permit.conversationControlId, conversationEpoch: permit.epoch,
        draft: { items: [{ lineId: 'l1', productId: 1007, quantity: 1 }] },
      });
    } catch (error) { caught = error; }
    const recovery = classifyOrderingFailure(caught);
    assert.equal(recovery.action, 'resync');
    assert.ok(recovery.action === 'resync');
    assert.equal(recovery.current.orderingId, orderingId, 'the conversation adopts the EXISTING open order instead of trying to create a second one');
  }

  // --- confirm TIMEOUT then reconciliation finds it actually confirmed:
  // exactly one confirmation outcome, no false "failed" told to the customer.
  {
    const confirmed = { ...cloneFixture<Record<string, unknown>>('snapshot.confirmed.json'), orderingId, revision: 5 };
    const { client, log } = fakeClient([
      { label: 'confirm_draft times out mid-flight', respond: () => { throw new Error('simulated network timeout'); } },
      { label: 'reconciliation GET finds the order already materialized', respond: () => okJson(confirmed) },
    ]);
    const current: OrderingSnapshot = {
      orderingId, empresaId: permit.empresaId, remoteJid: permit.remoteJid, state: 'cart_open', revision: 5,
      cart: { items: [] }, customer: { name: 'Cliente' }, fulfillment: { type: 'pickup', asap: true },
      payment: { pixReceiptRequired: false, pixReceiptApproved: false },
      pricing: { subtotal: 10, deliveryFee: 0, discount: 0, total: 10 },
      revalidation: { checkedAt: new Date(0).toISOString(), ok: true, issues: [] },
      confirmationAction: { type: 'confirm_order', token: 'timeout-token', revision: 5, expiresAt: new Date(Date.now() + 60_000).toISOString() },
      requiresReview: false, order: null,
    };
    const outcome = await resolveConfirmation(current, client, permit.empresaId, permit.remoteJid, 'wamid.e1-timeout-1', permit, 'timeout-token', 5, async () => true);
    assert.equal(log.length, 2, 'exactly two authority calls: the timed-out confirm attempt, then ONE reconciliation GET');
    assert.equal(outcome.kind, 'confirmed', 'reconciliation finds the order already landed — never told "failed" after it actually succeeded');
    assert.equal(outcome.snapshot.orderingId, orderingId);
  }

  // --- MUITAS_REQUISICOES: friendly retry copy, no technical detail leaked.
  {
    const { client } = fakeClient([{
      label: 'rate limited',
      respond: () => ({ status: 429, json: { error: 'MUITAS_REQUISICOES', requestId: 'req-rl' } }),
    }]);
    let caught: unknown = null;
    try {
      await client.updateDraft({
        empresaId: permit.empresaId, remoteJid: permit.remoteJid, messageId: 'wamid.e1-ratelimit-1',
        conversationControlId: permit.conversationControlId, conversationEpoch: permit.epoch, draft: { items: [] },
      });
    } catch (error) { caught = error; }
    const recovery = classifyOrderingFailure(caught);
    assert.equal(recovery.action, 'retry_later');
    assert.ok(recovery.action === 'retry_later');
    assert.equal(recovery.text, 'Deu uma instabilidade rápida por aqui agora. Pode tentar de novo em instantes?');
    assert.doesNotMatch(recovery.text, /MUITAS_REQUISICOES|429|internal|upstream/i, 'no technical code/status ever reaches customer-facing copy');
    assert.notEqual(recovery.countsTowardLimit, false, 'a plain rate-limit still spends the per-conversation retry budget (store-side availability codes are exempt)');
  }

  // --- CONFIRMACAO_INDISPONIVEL: this 400 is a store-side availability
  // fault, not a domain rejection. It must use the friendly retry path
  // without spending this conversation's escalation budget.
  {
    const unavailable = new ZeloMenuInternalError('CONFIRMACAO_INDISPONIVEL', 400, 'req-confirm-unavailable');
    const recovery = classifyOrderingFailure(unavailable);
    assert.equal(recovery.action, 'retry_later');
    assert.ok(recovery.action === 'retry_later');
    assert.equal(recovery.text, 'Deu uma instabilidade rápida por aqui agora. Pode tentar de novo em instantes?');
    assert.equal(recovery.countsTowardLimit, false, 'store-side confirmation availability never burns the per-conversation retry budget');
  }

  // --- CONFIRMACAO_SEM_TOKEN: the LOCAL twin of the code above, raised by
  // `resolveConfirmation` before a doomed mutation. Same recovery, distinct
  // code so the metric line stays diagnosable.
  {
    const tokenless = new ZeloMenuInternalError('CONFIRMACAO_SEM_TOKEN', 400, 'req-confirm-tokenless');
    const recovery = classifyOrderingFailure(tokenless);
    assert.equal(recovery.action, 'retry_later');
    assert.ok(recovery.action === 'retry_later');
    assert.equal(recovery.countsTowardLimit, false, 'a locally-detected missing token never burns the retry budget either');
    assert.doesNotMatch(recovery.text, /token|CONFIRMACAO|400/i, 'no technical code ever reaches customer-facing copy');
  }

  // --- Circuit breaker open: friendly copy, bounded by the SAME family of
  // copy as any other transient fault, PLUS exactly one manager notification
  // the instant it trips (not once per conversation).
  {
    let fakeNow = 0;
    const breaker = createOrderingCircuitBreaker({ threshold: 2, windowMs: 60_000, openMs: 30_000, now: () => fakeNow });
    let openedCount = 0;
    const openedFor: string[] = [];
    const breakerClient = new ZeloMenuInternalClient({
      baseUrl: 'https://internal.example', apiKey: 'test-key', timeoutMs: 100,
      fetchImpl: async () => new Response(JSON.stringify({ error: 'INDISPONIVEL' }), { status: 503 }),
      circuitBreaker: breaker,
      onCircuitOpen: (empresaId) => { openedCount += 1; openedFor.push(empresaId); },
    });
    for (let i = 0; i < 2; i += 1) {
      fakeNow += 1000;
      await assert.rejects(() => breakerClient.getOrdering(orderingId, 'empresa-breaker-e1', permit.remoteJid));
    }
    assert.equal(openedCount, 1, 'the manager is notified exactly ONCE — the call that flips the breaker, not once per conversation');
    assert.deepEqual(openedFor, ['empresa-breaker-e1']);

    fakeNow += 1000;
    let trippedError: unknown = null;
    try { await breakerClient.getOrdering(orderingId, 'empresa-breaker-e1', permit.remoteJid); } catch (error) { trippedError = error; }
    assert.ok(trippedError instanceof ZeloMenuInternalError && trippedError.code === 'INDISPONIVEL_CIRCUITO_ABERTO');
    const recovery = classifyOrderingFailure(trippedError);
    assert.equal(recovery.action, 'retry_later');
    assert.ok(recovery.action === 'retry_later');
    assert.equal(recovery.text, 'Deu uma instabilidade rápida por aqui agora. Pode tentar de novo em instantes?', 'the breaker-open reply reads exactly like any other transient fault to the customer');
    assert.equal(recovery.countsTowardLimit, false, 'a breaker-open failure never spends the per-conversation retry budget — every turn keeps getting the friendly reply while the breaker stays open');
  }
}

// =============================================================================
// Scenario 10 — version skew: a snapshot missing `requirements` (deploy/
// rollback skew between ZeloChat and ZeloMenu) fails closed with the
// structured ORDERING_WIRE_UNSUPPORTED code and NEVER a raw TypeError, and
// recovers with the SAME bounded, friendly retry copy as any other
// transient fault.
// =============================================================================
console.log('===== Scenario 10: version skew fails closed, never a raw TypeError =====');
{
  const permit: AiTurnPermit = {
    empresaId: '10000000-0000-4000-8000-0000000000f1', conversationControlId: '60000000-0000-4000-8000-0000000000f1',
    remoteJid: '5511900000001@s.whatsapp.net', epoch: '7', triggerMessageId: 'trigger-skew',
  };
  const skewed = cloneFixture<Record<string, unknown>>('snapshot.ready.json');
  delete (skewed as Record<string, unknown>).requirements;
  const { client } = fakeClient([{ label: 'GET returns a snapshot missing requirements[] entirely', respond: () => okJson(skewed) }]);

  // Never a raw TypeError bubbling out of the parser — a stable, structured
  // error code every time.
  let caught: unknown = null;
  try {
    await client.getOrdering('30000000-0000-4000-8000-000000000001', permit.empresaId, permit.remoteJid);
  } catch (error) { caught = error; }
  assert.ok(!(caught instanceof TypeError), 'version skew must never surface as a raw TypeError');
  assert.ok(caught instanceof ZeloMenuInternalError && caught.code === 'ORDERING_WIRE_UNSUPPORTED');

  // Also directly against the pure parser — the same guarantee one layer down.
  assert.throws(
    () => parseOrderingSnapshotWire(skewed),
    (error: unknown) => error instanceof OrderingWireUnsupportedError && error.reason === 'missing_requirements_array',
  );

  const recovery = classifyOrderingFailure(caught);
  assert.equal(recovery.action, 'retry_later', 'version skew is escalated boundedly and friendly, exactly like any other transient authority fault');
  assert.ok(recovery.action === 'retry_later');
  assert.equal(recovery.text, 'Deu uma instabilidade rápida por aqui agora. Pode tentar de novo em instantes?');
}

console.log('\nScenarios 8 and 10 passed');
console.log('\nhybridOrderingScenarios: all groups passed');
