import assert from 'node:assert/strict';
import { decodeCustomerCursor, encodeCustomerCursor, parseCustomerFilters, resolveCustomerActivity } from '../server/customers/filters.js';
assert.equal(parseCustomerFilters({ q: 'Ana', limit: '10', hasPhone: 'true' }).limit, 10);
assert.throws(() => parseCustomerFilters({ sql: 'drop table' }));
const cursor = encodeCustomerCursor('2026-01-01T00:00:00.000Z', '11111111-1111-4111-8111-111111111111'); assert.deepEqual(decodeCustomerCursor(cursor), { updatedAt: '2026-01-01T00:00:00.000Z', id: '11111111-1111-4111-8111-111111111111' });
assert.equal(resolveCustomerActivity({ lastDeliveredOrderAt: '2026-08-01T00:00:00Z', lastConversationAt: '2020-01-01T00:00:00Z', now: new Date('2026-08-25T00:00:00Z') }).lastActivityAt, '2026-08-01T00:00:00Z');
console.log('customerFilters: ok');
