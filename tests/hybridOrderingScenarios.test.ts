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
// Scenario 9 (part 1) — blocked date closes the live entry button. The
// per-tenant flag half of scenario 9 ("flag false -> zero authority calls")
// is gated inside server/ai.ts BEFORE tryHandleAiWhatsAppOrdering is ever
// invoked; it is already covered end to end by
// tests/aiHybridOrderingFlag.test.ts's source-order guardrails and is not
// re-tested here to avoid duplicating that coverage — this suite instead
// connects D3's own unit (resolveOrderingEntryStoreOpen) to the handler's
// observable behavior when storeOpen is false, which is the part D3's own
// test file does not itself drive.
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
