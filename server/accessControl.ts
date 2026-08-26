import type { Request } from 'express';
import { extractBearerToken, getServiceSupabase } from './supabase.js';

export type AccessErrorCode = 'UNAUTHORIZED' | 'EMPRESA_NOT_FOUND' | 'FORBIDDEN';

export class AccessControlError extends Error {
  readonly code: AccessErrorCode;

  constructor(code: AccessErrorCode) {
    super(code);
    this.name = 'AccessControlError';
    this.code = code;
  }
}

export interface ActorAccessContext {
  actorUserId: string;
  ownerUserId: string;
  empresaId: string;
  isOwner: boolean;
  permissions: Record<string, boolean> | null;
}

export interface ActorAccessRepository {
  findAccessUserByAuthUserId(actorUserId: string): Promise<{
    owner_user_id: string;
    role_id: string | null;
    status: string;
  } | null>;
  findEmpresaByOwnerUserId(ownerUserId: string): Promise<{ id: string; user_id: string } | null>;
  findRoleById(ownerUserId: string, roleId: string): Promise<{ owner_user_id: string; permissions: unknown } | null>;
}

const ACTOR_ACCESS_CACHE_TTL_MS = 5 * 60 * 1000;
const actorAccessCache = new Map<string, { context: ActorAccessContext; cachedAt: number }>();

const defaultRepository: ActorAccessRepository = {
  async findAccessUserByAuthUserId(actorUserId) {
    const { data, error } = await getServiceSupabase()
      .from('access_users')
      .select('owner_user_id, role_id, status')
      .eq('auth_user_id', actorUserId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
  async findEmpresaByOwnerUserId(ownerUserId) {
    const { data, error } = await getServiceSupabase()
      .from('empresa_perfil')
      .select('id, user_id')
      .eq('user_id', ownerUserId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
  async findRoleById(ownerUserId, roleId) {
    const { data, error } = await getServiceSupabase()
      .from('access_roles')
      .select('owner_user_id, permissions')
      .eq('owner_user_id', ownerUserId)
      .eq('id', roleId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
};

function accessErrorCode(error: unknown): AccessErrorCode {
  if (error instanceof AccessControlError) return error.code;
  return 'EMPRESA_NOT_FOUND';
}

function normalizePermissions(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, enabled]) => enabled === true)
      .map(([permission]) => [permission, true]),
  );
}

export function actorCan(context: ActorAccessContext, permission: string): boolean {
  return context.isOwner || context.permissions?.[permission] === true;
}

export function clearActorAccessCache(): void {
  actorAccessCache.clear();
}

/**
 * Resolves the authenticated actor to the owner empresa and role capabilities.
 * Cache keys intentionally use actorUserId: an owner and a sub-user can share
 * an empresa while retaining different permission contexts.
 */
export async function resolveActorAccess(
  actorUserId: string,
  repository: ActorAccessRepository = defaultRepository,
): Promise<ActorAccessContext> {
  if (!actorUserId) throw new AccessControlError('UNAUTHORIZED');

  const cached = actorAccessCache.get(actorUserId);
  if (cached && Date.now() - cached.cachedAt < ACTOR_ACCESS_CACHE_TTL_MS) {
    return cached.context;
  }

  try {
    const accessUser = await repository.findAccessUserByAuthUserId(actorUserId);
    if (accessUser && accessUser.status !== 'active') {
      throw new AccessControlError('UNAUTHORIZED');
    }

    const ownerUserId = accessUser?.owner_user_id ?? actorUserId;
    const empresa = await repository.findEmpresaByOwnerUserId(ownerUserId);
    if (!empresa?.id) throw new AccessControlError('EMPRESA_NOT_FOUND');

    let permissions: Record<string, boolean> | null = null;
    if (accessUser) {
      const role = accessUser.role_id
        ? await repository.findRoleById(ownerUserId, accessUser.role_id)
        : null;
      permissions = normalizePermissions(role?.permissions);
    }

    const context: ActorAccessContext = {
      actorUserId,
      ownerUserId,
      empresaId: empresa.id,
      isOwner: !accessUser,
      permissions,
    };
    actorAccessCache.set(actorUserId, { context, cachedAt: Date.now() });
    return context;
  } catch (error) {
    const code = accessErrorCode(error);
    if (error instanceof AccessControlError) throw error;
    console.error('[access] actor resolution failed:', error);
    throw new AccessControlError(code);
  }
}

export async function requireActorAccess(req: Request): Promise<ActorAccessContext> {
  const token = extractBearerToken(req);
  if (!token) throw new AccessControlError('UNAUTHORIZED');

  const context = await resolveActorAccessFromToken(token);
  const request = req as Request & {
    actorAccess?: ActorAccessContext;
    empresaId?: string;
    userId?: string;
    ownerUserId?: string;
  };
  request.actorAccess = context;
  request.empresaId = context.empresaId;
  request.userId = context.actorUserId;
  request.ownerUserId = context.ownerUserId;
  return context;
}

export async function resolveActorAccessFromToken(token: string): Promise<ActorAccessContext> {
  if (!token) throw new AccessControlError('UNAUTHORIZED');
  const { data, error } = await getServiceSupabase().auth.getUser(token);
  if (error || !data.user) throw new AccessControlError('UNAUTHORIZED');
  return resolveActorAccess(data.user.id);
}

export async function requireActorPermission(req: Request, permission: string): Promise<ActorAccessContext> {
  const context = await requireActorAccess(req);
  if (!actorCan(context, permission)) throw new AccessControlError('FORBIDDEN');
  return context;
}
