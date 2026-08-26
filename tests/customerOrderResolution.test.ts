import assert from 'node:assert/strict';
import { resolveCustomerForOrder } from '../server/customers/identity.js';

async function main() {
  const linked = await resolveCustomerForOrder({ empresaId: 'e', ownerUserId: 'o', phone: '11999999999' }, {
    repository: { ensureFromWhatsApp: async () => ({ status: 'linked', pessoaId: 'p' }) },
  });
  assert.equal(linked.pessoaId, 'p');
  const conflict = await resolveCustomerForOrder({ empresaId: 'e', ownerUserId: 'o', phone: '11999999999' }, {
    repository: { ensureFromWhatsApp: async () => ({ status: 'conflict', pessoaId: null }) },
  });
  assert.equal(conflict.pessoaId, null);
  const invalid = await resolveCustomerForOrder({ empresaId: 'e', ownerUserId: 'o', phone: '123' }, {
    repository: { ensureFromWhatsApp: async () => { throw new Error('must not call'); } },
  });
  assert.equal(invalid.pessoaId, null);
  console.log('customerOrderResolution: ok');
}
void main();
