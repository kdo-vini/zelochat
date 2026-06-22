import assert from 'node:assert/strict';
import {
  buildConfirmedCartCustomerMessage,
  buildPublicCartPath,
  computeCartPricing,
  createPublicCartToken,
  hashPublicCartToken,
  normalizePublicCartToken,
  resolveConfirmedCartState,
} from '../src/domain/zelomenuCart.js';

const tests = [
  {
    name: 'normaliza apenas tokens seguros',
    run() {
      const created = createPublicCartToken();
      assert.ok(normalizePublicCartToken(created.token), 'token gerado é aceito');
      assert.equal(normalizePublicCartToken('  abc '), null, 'token curto demais é rejeitado');
      assert.equal(normalizePublicCartToken('abc$def'), null, 'caracteres inválidos são rejeitados');
    },
  },
  {
    name: 'hash do token é determinístico',
    run() {
      const created = createPublicCartToken();
      assert.equal(hashPublicCartToken(created.token), created.tokenHash);
      assert.equal(created.tokenLast4, created.token.slice(-4));
    },
  },
  {
    name: 'calcula subtotal e taxa com arredondamento monetário',
    run() {
      const pricing = computeCartPricing([
        { lineTotal: 10.105 },
        { lineTotal: 4.335 },
      ], 2.229);
      assert.deepEqual(pricing, {
        subtotal: 14.44,
        deliveryFee: 2.23,
        total: 16.67,
      });
    },
  },
  {
    name: 'gera rota pública do carrinho',
    run() {
      const path = buildPublicCartPath('abc_DEF-123');
      assert.equal(path, '/menu/carrinho/abc_DEF-123');
    },
  },
  {
    name: 'confirmação com Pix pendente aguarda comprovante',
    run() {
      assert.equal(
        resolveConfirmedCartState({ pixReceiptRequired: true, pixReceiptApproved: false }),
        'confirmed_waiting_payment',
      );
      assert.equal(
        resolveConfirmedCartState({ pixReceiptRequired: true, pixReceiptApproved: true }),
        'confirmed_waiting_review',
      );
      assert.equal(
        resolveConfirmedCartState({ pixReceiptRequired: false, pixReceiptApproved: false }),
        'confirmed_waiting_review',
      );
    },
  },
  {
    name: 'mensagem de carrinho confirmado não promete produção',
    run() {
      const message = buildConfirmedCartCustomerMessage({
        orderingId: '12345678-aaaa-bbbb-cccc-123456789012',
        state: 'confirmed_waiting_review',
        cart: {
          items: [{ productName: 'Coxinha', quantity: 2, unitPrice: 5, lineTotal: 10 }],
          observations: 'sem cebola',
        },
        fulfillment: {
          type: 'pickup',
          pickupDate: '2026-06-22',
          pickupTime: '18:30',
          deliveryAddress: null,
          deliveryNeighborhood: null,
          deliveryFee: 0,
        },
        pricing: { subtotal: 10, deliveryFee: 0, total: 10 },
        payment: { declaredMethod: 'Dinheiro', pixReceiptRequired: false, pixReceiptApproved: false },
      });

      assert.match(message, /Pedido recebido pelo cardápio/);
      assert.match(message, /A loja vai conferir/);
      assert.doesNotMatch(message, /produção/i);
    },
  },
];

let failures = 0;

for (const test of tests) {
  try {
    test.run();
    console.log(`ok - ${test.name}`);
  } catch (error) {
    failures++;
    console.error(`not ok - ${test.name}`);
    console.error(error);
  }
}

if (failures > 0) {
  process.exit(1);
}
