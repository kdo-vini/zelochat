import assert from 'node:assert/strict';
import { buildCustomerRelationship, listCustomers } from '../server/customers/service.js';
const repo = { listPeople: async () => [{ id: 'p1', nome: 'Ana', contato: '5511', updated_at: '2026-01-01' }], countOrders: async () => ({ p1: { count: 1, total: 25, lastDeliveredAt: '2026-08-20T00:00:00Z' } }), lastConversations: async () => ({ p1: '2026-08-01T00:00:00Z' }), getPerson: async () => null };
const result = await listCustomers('e', 'o', { limit: 10 }, repo); assert.equal(result.customers[0].totalOrders, 1); assert.equal(result.customers[0].activityState, 'active');
const relationship = buildCustomerRelationship({ blockedAt: null, optedOut: true, campaigns: 3, automations: 2 }); assert.equal(relationship.optedOut, true); assert.equal(relationship.campaigns, 3); assert.equal(relationship.automations, 2);
console.log('customerReadApi: ok');
