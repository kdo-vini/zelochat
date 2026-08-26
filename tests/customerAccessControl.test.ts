import { assert, assertEqual, runSuite } from './testHarness.js';
type AccessControlModule = {
  AccessControlError: new (code: string) => Error & { code: string };
  actorCan: (context: ActorAccessContext, permission: string) => boolean;
  resolveActorAccess: (actorUserId: string, repository: ActorAccessRepository) => Promise<ActorAccessContext>;
  clearActorAccessCache: () => void;
};

type ActorAccessContext = {
  actorUserId: string;
  ownerUserId: string;
  empresaId: string;
  isOwner: boolean;
  permissions: Record<string, boolean> | null;
};

type ActorAccessRepository = {
  findAccessUserByAuthUserId: (actorUserId: string) => Promise<AccessUserRow | null>;
  findEmpresaByOwnerUserId: (ownerUserId: string) => Promise<{ id: string; user_id: string } | null>;
  findRoleById: (ownerUserId: string, roleId: string) => Promise<{ owner_user_id: string; permissions: unknown } | null>;
};

const accessControl = await import('../server/accessControl.js').catch(() => null) as AccessControlModule | null;

type AccessUserRow = {
  owner_user_id: string;
  role_id: string | null;
  status: string;
};

function repositoryFor(input: {
  empresas?: Record<string, string>;
  accessUsers?: Record<string, AccessUserRow>;
  roles?: Record<string, { owner_user_id: string; permissions: Record<string, boolean> }>;
}) {
  const calls = { accessUsers: 0, empresas: 0, roles: 0 };
  const repository: ActorAccessRepository = {
    async findAccessUserByAuthUserId(actorUserId) {
      calls.accessUsers += 1;
      return input.accessUsers?.[actorUserId] ?? null;
    },
    async findEmpresaByOwnerUserId(ownerUserId) {
      calls.empresas += 1;
      const empresaId = input.empresas?.[ownerUserId];
      return empresaId ? { id: empresaId, user_id: ownerUserId } : null;
    },
    async findRoleById(ownerUserId, roleId) {
      calls.roles += 1;
      const role = input.roles?.[roleId];
      if (!role || role.owner_user_id !== ownerUserId) return null;
      return role;
    },
  };
  return { repository, calls };
}

await runSuite('customer access control', [
  {
    name: 'owner receives every capability and resolves the owner empresa',
    run: async () => {
      accessControl?.clearActorAccessCache();
      const { repository } = repositoryFor({ empresas: { 'owner-1': 'empresa-1' } });
      assert(accessControl !== null, 'access control module is available');
      if (!accessControl) return;
      const context = await accessControl.resolveActorAccess('owner-1', repository);

      assertEqual(context.actorUserId, 'owner-1', 'owner actor id is preserved');
      assertEqual(context.ownerUserId, 'owner-1', 'owner is its own owner');
      assertEqual(context.empresaId, 'empresa-1', 'owner empresa is resolved');
      assert(context.isOwner, 'owner context is marked as owner');
      assert(accessControl.actorCan(context, 'pessoas.gerenciar'), 'owner can manage customers');
      assert(accessControl.actorCan(context, 'clientes.comunicar'), 'owner can communicate with customers');
    },
  },
  {
    name: 'active sub-user resolves owner empresa and role permissions',
    run: async () => {
      accessControl?.clearActorAccessCache();
      const { repository } = repositoryFor({
        empresas: { 'owner-1': 'empresa-1' },
        accessUsers: {
          'operator-1': { owner_user_id: 'owner-1', role_id: 'role-1', status: 'active' },
        },
        roles: {
          'role-1': { owner_user_id: 'owner-1', permissions: { 'pessoas.visualizar': true, 'clientes.comunicar': false } },
        },
      });
      assert(accessControl !== null, 'access control module is available');
      if (!accessControl) return;
      const context = await accessControl.resolveActorAccess('operator-1', repository);

      assertEqual(context.actorUserId, 'operator-1', 'sub-user actor id is preserved');
      assertEqual(context.ownerUserId, 'owner-1', 'sub-user resolves its owner');
      assertEqual(context.empresaId, 'empresa-1', 'sub-user resolves owner empresa');
      assert(!context.isOwner, 'sub-user is not marked as owner');
      assert(accessControl.actorCan(context, 'pessoas.visualizar'), 'role permission is enabled');
      assert(!accessControl.actorCan(context, 'clientes.comunicar'), 'disabled role permission is denied');
    },
  },
  {
    name: 'inactive sub-user fails closed with UNAUTHORIZED',
    run: async () => {
      accessControl?.clearActorAccessCache();
      const { repository } = repositoryFor({
        accessUsers: {
          'operator-blocked': { owner_user_id: 'owner-1', role_id: 'role-1', status: 'blocked' },
        },
      });

      assert(accessControl !== null, 'access control module is available');
      if (!accessControl) return;
      let error: unknown;
      try {
        await accessControl.resolveActorAccess('operator-blocked', repository);
      } catch (caught) {
        error = caught;
      }
      assert(error instanceof accessControl.AccessControlError, 'inactive sub-user throws an access error');
      assertEqual((error as Error & { code: string }).code, 'UNAUTHORIZED', 'inactive sub-user is unauthorized');
    },
  },
  {
    name: 'missing permission fails with FORBIDDEN',
    run: async () => {
      accessControl?.clearActorAccessCache();
      const { repository } = repositoryFor({
        empresas: { 'owner-1': 'empresa-1' },
        accessUsers: {
          'operator-1': { owner_user_id: 'owner-1', role_id: 'role-1', status: 'active' },
        },
        roles: {
          'role-1': { owner_user_id: 'owner-1', permissions: { 'pessoas.visualizar': true } },
        },
      });
      assert(accessControl !== null, 'access control module is available');
      if (!accessControl) return;
      const context = await accessControl.resolveActorAccess('operator-1', repository);

      assert(!accessControl.actorCan(context, 'pessoas.gerenciar'), 'missing permission is denied');
      let code: string | undefined;
      try {
        if (!accessControl.actorCan(context, 'pessoas.gerenciar')) throw new accessControl.AccessControlError('FORBIDDEN');
      } catch (error) {
        code = (error as Error & { code: string }).code;
      }
      assertEqual(code, 'FORBIDDEN', 'denied capability uses stable FORBIDDEN code');
    },
  },
  {
    name: 'cache is keyed by actor and does not leak owner context to sub-user',
    run: async () => {
      accessControl?.clearActorAccessCache();
      const { repository, calls } = repositoryFor({
        empresas: { 'owner-1': 'empresa-1' },
        accessUsers: {
          'operator-1': { owner_user_id: 'owner-1', role_id: 'role-1', status: 'active' },
        },
        roles: {
          'role-1': { owner_user_id: 'owner-1', permissions: { 'pessoas.visualizar': true } },
        },
      });

      assert(accessControl !== null, 'access control module is available');
      if (!accessControl) return;
      const owner = await accessControl.resolveActorAccess('owner-1', repository);
      const operator = await accessControl.resolveActorAccess('operator-1', repository);
      const ownerAgain = await accessControl.resolveActorAccess('owner-1', repository);

      assert(owner.isOwner, 'owner remains owner after sub-user lookup');
      assertEqual(operator.actorUserId, 'operator-1', 'sub-user remains the requesting actor');
      assert(!operator.isOwner, 'sub-user context is not promoted to owner');
      assertEqual(ownerAgain.empresaId, 'empresa-1', 'owner cache returns the same tenant');
      assertEqual(calls.empresas, 2, 'each actor has its own empresa cache entry');
      assertEqual(calls.accessUsers, 2, 'owner and sub-user are cached independently');
    },
  },
]);
