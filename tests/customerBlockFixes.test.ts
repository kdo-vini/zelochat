import assert from 'node:assert/strict';
import { runCustomerBackfill, type BackfillDependencies } from '../server/customers/backfill.js';
import { decodeCustomerCursor, decodeTimelineCursor, encodeCustomerCursor, encodeTimelineCursor, parseCustomerFilters } from '../server/customers/filters.js';
import { isMissingCustomerContractError } from '../server/customers/contract.js';
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
const cursor = encodeCustomerCursor(row.updated_at, row.id); assert.deepEqual(decodeCustomerCursor(cursor), { updatedAt: row.updated_at, id: row.id });
const timelineCursor = encodeTimelineCursor(row.updated_at, 'order', row.id); assert.deepEqual(decodeTimelineCursor(timelineCursor), { occurredAt: row.updated_at, kind: 'order', id: row.id });
assert.throws(() => parseCustomerFilters({ q: 'Ana),id.neq.x' }));
assert.throws(() => decodeCustomerCursor('not-a-valid-cursor'));
assert.equal(isMissingCustomerContractError({ code: 'PGRST202', message: 'missing function' }), true);
assert.equal(isMissingCustomerContractError({ code: '23514', message: 'validation failed' }), false);
assert.match(readFileSync(resolve('supabase/migrations/049_customer_backfill_state.sql'), 'utf8'), /cursor text/);
console.log('customerBlockFixes: ok');
