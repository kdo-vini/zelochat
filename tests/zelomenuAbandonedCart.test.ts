import assert from 'node:assert/strict';
import {
  ABANDONED_CART_RECOVERY_MAX_AGE_MS,
  ABANDONED_CART_RECOVERY_MIN_AGE_MS,
  buildAbandonedCartRecoveryMessage,
  isCartEligibleForAbandonedRecovery,
} from '../src/domain/zelomenuCart.js';

const NOW = Date.parse('2026-06-22T20:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const HOUR = 60 * 60 * 1000;

const base = {
  state: 'cart_open' as const,
  archivedAt: null as string | null,
  recoveryNudgeSentAt: null as string | null,
  updatedAt: ago(3 * HOUR),
  now: NOW,
};

const tests = [
  {
    name: 'carrinho aberto parado 3h é elegível',
    run() {
      assert.equal(isCartEligibleForAbandonedRecovery(base), true);
    },
  },
  {
    name: 'carrinho parado menos de 2h ainda não é elegível',
    run() {
      assert.equal(
        isCartEligibleForAbandonedRecovery({ ...base, updatedAt: ago(1 * HOUR) }),
        false,
      );
      // exatamente no limite de 2h já conta
      assert.equal(
        isCartEligibleForAbandonedRecovery({ ...base, updatedAt: ago(ABANDONED_CART_RECOVERY_MIN_AGE_MS) }),
        true,
      );
    },
  },
  {
    name: 'carrinho parado mais de 24h vira lembrete velho e não dispara',
    run() {
      assert.equal(
        isCartEligibleForAbandonedRecovery({ ...base, updatedAt: ago(25 * HOUR) }),
        false,
      );
      // exatamente no teto de 24h ainda conta
      assert.equal(
        isCartEligibleForAbandonedRecovery({ ...base, updatedAt: ago(ABANDONED_CART_RECOVERY_MAX_AGE_MS) }),
        true,
      );
    },
  },
  {
    name: 'estados pós-carrinho nunca recebem recuperação',
    run() {
      for (const state of [
        'confirmed_waiting_review',
        'confirmed_waiting_payment',
        'needs_customer_adjustment',
        'accepted',
        'rejected',
        'cancelled',
        'archived',
      ] as const) {
        assert.equal(
          isCartEligibleForAbandonedRecovery({ ...base, state }),
          false,
          `${state} não deve ser elegível`,
        );
      }
    },
  },
  {
    name: 'carrinho arquivado não é recuperado mesmo aberto',
    run() {
      assert.equal(
        isCartEligibleForAbandonedRecovery({ ...base, archivedAt: ago(2 * HOUR) }),
        false,
      );
    },
  },
  {
    name: 'no máximo uma recuperação por carrinho',
    run() {
      assert.equal(
        isCartEligibleForAbandonedRecovery({ ...base, recoveryNudgeSentAt: ago(1 * HOUR) }),
        false,
      );
    },
  },
  {
    name: 'updatedAt inválido nunca dispara',
    run() {
      assert.equal(
        isCartEligibleForAbandonedRecovery({ ...base, updatedAt: 'not-a-date' }),
        false,
      );
    },
  },
  {
    name: 'mensagem de recuperação é amigável, com link e sem jargão técnico',
    run() {
      const message = buildAbandonedCartRecoveryMessage({
        customerName: 'João',
        itemsLine: '2x Coxinha, 1x Refri',
        publicUrl: 'https://chat.zelopdv.com.br/menu/carrinho/token123',
      });
      assert.match(message, /Oi, João!/);
      assert.match(message, /2x Coxinha, 1x Refri/);
      assert.match(message, /https:\/\/chat\.zelopdv\.com\.br\/menu\/carrinho\/token123/);
      // não pode vazar nomes de provedores/infra
      assert.doesNotMatch(message, /Whatsmiau|Stripe|OpenAI|Supabase|webhook|endpoint|provider/i);
    },
  },
  {
    name: 'mensagem sem nome e sem itens ainda funciona',
    run() {
      const message = buildAbandonedCartRecoveryMessage({
        customerName: null,
        itemsLine: null,
        publicUrl: 'https://chat.zelopdv.com.br/menu/carrinho/token123',
      });
      assert.match(message, /^Oi! /);
      assert.doesNotMatch(message, /📦/);
      assert.match(message, /token123/);
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
