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
        productName: 'Monte sua Massa',
        modifierGroups: [
          { groupName: 'Escolha sua massa', optionNames: ['Penne'] },
          { groupName: 'Molho', optionNames: ['Sugo (Tomate)'] },
          { groupName: 'Turbine com Proteínas', optionNames: ['Picadinho de Frango', 'Bacon'] },
          { groupName: 'Finalize com Acompanhamentos', optionNames: ['Mussarela', 'Parmesão', 'Azeitona'] },
          { groupName: 'Adicional para sua massa', optionNames: ['Porção individual batata frita'] },
        ],
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
    assert.ok(text.includes('1x Monte sua Massa\n'), 'produto deve ocupar sua própria linha');
    assert.ok(text.includes('  Escolha sua massa: Penne\n'), 'cada grupo deve começar em uma linha própria');
    assert.ok(text.includes('  Molho: Sugo (Tomate)\n'), 'grupo de molho deve ficar separado');
    assert.ok(!text.includes('Monte sua Massa ('), 'o bilhete não deve repetir o resumo achatado');
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
