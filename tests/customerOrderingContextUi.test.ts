import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CustomerSummaryTab } from '../src/components/customers/CustomerSummaryTab.js';
import type { CustomerDetail } from '../src/services/customerApi.js';

const customer: CustomerDetail = {
  id: 'person-1', name: 'Ana', phone: '5511999999999', whatsapp: '5511999999999',
  lastOrderAt: '2026-08-20T12:00:00.000Z', lastActivityAt: '2026-08-30T12:00:00.000Z', activityState: 'active', orderCount: 4,
  totalValue: 100, openBalance: null, tags: ['VIP'], birthday: null, origin: 'WhatsApp',
  notes: null, automaticSummary: null,
  relationship: { blocked: false, blockReason: null, campaigns: 0, automations: 0 },
  orders: [], primaryJid: null, sessions: [],
  orderingContext: {
    fulfillmentType: { value: 'delivery', source: 'last_order' },
    deliveryAddress: {
      value: {
        address: 'Rua A, 10', neighborhood: 'Centro', complement: null, city: null,
        state: null, postalCode: null, reference: null, display: 'Rua A, 10 — Centro',
      },
      source: 'last_order',
    },
    paymentMethod: { value: 'Pix', source: 'fixed' },
    habitualTime: { value: { minutes: 1110, label: '18:30' }, source: 'derived' },
    medianRecurrenceDays: { value: 7, source: 'derived' },
    frequentItems: {
      value: [{ productId: '10', name: 'X-Burger', orderFrequency: 3, totalQuantity: 5 }],
      source: 'derived',
    },
    lastOrder: { value: null, source: 'none' },
    overrides: { paymentMethod: 'Pix' },
  },
};

const Component = CustomerSummaryTab as ComponentType<Record<string, unknown>>;
const editable = renderToStaticMarkup(createElement(Component, {
  customer,
  canManage: true,
  onUpdateOrderingOverrides: async () => undefined,
}));
assert.match(editable, /Hábitos de pedido/u);
assert.match(editable, /Último pedido/u);
assert.match(editable, /Fixado/u);
assert.match(editable, /Calculado/u);
assert.match(editable, /Fixar como padrão/u);
assert.match(editable, /Remover padrão/u);
assert.match(editable, /Rua A, 10 — Centro/u);
assert.match(editable, /X-Burger/u);
assert.match(editable, /a cada 7 dias/u);
assert.match(editable, /aria-label="Fixar tipo de atendimento como padrão"/u);
assert.match(editable, /grid-cols-1/u);

const readOnly = renderToStaticMarkup(createElement(Component, { customer, canManage: false }));
assert.doesNotMatch(readOnly, /Fixar como padrão|Remover padrão/u);

const source = readFileSync(new URL('../src/components/customers/CustomerSummaryTab.tsx', import.meta.url), 'utf8');
assert.equal(source.match(/saving=\{saving !== null\}/gu)?.length, 4, 'all override cards must lock while any save is running');
assert.doesNotMatch(source, /saving=\{saving ===/u);

console.log('customerOrderingContextUi: ok');
