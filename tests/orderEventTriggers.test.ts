import { selectOrderCreatedNotifyTriggers } from '../src/domain/orderEventTriggers.js';
import { assert, assertEqual, runSuite } from './testHarness.js';

const baseTrigger = {
  id: 't1',
  kind: 'notify_manager',
  name: 'Novo pedido',
  conditionDescription: 'Alerta o gerente sempre que um novo pedido for feito.',
  naturalInput: 'avise quando tiver novo pedido',
  active: true,
};

await runSuite('Order event trigger selection', [
  {
    name: 'notify_manager novo pedido fires from confirmed order event',
    run: () => {
      const matches = selectOrderCreatedNotifyTriggers(
        [baseTrigger],
        [{ product: 'Cento Tradicionais Sortidos', quantity: 100 }],
      );

      assertEqual(matches.length, 1, 'one trigger selected');
      assertEqual(matches[0].trigger.id, 't1', 'selected trigger is Novo pedido');
      assertEqual(matches[0].reason, 'Novo pedido confirmado', 'reason is deterministic');
    },
  },
  {
    name: 'large order notify trigger fires when total items crosses configured threshold',
    run: () => {
      const matches = selectOrderCreatedNotifyTriggers(
        [{
          id: 'large',
          kind: 'notify_manager',
          name: 'Pedido grande de salgados',
          conditionDescription: 'Cliente pediu mais de 300 salgados.',
          naturalInput: '',
          active: true,
        }],
        [
          { product: 'Cento Tradicionais Sortidos', quantity: 200 },
          { product: 'Cento de Coxinha de frango', quantity: 150 },
        ],
      );

      assertEqual(matches.length, 1, 'large-order trigger selected');
      assert(matches[0].reason.includes('350 itens'), 'reason includes total quantity');
    },
  },
  {
    name: 'inactive and escalation triggers are ignored for order event notifications',
    run: () => {
      const matches = selectOrderCreatedNotifyTriggers(
        [
          { ...baseTrigger, id: 'off', active: false },
          { ...baseTrigger, id: 'human', kind: 'escalate_human' },
        ],
        [{ product: 'Cento Tradicionais Sortidos', quantity: 100 }],
      );

      assertEqual(matches.length, 0, 'no non-notify active trigger selected');
    },
  },
]);
