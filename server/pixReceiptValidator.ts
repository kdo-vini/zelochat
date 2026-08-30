import type { ChatAttachment } from '../src/types.js';
import type { PixReceiptAnalysis, PixReceiptConfig } from '../src/domain/pixReceipt.js';
import { evaluatePixReceipt } from '../src/domain/pixReceipt.js';
import { recordAiUsage } from './aiUsage.js';
import { getOpenAIClient } from './openaiClient.js';

const PIX_RECEIPT_MODEL = process.env.OPENAI_PIX_RECEIPT_MODEL || process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';

export type PixReceiptValidationResult = {
  analysis: PixReceiptAnalysis;
  approved: boolean;
  reason: string;
};

function parseModelJson(text: string): PixReceiptAnalysis {
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  const parsed = JSON.parse(cleaned) as Partial<PixReceiptAnalysis>;
  return {
    isReceipt: parsed.isReceipt === true,
    isPix: parsed.isPix === true,
    beneficiaryName: typeof parsed.beneficiaryName === 'string' ? parsed.beneficiaryName : null,
    payerName: typeof parsed.payerName === 'string' ? parsed.payerName : null,
    amount: typeof parsed.amount === 'number' && Number.isFinite(parsed.amount) ? parsed.amount : null,
    paidAt: typeof parsed.paidAt === 'string' ? parsed.paidAt : null,
    institution: typeof parsed.institution === 'string' ? parsed.institution : null,
    confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0,
    reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 500) : 'Sem justificativa do modelo.',
  };
}

function inputPartForAttachment(attachment: ChatAttachment): Record<string, unknown> | null {
  const dataUrl = attachment.dataUrl;
  if (!dataUrl) return null;
  const mime = attachment.mimeType.split(';')[0]?.trim().toLowerCase() || '';

  if (attachment.type === 'image' && ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mime)) {
    return { type: 'input_image', image_url: dataUrl, detail: 'high' };
  }

  if (attachment.type === 'document' && mime === 'application/pdf') {
    return {
      type: 'input_file',
      filename: attachment.fileName || 'comprovante-pix.pdf',
      ...(dataUrl.startsWith('data:application/pdf;base64,')
        ? { file_data: dataUrl }
        : { file_url: dataUrl }),
    };
  }

  return null;
}

export function isSupportedPixReceiptAttachment(attachment: ChatAttachment | undefined): boolean {
  return !!attachment && inputPartForAttachment(attachment) !== null;
}

export async function validatePixReceipt(params: {
  empresaId: string;
  attachment: ChatAttachment;
  expectedTotal: number;
  config: PixReceiptConfig;
  permitGuard?: () => Promise<boolean>;
}): Promise<PixReceiptValidationResult | null> {
  const inputPart = inputPartForAttachment(params.attachment);
  if (!inputPart) {
    const analysis: PixReceiptAnalysis = {
      isReceipt: false,
      isPix: false,
      beneficiaryName: null,
      payerName: null,
      amount: null,
      paidAt: null,
      institution: null,
      confidence: 0,
      reason: 'Arquivo recebido não é imagem ou PDF compatível para leitura de comprovante.',
    };
    return { analysis, approved: false, reason: analysis.reason };
  }

  const prompt = `Analise o arquivo enviado como possível comprovante Pix brasileiro.

Extraia somente dados visíveis no comprovante. Não invente dados ausentes.
Responda APENAS JSON válido com este formato:
{
  "isReceipt": boolean,
  "isPix": boolean,
  "beneficiaryName": string|null,
  "payerName": string|null,
  "amount": number|null,
  "paidAt": string|null,
  "institution": string|null,
  "confidence": number,
  "reason": string
}

Regras:
- paidAt deve ser ISO 8601 quando a data/hora aparecer; caso contrário null.
- amount deve ser o valor transferido em reais, como número.
- confidence mede a confiança na leitura dos campos principais, de 0 a 1.
- Não diga que o dinheiro caiu na conta; isto é apenas leitura documental.`;

  try {
    if (params.permitGuard && !(await params.permitGuard())) return null;
    const openai = getOpenAIClient();
    const response = await openai.responses.create({
      model: PIX_RECEIPT_MODEL,
      input: [
        {
          role: 'user',
          content: [
            inputPart,
            { type: 'input_text', text: prompt },
          ],
        },
      ],
    } as any);
    // FIX 2026-08-30 R1: takeover durante o modelo Pix não pode produzir nem telemetria/mutação automática posterior.
    if (params.permitGuard && !(await params.permitGuard())) return null;
    recordAiUsage({
      empresaId: params.empresaId,
      feature: 'pix_receipt_validation',
      model: PIX_RECEIPT_MODEL,
      status: 'success',
      usage: (response as any).usage,
    });

    const text = (response as any).output_text || '';
    const analysis = parseModelJson(text);
    const evaluation = evaluatePixReceipt({
      analysis,
      config: params.config,
      expectedTotal: params.expectedTotal,
    });
    return {
      analysis,
      approved: evaluation.approved,
      reason: evaluation.reason,
    };
  } catch (error) {
    if (params.permitGuard && !(await params.permitGuard())) return null;
    recordAiUsage({
      empresaId: params.empresaId,
      feature: 'pix_receipt_validation',
      model: PIX_RECEIPT_MODEL,
      status: 'error',
    });
    console.error('[PixReceipt] validation failed:', error);
    const analysis: PixReceiptAnalysis = {
      isReceipt: false,
      isPix: false,
      beneficiaryName: null,
      payerName: null,
      amount: null,
      paidAt: null,
      institution: null,
      confidence: 0,
      reason: 'Falha técnica ao ler o comprovante.',
    };
    return { analysis, approved: false, reason: analysis.reason };
  }
}
