import assert from 'node:assert/strict';
import { COMMITTED_ORDER_STATUSES } from '../server/customers/orderingContext.js';
import { createSupabaseCustomerOrderingContextAdapter } from '../server/customers/orderingContextAdapter.js';

type QueryCall = { method: string; args: unknown[] };

class RecordingQuery implements PromiseLike<{ data: unknown; error: null }> {
  calls: QueryCall[] = [];
  constructor(private readonly response: { data: unknown; error: null }) {}
  select(...args: unknown[]) { this.calls.push({ method: 'select', args }); return this; }
  eq(...args: unknown[]) { this.calls.push({ method: 'eq', args }); return this; }
  in(...args: unknown[]) { this.calls.push({ method: 'in', args }); return this; }
  order(...args: unknown[]) { this.calls.push({ method: 'order', args }); return this; }
  limit(...args: unknown[]) { this.calls.push({ method: 'limit', args }); return this; }
  maybeSingle() { this.calls.push({ method: 'maybeSingle', args: [] }); return Promise.resolve(this.response); }
  upsert(...args: unknown[]) { this.calls.push({ method: 'upsert', args }); return Promise.resolve(this.response); }
  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.response).then(onfulfilled, onrejected);
  }
}

const queries: Array<{ table: string; query: RecordingQuery }> = [];
const responses: Record<string, unknown> = {
  zelo_orders: [],
  zelochat_customer_relationships: { ordering_overrides: { paymentMethod: 'Pix' } },
  pessoas: { id: 'person-1' },
};
const db = {
  from(table: string) {
    const query = new RecordingQuery({ data: responses[table] ?? null, error: null });
    queries.push({ table, query });
    return query;
  },
};
const adapter = createSupabaseCustomerOrderingContextAdapter(() => db as never);

await adapter.listCommittedOrders({ empresaId: 'empresa-1', pessoaId: 'person-1', limit: 20, statuses: COMMITTED_ORDER_STATUSES });
const orderQuery = queries[0];
assert.equal(orderQuery.table, 'zelo_orders');
assert.match(String(orderQuery.query.calls.find((call) => call.method === 'select')?.args[0]), /zelo_order_items\(id,product_id,name,unit_price,quantity,subtotal,modifiers,position\)/u);
assert.deepEqual(orderQuery.query.calls.filter((call) => call.method === 'eq').map((call) => call.args), [
  ['empresa_id', 'empresa-1'],
  ['pessoa_id', 'person-1'],
]);
assert.deepEqual(orderQuery.query.calls.find((call) => call.method === 'in')?.args, ['status', COMMITTED_ORDER_STATUSES]);
assert.deepEqual(orderQuery.query.calls.filter((call) => call.method === 'order').map((call) => call.args), [
  ['created_at', { ascending: false }],
  ['id', { ascending: false }],
]);
assert.deepEqual(orderQuery.query.calls.find((call) => call.method === 'limit')?.args, [20]);

assert.deepEqual(await adapter.getOrderingOverrides({ empresaId: 'empresa-1', pessoaId: 'person-1' }), { paymentMethod: 'Pix' });
const overridesQuery = queries[1];
assert.equal(overridesQuery.table, 'zelochat_customer_relationships');
assert.deepEqual(overridesQuery.query.calls.filter((call) => call.method === 'eq').map((call) => call.args), [
  ['empresa_id', 'empresa-1'],
  ['pessoa_id', 'person-1'],
]);

assert.equal(await adapter.customerBelongsToTenant({ empresaId: 'empresa-1', pessoaId: 'person-1', ownerUserId: 'owner-1' }), true);
const personQuery = queries[2];
assert.equal(personQuery.table, 'pessoas');
assert.deepEqual(personQuery.query.calls.filter((call) => call.method === 'eq').map((call) => call.args), [
  ['id', 'person-1'],
  ['id_usuario', 'owner-1'],
  ['tipo', 'cliente'],
]);

await adapter.saveOrderingOverrides({
  empresaId: 'empresa-1',
  pessoaId: 'person-1',
  ownerUserId: 'owner-1',
  overrides: { fulfillmentType: 'pickup' },
});
const saveQuery = queries[3];
assert.equal(saveQuery.table, 'zelochat_customer_relationships');
assert.deepEqual(saveQuery.query.calls.find((call) => call.method === 'upsert')?.args, [
  {
    empresa_id: 'empresa-1',
    id_usuario: 'owner-1',
    pessoa_id: 'person-1',
    ordering_overrides: { fulfillmentType: 'pickup' },
  },
  { onConflict: 'empresa_id,pessoa_id' },
]);

console.log('customerOrderingContextAdapter: ok');
