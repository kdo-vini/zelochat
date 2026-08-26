/** Errors that prove the shared PDV contract is not deployed yet. */
export function isMissingCustomerContractError(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
  const message = error instanceof Error ? error.message : String(error ?? '');
  return code === 'PGRST202' || code === '42703' || code === '42883'
    || /could not find the function|column .*pessoa_id.*does not exist|function .*create_zelo_order.*does not exist/i.test(message);
}

export type CustomerSource = 'pdv' | 'whatsapp' | 'zelomenu' | 'manual';
