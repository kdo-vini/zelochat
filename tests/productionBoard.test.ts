import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DELIVERED_BOARD_LINGER_MS,
  filterProductionBoardOrders,
  isOrderOnProductionBoard,
} from '../src/domain/productionBoard.js';
import type { Order } from '../src/types.js';

const NOW = Date.parse('2026-07-24T18:00:00-03:00');

function makeOrder(overrides: Partial<Order>): Order {
  return {
    id: 'o1',
    customerName: 'Cliente',
    customerPhone: '5514999999999',
    items: [{ product: 'X', quantity: 1 }],
    pickupDate: '2026-07-24',
    pickupTime: '12:00',
    status: 'pending',
    total: 10,
    createdAt: '2026-07-24T12:00:00-03:00',
    ...overrides,
  };
}

describe('production board visibility', () => {
  it('mantém pedidos ativos no quadro independente da idade', () => {
    // Pedido antigo (ontem) mas ainda não finalizado continua sendo trabalho do operador.
    const old = makeOrder({ status: 'preparing', createdAt: '2026-07-20T12:00:00-03:00', pickupDate: '2026-07-20' });
    assert.equal(isOrderOnProductionBoard(old, NOW), true);
  });

  it('mostra pedido entregue há poucos minutos', () => {
    const justDelivered = makeOrder({
      status: 'delivered',
      closedAt: new Date(NOW - 5 * 60 * 1000).toISOString(),
    });
    assert.equal(isOrderOnProductionBoard(justDelivered, NOW), true);
  });

  it('esconde pedido entregue depois da janela de permanência', () => {
    const longAgo = makeOrder({
      status: 'delivered',
      closedAt: new Date(NOW - (DELIVERED_BOARD_LINGER_MS + 60_000)).toISOString(),
    });
    assert.equal(isOrderOnProductionBoard(longAgo, NOW), false);
  });

  it('esconde pedido entregue ontem (caso do bug reportado)', () => {
    const yesterday = makeOrder({
      status: 'delivered',
      createdAt: '2026-07-23T20:08:00-03:00',
      closedAt: '2026-07-23T20:10:00-03:00',
    });
    assert.equal(isOrderOnProductionBoard(yesterday, NOW), false);
  });

  it('esconde pedido entregue sem carimbo de finalização (legado)', () => {
    const legacy = makeOrder({ status: 'delivered', closedAt: undefined });
    assert.equal(isOrderOnProductionBoard(legacy, NOW), false);
  });

  it('esconde pedido entregue com closedAt inválido em vez de mostrar pra sempre', () => {
    const broken = makeOrder({ status: 'delivered', closedAt: 'not-a-date' });
    assert.equal(isOrderOnProductionBoard(broken, NOW), false);
  });

  it('filterProductionBoardOrders remove só os entregues fora da janela', () => {
    const active = makeOrder({ id: 'a', status: 'ready' });
    const fresh = makeOrder({ id: 'b', status: 'delivered', closedAt: new Date(NOW - 60_000).toISOString() });
    const stale = makeOrder({ id: 'c', status: 'delivered', closedAt: '2026-07-23T20:10:00-03:00' });
    const result = filterProductionBoardOrders([active, fresh, stale], NOW);
    assert.deepEqual(result.map((o) => o.id), ['a', 'b']);
  });
});
