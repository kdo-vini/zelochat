import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { canonicalRowToOrder, uiStatusToCanonicalAction } from '../src/domain/canonicalOrders.js';

describe('pedidos canonicos', () => {
  it('adapta snapshots e itens para a UI', () => {
    const order = canonicalRowToOrder({
      id: 'order-1', status: 'accepted', revision: 4,
      customer: { name: 'Ana', phone: '5514999999999' },
      fulfillment: { pickupDate: '2026-07-12', pickupTime: '19:30' },
      payment: { declaredMethod: 'pix' }, total: 42.5, created_at: '2026-07-12T20:00:00Z',
      zelo_order_items: [{ name: 'B', quantity: 1, position: 2 }, { name: 'A', quantity: 2, position: 1 }],
    });
    assert.equal(order.status, 'pending');
    assert.equal(order.revision, 4);
    assert.deepEqual(order.items, [{ product: 'A', quantity: 2 }, { product: 'B', quantity: 1 }]);
  });

  it('inclui os modificadores selecionados no nome do item (bug: sumiam do Kanban)', () => {
    const order = canonicalRowToOrder({
      id: 'order-2', status: 'pending_review', revision: 1,
      customer: { name: 'Vinicius', phone: '5514999999999' },
      fulfillment: { pickupDate: '2026-07-23', pickupTime: '19:30' },
      payment: { declaredMethod: 'pix' }, total: 25, created_at: '2026-07-23T20:00:00Z',
      zelo_order_items: [{
        name: 'Monte sua Massa', quantity: 1, position: 0,
        modifiers: [
          { groupId: 'g1', groupName: 'Escolha sua massa', kind: 'variacao', selectedOptions: [{ optionId: 'o1', optionName: 'Nhoque', priceDelta: 0 }] },
          { groupId: 'g2', groupName: 'Turbine com Proteínas', kind: 'adicional', selectedOptions: [
            { optionId: 'o2', optionName: 'Carne Moída', priceDelta: 0 },
            { optionId: 'o3', optionName: 'Bacon', priceDelta: 0 },
          ] },
        ],
      }],
    });
    assert.equal(order.items[0].product, 'Monte sua Massa (Escolha sua massa: Nhoque • Turbine com Proteínas: Carne Moída, Bacon)');
  });

  it('mantém visível que um pedido do ZeloMenu ainda aguarda aceite', () => {
    const order = canonicalRowToOrder({
      id: 'order-review', status: 'pending_review', revision: 1,
      customer: { name: 'Vinicius', phone: '5514999999999' },
      fulfillment: { pickupDate: '2026-07-23', pickupTime: '19:30' },
      payment: { declaredMethod: 'pix' }, total: 25, created_at: '2026-07-23T20:00:00Z',
      zelo_order_items: [{ name: 'Monte sua Massa', quantity: 1, position: 0 }],
    });

    assert.equal((order as unknown as { requiresAcceptance?: boolean }).requiresAcceptance, true);
  });

  it('preserva grupos estruturados para o bilhete separar por linha', () => {
    const order = canonicalRowToOrder({
      id: 'order-receipt', status: 'pending_review', revision: 1,
      customer: { name: 'Vinicius', phone: '5514999999999' },
      fulfillment: { pickupDate: '2026-07-23', pickupTime: '19:30' },
      payment: { declaredMethod: 'pix' }, total: 25, created_at: '2026-07-23T20:00:00Z',
      zelo_order_items: [{
        name: 'Monte sua Massa', quantity: 1, position: 0,
        modifiers: [
          { groupId: 'g1', groupName: 'Escolha sua massa', kind: 'variacao', selectedOptions: [{ optionId: 'o1', optionName: 'Talharim', priceDelta: 0 }] },
        ],
      }],
    });

    assert.deepEqual(order.items[0], {
      product: 'Monte sua Massa (Escolha sua massa: Talharim)',
      productName: 'Monte sua Massa',
      modifierGroups: [{ groupName: 'Escolha sua massa', optionNames: ['Talharim'] }],
      quantity: 1,
    });
  });

  it('mapeia o kanban para acoes transacionais', () => {
    assert.deepEqual(
      ['pending', 'preparing', 'ready', 'out_for_delivery', 'delivered'].map((status) =>
        uiStatusToCanonicalAction(status as Parameters<typeof uiStatusToCanonicalAction>[0])),
      ['accept', 'start_preparing', 'mark_ready', 'dispatch', 'deliver'],
    );
  });

  it('baixa Pix aprovado no pedido canonico antes do ack final', () => {
    const source = readFileSync(new URL('../server/ai.ts', import.meta.url), 'utf8');
    const canonicalSource = readFileSync(new URL('../server/canonicalOrders.ts', import.meta.url), 'utf8');
    const approvedBranch = source.slice(source.indexOf('if (result.approved)'), source.indexOf('// Mismatch:'));
    assert.match(approvedBranch, /order\.status === 'pending_payment'/);
    assert.match(approvedBranch, /p_expected_revision:\s*order\.revision/);
    assert.match(approvedBranch, /p_action:\s*'payment_approved'/);
    assert.ok(
      approvedBranch.indexOf("p_action: 'payment_approved'") < approvedBranch.indexOf('benefici'),
      'a transicao deve ocorrer antes do reconhecimento final ao cliente',
    );
    assert.match(approvedBranch, /autoAcceptCanonicalOrderIfConfigured/);
    assert.match(approvedBranch, /manualReviewRequired/);
    assert.match(canonicalSource, /rpc\('accept_zelo_order'/);
    assert.match(canonicalSource, /p_actor_id: null/);
  });
});
