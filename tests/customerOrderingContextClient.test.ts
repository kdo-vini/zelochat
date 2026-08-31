import assert from 'node:assert/strict';
import { normalizeCustomerOrderingContext } from '../src/services/customerApi.js';

const normalized = normalizeCustomerOrderingContext({
  fulfillmentType: { value: 'delivery', source: 'last_order' },
  deliveryAddress: {
    value: { address: 'Rua A, 10', neighborhood: 'Centro', display: 'Rua A, 10 — Centro' },
    source: 'fixed',
  },
  paymentMethod: { value: 'Pix', source: 'fixed' },
  habitualTime: { value: { minutes: 1110, label: '18:30' }, source: 'derived' },
  medianRecurrenceDays: { value: 7, source: 'derived' },
  frequentItems: { value: [{ productId: '10', name: 'X-Burger', orderFrequency: 3, totalQuantity: 5 }], source: 'derived' },
  lastOrder: { value: null, source: 'none' },
  overrides: { paymentMethod: 'Pix' },
});

assert.deepEqual(normalized.fulfillmentType, { value: 'delivery', source: 'last_order' });
assert.equal(normalized.deliveryAddress.value?.display, 'Rua A, 10 — Centro');
assert.deepEqual(normalized.paymentMethod, { value: 'Pix', source: 'fixed' });
assert.deepEqual(normalized.frequentItems.value[0], { productId: '10', name: 'X-Burger', orderFrequency: 3, totalQuantity: 5 });
assert.deepEqual(normalized.overrides, { paymentMethod: 'Pix' });

const malformed = normalizeCustomerOrderingContext({
  fulfillmentType: { value: 'mesa', source: 'root' },
  medianRecurrenceDays: { value: null, source: 'derived' },
  frequentItems: { value: 'raw-json', source: 'derived' },
  overrides: { role: 'admin' },
});
assert.deepEqual(malformed.fulfillmentType, { value: null, source: 'none' });
assert.deepEqual(malformed.medianRecurrenceDays, { value: null, source: 'none' });
assert.deepEqual(malformed.frequentItems, { value: [], source: 'none' });
assert.deepEqual(malformed.overrides, {});

console.log('customerOrderingContextClient: ok');
