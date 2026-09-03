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

console.log('orderingPatchPlanner tests passed');
