/**
 * Contract test: every request body ZeloChat can build for the conversation
 * ordering surface must (a) structurally match what ZeloMenu's real parser
 * accepts (`commands.accepted.json`) and (b) never reproduce one of the
 * documented rejected shapes (`commands.rejected.json`) — the exact
 * mismatches the ultra-review contract audit found by reading both repos'
 * source directly (CT #4, #5, #6, #8; FN C2; PR I-13).
 *
 * Fixtures are the AUTHORITY's recorded truth
 * (`tests/fixtures/zelomenu-wire/v1/`, copied verbatim from
 * `zelomenu/.../docs/contracts/conversation-ordering-wire/v1`). Never
 * hand-edit a copy here — regenerate at the source and re-copy.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ZeloMenuInternalClient } from '../server/zeloMenuInternalClient.js';
import { applyConversationOrderPatch } from '../server/orderingPatchPlanner.js';
import { presentOrderingRequirements } from '../src/domain/orderingRequirementPresenter.js';
import { parseOrderingSnapshotWire } from '../server/zeloMenuOrderingWire.js';
import { sanitizeFulfillmentForWire, snapshotToDraft, type OrderingDraft, type OrderingSnapshot } from '../src/domain/aiWhatsAppOrdering.js';

const fixturesDir = new URL('./fixtures/zelomenu-wire/v1/', import.meta.url);
const loadFixture = (name: string): unknown => JSON.parse(readFileSync(new URL(name, fixturesDir), 'utf8'));
const acceptedCommands = loadFixture('commands.accepted.json') as Array<{ name: string; body: Record<string, unknown> }>;
const requirementTypes = loadFixture('requirement-types.json') as Record<string, unknown>;
const snapshotFixtureNames = [
  'snapshot.cancelled.json',
  'snapshot.confirmed.json',
  'snapshot.partial-montavel.json',
  'snapshot.ready.json',
  'snapshot.review-required.json',
];

// --- Structural conformance: every key ZeloChat sends in a `draft`/command
// body must exist, with a compatible primitive type, on at least one
// accepted command of the same `type` — a lightweight structural check
// (not full JSON-schema) that still catches "we send a field the parser has
// never heard of" or "we send a string where the parser expects a number".
function typeTag(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function keysConformTo(actual: unknown, template: unknown): boolean {
  if (actual === undefined) return true;
  if (typeTag(actual) === 'null') return typeTag(template) === 'null' || template === undefined;
  if (Array.isArray(actual)) {
    if (!Array.isArray(template) || template.length === 0) return true; // no element template to check against
    return actual.every((item) => keysConformTo(item, template[0]));
  }
  if (typeTag(actual) === 'object') {
    if (typeTag(template) !== 'object') return false;
    const templateObj = template as Record<string, unknown>;
    return Object.entries(actual as Record<string, unknown>).every(
      ([key, value]) => key in templateObj && keysConformTo(value, templateObj[key]),
    );
  }
  return typeTag(actual) === typeTag(template);
}

/**
 * Merges two structural templates: a key/shape is "known" if ANY accepted
 * fixture of this command type defines it — a real body may legitimately
 * combine fields that appear across different individual fixtures (e.g. a
 * `paymentMethod` from fixture #1 with a `removedLineIds` from fixture #2).
 */
function mergeTemplates(a: unknown, b: unknown): unknown {
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (Array.isArray(a) || Array.isArray(b)) {
    const combined = [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])];
    return combined.length ? [combined.reduce((acc, item) => mergeTemplates(acc, item))] : [];
  }
  if (typeTag(a) === 'object' && typeTag(b) === 'object') {
    const merged: Record<string, unknown> = { ...(a as Record<string, unknown>) };
    for (const [key, value] of Object.entries(b as Record<string, unknown>)) {
      merged[key] = key in merged ? mergeTemplates(merged[key], value) : value;
    }
    return merged;
  }
  return a;
}

function assertConformsToAccepted(type: string, body: Record<string, unknown>, label: string): void {
  const candidates = acceptedCommands.filter((entry) => entry.body.type === type);
  assert.ok(candidates.length > 0, `no accepted fixture for command type ${type}`);
  const template = candidates
    .map((entry): unknown => entry.body)
    .reduce((a, b) => mergeTemplates(a, b));
  assert.ok(keysConformTo(body, template), `${label}: body does not structurally conform to any accepted ${type} fixture\n${JSON.stringify(body)}`);
}

/** The specific, documented violations in `commands.rejected.json` — see its
 * `name` field for the exact wording each check below defends against. */
function assertNeverRejectedShape(body: Record<string, unknown>, label: string): void {
  const draft = body.draft as Record<string, unknown> | undefined;
  const fulfillment = draft?.fulfillment as Record<string, unknown> | undefined;
  if (fulfillment) {
    assert.equal(fulfillment.deliveryFee, undefined, `${label}: must never echo fulfillment.deliveryFee (the store computes it)`);
    assert.equal(fulfillment.deliveryFeeToConfirm, undefined, `${label}: must never echo fulfillment.deliveryFeeToConfirm`);
    assert.notEqual(fulfillment.type, null, `${label}: must never send fulfillment.type: null — omit fulfillment entirely instead`);
    assert.notEqual(fulfillment.type, 'scheduled', `${label}: "scheduled" is not a valid fulfillment.type — use asap:false + pickupDate/pickupTime`);
  }
  for (const item of (draft?.items as Array<Record<string, unknown>> | undefined) ?? []) {
    assert.equal(typeof item.lineId, 'string', `${label}: every item must carry a lineId`);
    assert.ok(item.lineId && (item.lineId as string).length > 0, `${label}: lineId must be non-empty`);
    for (const pricedField of ['productName', 'price', 'unitPrice', 'lineTotal']) {
      assert.equal(item[pricedField], undefined, `${label}: item must never echo priced field "${pricedField}"`);
    }
  }
  if (typeof body.conversationEpoch !== 'undefined') {
    assert.equal(typeof body.conversationEpoch, 'string', `${label}: conversationEpoch must always be a decimal STRING, never a number`);
  }
  if (body.type === 'confirm_draft') {
    assert.equal(typeof body.confirmationToken, 'string', `${label}: confirm_draft without confirmationToken is rejected (mandatory since ZM1 step 3)`);
    assert.ok((body.confirmationToken as string).length > 0);
  }
}

async function captureCommandBody(run: (client: ZeloMenuInternalClient) => Promise<unknown>): Promise<Record<string, unknown>> {
  let captured: Record<string, unknown> | null = null;
  const client = new ZeloMenuInternalClient({
    baseUrl: 'https://internal.example', apiKey: 'key', timeoutMs: 100, confirmTimeoutMs: 100,
    fetchImpl: async (_url, init) => {
      captured = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify(loadFixture('snapshot.ready.json')), { headers: { 'content-type': 'application/json' } });
    },
    requestIdFactory: () => 'req',
  });
  await run(client);
  assert.ok(captured, 'no request body was captured');
  return captured as Record<string, unknown>;
}

const identity = { empresaId: 'e', remoteJid: '5511900000000@s.whatsapp.net', messageId: 'wamid.1', conversationControlId: 'c', conversationEpoch: '7' };

// --- 1. Entry -> first draft (open, no orderingId/expectedRevision).
{
  const patch = { items: [{ productId: 1007, quantity: 1, selectedOptions: [{ groupId: 'g001', optionSelections: [{ optionId: 'o001', quantity: 1 }] }] }] };
  const draft = applyConversationOrderPatch(null, patch);
  const body = await captureCommandBody((client) => client.updateDraft({ ...identity, draft }));
  assertConformsToAccepted('open_or_update_draft', body, 'entry -> first draft');
  assertNeverRejectedShape(body, 'entry -> first draft');
  assert.ok((body.draft as { items: unknown[] }).items.every((item) => typeof (item as { lineId?: string }).lineId === 'string'), 'first draft must assign lineIds');
}

const existingSnapshot = {
  orderingId: 'ord-1', empresaId: 'e', remoteJid: '5511900000000@s.whatsapp.net', state: 'cart_open', revision: 3,
  cart: {
    items: [{
      lineId: 'linha-1', productId: 1007, productName: 'Monte Sua Massa', baseUnitPrice: 22,
      selectedModifiers: [
        { groupId: 'g001', groupName: 'Massa', kind: 'variacao', selectedOptions: [{ optionId: 'o001', optionName: 'Espaguete', priceDelta: 0, quantity: 1 }] },
        { groupId: 'g005', groupName: 'Extra pago', kind: 'adicional', selectedOptions: [{ optionId: 'o011', optionName: 'Queijo ralado', priceDelta: 3, quantity: 1 }] },
      ],
      modifierDeltaTotal: 3, quantity: 1, unitPrice: 25, lineTotal: 25, notes: undefined,
    }, {
      lineId: 'linha-2', productId: 1008, productName: 'Refrigerante', baseUnitPrice: 6, selectedModifiers: [], modifierDeltaTotal: 0, quantity: 2, unitPrice: 6, lineTotal: 12, notes: undefined,
    }],
    observations: undefined,
  },
  customer: { name: null, phone: null },
  fulfillment: { type: null, asap: true, deliveryFee: 0, deliveryFeeToConfirm: false },
  payment: { declaredMethod: null, pixReceiptRequired: false, pixReceiptApproved: false },
  pricing: { subtotal: 37, deliveryFee: 0, discount: 0, total: 37 },
  revalidation: { checkedAt: new Date(0).toISOString(), ok: true, issues: [] },
  requirements: [],
  readyForConfirmation: false,
  confirmationAction: null,
  requiresReview: false,
  order: null,
} as unknown as OrderingSnapshot;

// --- 2. Patch update: add an item, keep the existing one via the snapshot fallback.
{
  const patch = { items: [{ lineId: 'linha-3', productId: 1009, quantity: 1 }] };
  const draft = applyConversationOrderPatch(existingSnapshot, patch);
  const body = await captureCommandBody((client) => client.updateDraft({ ...identity, orderingId: existingSnapshot.orderingId, expectedRevision: existingSnapshot.revision, draft }));
  assertConformsToAccepted('open_or_update_draft', body, 'patch update');
  assertNeverRejectedShape(body, 'patch update');
}

// --- 3. Quantity-only patch on an existing line must preserve its modifiers (PR I-13).
{
  const patch = { items: [{ lineId: 'linha-1', productId: 1007, quantity: 3 }] };
  const draft = applyConversationOrderPatch(existingSnapshot, patch);
  const body = await captureCommandBody((client) => client.updateDraft({ ...identity, orderingId: existingSnapshot.orderingId, expectedRevision: existingSnapshot.revision, draft }));
  assertConformsToAccepted('open_or_update_draft', body, 'quantity-only patch');
  assertNeverRejectedShape(body, 'quantity-only patch');
  const sentLine1 = (body.draft as { items: Array<{ lineId: string; selectedOptions?: unknown[] }> }).items.find((item) => item.lineId === 'linha-1');
  assert.ok(sentLine1 && (sentLine1.selectedOptions ?? []).length === 2, 'quantity-only patch must still carry both previously selected modifier groups');
}

// --- 4. Remove a line entirely (CT Important 5).
{
  const draft = applyConversationOrderPatch(existingSnapshot, { items: [], removedLineIds: ['linha-2'] });
  const body = await captureCommandBody((client) => client.updateDraft({ ...identity, orderingId: existingSnapshot.orderingId, expectedRevision: existingSnapshot.revision, draft }));
  assertConformsToAccepted('open_or_update_draft', body, 'remove line');
  assertNeverRejectedShape(body, 'remove line');
  assert.deepEqual((body.draft as { removedLineIds?: string[] }).removedLineIds, ['linha-2']);
}

// --- 5. Fulfillment: pickup, delivery, and "scheduled" (asap:false + pickupDate/pickupTime, no such enum value).
for (const fulfillment of [
  { type: 'pickup' as const, asap: true },
  { type: 'delivery' as const, asap: true, deliveryAddress: 'Rua Fixture, 100', deliveryNeighborhood: 'Bairro Fixture', deliveryNumber: '100' },
  { type: 'pickup' as const, asap: false, pickupDate: '2026-09-10', pickupTime: '19:30' },
]) {
  const draft: OrderingDraft = { items: [{ lineId: 'linha-1', productId: 1007, quantity: 1 }], fulfillment };
  const body = await captureCommandBody((client) => client.updateDraft({ ...identity, orderingId: existingSnapshot.orderingId, expectedRevision: existingSnapshot.revision, draft }));
  assertConformsToAccepted('open_or_update_draft', body, `fulfillment ${JSON.stringify(fulfillment)}`);
  assertNeverRejectedShape(body, `fulfillment ${JSON.stringify(fulfillment)}`);
}

// --- Fulfillment fallback from a snapshot with type:null must OMIT fulfillment entirely (CT #4/#5).
{
  const draft = applyConversationOrderPatch(existingSnapshot, { items: [] });
  const body = await captureCommandBody((client) => client.updateDraft({ ...identity, orderingId: existingSnapshot.orderingId, expectedRevision: existingSnapshot.revision, draft }));
  assert.equal((body.draft as { fulfillment?: unknown }).fulfillment, undefined, 'a snapshot with fulfillment.type:null must never surface fulfillment on the wire at all');
}

// --- 6. Payment method.
{
  const draft: OrderingDraft = { items: [{ lineId: 'linha-1', productId: 1007, quantity: 1 }], paymentMethod: 'pix' };
  const body = await captureCommandBody((client) => client.updateDraft({ ...identity, orderingId: existingSnapshot.orderingId, expectedRevision: existingSnapshot.revision, draft }));
  assertConformsToAccepted('open_or_update_draft', body, 'payment method');
  assertNeverRejectedShape(body, 'payment method');
}

// --- 7. Confirm — must always carry the confirmationToken (the B2 fix to
// the text-"sim" path: it used to omit this and 400 against the real parser).
{
  const readySnapshot = parseOrderingSnapshotWire(loadFixture('snapshot.ready.json'));
  const body = await captureCommandBody((client) => client.confirmDraft({
    ...identity, orderingId: readySnapshot.orderingId, expectedRevision: readySnapshot.revision,
    confirmationToken: readySnapshot.confirmationAction?.token,
  }));
  assertConformsToAccepted('confirm_draft', body, 'confirm');
  assertNeverRejectedShape(body, 'confirm');
}

// --- 8. Cancel.
{
  const body = await captureCommandBody((client) => client.cancelDraft({ ...identity, orderingId: existingSnapshot.orderingId, expectedRevision: existingSnapshot.revision }));
  assertConformsToAccepted('cancel_draft', body, 'cancel');
}

// --- 9. Repeat-order ("o de sempre") assigns a lineId to every item — the
// exact bug (CT #6) that made this feature 400 on every real attempt.
{
  const source = readFileSync(new URL('../server/aiWhatsAppOrdering.ts', import.meta.url), 'utf8');
  assert.match(source, /lineId: `line-\$\{productId\}-\$\{index \+ 1\}`/, 'lastOrderDraft must assign a stable lineId to every repeat-order item');
}

// --- Presenter: every requirement type in the authority's exhaustive list,
// and every recorded snapshot fixture, renders non-empty text — never an
// `undefined` body reaching `validateOutboundPayload` as OUTBOUND_TEXT_EMPTY.
for (const type of Object.keys(requirementTypes)) {
  const minimalRequirement = { id: `req-${type}`, type: type as never, label: `Pergunta para ${type}`, blocking: true };
  const presentation = presentOrderingRequirements({
    orderingId: 'o', empresaId: 'e', remoteJid: 'j', state: 'cart_open', revision: 1,
    cart: { items: [] }, customer: {}, fulfillment: { type: 'pickup', asap: true },
    payment: { pixReceiptRequired: false, pixReceiptApproved: false },
    pricing: { subtotal: 0, deliveryFee: 0, discount: 0, total: 0 },
    revalidation: { checkedAt: '', ok: true, issues: [] },
    requirements: [minimalRequirement], readyForConfirmation: false, confirmationAction: null, requiresReview: false, order: null,
  });
  assert.ok(presentation.payload.text && presentation.payload.text.trim().length > 0, `requirement type ${type} must render non-empty text`);
}

for (const name of snapshotFixtureNames) {
  const snapshot = parseOrderingSnapshotWire(loadFixture(name));
  const presentation = presentOrderingRequirements(snapshot);
  assert.ok(presentation.payload.text && presentation.payload.text.trim().length > 0, `${name} must render non-empty text`);
  if (snapshot.readyForConfirmation && snapshot.confirmationAction) {
    assert.doesNotMatch(presentation.payload.text, /Resumo do pedido:\s*$/, `${name}: must never send the empty "Resumo do pedido:" header`);
  }
}

// snapshotToDraft on every fixture must never leak deliveryFee/type:null either.
for (const name of snapshotFixtureNames) {
  const snapshot = parseOrderingSnapshotWire(loadFixture(name));
  const draft = snapshotToDraft(snapshot);
  if (draft.fulfillment) {
    assert.equal((draft.fulfillment as Record<string, unknown>).deliveryFee, undefined, `${name}: snapshotToDraft must never leak deliveryFee`);
    assert.notEqual(draft.fulfillment.type, null, `${name}: snapshotToDraft must never leak fulfillment.type:null`);
  } else {
    assert.equal(sanitizeFulfillmentForWire(snapshot.fulfillment), undefined);
  }
}

console.log('zeloMenuWireContract tests passed');
