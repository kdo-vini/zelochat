import { Router, type Request, type Response } from 'express';

export const CUSTOMER_MUTATION_FIELDS = ['name', 'phones', 'birthday', 'notes', 'tags', 'whatsappBlocked'] as const;
export type CustomerMutationField = (typeof CUSTOMER_MUTATION_FIELDS)[number];
export type CustomerMutationPayload = Partial<Record<CustomerMutationField, unknown>>;

export interface CustomerMutationAccess {
  isOwner: boolean;
  permissions: Record<string, boolean> | null;
  empresaId: string;
}

export function requireCustomerMutationPermission(access: CustomerMutationAccess): boolean {
  return access.isOwner || access.permissions?.['pessoas.gerenciar'] === true;
}

export function sanitizeCustomerPatch(input: Record<string, unknown>): CustomerMutationPayload {
  const output: CustomerMutationPayload = {};
  for (const field of CUSTOMER_MUTATION_FIELDS) if (field in input) output[field] = input[field];
  return output;
}

export function validateCustomerTenant(actorEmpresaId: string, personEmpresaId: string): boolean {
  return Boolean(actorEmpresaId) && actorEmpresaId === personEmpresaId;
}

export interface CustomerMergeRequest {
  sourceId: string;
  targetId: string;
  sourceEmpresaId: string;
  targetEmpresaId: string;
  actorEmpresaId: string;
}

export function validateMergeRequest(request: CustomerMergeRequest): boolean {
  return Boolean(request.sourceId && request.targetId)
    && request.sourceId !== request.targetId
    && validateCustomerTenant(request.actorEmpresaId, request.sourceEmpresaId)
    && validateCustomerTenant(request.actorEmpresaId, request.targetEmpresaId);
}

/** Observed WhatsApp names may fill an empty/phone placeholder, never a manual name. */
export function shouldPreserveManualName(currentName: string | null | undefined, observedName: string | null | undefined, phonePlaceholder?: string | null): boolean {
  const current = currentName?.trim() ?? '';
  const observed = observedName?.trim() ?? '';
  return Boolean(current && current !== observed && current !== (phonePlaceholder?.trim() ?? ''));
}

export function buildCustomerDeleteConfirmation(name: string): string {
  return `Excluir ${name || 'este cliente'}? As conversas e o relacionamento serão removidos. Pedidos e vendas serão preservados sem vínculo.`;
}

export interface MappedCustomerError { code: string; message: string; }

export function mapCustomerMutationError(error: { code?: string | null; message?: string | null }): MappedCustomerError {
  if (error.code === 'PESSOA_SALDO_ABERTO' || error.code === 'CUSTOMER_OPEN_BALANCE') return { code: 'CUSTOMER_OPEN_BALANCE', message: 'Não é possível excluir este cliente enquanto houver saldo em aberto.' };
  if (error.code === 'FORBIDDEN') return { code: 'FORBIDDEN', message: 'Você não tem permissão para alterar clientes.' };
  if (error.code === 'NOT_FOUND') return { code: 'NOT_FOUND', message: 'Cliente não encontrado.' };
  return { code: 'CUSTOMER_MUTATION_FAILED', message: 'Não foi possível salvar as alterações do cliente. Tente novamente.' };
}

export interface CustomerMutationStore {
  getPersonEmpresaId: (personId: string) => Promise<string | null>;
  callRpc: (name: 'fiado_excluir_pessoa', args: { p_pessoa_id: string; p_empresa_id: string }) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
}

export interface CustomerWriteStore extends CustomerMutationStore {
  createCustomer: (empresaId: string, patch: CustomerMutationPayload) => Promise<unknown>;
  updateCustomer: (personId: string, empresaId: string, patch: CustomerMutationPayload) => Promise<unknown>;
  previewMerge: (sourceId: string, targetId: string, empresaId: string) => Promise<unknown>;
  executeMergeTransaction: (sourceId: string, targetId: string, empresaId: string) => Promise<void>;
}

export async function createCustomer(access: CustomerMutationAccess, patch: Record<string, unknown>, store: CustomerWriteStore): Promise<unknown> {
  if (!requireCustomerMutationPermission(access)) throw new Error('FORBIDDEN');
  return store.createCustomer(access.empresaId, sanitizeCustomerPatch(patch));
}

export async function updateCustomer(access: CustomerMutationAccess, personId: string, patch: Record<string, unknown>, store: CustomerWriteStore): Promise<unknown> {
  if (!requireCustomerMutationPermission(access)) throw new Error('FORBIDDEN');
  const personEmpresaId = await store.getPersonEmpresaId(personId);
  if (!personEmpresaId || !validateCustomerTenant(access.empresaId, personEmpresaId)) throw new Error('NOT_FOUND');
  return store.updateCustomer(personId, access.empresaId, sanitizeCustomerPatch(patch));
}

export async function previewCustomerMerge(access: CustomerMutationAccess, request: CustomerMergeRequest, store: CustomerWriteStore): Promise<unknown> {
  if (!requireCustomerMutationPermission(access) || !validateMergeRequest({ ...request, actorEmpresaId: access.empresaId })) throw new Error('FORBIDDEN');
  return store.previewMerge(request.sourceId, request.targetId, access.empresaId);
}

export async function executeCustomerMerge(access: CustomerMutationAccess, request: CustomerMergeRequest, store: CustomerWriteStore): Promise<void> {
  if (!requireCustomerMutationPermission(access) || !validateMergeRequest({ ...request, actorEmpresaId: access.empresaId })) throw new Error('FORBIDDEN');
  await store.executeMergeTransaction(request.sourceId, request.targetId, access.empresaId);
}

/** Deletion is deliberately delegated to the PDV-owned RPC after tenant validation. */
export async function deleteCustomerWithPdvRpc(access: CustomerMutationAccess, personId: string, store: CustomerMutationStore): Promise<void> {
  if (!requireCustomerMutationPermission(access)) throw new Error('FORBIDDEN');
  const personEmpresaId = await store.getPersonEmpresaId(personId);
  if (!personEmpresaId || !validateCustomerTenant(access.empresaId, personEmpresaId)) throw new Error('NOT_FOUND');
  const result = await store.callRpc('fiado_excluir_pessoa', { p_pessoa_id: personId, p_empresa_id: access.empresaId });
  if (result.error) throw new Error(result.error.code || 'CUSTOMER_MUTATION_FAILED');
}

export interface CustomerRouterDependencies {
  resolveAccess: (req: Request) => Promise<CustomerMutationAccess>;
  store: CustomerWriteStore;
}

function sendMutationError(res: Response, cause: unknown): void {
  const mapped = mapCustomerMutationError({ code: cause instanceof Error ? cause.message : null });
  const status = mapped.code === 'FORBIDDEN' ? 403 : mapped.code === 'NOT_FOUND' ? 404 : mapped.code === 'CUSTOMER_OPEN_BALANCE' ? 409 : 400;
  res.status(status).json(mapped);
}

export function createCustomersRouter(deps: CustomerRouterDependencies): Router {
  const router = Router();
  router.post('/', async (req, res) => { try { const value = await createCustomer(await deps.resolveAccess(req), req.body ?? {}, deps.store); res.status(201).json(value); } catch (cause) { sendMutationError(res, cause); } });
  router.patch('/:personId', async (req, res) => { try { const value = await updateCustomer(await deps.resolveAccess(req), req.params.personId, req.body ?? {}, deps.store); res.json(value); } catch (cause) { sendMutationError(res, cause); } });
  router.delete('/:personId', async (req, res) => { try { await deleteCustomerWithPdvRpc(await deps.resolveAccess(req), req.params.personId, deps.store); res.status(204).end(); } catch (cause) { sendMutationError(res, cause); } });
  router.post('/merge/preview', async (req, res) => { try { const value = await previewCustomerMerge(await deps.resolveAccess(req), req.body as CustomerMergeRequest, deps.store); res.json(value); } catch (cause) { sendMutationError(res, cause); } });
  router.post('/merge', async (req, res) => { try { await executeCustomerMerge(await deps.resolveAccess(req), req.body as CustomerMergeRequest, deps.store); res.status(204).end(); } catch (cause) { sendMutationError(res, cause); } });
  router.post('/:personId/merge', async (req, res) => { try { const access = await deps.resolveAccess(req); const request = { sourceId: req.params.personId, targetId: typeof req.body?.targetId === 'string' ? req.body.targetId : '', sourceEmpresaId: access.empresaId, targetEmpresaId: access.empresaId, actorEmpresaId: access.empresaId }; if (req.body?.execute === true) { await executeCustomerMerge(access, request, deps.store); res.status(204).end(); return; } res.json(await previewCustomerMerge(access, request, deps.store)); } catch (cause) { sendMutationError(res, cause); } });
  return router;
}
