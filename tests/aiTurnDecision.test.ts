import {
  classifyConfirmationIntent,
  classifyPendingOrderTurn,
  shouldFinalizeAfterObservationAck,
} from '../src/domain/conversationState.js';
import { classifyOrderingTurn } from '../src/domain/aiWhatsAppOrdering.js';
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
    name: 'canonical classifier (PR I-11) agrees with the legacy classifier on qualified replies',
    run: () => {
      // Neither classifier may treat a qualified/edit reply as a bare final
      // confirmation — CLAUDE.md's documented set must be exactly what both
      // paths honor, so the SAME customer message never confirms on one path
      // and edits on the other.
      const qualified = [
        'sim, sem cebola',
        'fechou, só coloca troco pra 50',
        'certo, mas troca a coca',
        'confirmar mais tarde?',
        'confirmar só se trocar o refri',
      ];
      for (const text of qualified) {
        assertEqual(
          classifyPendingOrderTurn(text).action === 'confirm_pending_order',
          false,
          `legacy: "${text}" is not a bare confirmation`,
        );
        assertEqual(
          classifyOrderingTurn(text, true).kind === 'confirm',
          false,
          `canonical: "${text}" is not a bare confirmation`,
        );
      }
      const partialCancel = ['cancela a coca', 'cancela a entrega, vou retirar'];
      for (const text of partialCancel) {
        assertEqual(
          classifyPendingOrderTurn(text).action === 'cancel_pending_order',
          false,
          `legacy: "${text}" is not a full cancellation`,
        );
        assertEqual(
          classifyOrderingTurn(text, true).kind === 'cancel',
          false,
          `canonical: "${text}" is not a full cancellation`,
        );
      }
      // The documented bare-confirmation set (CLAUDE.md) plus "confirmar"
      // (FN C4 — the canonical button's own label) all confirm on the
      // canonical path.
      for (const word of ['sim', 'ok', 'fechado', 'certinho', 'pode confirmar', 'com certeza', 'confirmar', '👍', '✅', '👌', '🙏']) {
        assertEqual(classifyOrderingTurn(word, true).kind, 'confirm', `canonical: "${word}" confirms`);
      }
      // "pode" and "show" alone are NOT documented confirmations on either path.
      for (const word of ['pode', 'show']) {
        assertEqual(classifyOrderingTurn(word, true).kind === 'confirm', false, `canonical: bare "${word}" does not confirm`);
      }
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
