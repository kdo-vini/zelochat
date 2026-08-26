import assert from 'node:assert/strict';
import { ensureCustomerForSession, normalizeWhatsAppPhone } from '../server/customers/identity.js';

const base = { empresaId: 'empresa', ownerUserId: 'owner', jid: '5511999999999@s.whatsapp.net', phone: '(11) 99999-9999' };

async function main() {
  assert.equal(normalizeWhatsAppPhone(base.phone), '5511999999999');
  let persisted: string | null | undefined;
  const linked = await ensureCustomerForSession({ ...base, persistPessoaId: async (id) => { persisted = id; } }, {
    repository: { ensureFromWhatsApp: async () => ({ status: 'linked', pessoaId: 'p-1' }) },
  });
  assert.equal(linked.pessoaId, 'p-1'); assert.equal(persisted, 'p-1');
  const conflict = await ensureCustomerForSession(base, {
    repository: { ensureFromWhatsApp: async () => ({ status: 'conflict', pessoaId: null, candidatePersonIds: ['a', 'b'] }), recordConflict: async () => { persisted = 'conflict-recorded'; } },
  });
  assert.equal(conflict.pessoaId, null); assert.equal(conflict.status, 'conflict');
  assert.equal(persisted, 'conflict-recorded');
  const failed = await ensureCustomerForSession(base, { repository: { ensureFromWhatsApp: async () => { throw new Error('down'); } } });
  assert.equal(failed.status, 'failed');
  const invalid = await ensureCustomerForSession({ ...base, jid: '120363@ g.us', phone: null }, { repository: { ensureFromWhatsApp: async () => { throw new Error('must not call'); } } });
  assert.equal(invalid.status, 'incomplete');
  const manual = await ensureCustomerForSession({ ...base, observedName: 'Nome manual' }, { repository: { ensureFromWhatsApp: async ({ observedName }) => { assert.equal(observedName, 'Nome manual'); return { status: 'linked', pessoaId: 'p-2' }; } } });
  assert.equal(manual.pessoaId, 'p-2');
  console.log('customerIdentityResolution: ok');
}
void main();
