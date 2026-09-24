import assert from 'node:assert/strict';
import {
  CATALOG_QUERY_MAX_LENGTH,
} from '../src/domain/aiWhatsAppOrdering.js';
import {
  decideOrderingEntry,
  ORDERING_INTENTS,
  parseOrderingRoute,
  routeCatalogQuery,
} from '../src/domain/orderingTurnRoute.js';

const validRoute = { intent: 'pedido', confidence: 0.9, items: ['Penne', ' molho branco '] };
assert.deepEqual(parseOrderingRoute(validRoute), {
  intent: 'pedido',
  confidence: 0.9,
  items: ['Penne', 'molho branco'],
});
assert.deepEqual(parseOrderingRoute(JSON.stringify(validRoute)), {
  intent: 'pedido',
  confidence: 0.9,
  items: ['Penne', 'molho branco'],
});
assert.equal(parseOrderingRoute({ ...validRoute, intent: 'desconhecido' }), null);
for (const confidence of [-0.1, 1.1, NaN, '0.9']) {
  assert.equal(parseOrderingRoute({ ...validRoute, confidence }), null);
}
assert.equal(parseOrderingRoute({ ...validRoute, items: 'penne' }), null);
assert.equal(parseOrderingRoute({ ...validRoute, items: ['penne', 2] }), null);
assert.equal(parseOrderingRoute('{malformed json'), null);
for (const input of [null, undefined, 42]) assert.equal(parseOrderingRoute(input), null);

const cleanedItems = parseOrderingRoute({
  intent: 'pedido',
  confidence: 0.9,
  items: [
    '  Penne  ',
    'penne',
    '',
    '   ',
    'x'.repeat(61),
    ...Array.from({ length: 10 }, (_, index) => `item ${index}`),
  ],
});
assert.deepEqual(cleanedItems?.items, ['Penne', ...Array.from({ length: 9 }, (_, index) => `item ${index}`)]);

for (const intent of ORDERING_INTENTS) {
  const route = { intent, confidence: 0.9, items: [] };
  const expected = intent === 'pedido' || intent === 'duvida_cardapio'
    ? 'order'
    : intent === 'pedir_cardapio' ? 'menu_request' : 'generic';
  assert.equal(decideOrderingEntry(route), expected);
}
assert.equal(decideOrderingEntry({ intent: 'pedido', confidence: 0.59, items: [] }), 'generic');
assert.equal(decideOrderingEntry({ intent: 'pedido', confidence: 0.6, items: [] }), 'order');

assert.equal(
  routeCatalogQuery({ intent: 'pedido', confidence: 0.9, items: ['macarrão penne', 'molho branco'] }, 'fallback'),
  'macarrão penne, molho branco',
);
assert.equal(
  routeCatalogQuery({ intent: 'pedido', confidence: 0.9, items: [] }, '  fallback  '),
  'fallback',
);
const clampedQuery = routeCatalogQuery({
  intent: 'pedido',
  confidence: 0.9,
  items: Array.from({ length: 10 }, (_, index) => `item-${index}-${'x'.repeat(30)}`),
}, 'fallback');
assert.ok(clampedQuery.length <= CATALOG_QUERY_MAX_LENGTH);

console.log('orderingTurnRoute tests passed');
