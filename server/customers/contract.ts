/** Errors that prove the shared PDV contract is not deployed yet. */
export function isMissingCustomerContractError(error: unknown, operation: 'write' | 'read' = 'write'): boolean {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : null;
  const code = String(record?.code ?? '');
  const message = typeof record?.message === 'string' ? record.message : String(error ?? '');
  if (operation === 'write') {
    // Only PostgREST's exact missing-signature response is safe to retry. A
    // generic SQL state can be an actual bug inside the RPC and must surface.
    return code === 'PGRST202'
      && /create_zelo_order/i.test(message)
      && /p_pessoa_id/i.test(message);
  }
  return code === '42703' && /zelo_orders\.pessoa_id/i.test(message);
}

export type CustomerSource = 'pdv' | 'whatsapp' | 'zelomenu' | 'manual';
