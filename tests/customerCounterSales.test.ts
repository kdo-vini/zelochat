import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aggregateCustomerOrderRows, mergeCustomerOrderRows } from '../server/customers/service.js';
import { decodeTimelineCursor } from '../server/customers/filters.js';

const migration = readFileSync('supabase/migrations/070_customer_aggregates_include_counter_sales.sql', 'utf8');
const service = readFileSync('server/customers/service.ts', 'utf8');
const ordersTab = readFileSync('src/components/customers/CustomerOrdersTab.tsx', 'utf8');
const personId = '11111111-1111-4111-8111-111111111111';
const deliveryId = '22222222-2222-4222-8222-222222222222';

const aggregate = aggregateCustomerOrderRows(
  [{ pessoa_id: personId, total: 20, closed_at: '2026-09-10T12:00:00Z' }],
  [{ id_cliente: personId, id_pessoa: null, valor_total: 15, data_hora: '2026-09-10T13:00:00Z' }],
);
assert.deepEqual(aggregate[personId], { count: 2, total: 35, lastDeliveredAt: '2026-09-10T13:00:00Z' });

const counterOnly = aggregateCustomerOrderRows([], [{ id_cliente: personId, id_pessoa: null, valor_total: 12, data_hora: '2026-09-10T13:00:00Z' }]);
assert.equal(counterOnly[personId].count, 1);
assert.equal(counterOnly[personId].total, 12);

const saleWithBothPersonColumns = aggregateCustomerOrderRows([], [{ id_cliente: personId, id_pessoa: personId, valor_total: 18, data_hora: '2026-09-10T14:00:00Z' }]);
assert.deepEqual(saleWithBothPersonColumns[personId], { count: 1, total: 18, lastDeliveredAt: '2026-09-10T14:00:00Z' });
assert(!migration.includes('fiado_lancamentos'));
assert(!service.includes('fiado_lancamentos'));

const deliveryRows = [
  { id: deliveryId, status: 'delivered', total: 20, created_at: '2026-09-10T12:00:00Z' },
  { id: '33333333-3333-4333-8333-333333333333', status: 'delivered', total: 10, created_at: '2026-09-10T11:00:00Z' },
];
const counterRows = [
  { id: 100, id_cliente: personId, id_pessoa: null, valor_total: 15, data_hora: '2026-09-10T13:00:00Z' },
  { id: 99, id_cliente: personId, id_pessoa: null, valor_total: 9, data_hora: '2026-09-10T12:00:00Z' },
  { id: 98, id_cliente: personId, id_pessoa: null, valor_total: 8, data_hora: '2026-09-10T10:00:00Z' },
];
const firstPage = mergeCustomerOrderRows(deliveryRows, counterRows, null, 2);
assert.deepEqual(firstPage.items.map((item) => [item.id, item.origin]), [[ '100', 'counter' ], [deliveryId, 'delivery']]);
assert.equal(firstPage.hasMore, true);
const firstCursor = decodeTimelineCursor(firstPage.nextCursor);
assert.deepEqual(firstCursor, { occurredAt: '2026-09-10T12:00:00Z', kind: 'order', id: deliveryId });

const secondPage = mergeCustomerOrderRows(deliveryRows, counterRows, firstCursor, 2);
assert.deepEqual(secondPage.items.map((item) => [item.id, item.origin]), [[ '99', 'counter' ], [ '33333333-3333-4333-8333-333333333333', 'delivery' ]]);
assert.equal(secondPage.hasMore, true);
const thirdPage = mergeCustomerOrderRows(deliveryRows, counterRows, decodeTimelineCursor(secondPage.nextCursor), 2);
assert.deepEqual(thirdPage.items.map((item) => [item.id, item.origin]), [[ '98', 'counter' ]]);
assert.equal(thirdPage.hasMore, false);

assert.match(migration, /v\.id_usuario = p_owner_user_id/);
assert.match(service, /\.eq\('id_usuario', ownerUserId\)/);
assert.match(migration, /count\(\*\) over \(\)::bigint total_count[\s\S]*limit least/);
assert.match(ordersTab, /Compras/);
assert.match(ordersTab, /Total gasto/);
assert.match(ordersTab, /order\.origin === 'counter' \? 'Balcão'/);

console.log('customerCounterSales: ok');
