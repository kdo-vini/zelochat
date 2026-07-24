/**
 * Regression + edge-case tests for src/domain/conversationState.ts.
 *
 * Each test asserts a single deterministic mapping that the production AI
 * pipeline depends on. The first three tests mirror the exact incidents that
 * motivated this module:
 *
 *   • Reg-1: AI was off when an order was confirmed. Customer sent the Pix
 *            receipt PDF after AI auto-reactivated. AI must NOT restart the
 *            order flow.
 *   • Reg-2: AI sent the order summary and asked "deseja alterar algo?".
 *            Customer replied "Certinho", "Gratidão", "Boa noite e até
 *            amanhã", or 👍. AI must finalize the order, not loop the same
 *            question.
 *   • Reg-3: Customer ordered "meio cento de salgados fritos, bolinha de
 *            queijo, frango, resto misturado". The catalog has "Cento de
 *            Bolinha de queijo", "Cento de Coxinha de frango", "Cento
 *            Sortidos", "Cento Tradicionais Sortidos". The semantic matcher
 *            must NOT return no_match — it must map "salgados fritos" to a
 *            unique product or to candidate set, not escalate cold.
 *
 * The remaining tests cover edge cases of informal Brazilian WhatsApp
 * ordering: emoji-only replies, mixed cancel/confirm signals, escalation
 * keywords, partial matches in the cento detector, empty inputs, and so on.
 *
 * Run via: npx tsx tests/conversationState.test.ts
 */

import {
  classifyConfirmationIntent,
  detectUnitCount,
  isLikelyPaymentProofMessage,
  looksLikeObservationPrompt,
  mapInformalSalgadoTerm,
  normalizeIntent,
  pickActiveOrder,
  resolveProductBySemantic,
  shouldFinalizeAfterObservationAck,
  textMentionsPaymentProof,
  type ActiveOrderRow,
  type CatalogProductLike,
  type ClassifyContext,
} from '../src/domain/conversationState.js';
import { assert, pass, fail } from './testHarness.js';

const observationCtx: ClassifyContext = { lastAiQuestion: 'observation_or_change' };
const summaryCtx: ClassifyContext = { lastAiQuestion: 'confirm_order_summary' };
const buttonCtx: ClassifyContext = { lastAiQuestion: 'pending_button_confirm' };
const noneCtx: ClassifyContext = { lastAiQuestion: 'none' };

// Catalog used across regression-3 + a few edge cases. Mirrors a real Casa
// dos Salgados configuration.
const SALGADOS_CATALOG: CatalogProductLike[] = [
  { name: 'Cento de Bolinha de queijo', unitBased: true },
  { name: 'Cento de Coxinha de frango', unitBased: true },
  { name: 'Cento Sortidos', unitBased: true },
  { name: 'Cento Tradicionais Sortidos', unitBased: true },
  { name: 'Cento Assados Sortidos', unitBased: true },
  { name: 'Brigadeiro tradicional', unitBased: true },
];

// ---------------------------------------------------------------------------
// REG-1 — Reactivation + receipt drop must NOT restart the order flow
// ---------------------------------------------------------------------------

console.log('\nReg-1: receipt drop after AI reactivation does not restart order flow');
{
  // The reactivation guardrail in server/ai.ts has two checks:
  //   (a) isLikelyPaymentProofMessage on the inbound message, OR
  //   (b) textMentionsPaymentProof on the caption/text.
  // findActiveOrderForCustomerPhone is the DB lookup; pickActiveOrder is the
  // pure decision rule we test here.
  assert(
    isLikelyPaymentProofMessage({ attachmentKind: 'image', caption: null }) === true,
    'image attachment is treated as payment proof',
  );
  assert(
    isLikelyPaymentProofMessage({ attachmentKind: 'document', caption: 'Comprovante Pix' }) === true,
    'PDF attachment is treated as payment proof',
  );
  assert(
    isLikelyPaymentProofMessage({ attachmentKind: 'audio', caption: null }) === false,
    'audio is not auto-treated as payment proof',
  );
  assert(
    isLikelyPaymentProofMessage({ attachmentKind: 'none', caption: 'Mandei o pix' }) === false,
    'caption-only without attachment requires the text mention to fire',
  );
  assert(
    textMentionsPaymentProof('Segue o comprovante do Pix') === true,
    'text "comprovante do Pix" is detected',
  );
  assert(
    textMentionsPaymentProof('Já paguei pelo pix, vê aí') === true,
    'text "paguei pelo pix" is detected',
  );
  assert(
    textMentionsPaymentProof('Quero fazer um pedido') === false,
    'plain order intent is not flagged as payment proof',
  );
  // Phantom-escalation guard — bare "pix" question must NOT trigger.
  assert(
    textMentionsPaymentProof('qual o pix?') === false,
    '"qual o pix?" does not fire payment-proof guard',
  );
  assert(
    textMentionsPaymentProof('tem pix?') === false,
    '"tem pix?" does not fire payment-proof guard',
  );
  assert(
    textMentionsPaymentProof('qual a chave pix?') === false,
    '"qual a chave pix?" does not fire payment-proof guard',
  );
  assert(
    textMentionsPaymentProof('manda o pix aí') === false,
    'no-question "manda o pix aí" alone is not enough (need verb pairing)',
  );
  assert(
    textMentionsPaymentProof('mandei o pix') === true,
    '"mandei o pix" is detected',
  );
  assert(
    textMentionsPaymentProof('pix enviado, segue ai') === true,
    '"pix enviado" is detected',
  );
  assert(
    textMentionsPaymentProof('encaminhei o comprovante') === true,
    '"encaminhei o comprovante" is detected',
  );
  assert(
    textMentionsPaymentProof('comprovante?') === false,
    '"comprovante?" with question mark is not a proof statement',
  );

  const now = new Date('2026-05-09T12:00:00-03:00');
  const orderConfirmedYesterday: ActiveOrderRow = {
    id: 'abc-123',
    status: 'pending',
    total: 90,
    paymentMethod: 'Pix',
    createdAt: '2026-05-08T20:00:00-03:00',
  };
  const orderDeliveredAlready: ActiveOrderRow = {
    id: 'old-001',
    status: 'delivered',
    total: 60,
    paymentMethod: 'Dinheiro',
    createdAt: '2026-05-08T10:00:00-03:00',
  };
  const orderTooOld: ActiveOrderRow = {
    id: 'old-002',
    status: 'pending',
    total: 50,
    paymentMethod: 'Pix',
    createdAt: '2026-05-01T10:00:00-03:00', // > 48h ago
  };
  const picked = pickActiveOrder([orderDeliveredAlready, orderTooOld, orderConfirmedYesterday], now);
  assert(picked?.id === 'abc-123', 'pickActiveOrder picks the most recent non-delivered order within 48h');
  assert(
    pickActiveOrder([orderDeliveredAlready, orderTooOld], now) === null,
    'pickActiveOrder returns null when no order qualifies',
  );
}

// ---------------------------------------------------------------------------
// REG-2 — informal confirmations after observation prompt
// ---------------------------------------------------------------------------

console.log('\nReg-2: informal confirmation replies finalize the order');
{
  const cases: Array<[string, string]> = [
    ['Certinho', 'certinho confirms after observation prompt'],
    ['Certinho!', 'certinho with exclamation confirms'],
    ['certinho 😊', 'certinho + emoji confirms'],
    ['Gratidão', 'gratidao confirms'],
    ['Boa noite e até amanhã', 'farewell confirms after observation prompt'],
    ['Boa noite, até amanhã!', 'farewell with comma + bang confirms'],
    ['ok obrigado', 'ok obrigado confirms'],
    ['perfeito', 'perfeito confirms'],
    ['combinado', 'combinado confirms'],
    ['pode crer', 'pode crer confirms'],
  ];
  for (const [input, msg] of cases) {
    const intent = classifyConfirmationIntent(input, observationCtx);
    assert(
      intent === 'affirmative_confirm' ||
        intent === 'farewell_or_thanks_confirm' ||
        intent === 'emoji_only_confirm',
      `${msg} (got ${intent})`,
    );
  }

  // Emoji-only after summary
  assert(
    classifyConfirmationIntent('👍', summaryCtx) === 'emoji_only_confirm',
    'thumbs-up after summary is emoji_only_confirm',
  );
  assert(
    classifyConfirmationIntent('🙏', summaryCtx) === 'emoji_only_confirm',
    'praying hands after summary is emoji_only_confirm',
  );
  assert(
    classifyConfirmationIntent('👏👏', buttonCtx) === 'unknown',
    'clap emoji repeated after buttons is enthusiasm, not order consent',
  );
  // Emoji-only with NO pending question is "unknown" — friendly reaction
  // to nothing actionable; we don't auto-confirm without a pending question.
  assert(
    classifyConfirmationIntent('👍', noneCtx) === 'unknown',
    'thumbs-up with no pending question is unknown (not auto-confirm)',
  );

  // shouldFinalizeAfterObservationAck — full thread simulation
  const thread = [
    { role: 'user', content: 'quero meio cento de salgados' },
    { role: 'assistant', content: 'Anotado: meio cento. Gostaria de alterar algo, ou tem alguma observação a fazer? 😊' },
    { role: 'user', content: 'Certinho' },
  ];
  assert(
    shouldFinalizeAfterObservationAck(thread) === true,
    'observation prompt followed by "Certinho" → finalize',
  );
  const threadEmoji = [
    { role: 'assistant', content: 'Tem alguma observação a fazer?' },
    { role: 'user', content: '👍' },
  ];
  assert(
    shouldFinalizeAfterObservationAck(threadEmoji) === true,
    'observation prompt followed by 👍 → finalize',
  );
  const threadFarewell = [
    { role: 'assistant', content: 'Quer alterar algo?' },
    { role: 'user', content: 'Boa noite e até amanhã' },
  ];
  assert(
    shouldFinalizeAfterObservationAck(threadFarewell) === true,
    'observation prompt followed by farewell → finalize',
  );
  const threadAfterEdit = [
    { role: 'assistant', content: 'Quer alterar algo?' },
    { role: 'user', content: 'sim, troca a coca por guaraná' },
  ];
  assert(
    shouldFinalizeAfterObservationAck(threadAfterEdit) === false,
    'observation prompt followed by an edit request does NOT finalize',
  );
}

// ---------------------------------------------------------------------------
// REG-3 — semantic product matching for "salgados fritos"
// ---------------------------------------------------------------------------

console.log('\nReg-3: "salgados fritos" maps to a candidate set, not no_match');
{
  const result = resolveProductBySemantic('Salgados fritos', SALGADOS_CATALOG);
  assert(
    result.kind !== 'no_match',
    `"Salgados fritos" must not be no_match (got ${result.kind})`,
  );
  if (result.kind === 'multiple_candidates') {
    const names = result.candidates.map((c) => c.name);
    assert(
      names.includes('Cento Tradicionais Sortidos') || names.includes('Cento Sortidos') || names.includes('Cento de Bolinha de queijo') || names.includes('Cento de Coxinha de frango'),
      'candidate list contains at least one fried-mini option',
    );
    assert(
      !names.includes('Cento Assados Sortidos'),
      'candidate list excludes "Cento Assados Sortidos" (mode=fritos)',
    );
    assert(
      !names.includes('Brigadeiro tradicional'),
      'candidate list excludes doces (different category)',
    );
  }

  // "meio cento de salgados fritos" — same mode, with units
  const intent = mapInformalSalgadoTerm('meio cento de salgados fritos');
  assert(intent.mode === 'fritos', 'intent mode = fritos');
  assert(intent.units === 50, 'intent units = 50 (meio cento)');
  assert(intent.categories.includes('salgado_frito_mini'), 'intent category = salgado_frito_mini');

  // "bolinha de queijo" hits the unique flavor match
  const bolinha = resolveProductBySemantic('bolinha de queijo', SALGADOS_CATALOG);
  assert(
    bolinha.kind === 'unique_match' && bolinha.product.name === 'Cento de Bolinha de queijo',
    'bolinha de queijo → unique match Cento de Bolinha de queijo',
  );

  // "frango" alone is ambiguous between coxinha and a sortido — treat as
  // multiple candidates, not no_match.
  const frango = resolveProductBySemantic('frango', SALGADOS_CATALOG);
  assert(
    frango.kind !== 'no_match',
    `"frango" alone is not no_match (got ${frango.kind})`,
  );

  // Empty input → no_match
  const empty = resolveProductBySemantic('', SALGADOS_CATALOG);
  assert(empty.kind === 'no_match', 'empty input is no_match');
}

console.log('\nReg-3b: common Casa dos Salgados assado names map semantically');
{
  const CASA_ASSADOS: CatalogProductLike[] = [
    { name: 'Cento de esfiha de carne', unitBased: true },
    { name: 'Cento de hamburguinho', unitBased: true },
    { name: 'Cento de travesseiro de presunto e queijo frito', unitBased: true },
    { name: 'Cento de presunto e queijo c catupiry', unitBased: true },
    { name: 'Cento de coxinha de carne', unitBased: true },
    { name: 'Cento Pastel carne', unitBased: true },
  ];

  const esfirra = resolveProductBySemantic('esfirra de carne', CASA_ASSADOS);
  assert(
    esfirra.kind === 'unique_match' && esfirra.product.name === 'Cento de esfiha de carne',
    `esfirra de carne → Cento de esfiha de carne (got ${esfirra.kind})`,
  );

  const hamburguer = resolveProductBySemantic('hambúrguer', CASA_ASSADOS);
  assert(
    hamburguer.kind === 'unique_match' && hamburguer.product.name === 'Cento de hamburguinho',
    `hambúrguer → Cento de hamburguinho (got ${hamburguer.kind})`,
  );

  const enroladinho = resolveProductBySemantic('enroladinho de presunto e queijo', CASA_ASSADOS);
  assert(
    enroladinho.kind !== 'no_match',
    `enroladinho de presunto e queijo should offer candidates instead of cold escalation (got ${enroladinho.kind})`,
  );
}

// ---------------------------------------------------------------------------
// REG-4 — "não" answering "quer alterar algo?" is confirm, not cancel
// ---------------------------------------------------------------------------

console.log('\nReg-4: "não" after observation prompt is no-changes, not cancel');
{
  assert(
    classifyConfirmationIntent('não', observationCtx) === 'farewell_or_thanks_confirm',
    'não after observation prompt is treated as confirm-no-changes',
  );
  assert(
    classifyConfirmationIntent('nao', observationCtx) === 'farewell_or_thanks_confirm',
    'nao (no accent) after observation prompt is treated as confirm-no-changes',
  );
  // But "não" with a different context is still cancel
  assert(
    classifyConfirmationIntent('não', summaryCtx) === 'negative_cancel',
    'não with summary context is cancel',
  );
  assert(
    classifyConfirmationIntent('não', buttonCtx) === 'negative_cancel',
    'não with button context is cancel',
  );
}

// ---------------------------------------------------------------------------
// REG-5 — receipt amount mismatch must NOT auto-confirm
// ---------------------------------------------------------------------------

console.log('\nReg-5: pickActiveOrder selects only non-delivered orders within 48h');
{
  const now = new Date('2026-05-09T12:00:00-03:00');
  const ready: ActiveOrderRow = {
    id: 'r1', status: 'ready', total: 100, paymentMethod: 'Pix',
    createdAt: '2026-05-09T08:00:00-03:00',
  };
  const out: ActiveOrderRow = {
    id: 'd1', status: 'out_for_delivery', total: 50, paymentMethod: 'Pix',
    createdAt: '2026-05-09T11:00:00-03:00',
  };
  const delivered: ActiveOrderRow = {
    id: 'old', status: 'delivered', total: 80, paymentMethod: 'Pix',
    createdAt: '2026-05-09T11:30:00-03:00',
  };
  const picked = pickActiveOrder([ready, out, delivered], now);
  assert(
    picked?.id === 'out' || picked?.id === 'd1',
    'most recent non-delivered wins over older non-delivered',
  );
  assert(
    pickActiveOrder([delivered], now) === null,
    'a single delivered order yields null',
  );
}

// ---------------------------------------------------------------------------
// EDGE CASES — confirmation intent
// ---------------------------------------------------------------------------

console.log('\nEdge: confirmation intent classifier');
{
  // 1. Plain "sim" with various contexts
  assert(classifyConfirmationIntent('sim', noneCtx) === 'affirmative_confirm', 'sim is affirmative');
  assert(classifyConfirmationIntent('Sim!', noneCtx) === 'affirmative_confirm', 'Sim! (caps + bang) is affirmative');
  assert(classifyConfirmationIntent('s', noneCtx) === 'affirmative_confirm', 's (single letter) is affirmative');
  assert(classifyConfirmationIntent('ss', noneCtx) === 'affirmative_confirm', 'ss is affirmative');

  // 2. "ok" variants
  assert(classifyConfirmationIntent('ok', noneCtx) === 'affirmative_confirm', 'ok is affirmative');
  assert(classifyConfirmationIntent('OK!', noneCtx) === 'affirmative_confirm', 'OK! is affirmative');
  assert(classifyConfirmationIntent('okidoki', noneCtx) === 'affirmative_confirm', 'okidoki is affirmative');

  // 3. Phrase with embedded edit must NOT be auto-confirm
  assert(
    classifyConfirmationIntent('certo, mas troca a coca', summaryCtx) === 'unknown',
    'qualified affirmative with edit phrase is unknown (safe path)',
  );
  assert(
    classifyConfirmationIntent('não, prefiro de manhã', summaryCtx) === 'unknown',
    'qualified negative with edit phrase is unknown (safe path)',
  );

  // 4. Escalation keywords always win
  assert(
    classifyConfirmationIntent('quero falar com um humano', noneCtx) === 'escalation_request',
    'humano keyword routes to escalation',
  );
  assert(
    classifyConfirmationIntent('isso é uma reclamação séria', summaryCtx) === 'escalation_request',
    'reclamacao keyword routes to escalation',
  );
  assert(
    classifyConfirmationIntent('quero meu dinheiro de volta', noneCtx) === 'escalation_request',
    'reembolso keyword routes to escalation',
  );

  // 5. Empty / whitespace
  assert(classifyConfirmationIntent('', noneCtx) === 'unknown', 'empty string is unknown');
  assert(classifyConfirmationIntent('   ', noneCtx) === 'unknown', 'whitespace is unknown');

  // 6. Numbers / random text
  assert(classifyConfirmationIntent('5min', noneCtx) === 'unknown', '5min is unknown (not auto-confirm)');
  assert(classifyConfirmationIntent('uns 10 minutos', noneCtx) === 'unknown', 'time estimate is unknown');
  assert(classifyConfirmationIntent('vendo aqui', noneCtx) === 'unknown', 'random text is unknown');

  // 7. Mixed positive emoji + thank you
  assert(
    classifyConfirmationIntent('Obrigado 🙏', observationCtx) === 'farewell_or_thanks_confirm',
    'thank-you with emoji after observation prompt is farewell-confirm',
  );

  // 8. "blz" / "show" / "tranquilo"
  assert(classifyConfirmationIntent('blz', noneCtx) === 'affirmative_confirm', 'blz is affirmative');
  assert(classifyConfirmationIntent('show', noneCtx) === 'affirmative_confirm', 'show is affirmative');
  assert(classifyConfirmationIntent('tranquilo', noneCtx) === 'affirmative_confirm', 'tranquilo is affirmative');

  // 9. "demorou" — gíria for "yes!"
  assert(classifyConfirmationIntent('demorou', noneCtx) === 'affirmative_confirm', 'demorou (gíria) is affirmative');

  // 10. Multi-token: "ok obrigado boa noite" — either confirm subtype is fine
  {
    const intent = classifyConfirmationIntent('ok obrigado boa noite', observationCtx);
    assert(
      intent === 'affirmative_confirm' || intent === 'farewell_or_thanks_confirm',
      `multi-token farewell stack after observation → confirm (got ${intent})`,
    );
  }

  // 11. Confidence-boosting "perfeitinho"
  assert(
    classifyConfirmationIntent('perfeitinho', noneCtx) === 'affirmative_confirm',
    'perfeitinho (diminutive) is affirmative',
  );

  // 12. Negative variants
  assert(classifyConfirmationIntent('cancela', noneCtx) === 'negative_cancel', 'cancela is negative');
  assert(classifyConfirmationIntent('cancelar', noneCtx) === 'negative_cancel', 'cancelar is negative');
  assert(classifyConfirmationIntent('desisto', noneCtx) === 'negative_cancel', 'desisto is negative');
  assert(classifyConfirmationIntent('esquece', noneCtx) === 'negative_cancel', 'esquece is negative');
  assert(classifyConfirmationIntent('mudei de ideia', noneCtx) === 'negative_cancel', 'mudei de ideia is negative');

  // 13. Negative emoji
  assert(classifyConfirmationIntent('❌', summaryCtx) === 'negative_cancel', 'X emoji is negative');
  assert(classifyConfirmationIntent('👎', summaryCtx) === 'negative_cancel', 'thumbs-down emoji is negative');

  // 14. Edge: "perfeito gratidão" — no contradicting tokens (any confirm subtype is fine)
  {
    const intent = classifyConfirmationIntent('perfeito gratidao', observationCtx);
    assert(
      intent === 'affirmative_confirm' || intent === 'farewell_or_thanks_confirm',
      `perfeito + gratidao after observation → confirm (got ${intent})`,
    );
  }

  // 15. Punctuation-heavy farewell
  assert(
    classifyConfirmationIntent('Boa noite!!! Até amanhã 😊', observationCtx) === 'farewell_or_thanks_confirm',
    'noisy farewell with emojis after observation → farewell-confirm',
  );
  assert(
    classifyConfirmationIntent('sem obs', observationCtx) === 'farewell_or_thanks_confirm',
    'sem obs after observation prompt means no changes',
  );
  assert(
    classifyConfirmationIntent('não, deixa como tá', observationCtx) === 'farewell_or_thanks_confirm',
    'não deixa como tá after observation prompt means no changes',
  );
}

// ---------------------------------------------------------------------------
// EDGE CASES — observation prompt detector
// ---------------------------------------------------------------------------

console.log('\nEdge: observation prompt detector');
{
  assert(
    looksLikeObservationPrompt('Gostaria de alterar algo, ou tem alguma observação a fazer?') === true,
    'standard observation prompt is detected',
  );
  assert(
    looksLikeObservationPrompt('GOSTARIA DE ALTERAR ALGO?') === true,
    'uppercase variant is detected',
  );
  assert(
    looksLikeObservationPrompt('Tem alguma observação?') === true,
    'short variant is detected',
  );
  assert(
    looksLikeObservationPrompt('Algo a mais?') === true,
    '"Algo a mais?" is detected',
  );
  assert(
    looksLikeObservationPrompt('Resumo do pedido: ...') === false,
    'order summary alone is NOT an observation prompt',
  );
  assert(
    looksLikeObservationPrompt('') === false,
    'empty content is not an observation prompt',
  );
}

// ---------------------------------------------------------------------------
// EDGE CASES — cento / unit detector
// ---------------------------------------------------------------------------

console.log('\nEdge: detectUnitCount');
{
  assert(detectUnitCount('meio cento') === 50, 'meio cento = 50');
  assert(detectUnitCount('um cento') === 100, 'um cento = 100');
  assert(detectUnitCount('cento') === 100, 'cento alone = 100');
  assert(detectUnitCount('2 centos') === 200, '2 centos = 200');
  assert(detectUnitCount('dois centos') === 200, 'dois centos = 200');
  assert(detectUnitCount('um quarto de cento') === 25, 'um quarto de cento = 25');
  assert(detectUnitCount('50 mini') === 50, '50 mini = 50');
  assert(detectUnitCount('30 salgadinhos') === 30, '30 salgadinhos = 30');
  assert(detectUnitCount('centena') === 100, 'centena = 100');
  assert(detectUnitCount('quero algo doce') === null, 'no quantity phrase = null');
  assert(detectUnitCount('') === null, 'empty = null');
  // Sanity: a phone number-like string must not be parsed as units.
  assert(detectUnitCount('11999998888') === null, 'phone number is not parsed as quantity');
}

// ---------------------------------------------------------------------------
// EDGE CASES — semantic product matcher
// ---------------------------------------------------------------------------

console.log('\nEdge: resolveProductBySemantic');
{
  // "fritinhos" alone → multiple_candidates (all non-assados centos)
  const fritinhos = resolveProductBySemantic('fritinhos', SALGADOS_CATALOG);
  assert(fritinhos.kind === 'multiple_candidates', 'fritinhos → multiple_candidates');

  // "assados" alone → multiple_candidates of assados only
  const assados = resolveProductBySemantic('mini assados sortidos', SALGADOS_CATALOG);
  assert(
    assados.kind === 'unique_match' && assados.product.name === 'Cento Assados Sortidos',
    'mini assados sortidos → Cento Assados Sortidos',
  );

  // "doces variados" → unique brigadeiro (only doce in catalog)
  const doces = resolveProductBySemantic('uns doces variados', SALGADOS_CATALOG);
  assert(
    doces.kind === 'unique_match' && doces.product.name === 'Brigadeiro tradicional',
    'doces variados → Brigadeiro tradicional (only doce in catalog)',
  );

  // Catalog with only one fried-mini option → unique
  const onlyOneFry: CatalogProductLike[] = [{ name: 'Cento Tradicionais Sortidos', unitBased: true }];
  const onlyOne = resolveProductBySemantic('salgados fritos', onlyOneFry);
  assert(
    onlyOne.kind === 'unique_match' && onlyOne.product.name === 'Cento Tradicionais Sortidos',
    'single fritos catalog item → unique_match',
  );

  // Empty catalog
  const emptyCatalog = resolveProductBySemantic('salgados fritos', []);
  assert(emptyCatalog.kind === 'no_match', 'empty catalog → no_match');

  // Phrase with no semantic hooks
  const garbage = resolveProductBySemantic('xpto banana 123', SALGADOS_CATALOG);
  assert(garbage.kind === 'no_match', 'garbage phrase → no_match');
}

// ---------------------------------------------------------------------------
// EDGE CASES — normalizeIntent
// ---------------------------------------------------------------------------

console.log('\nEdge: normalizeIntent');
{
  assert(normalizeIntent('Certinho!') === 'certinho', 'strips trailing exclamation');
  assert(normalizeIntent('  certo  ') === 'certo', 'strips outer whitespace');
  assert(normalizeIntent('SIM') === 'sim', 'lowercases');
  assert(normalizeIntent('beleza 👍') === 'beleza', 'strips trailing emoji');
  assert(normalizeIntent('GRATIDÃO') === 'gratidao', 'strips diacritics');
}

// ---------------------------------------------------------------------------
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
