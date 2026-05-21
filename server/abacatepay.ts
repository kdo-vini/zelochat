import { createHmac, timingSafeEqual } from 'crypto';

function getApiKey(): string {
  const key = process.env.ABACATEPAY_API_KEY;
  if (!key) throw new Error('ABACATEPAY_API_KEY not configured');
  return key;
}

export function buildUrl(path: string, searchParams?: Record<string, string>): string {
  const base = process.env.ABACATEPAY_BASE_URL ?? 'https://api.abacatepay.com/v2';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const url = new URL(path, normalizedBase);
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) {
      if (v != null) url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

async function abacateRequest<T>(
  path: string,
  init: { method?: string; body?: unknown; searchParams?: Record<string, string> } = {},
): Promise<T> {
  const url = buildUrl(path, init.searchParams);
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  const payload = await res.json().catch(() => null) as {
    success?: boolean;
    error?: string;
    data?: T;
  } | null;

  if (!res.ok || payload?.success === false || payload?.error) {
    throw new Error(payload?.error ?? `AbacatePay HTTP ${res.status}`);
  }

  return (payload?.data ?? payload) as T;
}

export interface PixChargeOpts {
  userId: string;
  empresaId: string;
  planTier: 'chat' | 'bundle';
  amountBRL: number;
  customerName: string | null;
  customerEmail: string | null;
  customerTaxId: string | null;
  customerPhone: string | null;
}

export interface PixChargeResult {
  paymentId: string;
  pixCopyPaste: string;
  pixQrCode: string;
  expiresAt: string;
}

const MAX_DESCRIPTION_CHARS = 37;

export async function createPixCharge(opts: PixChargeOpts): Promise<PixChargeResult> {
  const planLabel = opts.planTier === 'bundle' ? 'Bundle 30d' : 'Chat 30d';
  const description = `ZeloChat ${planLabel}`.slice(0, MAX_DESCRIPTION_CHARS);

  const customer: Record<string, string> = {};
  if (opts.customerName) customer.name = opts.customerName;
  if (opts.customerEmail) customer.email = opts.customerEmail;
  if (opts.customerTaxId) customer.taxId = opts.customerTaxId;
  if (opts.customerPhone) customer.cellphone = opts.customerPhone;

  const data = await abacateRequest<{
    id: string;
    brCode?: string;
    brCodeBase64?: string;
    pixCopyPaste?: string;
    pixQrCode?: string;
    expiresAt?: string;
  }>('transparents/create', {
    method: 'POST',
    body: {
      method: 'PIX',
      data: {
        amount: Math.round(opts.amountBRL * 100),
        expiresIn: 3600,
        description,
        externalId: `zelochat-${opts.planTier}-${opts.userId.slice(0, 8)}-${Date.now()}`,
        customer: Object.keys(customer).length > 0 ? customer : undefined,
        metadata: {
          source: 'zelochat_pix',
          userId: opts.userId,
          empresaId: opts.empresaId,
          planTier: opts.planTier,
        },
      },
    },
  });

  if (!data?.id) throw new Error('AbacatePay response missing payment id');

  return {
    paymentId: data.id,
    pixCopyPaste: data.brCode ?? data.pixCopyPaste ?? '',
    pixQrCode: data.brCodeBase64 ?? data.pixQrCode ?? '',
    expiresAt: data.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
}

type UpstreamStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'EXPIRED';

export const STATUS_MAP: Record<string, UpstreamStatus> = {
  ACTIVE: 'PENDING',
  PENDING: 'PENDING',
  PAID: 'COMPLETED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'FAILED',
  CANCELED: 'FAILED',
  EXPIRED: 'EXPIRED',
  REFUNDED: 'FAILED',
};

export async function getChargeStatus(paymentId: string): Promise<{ status: UpstreamStatus }> {
  const data = await abacateRequest<{ status?: string }>('transparents/check', {
    searchParams: { id: paymentId },
  });
  const raw = (data?.status ?? '').toUpperCase();
  return { status: STATUS_MAP[raw] ?? 'PENDING' };
}

/**
 * Verifies the HMAC-SHA256 signature that AbacatePay sends in x-webhook-signature.
 * AbacatePay encodes the digest as raw base64 (no "sha256=" prefix).
 * The publicKey is the webhook signing secret from the AbacatePay dashboard.
 */
export function verifyAbacatePaySignature(
  rawBody: Buffer,
  signatureHeader: string,
  publicKey: string,
): boolean {
  try {
    const expected = createHmac('sha256', publicKey).update(rawBody).digest('base64');
    const a = Buffer.from(expected);
    const b = Buffer.from(signatureHeader);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
