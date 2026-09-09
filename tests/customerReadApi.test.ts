import assert from 'node:assert/strict';
import { buildCustomerRelationship, listCustomers } from '../server/customers/service.js';
const repo = { listPeople: async () => [{ id: 'p1', nome: 'Ana', contato: '5511', updated_at: '2026-01-01' }], countOrders: async () => ({ p1: { count: 1, total: 25, lastDeliveredAt: '2026-08-20T00:00:00Z' } }), lastConversations: async () => ({ p1: '2026-08-01T00:00:00Z' }), getPerson: async () => null };
const result = await listCustomers('e', 'o', { limit: 10 }, repo); assert.equal(result.customers[0].totalOrders, 1); assert.equal(result.customers[0].activityState, 'active');
const nameRepo = { listPeople: async () => [
  { id: '11111111-1111-4111-8111-111111111111', nome: null, contato: null, total_orders: 0, total_value: 0, last_order_at: null, last_activity_at: null, activity_state: 'never', has_whatsapp: false, total_count: 2 },
  { id: '22222222-2222-4222-8222-222222222222', nome: 'Ana', contato: null, total_orders: 1, total_value: 10, last_order_at: '2026-08-20T00:00:00Z', last_activity_at: '2026-08-20T00:00:00Z', activity_state: 'active', has_whatsapp: false, total_count: 2 },
], countOrders: async () => ({}), lastConversations: async () => ({}), getPerson: async () => null };
const nameResult = await listCustomers('e', 'o', { limit: 1, sort: 'name' }, nameRepo);
assert.equal(nameResult.nextCursor !== null, true);
assert.equal(Buffer.from(nameResult.nextCursor!, 'base64url').toString('utf8'), 'v2|name||11111111-1111-4111-8111-111111111111');
const relationship = buildCustomerRelationship({ blockedAt: null, optedOut: true, campaigns: 3, automations: 2 }); assert.equal(relationship.optedOut, true); assert.equal(relationship.campaigns, 3); assert.equal(relationship.automations, 2);
console.log('customerReadApi: ok');
