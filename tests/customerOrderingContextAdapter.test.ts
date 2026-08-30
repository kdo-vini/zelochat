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
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
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
  async rpc(name: string, args: Record<string, unknown>) {
    rpcCalls.push({ name, args });
    return { data: { paymentMethod: 'Pix', habitualTime: '20:15' }, error: null };
  },
};
const adapter = createSupabaseCustomerOrderingContextAdapter(() => db as never);

await adapter.listCommittedOrders({ empresaId: 'empresa-1', pessoaId: 'person-1', limit: 20, statuses: COMMITTED_ORDER_STATUSES });
const orderQuery = queries[0];
assert.equal(orderQuery.table, 'zelo_orders');
const orderSelect = String(orderQuery.query.calls.find((call) => call.method === 'select')?.args[0]);
assert.match(orderSelect, /(^|,)customer(,|$)/u);
assert.match(orderSelect, /zelo_order_items\(id,product_id,name,unit_price,quantity,subtotal,modifiers,position\)/u);
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

assert.deepEqual(await adapter.patchOrderingOverridesAtomically({
  empresaId: 'empresa-1',
  pessoaId: 'person-1',
  ownerUserId: 'owner-1',
  patch: { paymentMethod: 'Pix', habitualTime: '20:15' },
}), { paymentMethod: 'Pix', habitualTime: '20:15' });
assert.deepEqual(rpcCalls, [{
  name: 'patch_zelochat_customer_ordering_overrides',
  args: {
    p_empresa_id: 'empresa-1',
    p_owner_user_id: 'owner-1',
    p_pessoa_id: 'person-1',
    p_patch: { paymentMethod: 'Pix', habitualTime: '20:15' },
  },
}]);
assert.equal(queries.some(({ table }) => table === 'pessoas'), false, 'tenant validation belongs inside the atomic RPC');

console.log('customerOrderingContextAdapter: ok');
