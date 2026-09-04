import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { presentOrderingRequirements, type OrderingReplyPayload } from '../src/domain/orderingRequirementPresenter.js';
import { parseOrderingButton, type OrderingRequirementKind, type OrderingSnapshot } from '../src/domain/aiWhatsAppOrdering.js';
import { validateOutboundPayload, type OutboundPayload } from '../src/domain/outbound.js';
import { parseOrderingSnapshotWire } from '../server/zeloMenuOrderingWire.js';

const fixturesDir = new URL('./fixtures/zelomenu-wire/v1/', import.meta.url);
const loadFixture = (name: string): unknown => JSON.parse(readFileSync(new URL(name, fixturesDir), 'utf8'));

/** Mirrors `presentationPayload` in `server/aiWhatsAppOrdering.ts` (list.text -> body). */
function toOutbound(payload: OrderingReplyPayload): OutboundPayload {
  if (payload.kind !== 'list') return payload;
  return { kind: 'list', body: payload.text, buttonText: payload.buttonText, sections: payload.sections };
}

const base = {
  orderingId: 'o', empresaId: 'e', remoteJid: 'j', state: 'cart_open', revision: 1,
  cart: { items: [] }, customer: {}, fulfillment: { type: 'pickup' as const, asap: true },
  payment: { pixReceiptRequired: false, pixReceiptApproved: false }, pricing: { subtotal: 0, deliveryFee: 0, discount: 0, total: 0 },
  revalidation: { checkedAt: '', ok: true, issues: [] }, confirmationAction: null, requiresReview: false, order: null,
} satisfies Omit<OrderingSnapshot, 'requirements' | 'readyForConfirmation'>;

// --- CT #1/#2/#3, PR C-7: real ZeloMenu wire shapes, parsed by the real
// adapter (`parseOrderingSnapshotWire`), must render a non-empty, valid
// prompt — not `undefined`, not a crash. This is the exact regression the
// old test double (hand-built `kind`/`label` requirements) could never
// catch.
const partial = parseOrderingSnapshotWire(loadFixture('snapshot.partial-montavel.json'));
const firstBlocking = presentOrderingRequirements(partial);
assert.equal(firstBlocking.payload.kind, 'buttons', 'the first blocking modifier_group (2 options) renders as buttons from the REAL wire shape');
assert.equal(validateOutboundPayload(toOutbound(firstBlocking.payload)), null, 'presenter payload for a real fixture must pass outbound validation');
if (firstBlocking.payload.kind === 'buttons') {
  assert.equal(firstBlocking.payload.buttons.length, 2);
  for (const button of firstBlocking.payload.buttons) {
    const parsed = parseOrderingButton(button.id);
    assert.equal(parsed?.kind, 'requirement', `button id ${button.id} must round-trip through parseOrderingButton`);
  }
}

// --- PR C-2: a snapshot missing `requirements` entirely must never throw —
// falls back to "nothing left to ask" instead of a TypeError deep in the
// presenter.
const missingRequirements = presentOrderingRequirements({ ...base, requirements: undefined, readyForConfirmation: false });
assert.equal(missingRequirements.payload.kind, 'text');

// --- CT #3 / PR 1.28: requirement ids containing ':' (ZeloMenu's real
// `${lineId}:${groupId}` shape) must survive the button id round trip, and
// the id must be bound to the orderingId/revision it was minted for so a
// stale tap is detectable.
{
  const snapshot = {
    ...base, orderingId: 'ord-1', revision: 5, readyForConfirmation: false,
    requirements: [{
      id: 'linha-7:g3', lineId: 'linha-7', groupId: 'g3', type: 'modifier_group' as const, label: 'Escolha o molho', blocking: true,
      kind: 'adicional' as const, minSelections: 1, maxSelections: 1,
      options: [
        { id: 'o9', name: 'Molho branco', priceDelta: 0, available: true },
        { id: 'o10', name: 'Molho vermelho', priceDelta: 0, available: true },
      ],
    }],
  };
  const presentation = presentOrderingRequirements(snapshot);
  assert.equal(presentation.payload.kind, 'buttons');
  if (presentation.payload.kind === 'buttons') {
    const parsed = parseOrderingButton(presentation.payload.buttons[0].id);
    assert.deepEqual(parsed && { requirementId: parsed.kind === 'requirement' ? parsed.requirementId : null, optionId: parsed.kind === 'requirement' ? parsed.optionId : null }, {
      requirementId: 'linha-7:g3', optionId: 'o9',
    });
    // A tap built for a DIFFERENT revision must not carry a matching fingerprint.
    const staleSnapshot = { ...snapshot, revision: 6 };
    const stalePresentation = presentOrderingRequirements(staleSnapshot);
    assert.equal(stalePresentation.payload.kind, 'buttons');
    const staleButtonId = stalePresentation.payload.kind === 'buttons' ? stalePresentation.payload.buttons[0].id : '';
    assert.notEqual(staleButtonId, presentation.payload.buttons[0].id, 'a different revision must mint a different button id');
  }
}

// --- PR C-1: a realistic modifier label with a price delta must never
// exceed the outbound caps (button label 20, list row/section title 24) —
// the design spec's own worked example, "Bife acebolado (+R$ 12,00)" (26
// chars), used to fail `validateOutboundPayload` and escalate every time.
{
  const snapshot = {
    ...base, readyForConfirmation: false,
    requirements: [{
      id: 'linha-1:g5', lineId: 'linha-1', groupId: 'g5', type: 'modifier_group' as const, label: 'Escolha as proteínas', blocking: true,
      kind: 'adicional' as const, minSelections: 1, maxSelections: 1,
      options: [
        { id: 'p1', name: 'Bife acebolado', priceDelta: 12, available: true },
        { id: 'p2', name: 'Frango grelhado', priceDelta: 10, available: true },
      ],
    }],
  };
  const presentation = presentOrderingRequirements(snapshot);
  assert.equal(presentation.payload.kind, 'buttons');
  if (presentation.payload.kind === 'buttons') {
    assert.equal(validateOutboundPayload(toOutbound(presentation.payload)), null);
    assert.ok(presentation.payload.buttons.every((button) => button.label.length <= 20), 'button labels never exceed 20 chars');
    assert.ok(!presentation.payload.buttons.some((button) => button.label.includes('R$')), 'price never lives in the button label');
    assert.match(presentation.payload.text, /R\$\s*12,00/, 'price is still communicated, in the body text');
  }
}

// List rows: title capped at 24, price moved to `description`.
{
  const longName = 'Filé de corvina empanado e frito à moda da casa';
  const snapshot = {
    ...base, readyForConfirmation: false,
    requirements: [{
      id: 'linha-1:g6', lineId: 'linha-1', groupId: 'g6', type: 'modifier_group' as const, label: 'Escolha a proteína', blocking: true,
      kind: 'adicional' as const, minSelections: 1, maxSelections: 1,
      options: Array.from({ length: 4 }, (_, index) => ({ id: `o${index}`, name: index === 0 ? longName : `Opção ${index}`, priceDelta: index === 0 ? 5 : 0, available: true })),
    }],
  };
  const presentation = presentOrderingRequirements(snapshot);
  assert.equal(presentation.payload.kind, 'list');
  if (presentation.payload.kind === 'list') {
    assert.equal(validateOutboundPayload(toOutbound(presentation.payload)), null);
    const firstRow = presentation.payload.sections[0].rows[0];
    assert.ok(firstRow.title.length <= 24, 'list row title never exceeds 24 chars');
    assert.equal(firstRow.description, '+ R$ 5,00', 'price lives in the row description, not the title');
  }
}

// --- PR I-12: optional groups must never truncate their option list —
// Incident XXVIII was exactly this ("omitiu misturas e acompanhamentos").
{
  const manyOptions = Array.from({ length: 8 }, (_, index) => ({ id: `e${index}`, name: `Extra ${index + 1}`, priceDelta: 0, available: true }));
  const optional = presentOrderingRequirements({
    ...base, readyForConfirmation: false,
    requirements: [{ id: 'extra', type: 'modifier_group' as const, label: 'Extras', blocking: false, kind: 'adicional' as const, options: manyOptions }],
  });
  assert.equal(optional.payload.kind, 'text');
  assert.deepEqual(optional.offeredOptionalRequirementIds, ['extra']);
  for (const option of manyOptions) {
    assert.ok(optional.payload.kind === 'text' && optional.payload.text.includes(option.name), `option ${option.name} must not be hidden`);
  }
}

// --- payment_method with no options[] (the real wire shape) asks in plain text.
{
  const payment = presentOrderingRequirements({
    ...base, readyForConfirmation: false,
    requirements: [{ id: 'payment_method', type: 'payment_method' as const, label: 'Escolha a forma de pagamento.', blocking: true }],
  });
  assert.equal(payment.payload.kind, 'text');
  assert.equal(payment.payload.text, 'Escolha a forma de pagamento.');
}

// --- fulfillment_type uses the REAL requirement id ("fulfillment_type"),
// not the old brittle hardcoded "REQ:fulfillment:*" special case.
{
  const fulfillment = presentOrderingRequirements({
    ...base, orderingId: 'ord-9', revision: 3, readyForConfirmation: false,
    requirements: [{ id: 'fulfillment_type', type: 'fulfillment_type' as const, label: 'Escolha entrega ou retirada.', blocking: true }],
  });
  assert.equal(fulfillment.payload.kind, 'buttons');
  if (fulfillment.payload.kind === 'buttons') {
    const deliveryAction = parseOrderingButton(fulfillment.payload.buttons[0].id);
    assert.equal(deliveryAction?.kind, 'requirement');
    assert.equal(deliveryAction?.kind === 'requirement' && deliveryAction.requirementId, 'fulfillment_type');
    assert.equal(deliveryAction?.kind === 'requirement' && deliveryAction.optionId, 'delivery');
  }
}

// --- unknown/forward-compat requirement type never renders empty text.
{
  const unknown = presentOrderingRequirements({
    ...base, readyForConfirmation: false,
    requirements: [{ id: 'future_thing', type: 'future_requirement_type' as unknown as OrderingRequirementKind, label: 'Um novo tipo de pergunta', blocking: true }],
  });
  assert.equal(unknown.payload.kind, 'text');
  assert.equal(unknown.payload.text, 'Um novo tipo de pergunta');
}

// --- summary uses `renderOrderingSummary`, never a non-existent `summaryText`.
{
  const ready = presentOrderingRequirements({
    ...base, requirements: [], readyForConfirmation: true,
    confirmationAction: { type: 'confirm_order', token: 'tok', revision: 1, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    cart: { items: [{ productId: 1, productName: 'Marmita', baseUnitPrice: 20, selectedModifiers: [], modifierDeltaTotal: 0, quantity: 1, unitPrice: 20, lineTotal: 20 }] },
    pricing: { subtotal: 20, deliveryFee: 0, discount: 0, total: 20 },
  });
  assert.equal(ready.payload.kind, 'buttons');
  if (ready.payload.kind === 'buttons') {
    assert.match(ready.payload.text, /Resumo:/);
    assert.doesNotMatch(ready.payload.text, /Resumo do pedido:\s*$/);
    assert.deepEqual(ready.payload.buttons.map((button) => button.label), ['Confirmar', 'Alterar', 'Cancelar']);
  }
}

console.log('orderingRequirementPresenter tests passed');
