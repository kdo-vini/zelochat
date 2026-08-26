import assert from 'node:assert/strict';
import { runCustomerBackfill, type BackfillDependencies } from '../server/customers/backfill.js';

async function main() {
  const rows = [{ id: '1', remote_jid: '5511@s.whatsapp.net', customer_phone: '11999999999', customer_name: 'A', updated_at: '2026-01-01' }];
  let saved = 0; let updated = 0;
  const deps: BackfillDependencies = {
    fetchSessions: async () => rows,
    resolve: async () => ({ status: 'linked', pessoaId: 'p1' }),
    updateSession: async () => { updated++; },
    loadCheckpoint: async () => ({ cursor: null, counts: { linked: 0, created: 0, incomplete: 0, conflict: 0, failed: 0 } }),
    saveCheckpoint: async () => { saved++; },
  };
  const dry = await runCustomerBackfill({ empresaId: 'e', dryRun: true, dependencies: deps });
  assert.equal(dry.counts.linked, 1); assert.equal(updated, 0); assert.equal(saved, 0);
  const real = await runCustomerBackfill({ empresaId: 'e', dependencies: deps });
  assert.equal(real.counts.linked, 1); assert.equal(updated, 1); assert.equal(saved, 1);
  console.log('customerBackfill: ok');
}
void main();
