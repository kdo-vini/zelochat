import {
  DEFAULT_PIX_RECEIPT_CONFIG,
  evaluatePixReceipt,
  isPixReceiptConfigActive,
  isPixPaymentMethod,
  normalizePixReceiptConfig,
  type PixReceiptAnalysis,
} from '../src/domain/pixReceipt';

let pass = 0;
let fail = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log('  PASS', msg);
    pass++;
  } else {
    console.log('  FAIL', msg);
    fail++;
  }
}

const baseConfig = normalizePixReceiptConfig({
  ...DEFAULT_PIX_RECEIPT_CONFIG,
  available: true,
  enabled: true,
  beneficiaryNames: ['Casa dos Salgados LTDA', 'Casa dos Salgados'],
  valueTolerance: 0.01,
  maxAgeHours: 24,
  minConfidence: 0.85,
});

const baseAnalysis: PixReceiptAnalysis = {
  isReceipt: true,
  isPix: true,
  beneficiaryName: 'CASA DOS SALGADOS LTDA',
  payerName: 'Cliente Teste',
  amount: 90,
  paidAt: '2026-05-06T12:00:00-03:00',
  institution: 'Banco Teste',
  confidence: 0.93,
  reason: 'Comprovante Pix legível.',
};

const now = new Date('2026-05-06T13:00:00-03:00');

console.log('\nPix receipt deterministic evaluation');

{
  const result = evaluatePixReceipt({ analysis: baseAnalysis, config: baseConfig, expectedTotal: 90, now });
  assert(result.approved, 'valid receipt is approved');
}

{
  const result = evaluatePixReceipt({ analysis: { ...baseAnalysis, amount: 90.01 }, config: baseConfig, expectedTotal: 90, now });
  assert(result.approved, 'overpaid receipt is approved');
}

{
  const result = evaluatePixReceipt({
    analysis: { ...baseAnalysis, beneficiaryName: 'Outra Loja' },
    config: baseConfig,
    expectedTotal: 90,
    now,
  });
  assert(!result.approved && /beneficiário|beneficiario/i.test(result.reason), 'wrong beneficiary is rejected');
}

{
  const result = evaluatePixReceipt({
    analysis: { ...baseAnalysis, amount: 89.98 },
    config: baseConfig,
    expectedTotal: 90,
    now,
  });
  assert(!result.approved && /menor/i.test(result.reason), 'underpaid receipt is rejected');
}

{
  const result = evaluatePixReceipt({
    analysis: { ...baseAnalysis, confidence: 0.5 },
    config: baseConfig,
    expectedTotal: 90,
    now,
  });
  assert(!result.approved && /confiança|confianca/i.test(result.reason), 'low confidence is rejected');
}

{
  const result = evaluatePixReceipt({
    analysis: { ...baseAnalysis, paidAt: '2026-05-04T12:00:00-03:00' },
    config: baseConfig,
    expectedTotal: 90,
    now,
  });
  assert(!result.approved && /antigo/i.test(result.reason), 'old receipt is rejected');
}

{
  const result = evaluatePixReceipt({
    analysis: { ...baseAnalysis, paidAt: '2026-05-06T13:30:00-03:00' },
    config: baseConfig,
    expectedTotal: 90,
    now,
  });
  assert(!result.approved && /futuro/i.test(result.reason), 'future-dated receipt is rejected');
}

{
  const normalized = normalizePixReceiptConfig({
    available: true,
    enabled: true,
    beneficiaryNames: [' Casa dos Salgados ', 'casa dos salgados', ''],
    valueTolerance: -10,
    maxAgeHours: 999,
    minConfidence: 2,
    fallback: 'invalid',
  });
  assert(normalized.beneficiaryNames.length === 1, 'beneficiary names are trimmed and deduplicated');
  assert(normalized.valueTolerance === 0, 'value tolerance is clamped to minimum');
  assert(normalized.maxAgeHours === 168, 'max age is clamped to maximum');
  assert(normalized.minConfidence === 0.99, 'minimum confidence is clamped to maximum');
  assert(normalized.fallback === 'escalate_human', 'invalid fallback defaults to human escalation');
  assert(isPixReceiptConfigActive(normalized), 'available enabled config with beneficiary is active');
  assert(!isPixReceiptConfigActive({ ...normalized, available: false }), 'available=false disables active config');
}

assert(isPixPaymentMethod('Pix'), 'Pix payment method is detected');
assert(isPixPaymentMethod('Pagamento via PIX na hora'), 'Pix inside phrase is detected');
assert(!isPixPaymentMethod('Cartão'), 'non-Pix payment method is not detected');

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
