import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ifoodIntentForChatAction } from '../src/domain/ifoodChatCommands.js';

const merchant = {
  source: 'ifood',
  fulfillment: { type: 'delivery', deliveredBy: 'MERCHANT' },
};

describe('ifoodIntentForChatAction', () => {
  it('aceita pending_review pelo botao Aceitar (status pending)', () => {
    assert.equal(ifoodIntentForChatAction({ ...merchant, status: 'pending_review' }, 'pending'), 'confirm');
  });

  it('conclui entrega em rota com codigo', () => {
    assert.equal(
      ifoodIntentForChatAction({ ...merchant, status: 'out_for_delivery' }, 'delivered'),
      'verify_delivery_code',
    );
  });

  it('nao trata pedido manual como iFood', () => {
    assert.equal(ifoodIntentForChatAction({ source: 'manual', status: 'pending_review' }, 'pending'), null);
  });
});
