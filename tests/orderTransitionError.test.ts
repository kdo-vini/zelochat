import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyOrderTransitionError } from '../src/domain/orderTransitionError.js';

describe('erros da transição de pedido', () => {
  it('não transforma erro PostgREST em UNKNOWN_ERROR', () => {
    const result = classifyOrderTransitionError({
      code: 'P0001',
      message: 'INVALID_ORDER_TRANSITION',
      details: 'pending_review -> preparing',
    });

    assert.deepEqual(result, {
      httpStatus: 409,
      code: 'INVALID_ORDER_TRANSITION',
      userMessage: 'O pedido não pode avançar a partir do estado atual. Atualize a tela e tente novamente.',
    });
  });

  it('explica bloqueio de estoque sem expor detalhes do banco', () => {
    const result = classifyOrderTransitionError({
      code: 'P0001',
      message: 'PRODUCT_STOCK_EXCEEDED',
      details: 'produto interno',
    });

    assert.equal(result.httpStatus, 409);
    assert.equal(result.code, 'PRODUCT_STOCK_EXCEEDED');
    assert.equal(result.userMessage, 'A quantidade de um item ultrapassa o estoque atual. Atualize o estoque para iniciar o preparo.');
  });
});
