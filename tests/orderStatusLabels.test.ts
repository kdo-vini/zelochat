import assert from 'node:assert/strict';
import { orderStatusLabel } from '../src/domain/orderStatusLabels.js';

const expected = {
  pending_payment: 'Aguardando pagamento',
  pending_review: 'Em análise',
  accepted: 'Aceito',
  preparing: 'Em preparo',
  ready: 'Pronto',
  out_for_delivery: 'Saiu para entrega',
  delivered: 'Entregue',
  rejected: 'Recusado',
  cancelled: 'Cancelado',
} as const;

for (const [status, label] of Object.entries(expected)) {
  assert.equal(orderStatusLabel(status), label);
}

const unknown = orderStatusLabel('status_novo');
assert.equal(unknown, 'Status não identificado');
assert.equal(orderStatusLabel('toString'), 'Status não identificado');
assert.equal(orderStatusLabel('__proto__'), 'Status não identificado');
assert(!unknown.includes('_'));
assert(!/^[a-z_]+$/u.test(unknown));

for (const label of Object.values(expected)) {
  assert(!label.includes('_'));
  assert(!/^[a-z_]+$/u.test(label));
}

console.log('orderStatusLabels: ok');
