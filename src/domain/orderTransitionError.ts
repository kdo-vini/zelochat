type ErrorRecord = Record<string, unknown>;

function asRecord(value: unknown): ErrorRecord | null {
  return value && typeof value === 'object' ? value as ErrorRecord : null;
}

/** Reads Supabase/PostgREST errors as well as native Error instances. */
export function getOrderTransitionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;

  const record = asRecord(error);
  if (!record) return 'UNKNOWN_ERROR';

  for (const key of ['message', 'details', 'hint', 'code']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }

  return 'UNKNOWN_ERROR';
}

function contains(error: unknown, token: string): boolean {
  const record = asRecord(error);
  const values = [
    getOrderTransitionErrorMessage(error),
    record?.code,
    record?.details,
    record?.hint,
  ];
  return values.some((value) => typeof value === 'string' && value.includes(token));
}

export type OrderTransitionErrorClassification = {
  httpStatus: 404 | 403 | 409 | 500;
  code: 'ORDER_NOT_FOUND' | 'ORDER_PERMISSION_DENIED' | 'REVISION_CONFLICT' | 'INVALID_ORDER_TRANSITION' | 'PRODUCT_STOCK_EXCEEDED' | 'UNKNOWN_ERROR';
  userMessage: string;
};

export function classifyOrderTransitionError(error: unknown): OrderTransitionErrorClassification {
  if (contains(error, 'ORDER_NOT_FOUND')) {
    return { httpStatus: 404, code: 'ORDER_NOT_FOUND', userMessage: 'Pedido não encontrado.' };
  }
  if (contains(error, 'ORDER_PERMISSION_DENIED') || contains(error, 'FORBIDDEN')) {
    return { httpStatus: 403, code: 'ORDER_PERMISSION_DENIED', userMessage: 'Você não tem permissão para atualizar este pedido.' };
  }
  if (contains(error, 'REVISION_CONFLICT')) {
    return { httpStatus: 409, code: 'REVISION_CONFLICT', userMessage: 'O pedido foi alterado em outra tela. Atualize a lista e tente novamente.' };
  }
  if (contains(error, 'PRODUCT_STOCK_EXCEEDED')) {
    return { httpStatus: 409, code: 'PRODUCT_STOCK_EXCEEDED', userMessage: 'A quantidade de um item ultrapassa o estoque atual. Atualize o estoque para iniciar o preparo.' };
  }
  if (contains(error, 'INVALID_ORDER_TRANSITION')) {
    return { httpStatus: 409, code: 'INVALID_ORDER_TRANSITION', userMessage: 'O pedido não pode avançar a partir do estado atual. Atualize a tela e tente novamente.' };
  }

  return { httpStatus: 500, code: 'UNKNOWN_ERROR', userMessage: 'Não consegui atualizar o pedido agora. Tente novamente.' };
}
