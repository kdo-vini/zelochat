import { readFileSync } from 'node:fs';
import { assert, runSuite } from './testHarness.js';

const viewSource = readFileSync(
  new URL('../src/components/views/AIConfigsView.tsx', import.meta.url),
  'utf8',
);

function declarationPrecedesUse(declaration: RegExp, usage: string): boolean {
  const declarationMatch = declaration.exec(viewSource);
  const usageIndex = viewSource.indexOf(usage);
  return declarationMatch !== null && usageIndex >= 0 && declarationMatch.index < usageIndex;
}

await runSuite('AI configs view guardrails', [
  {
    name: 'quick-response save state is declared before rendering the list',
    run: () => {
      assert(
        declarationPrecedesUse(
          /const \[qrSaveState, setQrSaveState\]/,
          'qrSaveState[qr.id]',
        ),
        'qrSaveState has a live React state binding',
      );
    },
  },
  {
    name: 'quick-response debounce ref is declared before scheduling saves',
    run: () => {
      assert(
        declarationPrecedesUse(
          /const qrDebounceRef\s*=\s*useRef/,
          'qrDebounceRef.current[id]',
        ),
        'qrDebounceRef has a live ref binding',
      );
    },
  },
  {
    name: 'prompt textarea ref is declared before focus and render use',
    run: () => {
      assert(
        declarationPrecedesUse(
          /const promptRef\s*=\s*useRef<HTMLTextAreaElement>/,
          'promptRef.current?.focus()',
        ),
        'promptRef has a live textarea ref binding',
      );
    },
  },
]);
