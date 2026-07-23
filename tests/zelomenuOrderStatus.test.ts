import assert from 'node:assert/strict';
import { buildZeloMenuOrderTimeline } from '../src/domain/zelomenuOrderStatus.js';

const tests = [
  {
    name: 'delivery flow — full progression',
    run() {
      const r0 = buildZeloMenuOrderTimeline('pending_review', 'delivery');
      assert.equal(r0.currentStepIndex, 0, 'pending_review → step 0');
      assert.equal(r0.isTerminal, false);
      assert.equal(r0.isCancelled, false);
      assert.equal(r0.steps.length, 6, 'delivery has 6 steps');
      assert.equal(r0.steps[0].label, 'Pedido recebido');

      const r1 = buildZeloMenuOrderTimeline('accepted', 'delivery');
      assert.equal(r1.currentStepIndex, 1, 'accepted → step 1');
      assert.equal(r1.steps[1].label, 'Pedido confirmado pela loja');

      const r2 = buildZeloMenuOrderTimeline('preparing', 'delivery');
      assert.equal(r2.currentStepIndex, 2);
      assert.equal(r2.steps[2].label, 'Em preparo');

      const r3 = buildZeloMenuOrderTimeline('ready', 'delivery');
      assert.equal(r3.currentStepIndex, 3);
      assert.equal(r3.steps[3].label, 'Pronto');

      const r4 = buildZeloMenuOrderTimeline('out_for_delivery', 'delivery');
      assert.equal(r4.currentStepIndex, 4);
      assert.equal(r4.steps[4].label, 'Saiu para entrega');

      const r5 = buildZeloMenuOrderTimeline('delivered', 'delivery');
      assert.equal(r5.currentStepIndex, 5);
      assert.equal(r5.steps[5].label, 'Entregue');
      assert.equal(r5.isTerminal, true);
      assert.equal(r5.isCancelled, false);
    },
  },
  {
    name: 'pickup flow — different labels, fewer steps',
    run() {
      const steps = buildZeloMenuOrderTimeline('pending_review', 'pickup').steps;
      assert.equal(steps.length, 5, 'pickup has 5 steps (no out_for_delivery)');
      assert.equal(steps[3].label, 'Pronto para retirada');
      assert.equal(steps[4].label, 'Retirado');

      const delivered = buildZeloMenuOrderTimeline('delivered', 'pickup');
      assert.equal(delivered.currentStepIndex, 4);
      assert.equal(delivered.isTerminal, true);
    },
  },
  {
    name: 'rejected → cancelled terminal state',
    run() {
      const r = buildZeloMenuOrderTimeline('rejected', 'pickup');
      assert.equal(r.currentStepIndex, -1);
      assert.equal(r.isTerminal, true);
      assert.equal(r.isCancelled, true);

      const c = buildZeloMenuOrderTimeline('cancelled', 'delivery');
      assert.equal(c.currentStepIndex, -1);
      assert.equal(c.isTerminal, true);
      assert.equal(c.isCancelled, true);
    },
  },
  {
    name: 'pending_payment maps to step 0 (same as pending_review)',
    run() {
      const r = buildZeloMenuOrderTimeline('pending_payment', 'delivery');
      assert.equal(r.currentStepIndex, 0);
      assert.equal(r.isTerminal, false);
    },
  },
  {
    name: 'unknown status defaults to step 0',
    run() {
      const r = buildZeloMenuOrderTimeline('unknown_status', 'delivery');
      assert.equal(r.currentStepIndex, 0);
      assert.equal(r.isTerminal, false);
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
