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
