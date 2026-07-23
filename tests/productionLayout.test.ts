import { readFileSync } from 'node:fs';
import { assert, assertIncludes, runSuite } from './testHarness.js';

const productionView = readFileSync(new URL('../src/components/views/ProductionView.tsx', import.meta.url), 'utf8');
const appStyles = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

await runSuite('Layout responsivo da Produção', [
  {
    name: 'fila de pedidos pode ser redimensionada e persiste a preferência',
    run() {
      assertIncludes(productionView, 'PRODUCTION_LAYOUT_STORAGE_KEY', 'layout da Produção tem chave persistente');
      assertIncludes(productionView, 'md:w-[var(--production-feed-width)]', 'fila usa largura customizada em desktop');
      assertIncludes(productionView, 'onPointerDown={(event) => startResize(event, \'feed\')}', 'fila tem alça de arraste');
      assertIncludes(productionView, 'onDoubleClick={resetLayout}', 'layout tem restauração rápida');
    },
  },
  {
    name: 'colunas usam largura adaptativa com override individual',
    run() {
      assertIncludes(productionView, 'min-w-[152px] flex-1', 'colunas encolhem até uma largura legível');
      assertIncludes(productionView, 'production-column-resize-handle', 'cada coluna tem alça própria');
      assertIncludes(productionView, 'columnWidths[col]', 'largura da coluna é individual');
      assert(!productionView.includes('w-[260px]'), 'não mantém largura fixa que corta o Kanban');
      assertIncludes(appStyles, 'scrollbar-color:', 'rolagem horizontal permanece visível');
    },
  },
  {
    name: 'alças continuam acessíveis sem mouse',
    run() {
      assertIncludes(productionView, 'role="separator"', 'alças expõem separador semântico');
      assertIncludes(productionView, 'handleResizeKeyDown', 'alças aceitam teclado');
      assertIncludes(productionView, 'ArrowLeft', 'teclado reduz a largura');
      assertIncludes(productionView, 'ArrowRight', 'teclado aumenta a largura');
    },
  },
]);
