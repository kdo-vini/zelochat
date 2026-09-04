import { readFileSync } from 'node:fs';
import { assertIncludes, runSuite } from './testHarness.js';

const router = readFileSync(new URL('../server/router.ts', import.meta.url), 'utf8');

await runSuite('Status do pedido escrito pelo WhatsApp', [
  {
    name: 'expõe a capacidade autenticada usada pela tela de Configurações',
    run() {
      assertIncludes(
        router,
        "router.get('/api/ai-ordering-status'",
        'o backend atende a rota consultada pelo frontend',
      );
      assertIncludes(
        router,
        /router\.get\('\/api\/ai-ordering-status'[\s\S]*?await requireEmpresaId\(req\)[\s\S]*?ZeloMenuInternalClient\.fromEnv\(\)/,
        'a rota autentica a empresa antes de verificar a integração privada',
      );
      assertIncludes(
        router,
        /router\.get\('\/api\/ai-ordering-status'[\s\S]*?res\.json\(\{ enabled: client !== null \}\);/,
        'a resposta usa o contrato booleano consumido pela interface',
      );
    },
  },
]);
