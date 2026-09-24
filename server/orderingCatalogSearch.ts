import { clampCatalogQuery, type CatalogReplyResult } from '../src/domain/aiWhatsAppOrdering.js';
import { routeCatalogQuery, type OrderingRoute } from '../src/domain/orderingTurnRoute.js';

interface CatalogSearchClient {
  searchCatalog(input: { empresaId: string; query: string; limit?: number }): Promise<CatalogReplyResult>;
}

/**
 * The authority scores coverage of one query, not a shopping list. Combining
 * several dishes can put every dish below its relevance floor. Keep that
 * search, then recover candidates for each mentioned item without changing
 * the authority's ranking or treating alternative matches as chosen products.
 */
export async function searchOrderingCatalog(input: {
  client: CatalogSearchClient;
  empresaId: string;
  route: OrderingRoute;
  fallbackQuery: string;
}): Promise<CatalogReplyResult> {
  const query = routeCatalogQuery(input.route, input.fallbackQuery);
  const combined = await input.client.searchCatalog({ empresaId: input.empresaId, query, limit: 12 });
  const queries = [...new Set(input.route.items.map(clampCatalogQuery).filter(Boolean))];
  if (queries.length <= 1) return combined;

  const individual = new Array<CatalogReplyResult>(queries.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, queries.length) }, async () => {
    while (next < queries.length) {
      const index = next++;
      individual[index] = queries[index] === query ? combined : await input.client.searchCatalog({
        empresaId: input.empresaId, query: queries[index], limit: 12,
      });
    }
  }));

  // One candidate per product carries its complete modifier tree. Round-robin
  // gives each mentioned item a slot before one ambiguous item fills the cap.
  const groups = [...individual, combined].map((result) => result.results);
  const byProduct = new Map<number, CatalogReplyResult['results'][number]>();
  for (let index = 0; groups.some((group) => index < group.length); index++) {
    for (const group of groups) {
      const candidate = group[index];
      if (candidate && !byProduct.has(candidate.productId)) byProduct.set(candidate.productId, candidate);
    }
  }
  // Distinct dishes in separate unambiguous searches are a shopping list.
  // Alternative products for a single item still require clarification.
  const ambiguous = byProduct.size > 12 || individual.some((result) => result.ambiguous
    && (result.results.length === 0 || new Set(result.results.map((candidate) => candidate.productId)).size > 1));
  return {
    total: byProduct.size,
    ambiguous,
    results: [...byProduct.values()].slice(0, 12).map((candidate) => ({ ...candidate, ambiguous })),
  };
}
