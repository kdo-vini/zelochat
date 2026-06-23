import assert from 'node:assert/strict';
import {
  buildAcceptedCartCustomerMessage,
  buildConfirmedCartCustomerMessage,
  buildPublicCartUrl,
  buildWhatsAppCartLinkMessage,
  buildPublicCartPath,
  computeCartPricing,
  createPublicCartToken,
  hashPublicCartToken,
  normalizePublicCartToken,
  resolveConfirmedCartState,
  resolveDeliveryFeeForNeighborhood,
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
      assert.equal(
        buildPublicCartUrl('https://chat.zelopdv.com.br/', 'abc_DEF-123'),
        'https://chat.zelopdv.com.br/menu/carrinho/abc_DEF-123',
      );
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
          items: [{
            productId: 1,
            productName: 'Coxinha',
            baseUnitPrice: 5,
            selectedModifiers: [{
              groupId: 'group-1',
              groupName: 'Molhos',
              kind: 'adicional',
              selectedOptions: [{ optionId: 'option-1', optionName: 'Maionese verde', priceDelta: 1.5 }],
            }],
            modifierDeltaTotal: 1.5,
            quantity: 2,
            unitPrice: 6.5,
            lineTotal: 13,
          }],
          observations: 'sem cebola',
        },
        fulfillment: {
          type: 'pickup',
          pickupDate: '2026-06-22',
          pickupTime: '18:30',
          deliveryAddress: null,
          deliveryNeighborhood: null,
          deliveryFee: 0,
          deliveryFeeToConfirm: false,
        },
        pricing: { subtotal: 13, deliveryFee: 0, total: 13 },
        payment: { declaredMethod: 'Dinheiro', pixReceiptRequired: false, pixReceiptApproved: false },
      });

      assert.match(message, /Pedido recebido pelo cardápio/);
      assert.match(message, /Molhos: Maionese verde/);
      assert.match(message, /A loja vai conferir/);
      assert.doesNotMatch(message, /produção/i);
    },
  },
  {
    name: 'mensagem do link orienta revisão no ZeloMenu',
    run() {
      const message = buildWhatsAppCartLinkMessage({
        publicUrl: 'https://chat.zelopdv.com.br/menu/carrinho/token123',
        customerName: 'João',
        summary: '📦 2x Coxinha\n📅 Retirada: 2026-06-22 às 18:30\n💳 Pagamento: Pix\n💰 Total: R$ 10.00',
        pixReceiptRequired: true,
      });

      assert.match(message, /João/);
      assert.match(message, /https:\/\/chat\.zelopdv\.com\.br\/menu\/carrinho\/token123/);
      assert.match(message, /revisar com calma, ajustar se precisar e confirmar/i);
      assert.match(message, /comprovante será pedido no WhatsApp/i);
    },
  },
  {
    name: 'mensagem de aceite final entra em produção sem citar cardápio',
    run() {
      const message = buildAcceptedCartCustomerMessage({
        orderId: 'abcdef12-aaaa-bbbb-cccc-123456789012',
        cart: {
          items: [{
            productId: 1,
            productName: 'Coxinha',
            baseUnitPrice: 5,
            selectedModifiers: [{
              groupId: 'group-1',
              groupName: 'Molhos',
              kind: 'adicional',
              selectedOptions: [{ optionId: 'option-1', optionName: 'Maionese verde', priceDelta: 1.5 }],
            }],
            modifierDeltaTotal: 1.5,
            quantity: 2,
            unitPrice: 6.5,
            lineTotal: 13,
          }],
          observations: 'sem cebola',
        },
        fulfillment: {
          type: 'pickup',
          pickupDate: '2026-06-22',
          pickupTime: '18:30',
          deliveryAddress: null,
          deliveryNeighborhood: null,
          deliveryFee: 0,
          deliveryFeeToConfirm: false,
        },
        pricing: { subtotal: 13, deliveryFee: 0, total: 13 },
        payment: { declaredMethod: 'Pix', pixReceiptRequired: false, pixReceiptApproved: false },
      });

      assert.match(message, /Pedido confirmado!/);
      assert.match(message, /Molhos: Maionese verde/);
      assert.match(message, /entrou na produção/i);
      assert.doesNotMatch(message, /cardápio/i);
    },
  },
  {
    name: 'bairro listado soma a taxa cadastrada (D-082)',
    run() {
      const neighborhoods = [{ name: 'Centro', fee: 5 }, { name: 'Zona Sul', fee: 7.5 }];
      const resolved = resolveDeliveryFeeForNeighborhood({
        type: 'delivery',
        neighborhood: 'centro', // case/acento-insensitive
        neighborhoods,
      });
      assert.deepEqual(resolved, { fee: 5, toConfirm: false });
    },
  },
  {
    name: 'retirada nunca tem taxa nem precisa confirmar',
    run() {
      const resolved = resolveDeliveryFeeForNeighborhood({
        type: 'pickup',
        neighborhood: 'Centro',
        neighborhoods: [{ name: 'Centro', fee: 5 }],
      });
      assert.deepEqual(resolved, { fee: 0, toConfirm: false });
    },
  },
  {
    name: 'bairro livre fora da lista vira taxa a confirmar (D-081/D-083)',
    run() {
      const resolved = resolveDeliveryFeeForNeighborhood({
        type: 'delivery',
        neighborhood: 'Bairro Novo que ninguém cadastrou',
        neighborhoods: [{ name: 'Centro', fee: 5 }],
      });
      assert.deepEqual(resolved, { fee: 0, toConfirm: true });
    },
  },
  {
    name: 'entrega sem bairro definido fica a confirmar, não bloqueia',
    run() {
      const resolved = resolveDeliveryFeeForNeighborhood({
        type: 'delivery',
        neighborhood: '',
        neighborhoods: [{ name: 'Centro', fee: 5 }],
      });
      assert.deepEqual(resolved, { fee: 0, toConfirm: true });
    },
  },
  {
    name: 'mensagem de confirmação avisa taxa a confirmar quando bairro é livre',
    run() {
      const message = buildConfirmedCartCustomerMessage({
        orderingId: '12345678-aaaa-bbbb-cccc-123456789012',
        state: 'confirmed_waiting_review',
        cart: { items: [], observations: null },
        fulfillment: {
          type: 'delivery',
          pickupDate: '2026-06-23',
          pickupTime: '19:00',
          deliveryAddress: 'Rua das Flores, 100',
          deliveryNeighborhood: 'Bairro Distante',
          deliveryFee: 0,
          deliveryFeeToConfirm: true,
        },
        pricing: { subtotal: 20, deliveryFee: 0, total: 20 },
        payment: { declaredMethod: 'Dinheiro', pixReceiptRequired: false, pixReceiptApproved: false },
      });
      assert.match(message, /Taxa de entrega: a confirmar/i);
      assert.match(message, /Bairro: Bairro Distante/);
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
