import assert from 'node:assert/strict';
import { listCustomers } from '../server/customers/service.js';
const repo = { listPeople: async () => [{ id: 'p1', nome: 'Ana', contato: '5511', updated_at: '2026-01-01' }], countOrders: async () => ({ p1: { count: 1, total: 25, lastDeliveredAt: '2026-08-20T00:00:00Z' } }), lastConversations: async () => ({ p1: '2026-08-01T00:00:00Z' }), getPerson: async () => null };
const result = await listCustomers('e', 'o', { limit: 10 }, repo); assert.equal(result.customers[0].totalOrders, 1); assert.equal(result.customers[0].activityState, 'active');
console.log('customerReadApi: ok');
