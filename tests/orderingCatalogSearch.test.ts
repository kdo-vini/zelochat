import assert from 'node:assert/strict';
import { searchOrderingCatalog } from '../server/orderingCatalogSearch.js';
import type { CatalogReplyResult } from '../src/domain/aiWhatsAppOrdering.js';

const result = (ids: number[], ambiguous = false): CatalogReplyResult => ({
  total: ids.length, ambiguous,
  results: ids.map((productId) => ({ productId, publicName: `Prato ${productId}`, currentPrice: 20, matchReason: 'nome_publico', ambiguous })),
});
const search = async (items: string[], responses: Record<string, CatalogReplyResult>) => {
  let active = 0;
  let peak = 0;
  const calls: string[] = [];
  const catalog = await searchOrderingCatalog({
    empresaId: 'empresa', fallbackQuery: 'pedido', route: { intent: 'pedido', confidence: 1, items },
    client: { searchCatalog: async ({ query }) => {
      calls.push(query);
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return responses[query] ?? result([]);
    } },
  });
  return { catalog, calls, peak };
};

const recovered = await search(['caldo verde', 'lasanha', 'escondidinho'], {
  'caldo verde': result([1]), lasanha: result([2]), escondidinho: result([3]),
});
assert.deepEqual(recovered.catalog.results.map((candidate) => candidate.productId), [1, 2, 3]);
assert.equal(recovered.catalog.ambiguous, false, 'three specifically named dishes are not alternatives');
assert.equal(recovered.calls[0], 'caldo verde, lasanha, escondidinho');
assert.ok(recovered.peak <= 3);

const ambiguous = await search(['caldo', 'lasanha'], { caldo: result([1, 4], true), lasanha: result([2]) });
assert.equal(ambiguous.catalog.ambiguous, true, 'alternative matches for one item remain ambiguous');
const modifiers = await search(['penne', 'bacon'], { penne: result([1, 1], true), bacon: result([1]) });
assert.equal(modifiers.catalog.ambiguous, false, 'options of the same product are specifications');
assert.equal(modifiers.catalog.total, 1);

const capped = await search(['caldo', 'lasanha'], {
  caldo: result(Array.from({ length: 12 }, (_, index) => index + 1), true), lasanha: result([20]),
});
assert.equal(capped.catalog.results.length, 12);
assert.ok(capped.catalog.results.some((candidate) => candidate.productId === 20), 'later items retain a slot');
assert.equal(capped.catalog.total, 13);
const single = await search(['lasanha'], { lasanha: result([2]) });
assert.deepEqual(single.calls, ['lasanha']);
await assert.rejects(searchOrderingCatalog({
  empresaId: 'empresa', fallbackQuery: '', route: { intent: 'pedido', confidence: 1, items: ['caldo', 'lasanha'] },
  client: { searchCatalog: async ({ query }) => { if (query === 'lasanha') throw new Error('unavailable'); return result([1]); } },
}), /unavailable/, 'a failed item lookup must not silently become a partial shopping list');
console.log('orderingCatalogSearch tests passed');
