import {
  classifyConfirmationIntent,
  classifyPendingOrderTurn,
  shouldFinalizeAfterObservationAck,
} from '../src/domain/conversationState.js';
import { assertEqual, runSuite } from './testHarness.js';

await runSuite('AI turn decision regression', [
  {
    name: 'natural Portuguese confirm/cancel phrases with qualifiers do not hard-confirm',
    run: () => {
      assertEqual(
        classifyPendingOrderTurn('confirmar mais tarde?').action,
        'edit_pending_order',
        'confirmar mais tarde is a scheduling/edit intent',
      );
      assertEqual(
        classifyPendingOrderTurn('confirmar só se trocar o refri').action,
        'edit_pending_order',
        'confirmar so se carries a condition, not final consent',
      );
      assertEqual(
        classifyPendingOrderTurn('cancelar só a coca').action,
        'edit_pending_order',
        'partial cancellation is an edit',
      );
      assertEqual(
        classifyPendingOrderTurn('cancela a coca').action,
        'edit_pending_order',
        'partial cancellation without só is an edit',
      );
      assertEqual(
        classifyPendingOrderTurn('cancela a entrega, vou retirar').action,
        'edit_pending_order',
        'changing delivery to pickup is an edit',
      );
    },
  },
  {
    name: 'pending order edits preserve the customer change text',
    run: () => {
      const cases = [
        'sim, sem cebola',
        'fechou, só coloca troco pra 50',
        'troca a coca por guaraná',
        'muda pra retirada',
      ];
      for (const text of cases) {
        const decision = classifyPendingOrderTurn(text);
        assertEqual(decision.action, 'edit_pending_order', `"${text}" is handled as edit`);
        if (decision.action === 'edit_pending_order') {
          assertEqual(decision.editText, text, `"${text}" is preserved for same-turn AI processing`);
        }
      }
    },
  },
  {
    name: 'no-observation replies force order creation instead of another summary loop',
    run: () => {
      const base = 'Gostaria de alterar algo, ou tem alguma observação a fazer?';
      for (const text of ['nada', 'sem obs', 'sem alteração', 'não, deixa como tá', 'não muda nada', '👍']) {
        assertEqual(
          shouldFinalizeAfterObservationAck([
            { role: 'assistant', content: base },
            { role: 'user', content: text },
          ]),
          true,
          `"${text}" should finalize after observation prompt`,
        );
      }
    },
  },
  {
    name: 'reaction-like enthusiasm emoji are not treated as consent',
    run: () => {
      for (const text of ['🔥', '❤', '💕', '👏', '😊']) {
        assertEqual(
          classifyConfirmationIntent(text, { lastAiQuestion: 'pending_button_confirm' }),
          'unknown',
          `"${text}" is not enough to confirm money/order`,
        );
      }
      assertEqual(
        classifyConfirmationIntent('👍', { lastAiQuestion: 'pending_button_confirm' }),
        'emoji_only_confirm',
        'thumbs-up remains consent in pending context',
      );
      assertEqual(
        classifyPendingOrderTurn('com certeza').action,
        'confirm_pending_order',
        'com certeza is a common confirmation, not an edit caused by "com"',
      );
      assertEqual(
        classifyPendingOrderTurn('sim, com certeza').action,
        'confirm_pending_order',
        'sim, com certeza is a common confirmation',
      );
    },
  },
  {
    name: 'ambiguous pending replies ask clarification instead of clearing the order',
    run: () => {
      for (const text of ['vendo aqui', 'pera', 'já te falo']) {
        assertEqual(
          classifyPendingOrderTurn(text).action,
          'clarify_pending_order',
          `"${text}" is not enough to confirm/cancel/edit`,
        );
      }
    },
  },
]);
