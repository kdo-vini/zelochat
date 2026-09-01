import { setConfig } from '../server/configStore.js';
import { simulateAtendimento } from '../server/aiSimulator.js';
import type { OrderingClient } from '../server/aiWhatsAppOrdering.js';
import { assert, assertEqual, assertIncludes, runSuite } from './testHarness.js';

const empresaId = `sim-ordering-${Date.now()}`;

setConfig(empresaId, {
  name: 'Bem Servido',
  specialty: 'marmitas',
  openTime: '00:00',
  closeTime: '23:59',
  closedDays: [],
  timezone: 'America/Sao_Paulo',
  zelomenuSlug: 'bemservido',
  aiEnabled: true,
  aiMode: 'always_on',
  zelochatMode: 'restaurant',
});

const catalogClient: OrderingClient = {
  searchCatalog: async () => ({
    total: 1,
    ambiguous: false,
    results: [{
      productId: 879,
      publicName: 'Marmita do dia',
      currentPrice: 18,
      matchReason: 'modifier_group',
      ambiguous: false,
      modifierGroups: [{
        id: 'mistura',
        name: 'Escolha a mistura',
        minSelections: 1,
        maxSelections: 1,
        options: [
          { id: 'm1', name: 'Carne de panela', priceDelta: 0 },
          { id: 'm2', name: 'Bisteca de porco', priceDelta: 0 },
        ],
      }],
    }],
  }),
  updateDraft: async () => { throw new Error('simulator must not mutate a cart'); },
  getOrdering: async () => { throw new Error('simulator must not read an ordering snapshot'); },
  confirmDraft: async () => { throw new Error('simulator must not confirm an order'); },
  cancelDraft: async () => { throw new Error('simulator must not cancel an order'); },
};

await runSuite('AI simulator canonical ordering parity', [
  {
    name: 'simulator offers menu and written ordering on restaurant entry',
    run: async () => {
      const result = await simulateAtendimento(empresaId, {
        customerMessage: 'boa tarde, estão atendendo?',
      }, { orderingClient: catalogClient });
      assertIncludes(result.reply, 'https://menu.zelopdv.com.br/bemservido', 'entry reply contains the store URL');
      assertIncludes(result.reply, 'pedido por escrito', 'entry reply offers written ordering');
      assertEqual(result.toolCallsMade.length, 0, 'entry does not invoke tools');
      assertEqual(result.wouldCreateOrder, false, 'entry never creates an order');
      assertIncludes(result.simulationNote, 'fluxo canônico', 'entry reports canonical simulation');
    },
  },
  {
    name: 'simulator renders every option from the canonical catalog group',
    run: async () => {
      const result = await simulateAtendimento(empresaId, {
        customerMessage: 'oq tem de mistura hoje?',
      }, { orderingClient: catalogClient });
      assertIncludes(result.reply, 'Carne de panela', 'catalog reply includes the first mixture');
      assertIncludes(result.reply, 'Bisteca de porco', 'catalog reply includes the last mixture');
      assertIncludes(result.simulationNote, 'fluxo canônico', 'catalog reports canonical simulation');
    },
  },
]);
