export type PixReceiptFallback = 'ask_retry' | 'escalate_human';

export type PixReceiptConfig = {
  /** Internal feature flag. V1 UI only appears when this is true. */
  available: boolean;
  /** Operator-facing toggle: require receipt before confirming Pix orders. */
  enabled: boolean;
  beneficiaryNames: string[];
  valueTolerance: number;
  maxAgeHours: number;
  fallback: PixReceiptFallback;
  minConfidence: number;
};

export type PixReceiptAnalysis = {
  isReceipt: boolean;
  isPix: boolean;
  beneficiaryName: string | null;
  payerName: string | null;
  amount: number | null;
  paidAt: string | null;
  institution: string | null;
  confidence: number;
  reason: string;
};

export type PixReceiptEvaluation =
  | { approved: true; reason: string }
  | { approved: false; reason: string };

export const DEFAULT_PIX_RECEIPT_CONFIG: PixReceiptConfig = {
  available: false,
  enabled: false,
  beneficiaryNames: [],
  valueTolerance: 0.01,
  maxAgeHours: 24,
  fallback: 'escalate_human',
  minConfidence: 0.85,
};

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeNameList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim().replace(/\s+/g, ' ');
    if (!trimmed) continue;
    const key = normalizeComparableText(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(trimmed.slice(0, 120));
  }
  return names.slice(0, 8);
}

export function normalizePixReceiptConfig(value: unknown): PixReceiptConfig {
  if (!value || typeof value !== 'object') return { ...DEFAULT_PIX_RECEIPT_CONFIG };
  const raw = value as Partial<PixReceiptConfig>;
  const fallback: PixReceiptFallback = raw.fallback === 'ask_retry' ? 'ask_retry' : 'escalate_human';
  return {
    available: asBoolean(raw.available, DEFAULT_PIX_RECEIPT_CONFIG.available),
    enabled: asBoolean(raw.enabled, DEFAULT_PIX_RECEIPT_CONFIG.enabled),
    beneficiaryNames: normalizeNameList(raw.beneficiaryNames),
    valueTolerance: asNumber(raw.valueTolerance, DEFAULT_PIX_RECEIPT_CONFIG.valueTolerance, 0, 20),
    maxAgeHours: asNumber(raw.maxAgeHours, DEFAULT_PIX_RECEIPT_CONFIG.maxAgeHours, 1, 168),
    fallback,
    minConfidence: asNumber(raw.minConfidence, DEFAULT_PIX_RECEIPT_CONFIG.minConfidence, 0.5, 0.99),
  };
}

export function isPixReceiptConfigActive(config: PixReceiptConfig | null | undefined): boolean {
  if (!config) return false;
  return config.available === true && config.enabled === true && config.beneficiaryNames.length > 0;
}

export function isPixPaymentMethod(value: string | null | undefined): boolean {
  if (!value) return false;
  return /\bpix\b/i.test(value.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
}

export function normalizeComparableText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function beneficiaryMatches(actual: string | null, expectedNames: string[]): boolean {
  if (!actual) return false;
  const actualNorm = normalizeComparableText(actual);
  if (!actualNorm) return false;
  return expectedNames.some((expected) => {
    const expectedNorm = normalizeComparableText(expected);
    if (!expectedNorm) return false;
    return actualNorm === expectedNorm || actualNorm.includes(expectedNorm) || expectedNorm.includes(actualNorm);
  });
}

function parsePaidAt(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function evaluatePixReceipt(params: {
  analysis: PixReceiptAnalysis;
  config: PixReceiptConfig;
  expectedTotal: number;
  now?: Date;
}): PixReceiptEvaluation {
  const { analysis, config, expectedTotal } = params;
  const now = params.now ?? new Date();

  if (!analysis.isReceipt || !analysis.isPix) {
    return { approved: false, reason: 'A imagem/documento não parece ser um comprovante Pix.' };
  }

  if (analysis.confidence < config.minConfidence) {
    return { approved: false, reason: 'A leitura do comprovante ficou com baixa confiança.' };
  }

  if (!beneficiaryMatches(analysis.beneficiaryName, config.beneficiaryNames)) {
    return { approved: false, reason: 'O beneficiário do comprovante não corresponde ao cadastro da loja.' };
  }

  if (analysis.amount == null || !Number.isFinite(analysis.amount)) {
    return { approved: false, reason: 'Não consegui identificar o valor pago no comprovante.' };
  }

  if (analysis.amount + config.valueTolerance < expectedTotal) {
    return { approved: false, reason: 'O valor do comprovante é menor que o total do pedido.' };
  }

  const paidAt = parsePaidAt(analysis.paidAt);
  if (!paidAt) {
    return { approved: false, reason: 'Não consegui identificar a data e hora do pagamento.' };
  }

  const maxAgeMs = config.maxAgeHours * 60 * 60 * 1000;
  if (paidAt.getTime() < now.getTime() - maxAgeMs) {
    return { approved: false, reason: 'O comprovante é antigo demais para este pedido.' };
  }

  if (paidAt.getTime() > now.getTime() + 10 * 60 * 1000) {
    return { approved: false, reason: 'A data do comprovante parece estar no futuro.' };
  }

  return { approved: true, reason: 'Comprovante Pix aprovado.' };
}
