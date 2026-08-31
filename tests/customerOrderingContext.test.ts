import assert from 'node:assert/strict';
import {
  COMMITTED_ORDER_STATUSES,
  createCustomerOrderingContext,
  isOrderingOverridesValidationError,
  type CustomerOrderingContextAdapter,
  type CustomerOrderingOrderRow,
  type CustomerOrderingOverrides,
} from '../server/customers/orderingContext.js';

const EMPRESA_ID = 'empresa-1';
const PESSOA_ID = 'pessoa-1';
const OWNER_USER_ID = 'owner-1';

function order(
  id: string,
  createdAt: string,
  overrides: Partial<CustomerOrderingOrderRow> = {},
): CustomerOrderingOrderRow {
  return {
    id,
    empresa_id: EMPRESA_ID,
    pessoa_id: PESSOA_ID,
    status: 'accepted',
    created_at: createdAt,
    closed_at: null,
    fulfillment: {
      type: 'delivery',
      pickupDate: createdAt.slice(0, 10),
      pickupTime: '18:30',
      deliveryAddress: 'Rua das Flores, 10',
      deliveryNeighborhood: 'Centro',
    },
    payment: { declaredMethod: 'Pix' },
    subtotal: 20,
    delivery_fee: 5,
    discount: 0,
    total: 25,
    observations: null,
    customer: {},
    zelo_order_items: [{
      id: `item-${id}`,
      product_id: 10,
      name: 'X-Burger',
      unit_price: 20,
      quantity: 1,
      subtotal: 20,
      modifiers: [],
      position: 0,
    }],
    ...overrides,
  };
}

class MemoryAdapter implements CustomerOrderingContextAdapter {
  orders: CustomerOrderingOrderRow[] = [];
  overrides: CustomerOrderingOverrides = {};
  belongs = true;
  listInputs: Array<{ empresaId: string; pessoaId: string; limit: number; statuses: readonly string[] }> = [];
  saved: CustomerOrderingOverrides[] = [];

  async listCommittedOrders(input: { empresaId: string; pessoaId: string; limit: number; statuses: readonly string[] }) {
    this.listInputs.push(input);
    return this.orders;
  }

  async getOrderingOverrides() { return this.overrides; }

  async patchOrderingOverridesAtomically(input: { patch: Record<string, unknown> }) {
    if (!this.belongs) throw new Error('CUSTOMER_NOT_FOUND');
    const next = { ...this.overrides } as Record<string, unknown>;
    for (const [key, value] of Object.entries(input.patch)) {
      if (value === null) delete next[key];
      else next[key] = value;
    }
    this.overrides = next as CustomerOrderingOverrides;
    this.saved.push(this.overrides);
    return this.overrides;
  }
}

class ConcurrentReadAdapter extends MemoryAdapter {
  private concurrentReads = 0;
  private releaseReads!: () => void;
  private readonly readsReleased = new Promise<void>((resolve) => { this.releaseReads = resolve; });

  override async getOrderingOverrides() {
    if (this.concurrentReads >= 2) return this.overrides;
    const staleSnapshot = { ...this.overrides };
    this.concurrentReads += 1;
    if (this.concurrentReads === 2) this.releaseReads();
    await this.readsReleased;
    return staleSnapshot;
  }
}

{
  const adapter = new MemoryAdapter();
  const context = createCustomerOrderingContext(adapter);
  const snapshot = await context.get({ empresaId: EMPRESA_ID, pessoaId: PESSOA_ID });

  assert.deepEqual(snapshot.fulfillmentType, { value: null, source: 'none' });
  assert.deepEqual(snapshot.deliveryAddress, { value: null, source: 'none' });
  assert.deepEqual(snapshot.paymentMethod, { value: null, source: 'none' });
  assert.deepEqual(snapshot.habitualTime, { value: null, source: 'none' });
  assert.deepEqual(snapshot.medianRecurrenceDays, { value: null, source: 'none' });
  assert.deepEqual(snapshot.frequentItems, { value: [], source: 'none' });
  assert.deepEqual(snapshot.lastOrder, { value: null, source: 'none' });
  assert.deepEqual(snapshot.overrides, {});
  assert.deepEqual(adapter.listInputs[0], {
    empresaId: EMPRESA_ID,
    pessoaId: PESSOA_ID,
    limit: 20,
    statuses: COMMITTED_ORDER_STATUSES,
  });
}

{
  const adapter = new ConcurrentReadAdapter();
  const context = createCustomerOrderingContext(adapter);
  await Promise.all([
    context.patchOverrides({ empresaId: EMPRESA_ID, pessoaId: PESSOA_ID, ownerUserId: OWNER_USER_ID, patch: { paymentMethod: 'Pix' } }),
    context.patchOverrides({ empresaId: EMPRESA_ID, pessoaId: PESSOA_ID, ownerUserId: OWNER_USER_ID, patch: { habitualTime: '20:15' } }),
  ]);
  const snapshot = await context.get({ empresaId: EMPRESA_ID, pessoaId: PESSOA_ID });
  assert.deepEqual(snapshot.overrides, { paymentMethod: 'Pix', habitualTime: '20:15' }, 'concurrent partial patches must preserve both fields');
}

{
  const adapter = new MemoryAdapter();
  adapter.orders = [order('latest', '2026-08-20T21:30:00.000Z', {
    customer: { name: 'Ana', phone: '5511999999999', loyalty: { tier: 'ouro' } },
    fulfillment: {
      type: 'delivery', pickupDate: '2026-08-20', pickupTime: '18:30', asap: true,
      deliveryAddress: 'Rua das Flores, 10', deliveryNeighborhood: 'Centro', deliveryInstructions: 'Portão azul',
    },
    payment: { declaredMethod: 'Pix', pixReceiptRequired: true, pixReceiptApproved: true, reconciliation: { attempt: 2 } },
    zelo_order_items: [{
      id: 'item-latest', product_id: 10, name: 'X-Burger especial', unit_price: 20,
      quantity: 2, subtotal: 40, position: 0,
      modifiers: [{ groupId: 'g1', groupName: 'Adicionais', kind: 'adicional', selectedOptions: [{ optionId: 'o1', optionName: 'Bacon', priceDelta: 3, quantity: 1 }] }],
    }],
  })];
  const snapshot = await createCustomerOrderingContext(adapter).get({ empresaId: EMPRESA_ID, pessoaId: PESSOA_ID });

  assert.deepEqual(snapshot.fulfillmentType, { value: 'delivery', source: 'last_order' });
  assert.equal(snapshot.deliveryAddress.source, 'last_order');
  assert.equal(snapshot.deliveryAddress.value?.display, 'Rua das Flores, 10 — Centro');
  assert.deepEqual(snapshot.paymentMethod, { value: 'Pix', source: 'last_order' });
  assert.deepEqual(snapshot.habitualTime, { value: null, source: 'none' }, 'one time sample must not invent a habit');
  assert.deepEqual(snapshot.medianRecurrenceDays, { value: null, source: 'none' });
  assert.equal(snapshot.frequentItems.source, 'derived');
  assert.deepEqual(snapshot.frequentItems.value[0], { productId: '10', name: 'X-Burger especial', orderFrequency: 1, totalQuantity: 2 });
  assert.equal(snapshot.lastOrder.source, 'last_order');
  assert.equal(snapshot.lastOrder.value?.items[0].modifiers[0].options[0].name, 'Bacon');
  assert.deepEqual(snapshot.lastOrder.value?.customer, { name: 'Ana', phone: '5511999999999', loyalty: { tier: 'ouro' } });
  assert.equal(snapshot.lastOrder.value?.fulfillment.asap, true);
  assert.equal(snapshot.lastOrder.value?.fulfillment.deliveryInstructions, 'Portão azul');
  assert.deepEqual(snapshot.lastOrder.value?.payment.reconciliation, { attempt: 2 });
  assert.deepEqual((snapshot as unknown as Record<string, unknown>).defaultItems, undefined, 'frequent items are context, never automatic defaults');
}

{
  const adapter = new MemoryAdapter();
  const committed = Array.from({ length: 21 }, (_, index) => order(
    `order-${index + 1}`,
    `2026-08-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
    index === 0 ? { zelo_order_items: [{ id: 'old-only', product_id: 999, name: 'Fora do limite', unit_price: 1, quantity: 9, subtotal: 9, modifiers: [], position: 0 }] } : {},
  ));
  adapter.orders = [
    ...committed,
    order('foreign-company', '2026-08-30T12:00:00.000Z', { empresa_id: 'empresa-2' }),
    order('foreign-person', '2026-08-29T12:00:00.000Z', { pessoa_id: 'pessoa-2' }),
    order('pending-payment', '2026-08-28T12:00:00.000Z', { status: 'pending_payment' }),
    order('pending-review', '2026-08-27T12:00:00.000Z', { status: 'pending_review' }),
    order('rejected', '2026-08-26T12:00:00.000Z', { status: 'rejected' }),
    order('cancelled', '2026-08-25T12:00:00.000Z', { status: 'cancelled' }),
  ];
  const snapshot = await createCustomerOrderingContext(adapter).get({ empresaId: EMPRESA_ID, pessoaId: PESSOA_ID });

  assert.equal(snapshot.lastOrder.value?.id, 'order-21');
  assert.equal(snapshot.frequentItems.value.some((item) => item.productId === '999'), false, 'the 21st committed order cannot influence habits');
  assert.equal(snapshot.frequentItems.value[0].orderFrequency, 20, 'only the twenty newest committed orders are aggregated');
}

{
  const adapter = new MemoryAdapter();
  adapter.orders = [
    order('d1', '2026-08-01T12:00:00.000Z'),
    order('d3', '2026-08-03T12:00:00.000Z'),
    order('d7', '2026-08-07T12:00:00.000Z'),
  ];
  const evenIntervals = await createCustomerOrderingContext(adapter).get({ empresaId: EMPRESA_ID, pessoaId: PESSOA_ID });
  assert.deepEqual(evenIntervals.medianRecurrenceDays, { value: 3, source: 'derived' });

  adapter.orders = [
    order('d1', '2026-08-01T12:00:00.000Z'),
    order('d2', '2026-08-02T12:00:00.000Z'),
    order('d5', '2026-08-05T12:00:00.000Z'),
    order('d13', '2026-08-13T12:00:00.000Z'),
  ];
  const oddIntervals = await createCustomerOrderingContext(adapter).get({ empresaId: EMPRESA_ID, pessoaId: PESSOA_ID });
  assert.deepEqual(oddIntervals.medianRecurrenceDays, { value: 3, source: 'derived' });
}

{
  const adapter = new MemoryAdapter();
  adapter.orders = [
    order('new', '2026-08-03T19:00:00.000Z', { fulfillment: { type: 'delivery', pickupTime: '19:00', deliveryAddress: 'Rua das Flores, 10' }, zelo_order_items: [
      { id: 'n2', product_id: 2, name: 'Nome mais novo', unit_price: 1, quantity: 1, subtotal: 1, modifiers: [], position: 1 },
      { id: 'n1', product_id: 1, name: 'Produto um', unit_price: 1, quantity: 1, subtotal: 1, modifiers: [], position: 0 },
    ] }),
    order('middle', '2026-08-02T18:00:00.000Z', { fulfillment: { type: 'delivery', pickupTime: '18:00', deliveryAddress: 'Rua das Flores, 10' }, zelo_order_items: [
      { id: 'm2', product_id: 2, name: 'Nome antigo', unit_price: 1, quantity: 2, subtotal: 2, modifiers: [], position: 0 },
      { id: 'm3', product_id: 3, name: 'Produto três', unit_price: 1, quantity: 4, subtotal: 4, modifiers: [], position: 1 },
    ] }),
    order('old', '2026-08-01T17:00:00.000Z', { fulfillment: { type: 'delivery', pickupTime: '17:00', deliveryAddress: 'Rua das Flores, 10' }, zelo_order_items: [
      { id: 'o1', product_id: 1, name: 'Produto um antigo', unit_price: 1, quantity: 2, subtotal: 2, modifiers: [], position: 0 },
      { id: 'o3', product_id: 3, name: 'Produto três antigo', unit_price: 1, quantity: 1, subtotal: 1, modifiers: [], position: 1 },
    ] }),
  ];
  const snapshot = await createCustomerOrderingContext(adapter).get({ empresaId: EMPRESA_ID, pessoaId: PESSOA_ID });
  assert.deepEqual(snapshot.frequentItems.value, [
    { productId: '3', name: 'Produto três', orderFrequency: 2, totalQuantity: 5 },
    { productId: '1', name: 'Produto um', orderFrequency: 2, totalQuantity: 3 },
    { productId: '2', name: 'Nome mais novo', orderFrequency: 2, totalQuantity: 3 },
  ]);
  assert.deepEqual(snapshot.habitualTime, { value: { minutes: 1080, label: '18:00' }, source: 'derived' });
}

{
  const adapter = new MemoryAdapter();
  adapter.orders = [
    order('before-midnight', '2026-08-02T23:50:00.000Z', { fulfillment: { type: 'pickup', pickupTime: '23:50' } }),
    order('after-midnight', '2026-08-01T00:10:00.000Z', { fulfillment: { type: 'pickup', pickupTime: '00:10' } }),
  ];
  const snapshot = await createCustomerOrderingContext(adapter).get({ empresaId: EMPRESA_ID, pessoaId: PESSOA_ID });
  assert.deepEqual(snapshot.habitualTime, { value: { minutes: 0, label: '00:00' }, source: 'derived' }, 'habitual time must use a circular median across midnight');
}

{
  const adapter = new MemoryAdapter();
  adapter.orders = [order('latest', '2026-08-20T12:00:00.000Z')];
  adapter.overrides = {
    fulfillmentType: 'pickup',
    deliveryAddress: { address: 'Av. Brasil, 100', neighborhood: 'Centro' },
    paymentMethod: 'Dinheiro',
    habitualTime: '20:15',
  };
  const context = createCustomerOrderingContext(adapter);
  const snapshot = await context.get({ empresaId: EMPRESA_ID, pessoaId: PESSOA_ID });
  assert.deepEqual(snapshot.fulfillmentType, { value: 'pickup', source: 'fixed' });
  assert.equal(snapshot.deliveryAddress.source, 'fixed');
  assert.equal(snapshot.deliveryAddress.value?.display, 'Av. Brasil, 100 — Centro');
  assert.deepEqual(snapshot.paymentMethod, { value: 'Dinheiro', source: 'fixed' });
  assert.deepEqual(snapshot.habitualTime, { value: { minutes: 1215, label: '20:15' }, source: 'fixed' });

  const updated = await context.patchOverrides({
    empresaId: EMPRESA_ID,
    pessoaId: PESSOA_ID,
    ownerUserId: OWNER_USER_ID,
    patch: { fulfillmentType: null, paymentMethod: ' Cartão ' },
  });
  assert.deepEqual(adapter.saved[0], {
    deliveryAddress: {
      address: 'Av. Brasil, 100', neighborhood: 'Centro',
    },
    paymentMethod: 'Cartão',
    habitualTime: '20:15',
  });
  assert.deepEqual(updated.fulfillmentType, { value: 'delivery', source: 'last_order' });
  assert.deepEqual(updated.paymentMethod, { value: 'Cartão', source: 'fixed' });
}

{
  const adapter = new MemoryAdapter();
  const context = createCustomerOrderingContext(adapter);
  adapter.belongs = false;
  await assert.rejects(
    context.patchOverrides({ empresaId: EMPRESA_ID, pessoaId: PESSOA_ID, ownerUserId: OWNER_USER_ID, patch: { paymentMethod: 'Pix' } }),
    /CUSTOMER_NOT_FOUND/,
  );
  adapter.belongs = true;
  for (const invalid of [
    { admin: true },
    { fulfillmentType: 'table' },
    { habitualTime: '25:70' },
    { paymentMethod: '' },
    { deliveryAddress: { address: '', neighborhood: 'Centro' } },
  ]) {
    await assert.rejects(
      context.patchOverrides({ empresaId: EMPRESA_ID, pessoaId: PESSOA_ID, ownerUserId: OWNER_USER_ID, patch: invalid }),
      (error: unknown) => isOrderingOverridesValidationError(error),
    );
  }
}

console.log('customerOrderingContext: ok');
