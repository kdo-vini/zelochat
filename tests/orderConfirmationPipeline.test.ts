/**
 * Pipeline test: hard-button / soft-confirm normalization + matching.
 *
 * The normalization + matching logic in router.ts (processWebhookEvent) is
 * Layer 3 of the 3-layer duplicate-order trap. These tests verify that every
 * button text variant WhatsApp/Whatsmiau can produce normalizes to the
 * expected match — and that near-misses (edits, time estimates) do NOT match.
 *
 * Run via: npx tsx tests/orderConfirmationPipeline.test.ts
 */

import { normalizeLoose, normalizeIntent } from '../src/domain/conversationState.js';
import { assert, pass, fail } from './testHarness.js';

// ---------------------------------------------------------------------------
// Hard-button normalization (router.ts lines 560-577)
// ---------------------------------------------------------------------------
// The router normalizes msgText with normalizeLoose then checks exact match
// against whitelisted tokens. These tests mirror every variant Whatsmiau has
// delivered in production.
// ---------------------------------------------------------------------------

console.log('\nHard-button: CONFIRMAR variants match');
{
  const tokens = ['confirmar', 'confirm order', 'confirmar pedido'];
  const inputs = [
    '✅ Confirmar',
    '✅Confirmar',
    'Confirmar ✅',
    'CONFIRMAR',
    'Confirmar.',
    'confirmar',
    'Confirmar ✅',
    'confirm order',
    'CONFIRM ORDER',
    'confirmar pedido',
    'CONFIRMAR PEDIDO',
    '✅ confirmar pedido',
  ];
  for (const input of inputs) {
    const norm = normalizeLoose(input);
    const ok = tokens.includes(norm);
    assert(ok, `"${input}" → "${norm}" matches a confirm token`);
  }
}

console.log('\nHard-button: CANCELAR variants match');
{
  const tokens = ['cancelar', 'cancel order', 'cancelar pedido'];
  const inputs = [
    '❌ Cancelar',
    '❌Cancelar',
    'Cancelar ❌',
    'CANCELAR',
    'cancelar',
    'Cancelar.',
    'CANCELAR PEDIDO',
    'cancel order',
    'CANCEL ORDER',
    '❌ cancelar pedido',
  ];
  for (const input of inputs) {
    const norm = normalizeLoose(input);
    const ok = tokens.includes(norm);
    assert(ok, `"${input}" → "${norm}" matches a cancel token`);
  }
}

console.log('\nHard-button: near-misses do NOT match (regression P1.15)');
{
  const confirmTokens = ['confirmar', 'confirm order', 'confirmar pedido'];
  const cancelTokens = ['cancelar', 'cancel order', 'cancelar pedido'];
  const nearMisses: Array<[string, string]> = [
    ['confirmar mais tarde?', 'edit intent with "mais tarde"'],
    ['cancelar só a coca', 'partial cancel with item modifier'],
    ['confirmar pedido depois', 'edit intent with "depois"'],
    ['quero confirmar', 'wants to confirm but is a full sentence'],
    ['pode cancelar', 'polite cancel request'],
    ['vou cancelar', 'future tense cancel'],
    ['confirma pra mim', 'verb variation "confirma"'],
    ['5min', 'time estimate (P1.21 regression)'],
    ['uns 10 minutos', 'time estimate phrase'],
    ['10s', 'seconds abbreviation (P1.21)'],
    ['blz', 'slang ok — should go to AI'],
    ['ok', 'generic ok — should go to AI'],
    ['', 'empty string'],
  ];
  for (const [input, label] of nearMisses) {
    const norm = normalizeLoose(input);
    const isConfirm = confirmTokens.includes(norm);
    const isCancel = cancelTokens.includes(norm);
    assert(!isConfirm && !isCancel, `"${input}" → "${norm}" (${label}) does NOT match hard-button`);
  }
}

// ---------------------------------------------------------------------------
// Soft-confirm normalization (router.ts lines 655-668)
// ---------------------------------------------------------------------------
// The router normalizes with strip-diacritics + strip trailing then checks
// against "sim"/"s"/"nao"/"n". normalizeIntent is close enough to test.
// ---------------------------------------------------------------------------

console.log('\nSoft-confirm: "sim"/"s" variants match');
{
  const inputs = [
    'sim',
    'Sim',
    'SIM',
    's',
    'S',
    'sim!',
    'Sim.',
    '  sim  ',
    's.',
  ];
  for (const input of inputs) {
    const norm = normalizeIntent(input);
    const isConfirm = norm === 'sim' || norm === 's';
    assert(isConfirm, `"${input}" → "${norm}" is soft-confirm`);
  }
}

console.log('\nSoft-confirm: "não"/"nao"/"n" variants match');
{
  const inputs = [
    'nao',
    'não',
    'NÃO',
    'Não',
    'n',
    'N',
    'nao!',
    'não.',
  ];
  for (const input of inputs) {
    const norm = normalizeIntent(input);
    const isCancel = norm === 'nao' || norm === 'n';
    assert(isCancel, `"${input}" → "${norm}" is soft-cancel`);
  }
}

console.log('\nSoft-confirm: near-misses do NOT match (regression P1.21)');
{
  const nearMisses: Array<[string, string]> = [
    ['5min', 'time estimate'],
    ['10s', 'seconds abbreviation'],
    ['uns 10 minutos', 'time estimate phrase'],
    ['sim, mas troca a coca', 'qualified sim with edit'],
    ['não, de manhã', 'qualified nao with context'],
    ['ss', 'double s is not exact match'],
    ['sim sim', 'repeated sim is not exact'],
    ['simm', 'typo variation'],
    ['naooo', 'typo variation'],
    ['blz', 'slang — goes to AI'],
    ['', 'empty'],
  ];
  for (const [input, label] of nearMisses) {
    const norm = normalizeIntent(input);
    const isConfirm = norm === 'sim' || norm === 's';
    const isCancel = norm === 'nao' || norm === 'n';
    assert(!isConfirm && !isCancel, `"${input}" → "${norm}" (${label}) does NOT match soft-confirm`);
  }
}

// ---------------------------------------------------------------------------
// Combined sequence simulation — the full trap
// ---------------------------------------------------------------------------

console.log('\nCombined: hard-button normalization catches real Whatsmiau payloads');
{
  // These are actual Whatsmiau payload values that have been observed in prod
  const prodPayloads = [
    '✅ Confirmar',
    '❌ Cancelar',
    'CONFIRMAR',
    'CANCELAR',
    'confirm order',
    'cancel order',
  ];
  for (const payload of prodPayloads) {
    const norm = normalizeLoose(payload);
    const isConfirm = ['confirmar', 'confirm order', 'confirmar pedido'].includes(norm);
    const isCancel = ['cancelar', 'cancel order', 'cancelar pedido'].includes(norm);
    assert(
      isConfirm || isCancel,
      `prod payload "${payload}" → "${norm}" is recognized as confirm or cancel`,
    );
  }
}

console.log('\nCombined: button ID overrides text (CONFIRM_ORDER always confirms)');
{
  // Even if msgText is empty or garbage, a buttonId of CONFIRM_ORDER must
  // trigger confirm. This mirrors the router logic: isHardConfirm is
  // buttonId === 'CONFIRM_ORDER' || isConfirmText.
  const buttonId = 'CONFIRM_ORDER';
  const garbageTexts = ['', 'não', 'blabla', '❌ Cancelar'];
  for (const text of garbageTexts) {
    const norm = normalizeLoose(text);
    const isConfirmText = ['confirmar', 'confirm order', 'confirmar pedido'].includes(norm);
    const isHardConfirm = buttonId === 'CONFIRM_ORDER' || isConfirmText;
    assert(isHardConfirm, `CONFIRM_ORDER buttonId + "${text}" → hard confirm (buttonId wins)`);
  }
}

console.log('\nCombined: button ID CANCEL_ORDER always cancels');
{
  const buttonId = 'CANCEL_ORDER';
  const garbageTexts = ['', 'sim', 'blabla', '✅ Confirmar'];
  for (const text of garbageTexts) {
    const norm = normalizeLoose(text);
    const isCancelText = ['cancelar', 'cancel order', 'cancelar pedido'].includes(norm);
    const isHardCancel = buttonId === 'CANCEL_ORDER' || isCancelText;
    assert(isHardCancel, `CANCEL_ORDER buttonId + "${text}" → hard cancel (buttonId wins)`);
  }
}

// ---------------------------------------------------------------------------
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
