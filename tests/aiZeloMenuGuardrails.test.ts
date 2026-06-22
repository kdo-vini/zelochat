import { readFileSync } from 'node:fs';
import { assert, assertIncludes, runSuite } from './testHarness.js';

const aiSource = readFileSync('server/ai.ts', 'utf8');

function indexOfOrFail(text: string): number {
  const idx = aiSource.indexOf(text);
  assert(idx >= 0, `found marker: ${text}`);
  return idx;
}

await runSuite('AI ZeloMenu guardrails', [
  {
    name: 'AI opens ZeloMenu cart before falling back to pending order',
    run: () => {
      const openCart = indexOfOrFail('const cartSession = await openWhatsAppCartSession({');
      const fallbackWarn = indexOfOrFail('falling back to legacy pending order flow');
      const setPending = indexOfOrFail('await setPendingOrder({');

      assert(openCart < fallbackWarn, 'new cart flow is attempted before fallback warning');
      assert(fallbackWarn < setPending, 'legacy pending order starts only after new cart flow fails');
    },
  },
  {
    name: 'AI sends absolute ZeloMenu cart link to the customer',
    run: () => {
      assertIncludes(aiSource, 'const publicUrl = buildPublicCartUrl(getPublicAppBaseUrl(), cartSession.publicToken);', 'absolute cart URL is built server-side');
      assertIncludes(aiSource, 'const linkMsg = buildWhatsAppCartLinkMessage({', 'customer-facing link message helper is used');
      assertIncludes(aiSource, 'Carrinho ZeloMenu aberto:', 'chat audit trail records the new handoff');
    },
  },
]);
