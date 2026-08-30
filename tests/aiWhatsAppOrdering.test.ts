import assert from 'node:assert/strict';
import {
  AI_ORDER_CONFIRM_PREFIX,
  applyOrderingDefaults,
  buildConfirmationButtons,
  classifyOrderingTurn,
  getAiWhatsAppOrderingMode,
  parseOrderingButton,
  renderCatalogReply,
  renderOrderingSummary,
  type OrderingSnapshot,
} from '../src/domain/aiWhatsAppOrdering.js';
import {
  ORDERING_MODEL_TOOLS,
  ZeloMenuInternalClient,
  ZeloMenuInternalError,
} from '../server/zeloMenuInternalClient.js';

function snapshot(overrides: Partial<OrderingSnapshot> = {}): OrderingSnapshot {
  return {
    orderingId: '11111111-1111-4111-8111-111111111111',
    empresaId: '22222222-2222-4222-8222-222222222222',
    remoteJid: '5511999999999@s.whatsapp.net',
    state: 'cart_open',
    revision: 2,
    cart: {
      items: [{
        productId: 10,
        productName: 'Marmita do dia',
        baseUnitPrice: 20,
        selectedModifiers: [{
          groupId: 4,
          groupName: 'Escolha a mistura',
          kind: 'single',
          selectedOptions: [{ optionId: 7, optionName: 'Frango', priceDelta: 0, quantity: 1 }],
        }],
        modifierDeltaTotal: 0,
        quantity: 2,
        unitPrice: 20,
        lineTotal: 40,
      }],
    },
    customer: { name: 'Ana', phone: '5511999999999' },
    fulfillment: {
      type: 'delivery',
      asap: true,
      deliveryAddress: 'Rua das Flores',
      deliveryNumber: '10',
      deliveryNeighborhood: 'Centro',
      deliveryFee: 5,
      deliveryFeeToConfirm: false,
    },
    payment: { declaredMethod: 'pix', pixReceiptRequired: false, pixReceiptApproved: false },
    pricing: { subtotal: 40, deliveryFee: 5, discount: 0, total: 45 },
    revalidation: { checkedAt: new Date(0).toISOString(), ok: true, issues: [] },
    confirmationAction: { type: 'confirm_order', token: 'opaque-token', revision: 2, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    requiresReview: false,
    order: null,
    ...overrides,
  };
}

// Fail closed, with independent global shadow and active switches.
assert.equal(getAiWhatsAppOrderingMode({}), 'off');
assert.equal(getAiWhatsAppOrderingMode({ ZELOCHAT_AI_ORDERING_SHADOW: '1' }), 'off');
assert.equal(getAiWhatsAppOrderingMode({ ZELOCHAT_AI_ORDERING_KILL_SWITCH: '0', ZELOCHAT_AI_ORDERING_SHADOW: '1' }), 'shadow');
assert.equal(getAiWhatsAppOrderingMode({ ZELOCHAT_AI_ORDERING_KILL_SWITCH: '0', ZELOCHAT_AI_ORDERING_ACTIVE: '1' }), 'active');

// Confirmation/correction/cancellation are deterministic and conservative.
assert.deepEqual(classifyOrderingTurn('sim', true), { kind: 'confirm' });
assert.equal(classifyOrderingTurn('sim, mas troca o frango', true).kind, 'alter');
assert.deepEqual(classifyOrderingTurn('não', true), { kind: 'ask_change' });
assert.deepEqual(classifyOrderingTurn('cancela o pedido', true), { kind: 'cancel' });
assert.deepEqual(classifyOrderingTurn('quero cancelar meu pedido por favor', true), { kind: 'cancel' });
assert.equal(classifyOrderingTurn('cancelar só a coca', true).kind, 'alter');
assert.equal(classifyOrderingTurn('não, prefiro retirar', true).kind, 'alter');

const buttons = buildConfirmationButtons(snapshot());
assert.deepEqual(buttons.map((button) => button.displayText), ['Confirmar', 'Alterar']);
assert.ok(buttons[0].id.startsWith(AI_ORDER_CONFIRM_PREFIX));
assert.equal(buttons[0].id.includes(snapshot().orderingId), false, 'button must not expose orderingId');
assert.deepEqual(parseOrderingButton(buttons[0].id), { kind: 'confirm', token: 'opaque-token' });
assert.deepEqual(parseOrderingButton(buttons[1].id), { kind: 'alter' });

const summary = renderOrderingSummary(snapshot());
assert.match(summary, /2x Marmita do dia \(Escolha a mistura: Frango\)/);
assert.match(summary, /entrega em Rua das Flores, 10 - Centro/);
assert.match(summary, /Pix/);
assert.match(summary, /R\$ 45,00/);
assert.equal((summary.match(/[.!?](?:\s|$)/g) ?? []).length <= 2, true, summary);
assert.equal(/\p{Extended_Pictographic}/u.test(summary), false, 'summary cannot contain emoji');

const catalogReply = renderCatalogReply({
  total: 1,
  ambiguous: false,
  results: [{
    productId: 10,
    publicName: 'Marmita do dia',
    currentPrice: 20,
    matchReason: 'modifier_group',
    ambiguous: false,
    modifierGroups: [{
      id: 4,
      name: 'Escolha a mistura',
      options: [
        { id: 7, name: 'Frango', priceDelta: 0 },
        { id: 8, name: 'Carne', priceDelta: 3 },
      ],
    }],
  }],
}, 'oq tem de mistura hoje');
assert.match(catalogReply, /Marmita do dia/);
assert.match(catalogReply, /Frango/);
assert.match(catalogReply, /Carne/);
assert.match(renderCatalogReply({ total: 20, ambiguous: false, results: [] }, 'lanche'), /filtrar/i);
assert.match(renderCatalogReply({ total: 2, ambiguous: true, results: [] }, 'x'), /qual/i);

const defaults = applyOrderingDefaults(
  { items: [{ productId: 10, quantity: 1 }] },
  {
    resolved: {
      fulfillmentType: { value: 'delivery', source: 'fixed' },
      deliveryAddress: { value: 'Rua A', source: 'fixed' },
      paymentMethod: { value: 'pix', source: 'last_order' },
      pickupTimePreference: { value: null, source: 'none' },
    },
    frequentItems: [{ productId: 99, productName: 'Não adicionar', totalQuantity: 5, orderCount: 3 }],
  },
);
assert.equal(defaults.fulfillment?.type, 'delivery');
assert.equal(defaults.fulfillment?.deliveryAddress, 'Rua A');
assert.equal(defaults.fulfillment?.asap, true);
assert.equal(defaults.paymentMethod, 'pix');
assert.deepEqual(defaults.items, [{ productId: 10, quantity: 1 }], 'frequent items are never automatic');

assert.deepEqual(ORDERING_MODEL_TOOLS.map((tool) => tool.function.name), [
  'buscar_cardapio',
  'alterar_carrinho',
  'consultar_carrinho',
]);
assert.equal(ORDERING_MODEL_TOOLS.some((tool) => /confirm/i.test(tool.function.name)), false);

let requestHeaders: Headers | undefined;
const client = new ZeloMenuInternalClient({
  baseUrl: 'https://internal.example',
  apiKey: 'secret-key',
  timeoutMs: 100,
  fetchImpl: async (_url, init) => {
    requestHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({ total: 0, ambiguous: false, results: [], requestId: 'remote-id' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  },
  requestIdFactory: () => 'local-request-id',
});
await client.searchCatalog({ empresaId: snapshot().empresaId, query: 'mistura', limit: 12 });
assert.equal(requestHeaders?.get('x-zelo-internal-key'), 'secret-key');
assert.equal(requestHeaders?.get('x-request-id'), 'local-request-id');

const failing = new ZeloMenuInternalClient({
  baseUrl: 'https://internal.example', apiKey: 'secret-key', timeoutMs: 100,
  fetchImpl: async () => new Response(JSON.stringify({ error: 'PEDIDO_INDISPONIVEL', detail: 'raw database secret' }), { status: 500 }),
});
await assert.rejects(
  () => failing.getOrdering(snapshot().orderingId, snapshot().empresaId),
  (error: unknown) => error instanceof ZeloMenuInternalError
    && error.message === 'Não foi possível consultar o pedido agora.'
    && !error.message.includes('raw database secret'),
);

console.log('aiWhatsAppOrdering tests passed');
