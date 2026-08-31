import { readFileSync } from 'node:fs';
import { assert, assertIncludes, runSuite } from './testHarness.js';

const sidebar = readFileSync(new URL('../src/components/Sidebar.tsx', import.meta.url), 'utf8');

await runSuite('Camada única da sidebar', [
  {
    name: 'mantém navegação e rodapé no mesmo contêiner de rolagem',
    run() {
      assertIncludes(sidebar, 'min-h-0', 'a própria sidebar pode encolher dentro do layout');
      assertIncludes(sidebar, 'overflow-y-auto custom-scrollbar', 'a própria sidebar controla a rolagem');
      assertIncludes(sidebar, '<div className="flex min-h-full flex-col py-3">', 'o conteúdo interno ocupa toda a altura disponível');
      assertIncludes(sidebar, '<div className="px-2 flex-1">', 'a navegação principal não cria uma segunda camada de rolagem');
      assert(!sidebar.includes('flex-1 overflow-y-auto custom-scrollbar'), 'não há um segundo contêiner de rolagem sobreposto ao rodapé');
    },
  },
]);
