/**
 * C6 / PR I-9 — a canonical interactive tap with no display title must
 * never leak its raw id (e.g. `ZOC:<confirmationToken>|<revision>`,
 * `REQ:<requirementId>|<optionId>|<fingerprint>`) into the stored customer
 * message content. Routing never depended on this value (`router.ts`
 * re-derives the button id from the live webhook payload independently),
 * so a generic human-readable placeholder is exactly as functional.
 *
 * Run via: npx tsx tests/messageHandlerInteractiveText.test.ts
 */
import { __extractTextForTests } from '../server/messageHandler.ts';
import { assert, assertEqual, runSuite } from './testHarness.js';

const { extractText } = __extractTextForTests;

await runSuite('extractText interactive id leak (C6 / PR I-9)', [
  {
    name: 'a button tap with no display title stores a generic placeholder, never the raw id',
    run: () => {
      const msg = {
        message: {
          buttonsResponseMessage: {
            selectedButtonId: 'ZOC:opaque-confirmation-token-value|7',
            // selectedDisplayText intentionally absent
          },
        },
      };
      const text = extractText(msg);
      assertEqual(text, '[Opção selecionada]', 'no raw button id leaks into stored content');
      assert(!text?.includes('opaque-confirmation-token-value'), 'confirmation token never appears in stored content');
    },
  },
  {
    name: 'a REQ requirement button tap with no title stores a generic placeholder',
    run: () => {
      const msg = {
        message: {
          buttonsResponseMessage: {
            selectedButtonId: 'REQ:linha-1:g002|o9|abc123',
          },
        },
      };
      assertEqual(extractText(msg), '[Opção selecionada]', 'no raw requirement button id leaks into stored content');
    },
  },
  {
    name: 'a list row tap with no title stores a list-specific placeholder',
    run: () => {
      const msg = {
        message: {
          listResponseMessage: {
            singleSelectReply: { selectedRowId: 'REQ:linha-1:g002|o9|abc123' },
          },
        },
      };
      assertEqual(extractText(msg), '[Item selecionado na lista]', 'no raw list row id leaks into stored content');
    },
  },
  {
    name: 'a button tap WITH a display title still stores the human label (unchanged)',
    run: () => {
      const msg = {
        message: {
          buttonsResponseMessage: {
            selectedButtonId: 'ZOC:opaque-confirmation-token-value|7',
            selectedDisplayText: 'Confirmar',
          },
        },
      };
      assertEqual(extractText(msg), 'Confirmar', 'a real display title is still used verbatim');
    },
  },
]);
