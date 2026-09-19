import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findNewArrivalOrders } from '../src/domain/ifoodArrivalSound.js';
import type { Order } from '../src/types';

const now = Date.parse('2026-09-19T12:00:00.000Z');

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: 'a',
    customerName: 'Rafa',
    customerPhone: '0800',
    items: [],
    pickupDate: '2026-09-19',
    pickupTime: '12:00',
    status: 'pending',
    total: 10,
    createdAt: '2026-09-19T11:58:00.000Z',
    source: 'ifood',
    requiresAcceptance: true,
    ...overrides,
  };
}

describe('order arrival sound', () => {
  it('marca qualquer canal novo (não só iFood)', () => {
    const previous = [order({ id: 'a' })];
    const next = [
      order({ id: 'a' }),
      order({ id: 'b', source: 'ifood' }),
      order({ id: 'c', source: 'manual', requiresAcceptance: false, status: 'preparing' }),
      order({ id: 'd', source: 'zelomenu', requiresAcceptance: true }),
      order({ id: 'e', status: 'delivered', createdAt: '2026-09-19T11:59:00.000Z' }),
    ];
    assert.deepEqual(findNewArrivalOrders(previous, next, { now }).map((row) => row.id), ['b', 'c', 'd']);
  });

  it('ignora pedido antigo que reaparece no lookback', () => {
    const next = [order({ id: 'old', createdAt: '2026-09-18T12:00:00.000Z' })];
    assert.equal(findNewArrivalOrders([], next, { now }).length, 0);
  });
});
