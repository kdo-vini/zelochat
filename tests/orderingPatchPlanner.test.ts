import assert from 'node:assert/strict';
import { applyConversationOrderPatch, validateConversationOrderPatch } from '../server/orderingPatchPlanner.js';
import type { CatalogReplyResult, OrderingSnapshot } from '../src/domain/aiWhatsAppOrdering.js';

const catalog: CatalogReplyResult = { total: 1, ambiguous: false, results: [{ productId: 1001, publicName: 'Massa', currentPrice: 22, matchReason: 'name', ambiguous: false, modifierGroups: [{ id: 'g1', name: 'Massa', options: [{ id: 'o1', name: 'Talharim', priceDelta: 0 }] }, { id: 'g2', name: 'Molho', options: [{ id: 'o2', name: 'Branco', priceDelta: 0 }] }] }] };
const patch = { items: [{ productId: 1001, quantity: 1, selectedOptions: [{ groupId: 'g1', optionSelections: [{ optionId: 'o1', quantity: 1 }] }, { groupId: 'g2', optionSelections: [{ optionId: 'o2', quantity: 1 }] }] }] };
assert.equal(validateConversationOrderPatch(patch, catalog, null), true);
assert.equal(validateConversationOrderPatch({ items: [{ ...patch.items[0], selectedOptions: [{ groupId: 'g1', optionSelections: [{ optionId: 'wrong', quantity: 1 }] }] }] }, catalog, null), false);
const draft = applyConversationOrderPatch(null, patch);
assert.equal(draft.items[0].lineId, 'line-1001-1');
const current = { cart: { items: [{ lineId: 'line-1001-1', productId: 1001, quantity: 1, notes: undefined, selectedModifiers: [], productName: 'Massa', baseUnitPrice: 22, modifierDeltaTotal: 0, unitPrice: 22, lineTotal: 22 }] } } as OrderingSnapshot;
assert.equal(applyConversationOrderPatch(current, patch).items.length, 2, 'a new matching product gets a distinct stable line');

// PR I-13: a quantity-only patch on an EXISTING line (referenced by lineId,
// no selectedOptions at all) must keep that line's current modifier
// selections — it must not wipe misturas/molhos/paid add-ons.
{
  const withModifiers = {
    cart: { items: [{
      lineId: 'linha-1', productId: 1001, quantity: 2, notes: undefined, productName: 'Massa',
      baseUnitPrice: 22, modifierDeltaTotal: 3, unitPrice: 25, lineTotal: 50,
      selectedModifiers: [{ groupId: 'g1', groupName: 'Massa', kind: 'variacao', selectedOptions: [{ optionId: 'o1', optionName: 'Talharim', priceDelta: 0, quantity: 1 }] }, { groupId: 'g5', groupName: 'Extra', kind: 'adicional', selectedOptions: [{ optionId: 'e1', optionName: 'Queijo', priceDelta: 3, quantity: 1 }] }],
    }] },
  } as OrderingSnapshot;
  const quantityOnlyPatch = { items: [{ lineId: 'linha-1', productId: 1001, quantity: 3 }] };
  const result = applyConversationOrderPatch(withModifiers, quantityOnlyPatch);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].quantity, 3);
  assert.deepEqual(
    (result.items[0].selectedOptions ?? []).map((group) => group.groupId).sort(),
    ['g1', 'g5'],
    'a quantity-only patch must preserve every previously selected modifier group',
  );

  // An EXPLICIT (even empty) selectedOptions is still a deliberate full
  // replace, not a merge — the model can still clear a line on purpose.
  const explicitClear = applyConversationOrderPatch(withModifiers, { items: [{ lineId: 'linha-1', productId: 1001, quantity: 1, selectedOptions: [] }] });
  assert.deepEqual(explicitClear.items[0].selectedOptions, []);
}

// CT Important 5: `removedLineIds` must actually drop the line from BOTH the
// untouched set and the merged set (repeat the request idempotently).
{
  const twoLines = {
    cart: { items: [
      { lineId: 'linha-1', productId: 1001, quantity: 1, notes: undefined, productName: 'Massa', baseUnitPrice: 22, modifierDeltaTotal: 0, unitPrice: 22, lineTotal: 22, selectedModifiers: [] },
      { lineId: 'linha-2', productId: 1002, quantity: 1, notes: undefined, productName: 'Refrigerante', baseUnitPrice: 6, modifierDeltaTotal: 0, unitPrice: 6, lineTotal: 6, selectedModifiers: [] },
    ] },
  } as OrderingSnapshot;
  const removed = applyConversationOrderPatch(twoLines, { items: [], removedLineIds: ['linha-2'] });
  assert.deepEqual(removed.items.map((item) => item.lineId), ['linha-1']);
  assert.deepEqual(removed.removedLineIds, ['linha-2']);
}

// CT #4/#5/#8: falling back to `current` for fulfillment/customer must go
// through the wire sanitizer — never echo `deliveryFee`/`deliveryFeeToConfirm`,
// never send `fulfillment.type: null`, never send an unknown customer name.
{
  const snapshotWithRejectedFields = {
    cart: { items: [] },
    customer: { name: null, phone: '5511999998888' },
    fulfillment: { type: null, asap: true, deliveryFee: 8, deliveryFeeToConfirm: false },
    payment: { declaredMethod: null, pixReceiptRequired: false, pixReceiptApproved: false },
  } as unknown as OrderingSnapshot;
  const fallback = applyConversationOrderPatch(snapshotWithRejectedFields, { items: [] });
  assert.equal(fallback.fulfillment, undefined, 'no fulfillment.type chosen yet -> omit fulfillment entirely, never type:null');
  assert.equal(fallback.customer, undefined, 'no customer name known -> omit customer entirely, never {name: null}');

  const snapshotWithChosenFulfillment = {
    cart: { items: [] },
    customer: { name: 'Ana', phone: '5511999998888' },
    fulfillment: { type: 'delivery', asap: true, deliveryAddress: 'Rua A', deliveryFee: 8, deliveryFeeToConfirm: true },
    payment: { declaredMethod: null, pixReceiptRequired: false, pixReceiptApproved: false },
  } as unknown as OrderingSnapshot;
  const fallback2 = applyConversationOrderPatch(snapshotWithChosenFulfillment, { items: [] });
  assert.deepEqual(fallback2.fulfillment, { type: 'delivery', asap: true, deliveryAddress: 'Rua A' });
  assert.deepEqual(fallback2.customer, { name: 'Ana' });
}

console.log('orderingPatchPlanner tests passed');
