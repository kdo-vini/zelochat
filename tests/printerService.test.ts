import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildOrderText } from '../src/services/printerService.js';

describe('bilhete da impressora', () => {
  it('imprime todos os complementos de um item de grupo', () => {
    const text = buildOrderText({
      id: '59428cdd',
      customerName: 'Vinicius',
      customerPhone: '14997000091',
      items: [{
        quantity: 1,
        product: 'Monte sua Massa (Escolha sua massa: Penne • Molho: Sugo (Tomate) • Turbine com Proteínas: Picadinho de Frango, Bacon • Finalize com Acompanhamentos: Mussarela, Parmesão, Azeitona • Adicional para sua massa: Porção individual batata frita)',
      }],
      pickupDate: '2026-07-23',
      pickupTime: '21:15',
      paymentMethod: 'Pix',
      total: 48.99,
      createdAt: '2026-07-23T21:15:00-03:00',
      deliveryAddress: 'Olísvaldo José da Silva 217',
      status: 'preparing',
    }, 'Bem Servido');

    const normalizedText = text.replace(/\s+/g, ' ');
    for (const detail of [
      'Penne',
      'Sugo (Tomate)',
      'Picadinho de Frango',
      'Bacon',
      'Mussarela',
      'Parmesão',
      'Azeitona',
      'Porção individual batata frita',
    ]) {
      assert.ok(normalizedText.includes(detail), `bilhete deve conter: ${detail}`);
    }

    assert.ok(
      text.split('\n').every((receiptLine) => receiptLine.length <= 32),
      'nenhuma linha do bilhete deve ultrapassar a largura da impressora',
    );
  });
});
