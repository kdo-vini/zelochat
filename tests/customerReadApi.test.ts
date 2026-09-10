import assert from 'node:assert/strict';
import { decodeCustomerCursor } from '../server/customers/filters.js';
import { customerRouter } from '../server/customers/router.js';
import { buildCustomerRelationship, countCustomerSegments, listCustomers } from '../server/customers/service.js';
import { fetchSegmentCounts } from '../src/services/customerApi.js';
const repo = { listPeople: async () => [{ id: 'p1', nome: 'Ana', contato: '5511', updated_at: '2026-01-01' }], countOrders: async () => ({ p1: { count: 1, total: 25, lastDeliveredAt: '2026-08-20T00:00:00Z' } }), lastConversations: async () => ({ p1: '2026-08-01T00:00:00Z' }), getPerson: async () => null };
const result = await listCustomers('e', 'o', { limit: 10 }, repo); assert.equal(result.customers[0].totalOrders, 1); assert.equal(result.customers[0].activityState, 'active');
const taggedResult = await listCustomers('e', 'o', { limit: 10 }, { ...repo, listTags: async () => ({ p1: ['Fiel'] }) }); assert.deepEqual(taggedResult.customers[0].tags, ['Fiel']);
const nameRepo = { listPeople: async () => [
  { id: '11111111-1111-4111-8111-111111111111', nome: null, contato: null, total_orders: 0, total_value: 0, last_order_at: null, last_activity_at: null, activity_state: 'never', has_whatsapp: false, total_count: 2 },
  { id: '22222222-2222-4222-8222-222222222222', nome: 'Ana', contato: null, total_orders: 1, total_value: 10, last_order_at: '2026-08-20T00:00:00Z', last_activity_at: '2026-08-20T00:00:00Z', activity_state: 'active', has_whatsapp: false, total_count: 2 },
], countOrders: async () => ({}), lastConversations: async () => ({}), getPerson: async () => null };
const nameResult = await listCustomers('e', 'o', { limit: 1, sort: 'name' }, nameRepo);
assert.equal(nameResult.nextCursor !== null, true);
assert.equal(Buffer.from(nameResult.nextCursor!, 'base64url').toString('utf8'), 'v2|name||11111111-1111-4111-8111-111111111111');
// Timestamp cru de produção: o cursor da lista não pode perder as seis casas decimais.
const recentTimestamp = '2026-09-10T14:50:32.375571+00:00';
const recentRepo = { listPeople: async () => [
  { id: '11111111-1111-4111-8111-111111111111', nome: 'Mais recente', contato: null, total_orders: 2, total_value: 50, last_order_at: recentTimestamp, last_activity_at: recentTimestamp, activity_state: 'active', has_whatsapp: false, total_count: 2 },
  { id: '22222222-2222-4222-8222-222222222222', nome: 'Anterior', contato: null, total_orders: 1, total_value: 10, last_order_at: '2026-09-09T14:50:32+00:00', last_activity_at: '2026-09-09T14:50:32+00:00', activity_state: 'active', has_whatsapp: false, total_count: 2 },
], countOrders: async () => ({}), lastConversations: async () => ({}), getPerson: async () => null };
const recentResult = await listCustomers('e', 'o', { limit: 1, sort: 'recent' }, recentRepo);
assert.deepEqual(decodeCustomerCursor(recentResult.nextCursor, 'recent'), { sort: 'recent', value: recentTimestamp, id: '11111111-1111-4111-8111-111111111111' });
const relationship = buildCustomerRelationship({ blockedAt: null, optedOut: true, campaigns: 3, automations: 2 }); assert.equal(relationship.optedOut, true); assert.equal(relationship.campaigns, 3); assert.equal(relationship.automations, 2);

const rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = [];
const segmentCounts = await countCustomerSegments('empresa-1', 'owner-1', {
  rpc: async (name, params) => {
    rpcCalls.push({ name, params });
    const total = params.p_min_days_since_last_order === 30 ? 7 : params.p_min_orders === 1 ? 4 : 2;
    return { data: [{ total_count: total }], error: null };
  },
});
assert.deepEqual(segmentCounts, { sumiram: 7, 'uma-vez': 4, melhores: 2 });
assert.equal(rpcCalls.length, 3);
assert(rpcCalls.every((call) => call.name === 'list_zelochat_customers' && call.params.p_limit === 1));
assert.deepEqual(rpcCalls.map((call) => call.params.p_sort).sort(), ['orders', 'recent', 'recent']);
const emptySegmentCounts = await countCustomerSegments('empresa-1', 'owner-1', { rpc: async () => ({ data: [], error: null }) });
assert.deepEqual(emptySegmentCounts, { sumiram: 0, 'uma-vez': 0, melhores: 0 });

const previousFetch = globalThis.fetch;
let fetchedUrl = '';
let fetchedAuthorization = '';
globalThis.fetch = async (input, init) => {
  fetchedUrl = String(input);
  fetchedAuthorization = String(new Headers(init?.headers).get('Authorization'));
  return Response.json({ counts: { sumiram: 7, 'uma-vez': 4, melhores: 2 } });
};
try {
  assert.deepEqual(await fetchSegmentCounts('token-1'), { sumiram: 7, 'uma-vez': 4, melhores: 2 });
  assert(fetchedUrl.endsWith('/api/customers/segment-counts') && fetchedAuthorization === 'Bearer token-1', 'frontend count service uses the authenticated segment route');
} finally {
  globalThis.fetch = previousFetch;
}

type RouteLayer = { route?: { path: string; methods: Record<string, boolean> } };
const readRoutes = (customerRouter as unknown as { stack: RouteLayer[] }).stack.filter((layer) => layer.route?.methods.get);
const segmentCountsRoute = readRoutes.findIndex((layer) => layer.route?.path === '/api/customers/segment-counts');
const personRoute = readRoutes.findIndex((layer) => layer.route?.path === '/api/customers/:personId');
assert(segmentCountsRoute >= 0 && segmentCountsRoute < personRoute, 'segment-counts is registered before the personId catch-all');
console.log('customerReadApi: ok');
