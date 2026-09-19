import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { quoteManualDelivery, manualFulfillmentSnapshot } from '../src/domain/manualOrderFulfillment.js';

describe('quoteManualDelivery', () => {
  it('grava entrega com deliveryAddress e taxa do unico bairro', () => {
    const quote = quoteManualDelivery({
      deliveryAddress: 'Av. Julio Prestes, 930',
      neighborhoods: [{ name: 'Centro', fee: 8 }],
    });
    assert.equal(quote.type, 'delivery');
    assert.equal(quote.deliveryAddress, 'Av. Julio Prestes, 930');
    assert.equal(quote.deliveryFee, 8);
    assert.equal(manualFulfillmentSnapshot(quote, '2026-09-18', '19:00').deliveryAddress, 'Av. Julio Prestes, 930');
  });

  it('casa o nome do bairro dentro do endereco', () => {
    const quote = quoteManualDelivery({
      deliveryAddress: 'hotel esplanada quarto 61 centro',
      neighborhoods: [
        { name: 'Jardim', fee: 10 },
        { name: 'Centro', fee: 8 },
      ],
    });
    assert.equal(quote.deliveryFee, 8);
    assert.equal(quote.neighborhood, 'Centro');
  });

  it('taxa digitada ganha da tabela', () => {
    const quote = quoteManualDelivery({
      deliveryAddress: 'Hotel Esplanada',
      deliveryFee: '12,5',
      neighborhoods: [{ name: 'Centro', fee: 8 }],
    });
    assert.equal(quote.deliveryFee, 12.5);
  });

  it('endereco vazio e retirada', () => {
    const quote = quoteManualDelivery({ deliveryAddress: '  ' });
    assert.equal(quote.type, 'pickup');
    assert.equal(quote.deliveryFee, 0);
  });
});
