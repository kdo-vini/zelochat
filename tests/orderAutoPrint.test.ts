import { selectOrdersToAutoPrint } from '../src/domain/orderAutoPrint.js';
import type { Order } from '../src/types.js';
import { assert, assertEqual, runSuite } from './testHarness.js';

const BASE_TIME = 1_700_000_000_000; // arbitrary stable timestamp
const MS_15_MIN = 15 * 60 * 1000;

function makeOrder(overrides: Partial<Order> & { id: string }): Order {
  return {
    customerName: 'Teste',
    customerPhone: '5511999999999',
    items: [],
    pickupDate: '2026-07-23',
    pickupTime: '12:00',
    status: 'pending',
    total: 0,
    createdAt: new Date(BASE_TIME).toISOString(),
    ...overrides,
  };
}

await runSuite('selectOrdersToAutoPrint', [
  {
    name: 'new recent non-delivered order is included',
    run: () => {
      const existing = [makeOrder({ id: 'a' })];
      const incoming = [
        makeOrder({ id: 'a' }),
        makeOrder({ id: 'b', createdAt: new Date(BASE_TIME - 1000).toISOString() }),
      ];
      const result = selectOrdersToAutoPrint(existing, incoming, {
        maxAgeMs: MS_15_MIN,
        now: BASE_TIME,
      });
      assertEqual(result.length, 1, 'only order b is new');
      assertEqual(result[0].id, 'b', 'order b is selected');
    },
  },
  {
    name: 'order present in both lists is excluded',
    run: () => {
      const existing = [
        makeOrder({ id: 'a' }),
        makeOrder({ id: 'b' }),
      ];
      const incoming = [
        makeOrder({ id: 'a' }),
        makeOrder({ id: 'b' }),
      ];
      const result = selectOrdersToAutoPrint(existing, incoming, {
        maxAgeMs: MS_15_MIN,
        now: BASE_TIME,
      });
      assertEqual(result.length, 0, 'no new orders');
    },
  },
  {
    name: 'delivered order that is new to the list is excluded',
    run: () => {
      const existing = [makeOrder({ id: 'a' })];
      const incoming = [
        makeOrder({ id: 'a' }),
        makeOrder({ id: 'b', status: 'delivered', createdAt: new Date(BASE_TIME - 1000).toISOString() }),
      ];
      const result = selectOrdersToAutoPrint(existing, incoming, {
        maxAgeMs: MS_15_MIN,
        now: BASE_TIME,
      });
      assertEqual(result.length, 0, 'delivered order is excluded');
    },
  },
  {
    name: 'order older than maxAgeMs is excluded',
    run: () => {
      const existing = [makeOrder({ id: 'a' })];
      const incoming = [
        makeOrder({ id: 'a' }),
        makeOrder({ id: 'b', createdAt: new Date(BASE_TIME - MS_15_MIN - 1000).toISOString() }),
      ];
      const result = selectOrdersToAutoPrint(existing, incoming, {
        maxAgeMs: MS_15_MIN,
        now: BASE_TIME,
      });
      assertEqual(result.length, 0, 'old order is excluded');
    },
  },
  {
    name: 'empty previousOrders — all eligible included',
    run: () => {
      const incoming = [
        makeOrder({ id: 'a', createdAt: new Date(BASE_TIME - 1000).toISOString() }),
        makeOrder({ id: 'b', createdAt: new Date(BASE_TIME - 5000).toISOString() }),
      ];
      const result = selectOrdersToAutoPrint([], incoming, {
        maxAgeMs: MS_15_MIN,
        now: BASE_TIME,
      });
      assertEqual(result.length, 2, 'both orders are new');
    },
  },
  {
    name: 'pedido aguardando aceite e impresso assim que chega',
    run: () => {
      const incoming = [makeOrder({ id: 'review', requiresAcceptance: true })];
      const result = selectOrdersToAutoPrint([], incoming, {
        maxAgeMs: MS_15_MIN,
        now: BASE_TIME,
      });
      assertEqual(result.length, 1, 'pedido aguardando aceite e imprimivel');
    },
  },
  {
    name: 'pedido ja conhecido nao e impresso novamente ao ser aceito',
    run: () => {
      const previous = [makeOrder({ id: 'review', requiresAcceptance: true })];
      const incoming = [makeOrder({ id: 'review', requiresAcceptance: false, status: 'preparing' })];
      const result = selectOrdersToAutoPrint(previous, incoming, {
        maxAgeMs: MS_15_MIN,
        now: BASE_TIME,
      });
      assertEqual(result.length, 0, 'aceite nao duplica o bilhete');
    },
  },
]);
