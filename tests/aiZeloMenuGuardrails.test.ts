import { readFileSync } from 'node:fs';
import { assert, runSuite } from './testHarness.js';

// ZLM-310: a IA não monta mais pedidos. O fluxo antigo (abrir carrinho ZeloMenu
// no WhatsApp via openWhatsAppCartSession, com fallback para pending order
// legado) foi removido. Pedidos têm fonte única agora: nascem no cardápio
// online (ZeloMenu), e a IA apenas redireciona o cliente para o link da loja.
// Estes guardrails travam a ausência do código de criação de pedido na IA.

const aiSource = readFileSync('server/ai.ts', 'utf8');
const simulatorSource = readFileSync('server/aiSimulator.ts', 'utf8');

await runSuite('AI ZeloMenu guardrails (fonte única de pedidos)', [
  {
    // Asserções no FORMATO de chamada/definição (não no nome puro), porque os
    // comentários de remoção em ai.ts citam os nomes dos símbolos de propósito.
    name: 'AI no longer builds WhatsApp carts or legacy pending orders',
    run: () => {
      assert(!aiSource.includes('await openWhatsAppCartSession('), 'AI does not open WhatsApp cart sessions anymore');
      assert(!aiSource.includes('await setPendingOrder('), 'AI does not create legacy pending orders anymore');
      assert(!aiSource.includes('falling back to legacy pending order flow'), 'legacy fallback path is gone');
      assert(!aiSource.includes('buildWhatsAppCartLinkMessage('), 'AI does not assemble the WhatsApp cart link message anymore');
    },
  },
  {
    name: 'criar_pedido tool is removed from the AI tool stack',
    run: () => {
      assert(!aiSource.includes('export const CREATE_ORDER_TOOL'), 'CREATE_ORDER_TOOL definition is removed');
      assert(!aiSource.includes("name: 'criar_pedido'"), 'criar_pedido tool schema is gone');
      assert(!aiSource.includes('forceCreateOrderFromObservationAck'), 'forced criar_pedido tool_choice is gone (was a latent OpenAI 400)');
      // The AI must still keep the two read-only / signalling tools.
      assert(aiSource.includes('CONSULT_ORDER_TOOL'), 'consultar_pedido tool is retained');
      assert(aiSource.includes('DISPATCH_TRIGGER_TOOL'), 'dispatch_trigger tool is retained');
    },
  },
  {
    name: 'AI hands the customer the public store link built from the slug',
    run: () => {
      assert(aiSource.includes('buildPublicStoreUrl(getZeloMenuPublicBaseUrl(), cfg.zelomenuSlug)'), 'ordering link is built from the empresa slug');
      assert(aiSource.includes('cfg.zelomenuSlug'), 'prompt reads the public slug from config');
    },
  },
  {
    name: 'simulator mirrors production tool stack (no criar_pedido)',
    run: () => {
      assert(!simulatorSource.includes('CREATE_ORDER_TOOL'), 'simulator no longer offers criar_pedido');
      assert(!simulatorSource.includes("name === 'criar_pedido'"), 'simulator drops the criar_pedido dry-run');
    },
  },
]);
