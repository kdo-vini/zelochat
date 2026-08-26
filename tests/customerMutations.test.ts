import { assert, runSuite } from './testHarness.js';
import {
  CUSTOMER_MUTATION_FIELDS,
  buildCustomerDeleteConfirmation,
  mapCustomerMutationError,
  requireCustomerMutationPermission,
  sanitizeCustomerPatch,
  validateCustomerTenant,
  validateMergeRequest,
  shouldPreserveManualName,
  type CustomerMutationAccess,
} from '../server/customers/mutations.ts';

const owner: CustomerMutationAccess = { isOwner: true, permissions: null, empresaId: 'empresa-1' };
const manager: CustomerMutationAccess = { isOwner: false, permissions: { 'pessoas.gerenciar': true }, empresaId: 'empresa-1' };
const viewer: CustomerMutationAccess = { isOwner: false, permissions: { 'pessoas.visualizar': true }, empresaId: 'empresa-1' };

await runSuite('customer mutations', [
  {
    name: 'preserves a manual name from later observed WhatsApp names',
    run: () => {
      assert(shouldPreserveManualName('Ana Souza', 'Ana', '5511999999999'), 'manual name is protected');
      assert(!shouldPreserveManualName('5511999999999', 'Ana', '5511999999999'), 'phone placeholder can be replaced');
    },
  },
  {
    name: 'accepts exactly the approved CRM fields',
    run: () => {
      const patch = sanitizeCustomerPatch({ name: 'Ana', phones: ['5511999999999'], birthday: { day: 1, month: 2 }, notes: 'Ligou', tags: ['vip'], whatsappBlocked: true, empresa_id: 'other', role: 'admin' });
      assert(JSON.stringify(Object.keys(patch).sort()) === JSON.stringify([...CUSTOMER_MUTATION_FIELDS].sort()), 'unknown fields never enter the mutation payload');
      assert(patch.name === 'Ana' && patch.whatsappBlocked === true, 'approved fields remain intact');
    },
  },
  {
    name: 'requires pessoas.gerenciar for every write',
    run: () => {
      assert(requireCustomerMutationPermission(owner), 'owner can manage customers');
      assert(requireCustomerMutationPermission(manager), 'manager permission can manage customers');
      assert(!requireCustomerMutationPermission(viewer), 'viewer cannot manage customers');
    },
  },
  {
    name: 'rejects a person from another tenant before mutation',
    run: () => {
      assert(validateCustomerTenant('empresa-1', 'empresa-1'), 'same tenant is accepted');
      assert(!validateCustomerTenant('empresa-1', 'empresa-2'), 'cross-tenant person is rejected');
    },
  },
  {
    name: 'rejects merging a person into itself or another tenant',
    run: () => {
      assert(!validateMergeRequest({ sourceId: 'a', targetId: 'a', sourceEmpresaId: 'empresa-1', targetEmpresaId: 'empresa-1', actorEmpresaId: 'empresa-1' }), 'self merge is rejected');
      assert(!validateMergeRequest({ sourceId: 'a', targetId: 'b', sourceEmpresaId: 'empresa-1', targetEmpresaId: 'empresa-2', actorEmpresaId: 'empresa-1' }), 'cross-tenant merge is rejected');
      assert(validateMergeRequest({ sourceId: 'a', targetId: 'b', sourceEmpresaId: 'empresa-1', targetEmpresaId: 'empresa-1', actorEmpresaId: 'empresa-1' }), 'same-tenant merge is accepted');
    },
  },
  {
    name: 'maps open balance to stable friendly delete error',
    run: () => {
      const mapped = mapCustomerMutationError({ code: 'PESSOA_SALDO_ABERTO' });
      assert(mapped.code === 'CUSTOMER_OPEN_BALANCE', 'stable client error code is returned');
      assert(/saldo em aberto/i.test(mapped.message), 'message explains why deletion is blocked');
    },
  },
  {
    name: 'explains what deletion removes and preserves',
    run: () => {
      const copy = buildCustomerDeleteConfirmation('Ana');
      assert(/conversas e o relacionamento serão removidos/i.test(copy), 'conversation data is called out');
      assert(/pedidos e vendas serão preservados sem vínculo/i.test(copy), 'financial history preservation is called out');
    },
  },
]);
