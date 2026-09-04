import { setConfig } from '../server/configStore.js';
import { simulateAtendimento } from '../server/aiSimulator.js';
import type { OrderingClient, OrderingDraftPlanner } from '../server/aiWhatsAppOrdering.js';
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
  // PR 1.1/1.3: the simulator now honors the same per-empresa hybrid-ordering
  // flag as production — this suite exercises the canonical dry-run path, so
  // it must explicitly opt this test empresa in, exactly as a real pilot
  // tenant would need to.
  aiHybridOrderingEnabled: true,
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
      }, {
        id: 'base',
        name: 'Escolha a base',
        minSelections: 0,
        maxSelections: 2,
        options: [
          { id: 'base-arroz', name: 'Arroz branco', priceDelta: 0 },
          { id: 'base-feijao', name: 'Feijão carioca', priceDelta: 0 },
        ],
      }, {
        id: 'acompanhamento',
        name: 'Escolha 1 acompanhamento',
        minSelections: 0,
        maxSelections: 1,
        options: [
          { id: 'acomp-farofa', name: 'Farofa', priceDelta: 0 },
          { id: 'acomp-pure', name: 'Purê de batata', priceDelta: 0 },
        ],
      }],
    }],
  }),
  updateDraft: async () => { throw new Error('simulator must not mutate a cart'); },
  getOrdering: async (_orderingId: string, _empresaId: string, _remoteJid: string) => { throw new Error('simulator must not read an ordering snapshot'); },
  confirmDraft: async () => { throw new Error('simulator must not confirm an order'); },
  cancelDraft: async () => { throw new Error('simulator must not cancel an order'); },
};

const emptyCatalogClient: OrderingClient = {
  ...catalogClient,
  searchCatalog: async () => ({ total: 0, ambiguous: false, results: [] }),
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
  {
    name: 'simulator states that rice and beans are both optional choices',
    run: async () => {
      const result = await simulateAtendimento(empresaId, {
        customerMessage: 'posso escolher arroz e feijão juntos ou tenho que escolher um?',
      }, { orderingClient: catalogClient });
      assertIncludes(result.reply, 'opcional', 'base reply identifies optional selection');
      assertIncludes(result.reply, 'até 2', 'base reply exposes the maximum cardinality');
      assertIncludes(result.reply, 'Arroz branco', 'base reply includes rice');
      assertIncludes(result.reply, 'Feijão carioca', 'base reply includes beans');
      assert(!/arroz branco ou feijão carioca/i.test(result.reply), 'base reply does not force an either/or choice');
    },
  },
  {
    name: 'simulator asks only the next missing fulfillment detail after a complete item selection',
    run: async () => {
      const draftPlanner: OrderingDraftPlanner = async () => ({
        items: [{
          productId: 879,
          quantity: 1,
          selectedOptions: [
            { groupId: 'mistura', optionSelections: [{ optionId: 'm2', quantity: 1 }] },
            { groupId: 'base', optionSelections: [
              { optionId: 'base-arroz', quantity: 1 },
              { optionId: 'base-feijao', quantity: 1 },
            ] },
            { groupId: 'acompanhamento', optionSelections: [
              { optionId: 'acomp-farofa', quantity: 1 },
              { optionId: 'acomp-pure', quantity: 1 },
            ] },
          ],
        }],
      });
      const result = await simulateAtendimento(empresaId, {
        customerMessage: 'quero uma marmita P de bisteca com arroz, feijão, farofa e purê',
      }, { orderingClient: catalogClient, orderingDraftPlanner: draftPlanner });
      assertIncludes(result.reply, 'entrega ou retirada', 'complete item selection asks fulfillment next');
      assert(!/quer.*feijão|quer.*farofa/i.test(result.reply), 'complete item selection is not asked again');
      assertEqual(result.wouldCreateOrder, false, 'dry-run does not create an order');
    },
  },
  {
    name: 'simulator previews a complete draft without mutating the cart',
    run: async () => {
      const draftPlanner: OrderingDraftPlanner = async () => ({
        items: [{
          productId: 879,
          quantity: 1,
          selectedOptions: [{
            groupId: 'mistura',
            optionSelections: [{ optionId: 'm2', quantity: 1 }],
          }],
        }],
        fulfillment: { type: 'pickup', asap: true },
        paymentMethod: 'Pix',
      });
      const result = await simulateAtendimento(empresaId, {
        customerMessage: 'quero a bisteca para retirar e pagar no Pix',
      }, { orderingClient: catalogClient, orderingDraftPlanner: draftPlanner });
      assertIncludes(result.reply, 'Marmita do dia', 'complete draft preview names the canonical product');
      assertIncludes(result.reply, 'retirada', 'complete draft preview includes fulfillment');
      assertIncludes(result.reply, 'Posso confirmar?', 'complete draft preview asks for confirmation');
      assertEqual(result.wouldCreateOrder, false, 'complete dry-run never creates an order');
    },
  },
  {
    name: 'simulator previews a friendly human handoff for an explicit request',
    run: async () => {
      const result = await simulateAtendimento(empresaId, {
        customerMessage: 'quero falar com um atendente humano',
      }, { orderingClient: catalogClient });
      assertIncludes(result.reply, 'atendente humano', 'handoff preview speaks to the customer');
      assertEqual(result.toolCallsMade[0], 'dispatch_trigger', 'handoff preview identifies the trigger tool');
      assertEqual(result.wouldCreateOrder, false, 'handoff preview never creates an order');
    },
  },
  {
    name: 'simulator previews a handoff for a clear complaint',
    run: async () => {
      const result = await simulateAtendimento(empresaId, {
        customerMessage: 'meu pedido veio errado e estou chateado',
      }, { orderingClient: catalogClient });
      assertIncludes(result.reply, 'gerência', 'complaint preview acknowledges management handoff');
      assertEqual(result.toolCallsMade[0], 'dispatch_trigger', 'complaint preview identifies the trigger tool');
    },
  },
  {
    name: 'simulator does not invent an unavailable catalog item',
    run: async () => {
      const result = await simulateAtendimento(empresaId, {
        customerMessage: 'tem salmão hoje?',
      }, { orderingClient: emptyCatalogClient });
      assertIncludes(result.reply, 'Não encontrei', 'unavailable item is stated plainly');
      assert(!/temos sim/i.test(result.reply), 'unavailable item is not presented as available');
    },
  },
  {
    name: 'simulator explains delivery fee without inventing a value',
    run: async () => {
      const result = await simulateAtendimento(empresaId, {
        customerMessage: 'quero entrega, quanto fica a taxa?',
      }, { orderingClient: catalogClient, orderingDraftPlanner: async () => null });
      assertIncludes(result.reply, 'cardápio', 'delivery reply points to the online menu');
      assertIncludes(result.reply, 'endereço', 'delivery reply explains when the fee is calculated');
      assert(!/R\$\s*\d/i.test(result.reply), 'delivery reply does not invent a fee');
    },
  },
]);
