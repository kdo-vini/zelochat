import { readFileSync } from 'node:fs';
import { assertIncludes, runSuite } from './testHarness.js';

const ai = readFileSync('server/ai.ts', 'utf8');
const router = readFileSync('server/router.ts', 'utf8');
const simulator = readFileSync('server/aiSimulator.ts', 'utf8');

await runSuite('AI canonical ordering follows restaurant mode', [
  {
    name: 'production AI enters canonical ordering for every non-general empresa',
    run: () => {
      assertIncludes(
        ai,
        /if \(!isGeneralMode\) \{\s+\/\/ FIX 2026-08-31:[\s\S]*?await tryHandleAiWhatsAppOrdering\(/,
        'the canonical handler is guarded only by restaurant mode',
      );
    },
  },
  {
    name: 'simulator enters canonical ordering for every restaurant-mode empresa',
    run: () => {
      assertIncludes(
        simulator,
        /if \(cfg\.zelochatMode !== 'general'\) \{[\s\S]*?tryHandleAiWhatsAppOrdering\(/,
        'the simulator mirrors production restaurant-mode routing',
      );
    },
  },
  {
    name: 'canonical button ids route before the legacy confirmation path',
    run: () => {
      assertIncludes(
        router,
        'if (buttonId && parseOrderingButton(buttonId)) {',
        'canonical button routing keeps the button-id and parser guard',
      );
    },
  },
  {
    name: 'typed confirmation collisions preserve the layer-3 duplicate-order guard',
    run: () => {
      assertIncludes(
        router,
        'if ((isHardConfirm || isHardCancel || isAlterText) && !(buttonId && parseOrderingButton(buttonId))) {',
        'typed actions retain every non-rollout condition and the canonical-button negation',
      );
    },
  },
]);
