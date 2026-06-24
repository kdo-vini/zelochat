import assert from 'node:assert/strict';
import {
  loadZeloMenuStoreCartCache,
  persistZeloMenuStoreCartCache,
  syncZeloMenuStoreCartCache,
  zeloMenuStoreCartStorageKey,
} from '../src/domain/zelomenuStoreCartCache.js';

const values = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  },
});

const slug = 'casa-dos-salgados';

persistZeloMenuStoreCartCache(slug, {
  items: {
    '1::plain': {
      key: '1::plain',
      productId: 1,
      productName: 'Coxinha',
      quantity: 2,
      selectedOptions: [],
      unitPrice: 5,
    },
  },
});
assert.equal(loadZeloMenuStoreCartCache(slug).items['1::plain']?.quantity, 2);

syncZeloMenuStoreCartCache({
  slug,
  state: 'cart_open',
  items: [{
    productId: 1,
    productName: 'Coxinha',
    quantity: 8,
    unitPrice: 5,
    selectedModifiers: [],
  }],
});
assert.equal(loadZeloMenuStoreCartCache(slug).items['1::plain']?.quantity, 8);
console.log('ok - sincroniza quantidade salva pelo checkout');

syncZeloMenuStoreCartCache({
  slug,
  state: 'cart_open',
  items: [],
});
assert.equal(localStorage.getItem(zeloMenuStoreCartStorageKey(slug)), null);
console.log('ok - carrinho vazio remove o cache restaurado pelo cardápio');

persistZeloMenuStoreCartCache(slug, {
  items: {
    '1::plain': {
      key: '1::plain',
      productId: 1,
      productName: 'Coxinha',
      quantity: 1,
      selectedOptions: [],
      unitPrice: 5,
    },
  },
});
syncZeloMenuStoreCartCache({
  slug,
  state: 'confirmed_waiting_review',
  items: [{
    productId: 1,
    productName: 'Coxinha',
    quantity: 1,
    unitPrice: 5,
    selectedModifiers: [],
  }],
});
assert.equal(localStorage.getItem(zeloMenuStoreCartStorageKey(slug)), null);
console.log('ok - confirmação limpa o cache para o próximo pedido');
