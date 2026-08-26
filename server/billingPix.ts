import type { Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import {
  getServiceSupabase,
  invalidateSubscriptionCache,
} from './supabase.js';
import { requireOwnerAccess } from './accessControl.js';
import { createPixCharge, getChargeStatus, verifyAbacatePaySignature } from './abacatepay.js';
import { PRICING } from '../src/data/pricing.js';

// Valor cobrado no PIX = FONTE ÚNICA src/data/pricing.ts (mesma da landing e dos
// e-mails). Antes vinha do env ABACATEPAY_PRICE_* em centavos, desacoplado do
// preço exibido — isso permitia cobrar um valor e mostrar outro. Agora o PIX
// cobra exatamente o preço anunciado (chat 149 / bundle 198). Os envs
// ABACATEPAY_PRICE_CHAT/BUNDLE ficam obsoletos e podem ser removidos do Dokploy.
// (O Stripe continua com price próprio via STRIPE_PRICE_* — trocar quando a conta
// permitir; até lá PIX e cartão podem cobrar valores diferentes.)
function getPlanPrice(planTier: 'chat' | 'bundle'): number {
  return PRICING[planTier].priceBRL;
}

export function safeEqualStr(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

// POST /api/billing/pix/create
export async function handleCreatePixCharge(req: Request, res: Response): Promise<void> {
  try {
    const { ownerUserId: userId, empresaId } = await requireOwnerAccess(req);
    const planTier = (req.body?.planTier ?? 'chat') as string;

    if (planTier !== 'chat' && planTier !== 'bundle') {
      res.status(400).json({ error: 'INVALID_PLAN_TIER' });
      return;
    }

    const supabase = getServiceSupabase();

    // Block if user already has an active ZeloChat subscription
    const { data: active } = await supabase
      .from('subscriptions')
      .select('status, current_period_end')
      .eq('user_id', userId)
      .in('plan_tier', ['chat', 'bundle'])
      .eq('status', 'active')
      .order('current_period_end', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (active?.current_period_end && new Date(active.current_period_end).getTime() > Date.now()) {
      res.status(409).json({ error: 'ALREADY_ACTIVE' });
      return;
    }

    // Fetch customer data from empresa_perfil for the Pix charge
    const { data: empresa } = await supabase
      .from('empresa_perfil')
      .select('nome_exibicao, documento, contato')
      .eq('id', empresaId)
      .maybeSingle() as { data: { nome_exibicao?: string; documento?: string; contato?: string } | null };

    const { data: authUser } = await supabase.auth.admin.getUserById(userId);
    const customerEmail = authUser?.user?.email ?? null;

    const amountBRL = getPlanPrice(planTier);

    const charge = await createPixCharge({
      userId,
      empresaId,
      planTier,
      amountBRL,
      customerName: empresa?.nome_exibicao ?? null,
      customerEmail,
      customerTaxId: empresa?.documento ?? null,
      customerPhone: empresa?.contato ?? null,
    });

    await supabase.from('zelochat_billing_payments').insert({
      user_id: userId,
      empresa_id: empresaId,
      provider: 'abacatepay',
      provider_payment_id: charge.paymentId,
      plan_tier: planTier,
      amount_brl: amountBRL,
      status: 'pending',
      pix_copy_paste: charge.pixCopyPaste,
      pix_qr_code: charge.pixQrCode,
      expires_at: charge.expiresAt,
    });

    res.json({
      paymentId: charge.paymentId,
      pixCopyPaste: charge.pixCopyPaste,
      pixQrCode: charge.pixQrCode,
      amount: amountBRL,
      expiresAt: charge.expiresAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'UNKNOWN';
    if (msg === 'UNAUTHORIZED') { res.status(401).json({ error: 'Sua sessão expirou. Entre novamente.', code: 'UNAUTHORIZED' }); return; }
    if (msg === 'FORBIDDEN') { res.status(403).json({ error: 'Apenas o responsável pela conta pode gerenciar a cobrança.', code: 'FORBIDDEN' }); return; }
    if (msg === 'EMPRESA_NOT_FOUND') { res.status(404).json({ error: 'Não encontramos sua empresa. Confira o acesso e tente novamente.', code: 'EMPRESA_NOT_FOUND' }); return; }
    if (msg.endsWith('not configured')) { res.status(503).json({ error: 'PIX_NOT_CONFIGURED' }); return; }
    console.error('[billingPix] createPixCharge error:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}

// GET /api/billing/pix/status/:paymentId
export async function handleGetPixStatus(req: Request, res: Response): Promise<void> {
  try {
    const { ownerUserId: userId } = await requireOwnerAccess(req);
    const { paymentId } = req.params;

    const supabase = getServiceSupabase();
    const { data: row } = await supabase
      .from('zelochat_billing_payments')
      .select('status, pix_copy_paste, expires_at')
      .eq('provider_payment_id', paymentId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!row) {
      res.status(404).json({ error: 'PAYMENT_NOT_FOUND' });
      return;
    }

    if (row.status === 'completed') {
      res.json({ status: 'completed' });
      return;
    }

    if (row.status === 'pending') {
      try {
        const upstream = await getChargeStatus(paymentId);
        if (upstream.status === 'COMPLETED') {
          res.json({ status: 'completed' });
          return;
        }
        if (upstream.status === 'EXPIRED' || upstream.status === 'FAILED') {
          const newStatus = upstream.status.toLowerCase();
          await supabase
            .from('zelochat_billing_payments')
            .update({ status: newStatus, updated_at: new Date().toISOString() })
            .eq('provider_payment_id', paymentId)
            .eq('user_id', userId);
          res.json({ status: newStatus, pixCopyPaste: row.pix_copy_paste, expiresAt: row.expires_at });
          return;
        }
      } catch (pollErr) {
        console.warn('[billingPix] upstream status poll failed (returning DB state):', pollErr);
      }
    }

    res.json({ status: row.status, pixCopyPaste: row.pix_copy_paste, expiresAt: row.expires_at });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'UNKNOWN';
    if (msg === 'UNAUTHORIZED') { res.status(401).json({ error: 'Sua sessão expirou. Entre novamente.', code: 'UNAUTHORIZED' }); return; }
    if (msg === 'FORBIDDEN') { res.status(403).json({ error: 'Apenas o responsável pela conta pode consultar a cobrança.', code: 'FORBIDDEN' }); return; }
    if (msg === 'EMPRESA_NOT_FOUND') { res.status(404).json({ error: 'Não encontramos sua empresa. Confira o acesso e tente novamente.', code: 'EMPRESA_NOT_FOUND' }); return; }
    console.error('[billingPix] getPixStatus error:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}

// POST /api/webhooks/abacatepay
// Auth layer 1: ?webhookSecret= query param (timing-safe)
// Auth layer 2: x-webhook-signature HMAC SHA-256 (base64) header
// Body must arrive as raw Buffer — see express.raw() in index.ts
export async function handleAbacatePayWebhook(req: Request, res: Response): Promise<void> {
  try {
    const webhookSecret = process.env.ABACATEPAY_WEBHOOK_SECRET ?? '';
    const querySecret = (req.query.webhookSecret as string) ?? '';
    if (!webhookSecret || !safeEqualStr(querySecret, webhookSecret)) {
      console.warn('[abacatepay-webhook] 401 — invalid webhookSecret');
      res.status(401).json({ error: 'invalid webhook secret' });
      return;
    }

    const rawBody = req.body as Buffer;
    if (!Buffer.isBuffer(rawBody)) {
      console.warn('[abacatepay-webhook] body is not a raw Buffer — express.raw() missing');
      res.status(400).json({ error: 'invalid body encoding' });
      return;
    }

    const publicKey = process.env.ABACATEPAY_PUBLIC_KEY ?? '';
    const signatureHeader = (req.headers['x-webhook-signature'] as string) ?? '';
    if (publicKey) {
      if (!signatureHeader) {
        console.warn('[abacatepay-webhook] 401 — x-webhook-signature header missing');
        res.status(401).json({ error: 'missing signature' });
        return;
      }
      if (!verifyAbacatePaySignature(rawBody, signatureHeader, publicKey)) {
        console.warn('[abacatepay-webhook] 401 — HMAC mismatch');
        res.status(401).json({ error: 'invalid signature' });
        return;
      }
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody.toString('utf-8')) as Record<string, unknown>;
    } catch {
      res.status(400).json({ error: 'invalid JSON' });
      return;
    }

    // AbacatePay v2 webhook shape: { id, event, data: { transparent: { ... } } }
    const eventType = ((payload.event ?? '') as string).toLowerCase();
    const eventId = (payload.id ?? '') as string;

    if (eventId) {
      const supabase = getServiceSupabase();
      const { error: idempotencyErr } = await supabase.from('zelochat_billing_webhook_events').insert({
        provider: 'abacatepay',
        event_id: eventId,
        event_type: eventType,
        payload,
      });
      if (idempotencyErr?.code === '23505') {
        res.status(200).json({ ok: true, duplicate: true });
        return;
      }
      if (idempotencyErr) {
        console.warn('[abacatepay-webhook] idempotency insert failed (continuing):', idempotencyErr.message);
      }
    }

    if (eventType === 'transparent.completed') {
      await activateSubscription(payload);
    } else if (
      eventType === 'transparent.refunded' ||
      eventType === 'transparent.disputed' ||
      eventType === 'transparent.lost'
    ) {
      await markPaymentFailed(payload);
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[abacatepay-webhook] unhandled error:', err);
    res.status(200).json({ ok: true });
  }
}

export function extractTransparentId(payload: Record<string, unknown>): string | undefined {
  const transparent = (payload.data as { transparent?: { id?: string } } | undefined)?.transparent;
  return (
    transparent?.id ??
    (payload.data as { id?: string } | undefined)?.id ??
    payload.id as string | undefined
  );
}

async function activateSubscription(payload: Record<string, unknown>): Promise<void> {
  const transparentId = extractTransparentId(payload);
  if (!transparentId) {
    console.warn('[abacatepay-webhook] transparent.completed — no transparent id in payload:', payload);
    return;
  }

  const supabase = getServiceSupabase();
  const { data: payment } = await supabase
    .from('zelochat_billing_payments')
    .select('id, user_id, plan_tier, status')
    .eq('provider_payment_id', transparentId)
    .maybeSingle();

  if (!payment) {
    console.warn(`[abacatepay-webhook] no billing_payments row for id=${transparentId} — expecting retry`);
    return;
  }
  if (payment.status === 'completed') return;

  const now = new Date().toISOString();
  const currentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await supabase
    .from('zelochat_billing_payments')
    .update({ status: 'completed', updated_at: now })
    .eq('id', payment.id);

  // Find existing chat/bundle row to update in-place on renewal.
  // Must NOT touch PDV-only rows (owned by ZeloPDV + Stripe) — overwriting those
  // would corrupt the Stripe subscription ID and break the PDV user's billing.
  const { data: existingSub } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('user_id', payment.user_id)
    .in('plan_tier', ['chat', 'bundle'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const subPayload = {
    user_id: payment.user_id,
    plan_tier: payment.plan_tier,
    status: 'active',
    payment_provider: 'abacatepay',
    provider_customer_id: null as null,
    provider_subscription_id: transparentId,
    current_period_end: currentPeriodEnd,
    billing_type: 'PIX',
    cancel_at_period_end: false,
    updated_at: now,
  };

  if (existingSub) {
    const { error } = await supabase.from('subscriptions').update(subPayload).eq('id', existingSub.id);
    if (error) console.error('[abacatepay-webhook] subscriptions update failed:', error.message);
  } else {
    const { error } = await supabase.from('subscriptions').insert({ ...subPayload, created_at: now });
    if (error) console.error('[abacatepay-webhook] subscriptions insert failed:', error.message);
  }

  invalidateSubscriptionCache(payment.user_id);
  console.log(`[abacatepay-webhook] activated user=${payment.user_id} plan=${payment.plan_tier} until=${currentPeriodEnd}`);
}

async function markPaymentFailed(payload: Record<string, unknown>): Promise<void> {
  const transparentId = extractTransparentId(payload);
  if (!transparentId) return;
  const supabase = getServiceSupabase();
  await supabase
    .from('zelochat_billing_payments')
    .update({ status: 'failed', updated_at: new Date().toISOString() })
    .eq('provider_payment_id', transparentId)
    .eq('status', 'pending');
}
