import assert from 'node:assert/strict';
import { runCustomerBackfill, type BackfillDependencies } from '../server/customers/backfill.js';
import { decodeCustomerCursor, decodeTimelineCursor, encodeCustomerCursor, encodeTimelineCursor, parseCustomerFilters } from '../server/customers/filters.js';
import { isMissingCustomerContractError } from '../server/customers/contract.js';
import { resolveCustomerForOrder } from '../server/customers/identity.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const row = { id: '11111111-1111-4111-8111-111111111111', remote_jid: '5511999999999@s.whatsapp.net', customer_phone: '5511999999999', customer_name: 'Ana', updated_at: '2026-08-25T10:00:00.000Z' };
let mutatingResolveCalls = 0; let previewCalls = 0; let writes = 0;
const deps: BackfillDependencies = {
  fetchSessions: async () => [row],
  resolve: async () => { mutatingResolveCalls++; throw new Error('dry-run must not call ensure'); },
  previewResolve: async () => { previewCalls++; return { status: 'linked', pessoaId: 'p1' }; },
  updateSession: async () => { writes++; },
  loadCheckpoint: async () => ({ cursor: null, counts: { linked: 0, created: 0, incomplete: 0, conflict: 0, failed: 0 } }),
  saveCheckpoint: async () => { writes++; },
};
const dry = await runCustomerBackfill({ empresaId: 'e', dryRun: true, dependencies: deps });
assert.equal(dry.counts.linked, 1); assert.equal(previewCalls, 1); assert.equal(mutatingResolveCalls, 0); assert.equal(writes, 0);
const cursor = encodeCustomerCursor('orders', '1', row.id); assert.deepEqual(decodeCustomerCursor(cursor, 'orders'), { sort: 'orders', value: '1', id: row.id });
const timelineCursor = encodeTimelineCursor(row.updated_at, 'order', row.id); assert.deepEqual(decodeTimelineCursor(timelineCursor), { occurredAt: row.updated_at, kind: 'order', id: row.id });
assert.throws(() => parseCustomerFilters({ q: 'Ana),id.neq.x' }));
assert.throws(() => decodeCustomerCursor('not-a-valid-cursor'));
assert.equal(isMissingCustomerContractError({ code: 'PGRST202', message: 'Could not find function create_zelo_order with p_pessoa_id' }), true);
assert.equal(isMissingCustomerContractError({ code: '42703', message: 'internal missing column' }), false);
assert.equal(isMissingCustomerContractError({ code: '42883', message: 'internal function missing' }), false);
assert.equal(isMissingCustomerContractError({ code: '42703', message: 'column zelo_orders.pessoa_id does not exist' }, 'read'), true);
assert.match(readFileSync(resolve('supabase/migrations/049_customer_backfill_state.sql'), 'utf8'), /cursor text/);
const migration050 = readFileSync(resolve('supabase/migrations/050_customer_read_aggregates_and_conflict_dedupe.sql'), 'utf8');
assert.match(migration050, /zelochat_person_match_conflicts_open_identity_uq/);
assert.match(migration050, /on conflict \(empresa_id, id_usuario, identity_key\) where state = 'open'/i);
assert.match(migration050, /revoke all on function public\.list_zelochat_customers/i);
assert.match(migration050, /list_zelochat_customer_timeline/);
let seenSource: string | undefined;
await resolveCustomerForOrder({ empresaId: 'e', ownerUserId: 'o', phone: '11999999999', source: 'zelomenu' }, { repository: { ensureFromWhatsApp: async ({ source }) => { seenSource = source; return { status: 'conflict', pessoaId: null }; }, recordConflict: async () => {} } });
assert.equal(seenSource, 'zelomenu');
console.log('customerBlockFixes: ok');
