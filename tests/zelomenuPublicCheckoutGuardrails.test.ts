import { readFileSync } from 'node:fs';
import { assert, assertIncludes, runSuite } from './testHarness.js';

const storePage = readFileSync(
  new URL('../src/pages/ZeloMenuStorePage.tsx', import.meta.url),
  'utf8',
);
const cartPage = readFileSync(
  new URL('../src/pages/ZeloMenuCartPage.tsx', import.meta.url),
  'utf8',
);

await runSuite('ZeloMenu public checkout guardrails', [
  {
    name: 'abre o checkout direto do cardápio sem coletar dados antes',
    run() {
      assertIncludes(storePage, /onClick=\{\(\) => void continueToCart\(\)\}/, 'CTA abre o checkout diretamente');
      assert(!storePage.includes('Seus dados'), 'cardápio não coleta dados pessoais');
      assert(!storePage.includes('Ir para o carrinho'), 'resumo intermediário não mantém CTA redundante');
      assert(!storePage.includes('customerName:'), 'bootstrap não envia nome');
      assert(!storePage.includes('customerPhone:'), 'bootstrap não envia WhatsApp');
    },
  },
  {
    name: 'coleta nome e WhatsApp dentro do checkout',
    run() {
      assertIncludes(cartPage, /Seu nome \{requiredMark\}/, 'checkout contém campo obrigatório de nome');
      assertIncludes(cartPage, /WhatsApp \{requiredMark\}/, 'checkout contém campo obrigatório de WhatsApp');
      assertIncludes(cartPage, /customerPhoneDigits\.length < 10|validateDetails\(\)/, 'checkout valida o WhatsApp');
      assertIncludes(cartPage, /updateField\('pickupDate', ''\)/, 'agendamento exige data explícita');
      assertIncludes(cartPage, /updateField\('pickupTime', ''\)/, 'agendamento exige horário explícito');
    },
  },
]);
