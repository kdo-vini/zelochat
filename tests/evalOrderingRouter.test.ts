import assert from 'node:assert/strict';
import {
  computeGate,
  expectedDecision,
  keywordDecision,
  percentile,
} from '../scripts/evalOrderingRouter.js';

assert.equal(expectedDecision('pedido'), 'order');
assert.equal(expectedDecision('duvida_cardapio'), 'order');
assert.equal(expectedDecision('pedir_cardapio'), 'menu_request');
for (const intent of ['conversa', 'atendente', 'outro'] as const) assert.equal(expectedDecision(intent), 'generic');

assert.equal(keywordDecision('me manda o cardápio'), 'menu_request');
assert.equal(keywordDecision('quero marmita'), 'order');
assert.equal(keywordDecision('bom dia, tudo bem?'), 'generic');

assert.equal(percentile([], 0.5), 0);
assert.equal(percentile([10, 20, 30, 40], 0.5), 25);
assert.equal(percentile([10, 20, 30, 40], 0.95), 38.5);
assert.equal(percentile([10, 20, 30], -1), 10);
assert.equal(percentile([10, 20, 30], 2), 30);

const passingMetrics = {
  routerMissedOrders: 1,
  keywordMissedOrders: 2,
  routerAccuracy: 0.9,
  keywordAccuracy: 0.8,
  routerFalseOrdersInSafetyRows: 0,
};
assert.equal(computeGate(passingMetrics), true);
assert.equal(computeGate({ ...passingMetrics, routerFalseOrdersInSafetyRows: 1 }), false);
assert.equal(computeGate({ ...passingMetrics, routerMissedOrders: 3 }), false);
assert.equal(computeGate({ ...passingMetrics, routerAccuracy: 0.7 }), false);

console.log('evalOrderingRouter tests passed');
