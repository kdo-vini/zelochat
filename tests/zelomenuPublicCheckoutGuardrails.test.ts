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
  {
    name: 'quantidade pode ser digitada pelo teclado numérico',
    run() {
      assertIncludes(cartPage, /inputMode="numeric"/, 'quantidade abre teclado numérico');
      assertIncludes(cartPage, /pattern="\[0-9\]\*"/, 'quantidade aceita somente dígitos');
      assertIncludes(cartPage, /editItemQuantity\(key, event\.target\.value\)/, 'digitação atualiza a quantidade');
      assertIncludes(cartPage, /event\.currentTarget\.select\(\)/, 'toque seleciona a quantidade atual');
    },
  },
  {
    name: 'edições são persistidas automaticamente antes da confirmação',
    run() {
      const autosaveStart = cartPage.indexOf('const enqueueAutosave');
      const confirmStart = cartPage.indexOf('const confirmCart');
      assert(autosaveStart >= 0 && autosaveStart < confirmStart, 'autosave existe fora do fluxo de confirmação');
      assertIncludes(cartPage, /setTimeout\(\(\) => \{[\s\S]*enqueueAutosave\(autosavePayload\)[\s\S]*\}, 650\)/, 'autosave usa debounce');
      assertIncludes(cartPage, /saveQueueRef\.current[\s\S]*updatePublicCart\(token, nextPayload\)/, 'PATCHs são serializados');
      assertIncludes(cartPage, /version !== saveVersionRef\.current/, 'resposta antiga não sobrescreve status recente');
      assertIncludes(cartPage, /visibilitychange/, 'alteração pendente é enviada ao ocultar a página');
      assertIncludes(cartPage, /flushPendingAutosave\(\)\.then\(\(\) => load\('refresh'\)\)/, 'recarregar espera o salvamento pendente');
      assertIncludes(cartPage, /autosaveReadyRef\.current = false/, 'troca de token reinicia o autosave');
      assertIncludes(cartPage, /Salvando alterações…/, 'cliente recebe feedback de salvamento');
      assertIncludes(cartPage, /Alterações salvas/, 'cliente recebe confirmação de persistência');
      assertIncludes(cartPage, /Não foi possível salvar\. Tentar novamente/, 'falha oferece nova tentativa acionável');
      assertIncludes(cartPage, /syncStoreCacheFromResponse\(updated\)/, 'PATCH sincroniza o cache do cardápio');
      assertIncludes(cartPage, /await flushPendingAutosave\(\);[\s\S]*window\.history\.back\(\)/, 'voltar aguarda cache e servidor');
    },
  },
  {
    name: 'fotos usam moldura fixa sem cortar produtos',
    run() {
      assertIncludes(storePage, /aspect-square/, 'cards usam área de imagem quadrada');
      assertIncludes(storePage, /object-contain/, 'imagem inteira permanece visível');
      assertIncludes(storePage, /min-h-\[108px\]/, 'área de informações mantém cards alinhados');
    },
  },
]);
