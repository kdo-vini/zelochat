import assert from 'node:assert/strict';
import { renderCatalogReply, type CatalogReplyResult } from '../src/domain/aiWhatsAppOrdering.js';

const catalog: CatalogReplyResult = {
  total: 1, ambiguous: false,
  results: [{
    productId: 7, publicName: 'Lasanha', currentPrice: 25,
    displayPrice: { kind: 'from', amount: 25 },
    matchReason: 'name', ambiguous: false,
    modifierGroups: [{ id: 'side', name: 'Acompanhamento', minSelections: 0, maxSelections: 1,
      options: [
        { id: 'salad', name: 'Salada', priceDelta: 5 },
        { id: 'rice', name: 'Arroz', priceDelta: 0, available: false },
      ],
    }],
  }],
};

const price = renderCatalogReply(catalog, 'Quero saber o preço da lasanha', null, null, true);
assert.match(price, /a partir de R\$/);
assert.doesNotMatch(price, /Qual você quer|Tem sim|Posso confirmar/);
assert.match(price, /Salada/);
assert.doesNotMatch(price, /Arroz/);

const ingredients = renderCatalogReply(catalog, 'A lasanha vem com salada?', null, null, true);
assert.match(ingredients, /opcional/);
assert.match(ingredients, /Não tenho a composição completa/);
assert.doesNotMatch(ingredients, /Tem sim|Qual você quer/);
assert.match(renderCatalogReply(catalog, 'Tem lasanha?', null, 'Agora estamos fechados.', true), /Agora estamos fechados/);
assert.match(renderCatalogReply(catalog, 'lasanha'), /Qual você quer/);
console.log('orderingCatalogQuestions tests passed');
