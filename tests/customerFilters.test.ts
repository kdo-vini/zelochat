import assert from 'node:assert/strict';
import { decodeCustomerCursor, encodeCustomerCursor, parseCustomerFilters, resolveCustomerActivity } from '../server/customers/filters.js';
assert.equal(parseCustomerFilters({ q: 'Ana', limit: '10', hasPhone: 'true' }).limit, 10);
assert.deepEqual(parseCustomerFilters({ status: 'active', hasWhatsApp: 'true', vip: 'true', birthdayOnly: 'true' }), { activityState: 'active', hasPhone: true, vip: true, birthdayOnly: true, sort: 'orders', segment: { buyers: 'buyers', hasWhatsApp: true } });
assert.deepEqual(parseCustomerFilters({ minOrders: '3' }).segment, { buyers: 'buyers', minOrders: 3 });
assert.deepEqual(parseCustomerFilters({ buyers: 'all', minOrders: '0' }).segment, { buyers: 'all', minOrders: 0 });
assert.throws(() => parseCustomerFilters({ sql: 'drop table' }));
const id = '11111111-1111-4111-8111-111111111111';
for (const [sort, value] of [['orders', '12'], ['value', '123.45'], ['recent', '2026-01-01T00:00:00.000Z'], ['name', 'Ana|Silva']] as const) {
  const cursor = encodeCustomerCursor(sort, value, id);
  assert.deepEqual(decodeCustomerCursor(cursor, sort), { sort, value: sort === 'name' ? 'ana|silva' : value, id });
}
const emptyRecent = encodeCustomerCursor('recent', '', id);
assert.deepEqual(decodeCustomerCursor(emptyRecent, 'recent'), { sort: 'recent', value: '', id });
assert.throws(() => decodeCustomerCursor(encodeCustomerCursor('orders', '12', id), 'value'), /Cursor inválido/);
assert.throws(() => decodeCustomerCursor(Buffer.from(`2026-01-01T00:00:00.000Z|${id}`).toString('base64url'), 'orders'), /Cursor inválido/);
assert.equal(resolveCustomerActivity({ lastDeliveredOrderAt: '2026-08-01T00:00:00Z', lastConversationAt: '2020-01-01T00:00:00Z', now: new Date('2026-08-25T00:00:00Z') }).lastActivityAt, '2026-08-01T00:00:00Z');
console.log('customerFilters: ok');
