import assert from 'node:assert/strict';
import { presentOrderingRequirements } from '../src/domain/orderingRequirementPresenter.js';
import type { OrderingSnapshot } from '../src/domain/aiWhatsAppOrdering.js';

const base = {
  orderingId: 'o', empresaId: 'e', remoteJid: 'j', state: 'cart_open', revision: 1,
  cart: { items: [] }, customer: {}, fulfillment: { type: 'pickup', asap: true },
  payment: { pixReceiptRequired: false, pixReceiptApproved: false }, pricing: { subtotal: 0, deliveryFee: 0, discount: 0, total: 0 },
  revalidation: { checkedAt: '', ok: true, issues: [] }, confirmationAction: null, requiresReview: false, order: null,
} satisfies Omit<OrderingSnapshot, 'requirements' | 'readyForConfirmation'>;
const buttons = presentOrderingRequirements({ ...base, requirements: [{ id: 'massa', lineId: 'l', groupId: 'g', kind: 'modifier_group', label: 'Escolha a massa', blocking: true, minSelections: 1, maxSelections: 1, options: ['A', 'B', 'C'].map((name, index) => ({ id: String(index), name, priceDelta: 0, available: true })) }] });
assert.equal(buttons.payload.kind, 'buttons');
assert.equal(buttons.payload.kind === 'buttons' && buttons.payload.buttons.length, 3);
const list = presentOrderingRequirements({ ...base, requirements: [{ id: 'molho', lineId: 'l', groupId: 'g', kind: 'modifier_group', label: 'Escolha o molho', blocking: true, minSelections: 1, maxSelections: 1, options: Array.from({ length: 4 }, (_, index) => ({ id: String(index), name: `M${index}`, priceDelta: 0, available: true })) }] });
assert.equal(list.payload.kind, 'list');
const optional = presentOrderingRequirements({ ...base, requirements: [{ id: 'extra', kind: 'modifier_group', label: 'Extras', blocking: false, options: [{ id: 'e', name: 'Bife', priceDelta: 12, available: true }] }] });
assert.equal(optional.payload.kind, 'text');
assert.deepEqual(optional.offeredOptionalRequirementIds, ['extra']);

console.log('orderingRequirementPresenter tests passed');
