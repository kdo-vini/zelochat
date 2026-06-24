import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  firstZeloMenuCheckoutError,
  validateZeloMenuCheckoutDetails,
} from '../src/domain/zelomenuCheckout.js';

const validPickup = {
  customerName: 'Ana',
  customerPhone: '(14) 99999-8888',
  fulfillmentType: 'pickup' as const,
  deliveryAddress: '',
  pickupDate: '2026-06-24',
  pickupTime: '15:30',
};
const cartSessionsSource = readFileSync(
  new URL('../server/zelomenuCartSessions.ts', import.meta.url),
  'utf8',
);

const tests = [
  {
    name: 'retirada exige nome, WhatsApp, data e horário',
    run() {
      assert.deepEqual(validateZeloMenuCheckoutDetails({
        ...validPickup,
        customerName: '',
        customerPhone: '',
        pickupDate: '',
        pickupTime: '',
      }), {
        customerName: 'Informe seu nome.',
        customerPhone: 'Informe um WhatsApp válido com DDD.',
        pickupDate: 'Informe a data.',
        pickupTime: 'Informe o horário.',
      });
    },
  },
  {
    name: 'retirada válida não exige endereço',
    run() {
      assert.deepEqual(validateZeloMenuCheckoutDetails(validPickup), {});
    },
  },
  {
    name: 'entrega exige endereço',
    run() {
      assert.deepEqual(validateZeloMenuCheckoutDetails({
        ...validPickup,
        fulfillmentType: 'delivery',
      }), {
        deliveryAddress: 'Informe o endereço da entrega.',
      });
    },
  },
  {
    name: 'aceita entrega completa',
    run() {
      assert.deepEqual(validateZeloMenuCheckoutDetails({
        ...validPickup,
        fulfillmentType: 'delivery',
        deliveryAddress: 'Rua das Flores, 123',
      }), {});
    },
  },
  {
    name: 'rejeita data, horário e telefone malformados',
    run() {
      const errors = validateZeloMenuCheckoutDetails({
        ...validPickup,
        customerPhone: '123',
        pickupDate: '24/06/2026',
        pickupTime: '25:70',
      });
      assert.equal(errors.customerPhone, 'Informe um WhatsApp válido com DDD.');
      assert.equal(errors.pickupDate, 'Informe a data.');
      assert.equal(errors.pickupTime, 'Informe o horário.');
      assert.equal(firstZeloMenuCheckoutError(errors), errors.customerPhone);
    },
  },
  {
    name: 'backend bloqueia confirmação pública com dados incompletos',
    run() {
      const confirmStart = cartSessionsSource.indexOf('export async function confirmPublicCartSession');
      const validation = cartSessionsSource.indexOf("throw new Error('CUSTOMER_DETAILS_REQUIRED')", confirmStart);
      const revalidation = cartSessionsSource.indexOf('const revalidation = await runRevalidation', confirmStart);
      assert.ok(confirmStart >= 0);
      assert.ok(validation > confirmStart);
      assert.ok(revalidation > validation);
    },
  },
  {
    name: 'modo pra já registra horário sem cair na validação de agendamento passado',
    run() {
      assert.match(
        cartSessionsSource,
        /!session\.fulfillment\.asap && session\.fulfillment\.pickupDate && session\.fulfillment\.pickupTime/,
      );
    },
  },
];

for (const test of tests) {
  try {
    test.run();
    console.log(`ok - ${test.name}`);
  } catch (error) {
    console.error(`not ok - ${test.name}`);
    throw error;
  }
}
