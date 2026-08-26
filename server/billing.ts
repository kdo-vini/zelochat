/**
 * Stripe billing endpoints for ZeloChat.
 *
 * ZeloChat reads from the shared `subscriptions` table (used by both ZeloChat
 * and ZeloPDV). Webhook processing lives in zeloPDV-Prod
 * (`/api/billing/webhook`) — Stripe sends every event there, the handler
 * writes the canonical row, and ZeloChat picks it up. Both deployments share
 * the same Stripe credentials and the same Supabase project.
 *
 * What this file owns (ZeloChat-side, no operator action required):
 * - POST /api/billing/checkout     — start a Stripe Checkout session for the
 *   chat or bundle plan. NO TRIAL — the chat plan charges immediately.
 *   Pre-records an 'incomplete' row so the webhook has something to update.
 * - POST /api/billing/portal       — open Stripe Billing Portal for self-service
 *   cancel / update card / view invoices.
 * - POST /api/billing/sync         — manual fallback if a webhook is delayed: the
 *   client calls this after returning from Checkout to flip the row to active
 *   without waiting for the webhook race.
 * - POST /api/billing/change-plan  — swap plan tier in place via
 *   stripe.subscriptions.update (pdv→bundle, chat→bundle, bundle→chat). Lets
 *   ZeloChat handle plan changes natively — no redirect to ZeloPDV.
 */
import type { Request, Response } from 'express';
import Stripe from 'stripe';
import { extractBearerToken, getServiceSupabase } from './supabase.js';
import { requireOwnerAccess } from './accessControl.js';
import { PRICING } from '../src/data/pricing.js';
import { redactEmail, redactCustomerId } from './redact.js';

const STRIPE_API_VERSION = '2024-06-20';

let stripeClient: Stripe | null = null;

function getStripe(): Stripe {
  if (stripeClient) return stripeClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_NOT_CONFIGURED');
  }
  stripeClient = new Stripe(key, { apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion });
  return stripeClient;
}

function stripeObjectId(value: string | { id?: string } | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return typeof value.id === 'string' ? value.id : null;
}

/**
 * Sets cancel_at_period_end on the user's Stripe subscription. Used by the account
 * deletion grace period: true when scheduling deletion (reversible), false when the
 * user reactivates. No-op for Pix-only customers / missing subscriptions.
 */
export async function setStripeCancelAtPeriodEnd(userId: string, cancel: boolean): Promise<void> {
  const { data, error } = await getServiceSupabase()
    .from('subscriptions')
    .select('provider_subscription_id, payment_provider, status')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Subscription lookup failed: ${error.message}`);
  const sub = data as { provider_subscription_id?: string; payment_provider?: string; status?: string } | null;
  if (!sub?.provider_subscription_id || sub.payment_provider !== 'stripe' || sub.status === 'canceled') return;
  try {
    await getStripe().subscriptions.update(sub.provider_subscription_id, { cancel_at_period_end: cancel });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (!/resource_missing|not.?found|no such/i.test(msg)) throw err;
  }
}

/**
 * Cancels the user's active Stripe subscription immediately. Used by account
 * deletion — billing must stop when the account is destroyed. Best-effort:
 * swallows "already gone" Stripe errors. No-op when there is no Stripe
 * subscription (e.g. Pix-only customers).
 */
export async function cancelStripeSubscriptionForUser(userId: string): Promise<void> {
  const { data, error } = await getServiceSupabase()
    .from('subscriptions')
    .select('provider_subscription_id, payment_provider')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Subscription lookup failed: ${error.message}`);
  const sub = data as { provider_subscription_id?: string; payment_provider?: string } | null;
  if (!sub?.provider_subscription_id || sub.payment_provider !== 'stripe') return;
  try {
    await getStripe().subscriptions.cancel(sub.provider_subscription_id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (!/resource_missing|not.?found|no such|already canceled/i.test(msg)) {
      throw err;
    }
  }
}

// P2.10 — Stripe price IDs must come from env. Previously these had hardcoded
// fallback values ('price_1TR0...'), meaning a dev environment without
// STRIPE_PRICE_CHAT / STRIPE_PRICE_BUNDLE set would silently use the production
// price IDs and potentially charge real customers. Keep validation at billing
// action time (not module load) so a missing Stripe price never takes down
// WhatsApp/AI or the platform's healthcheck.
//
// Local dev must set them in .env (use test-mode price IDs from Stripe dashboard).
function getRequiredStripePrice(name: 'STRIPE_PRICE_CHAT' | 'STRIPE_PRICE_BUNDLE'): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[billing] ${name} env var is required for billing actions`);
    throw new Error(`${name}_MISSING`);
  }
  return value;
}

interface PlanCatalogEntry {
  tier: 'chat' | 'bundle';
  priceId: string;
  label: string;
  priceBRL: number;
}

function getPlanCatalog(): Record<'chat' | 'bundle', PlanCatalogEntry> {
  return {
    chat: {
      tier: 'chat',
      priceId: getRequiredStripePrice('STRIPE_PRICE_CHAT'),
      label: 'ZeloChat Pro',
      priceBRL: PRICING.chat.priceBRL,
    },
    bundle: {
      tier: 'bundle',
      priceId: getRequiredStripePrice('STRIPE_PRICE_BUNDLE'),
      label: 'ZeloChat + ZeloPDV',
      priceBRL: PRICING.bundle.priceBRL,
    },
  };
}

function getReturnOrigin(req: Request): string {
  const explicit = process.env.PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin) return origin.replace(/\/$/, '');
  return 'https://zelochat.com.br';
}

interface AuthedUser {
  id: string;
  email: string | null;
}

async function authenticate(req: Request): Promise<AuthedUser> {
  const context = await requireOwnerAccess(req);
  const token = extractBearerToken(req);
  if (!token) throw new Error('UNAUTHORIZED');
  const supabase = getServiceSupabase();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Error('UNAUTHORIZED');
  return { id: context.ownerUserId, email: data.user.email ?? null };
}

function sendBillingError(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : 'Unknown error';
  if (message === 'UNAUTHORIZED') {
    res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
    return;
  }
  if (message === 'FORBIDDEN') {
    res.status(403).json({
      error: 'Apenas o responsável pela conta pode gerenciar a cobrança.',
      code: 'FORBIDDEN',
    });
    return;
  }
  if (message === 'STRIPE_NOT_CONFIGURED') {
    res.status(500).json({
      error: 'Stripe não configurado no servidor. Defina STRIPE_SECRET_KEY.',
      code: 'STRIPE_NOT_CONFIGURED',
    });
    return;
  }
  if (message === 'STRIPE_PRICE_CHAT_MISSING' || message === 'STRIPE_PRICE_BUNDLE_MISSING') {
    res.status(503).json({
      error: 'Planos de cobrança não configurados no servidor. Chame o suporte antes de tentar contratar ou trocar de plano.',
      code: 'STRIPE_PRICE_NOT_CONFIGURED',
    });
    return;
  }
  if (message === 'INVALID_PLAN') {
    res.status(400).json({ error: 'Plano inválido. Use "chat" ou "bundle".' });
    return;
  }
  if (message === 'ALREADY_ACTIVE') {
    res.status(409).json({
      error: 'Você já tem uma assinatura ativa do ZeloChat. Use o portal para gerenciar.',
      code: 'ALREADY_ACTIVE',
    });
    return;
  }
  // P1.28 — Trialing user attempted checkout; route them to the portal instead.
  if (message === 'TRIALING_USE_PORTAL') {
    res.status(409).json({
      error: 'Você já tem um período de avaliação ativo. Use o portal para ativar o plano pago.',
      code: 'TRIALING_USE_PORTAL',
    });
    return;
  }
  if (message === 'NO_CUSTOMER') {
    res.status(404).json({
      error: 'Nenhum cliente Stripe associado a esta conta. Faça uma assinatura primeiro.',
      code: 'NO_CUSTOMER',
    });
    return;
  }
  if (message === 'PDV_UPGRADE_AVAILABLE') {
    res.status(409).json({
      error: `Você já tem ZeloPDV. Use "Mudar de plano" para fazer upgrade pro Pacote Gestão + Atendimento (R$ ${PRICING.bundle.priceBRL}/mês — R$ 9 mais barato que Chat avulso).`,
      code: 'PDV_UPGRADE_AVAILABLE',
    });
    return;
  }
  if (message === 'NO_SUBSCRIPTION') {
    res.status(404).json({
      error: 'Nenhuma assinatura ativa encontrada. Comece pelo Checkout.',
      code: 'NO_SUBSCRIPTION',
    });
    return;
  }
  if (message === 'SAME_PLAN') {
    res.status(409).json({
      error: 'Você já está nesse plano.',
      code: 'SAME_PLAN',
    });
    return;
  }
  if (message === 'INVALID_TRANSITION') {
    res.status(409).json({
      error: 'Esta troca de plano não é suportada. Para cancelar ou mudar pro PDV, use o portal do Stripe.',
      code: 'INVALID_TRANSITION',
    });
    return;
  }
  if (message === 'SUBSCRIPTION_PAYMENT_ISSUE') {
    res.status(409).json({
      error: 'Sua assinatura tem um problema de pagamento. Regularize antes de mudar de plano.',
      code: 'SUBSCRIPTION_PAYMENT_ISSUE',
    });
    return;
  }
  if (message === 'PAYMENT_ACTION_REQUIRED') {
    res.status(409).json({
      error: 'O banco pediu uma confirmação do cartão antes de concluir a troca. Abra o portal de cobrança para confirmar o pagamento.',
      code: 'PAYMENT_ACTION_REQUIRED',
    });
    return;
  }
  // P1.29 — Paused is a voluntary pause, not a payment issue.
  if (message === 'SUBSCRIPTION_PAUSED') {
    res.status(409).json({
      error: 'Sua assinatura está pausada. Reative-a antes de trocar de plano.',
      code: 'SUBSCRIPTION_PAUSED',
    });
    return;
  }
  if (message === 'SUBSCRIPTION_NOT_RESUMABLE') {
    res.status(409).json({
      error: 'Sua assinatura foi encerrada. Faça uma nova assinatura pelo Checkout.',
      code: 'SUBSCRIPTION_NOT_RESUMABLE',
    });
    return;
  }
  if (message === 'SUBSCRIPTION_INCOMPLETE') {
    res.status(409).json({
      error: 'Sua assinatura ainda está sendo finalizada. Tente novamente em alguns segundos.',
      code: 'SUBSCRIPTION_INCOMPLETE',
    });
    return;
  }
  if (message === 'CUSTOMER_MISMATCH' || message === 'NO_MATCHING_ITEM') {
    // Redact PII: log only the error code, not the full Stripe object (may contain email/customer_id)
    console.error('[billing] data integrity error:', message);
    res.status(500).json({
      error: 'Inconsistência detectada na assinatura. Entre em contato com o suporte.',
      code: message,
    });
    return;
  }
  if (message === 'STRIPE_ERROR') {
    res.status(502).json({
      error: 'Erro ao processar pagamento. Tente novamente em instantes.',
      code: 'STRIPE_ERROR',
    });
    return;
  }
  // Redact PII: avoid logging the full error object which may contain email/customer_id from Stripe
  console.error('[billing] error:', message);
  res.status(500).json({ error: message });
}

function isPaymentActionRequired(err: unknown): boolean {
  const e = err as {
    code?: string;
    decline_code?: string;
    message?: string;
    raw?: { code?: string; decline_code?: string; message?: string };
    payment_intent?: { status?: string };
  };
  const code = e.code ?? e.raw?.code ?? '';
  const declineCode = e.decline_code ?? e.raw?.decline_code ?? '';
  const message = `${e.message ?? ''} ${e.raw?.message ?? ''}`.toLowerCase();
  return (
    code === 'payment_intent_authentication_failure' ||
    code === 'invoice_payment_intent_requires_action' ||
    code === 'payment_intent_requires_action' ||
    declineCode === 'authentication_required' ||
    e.payment_intent?.status === 'requires_action' ||
    message.includes('requires_action') ||
    message.includes('authentication_required')
  );
}

/**
 * POST /api/billing/checkout
 *
 * Body: { planTier?: 'chat' | 'bundle' } (default 'chat')
 * Returns: { url: string }  — Stripe Checkout URL to redirect the browser to.
 */
export async function createCheckoutSession(req: Request, res: Response): Promise<void> {
  try {
    const user = await authenticate(req);
    const stripe = getStripe();
    const catalog = getPlanCatalog();

    const requestedTier = (req.body?.planTier ?? 'chat') as string;
    if (requestedTier !== 'chat' && requestedTier !== 'bundle') {
      throw new Error('INVALID_PLAN');
    }
    const plan = catalog[requestedTier];

    const supabase = getServiceSupabase();

    // Look at any existing subscription row for this user. We reuse the Stripe
    // customer if we already have one, and short-circuit if a chat/bundle is
    // already active so the user can't double-subscribe.
    const { data: existingRows } = await supabase
      .from('subscriptions')
      .select('id, status, plan_tier, provider_customer_id, payment_provider, current_period_end')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });

    const existing = existingRows ?? [];
    // P1.28 — Block checkout for both active AND trialing subscriptions.
    // Previously only 'active' was checked, so a trialing user who clicked
    // "Ativar" would silently create a second Stripe subscription.
    const activeOrTrialing = existing.find((row) =>
      ['chat', 'bundle'].includes(row.plan_tier) &&
      ['active', 'trialing'].includes(row.status) &&
      row.current_period_end &&
      new Date(row.current_period_end).getTime() > Date.now(),
    );
    if (activeOrTrialing) {
      if (activeOrTrialing.status === 'trialing') throw new Error('TRIALING_USE_PORTAL');
      throw new Error('ALREADY_ACTIVE');
    }

    // Safety net: usuário com plano PDV ativo NÃO deve criar nova subscription Chat
    // (resultaria em 2 subscriptions Stripe pro mesmo user, vs bundle price único).
    // Bloqueia aqui mesmo se chamarem direto a API; o frontend já redireciona via UX.
    // Plan tier swap pdv→bundle vai pelo endpoint /api/billing/change-plan no zeloPDV-Prod.
    const activePdv = existing.find((row) =>
      row.plan_tier === 'pdv' &&
      row.status === 'active' &&
      row.current_period_end &&
      new Date(row.current_period_end).getTime() > Date.now(),
    );
    if (activePdv) throw new Error('PDV_UPGRADE_AVAILABLE');

    // Reuse a Stripe customer if any prior row has one (prevents orphan
    // customers). The lookup is by user_id which is JWT-validated, so a PDV
    // row's provider_customer_id is a SAFE reuse — same user, shared Stripe
    // account by design (see CLAUDE.md §"Billing").
    //
    // P0.19 — we used to fall back to `stripe.customers.list({ email })` if
    // the DB had no row. That's gone now. Email-based match is unreliable
    // (case sensitivity, plus-addressing, deduplication quirks) and could
    // adopt a customer record from another product or organization that
    // happened to share an email. A user with no DB row gets a fresh
    // customer tagged with their user_id — the canonical state.
    let stripeCustomerId: string | null = null;
    for (const row of existing) {
      if (row.payment_provider === 'stripe' && row.provider_customer_id) {
        stripeCustomerId = row.provider_customer_id;
        break;
      }
    }
    if (!stripeCustomerId) {
      const created = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { user_id: user.id },
      });
      stripeCustomerId = created.id;
      // Redact PII in log: email and customer_id are LGPD-sensitive
      console.log('[billing] created new Stripe customer:', redactCustomerId(stripeCustomerId), 'for email:', redactEmail(user.email));
    }

    const origin = getReturnOrigin(req);
    // P0.18 — idempotencyKey buckets at 5-minute intervals so a double-click
    // (or a network retry of the same submit) returns the SAME Checkout
    // session URL instead of creating two parallel sessions that could both
    // be paid. The bucket gives genuine retries (e.g. user came back 30 min
    // later after card decline) a fresh session because the bucket has rolled.
    const idempotencyBucket = Math.floor(Date.now() / (5 * 60 * 1000));
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      line_items: [{ price: plan.priceId, quantity: 1 }],
      payment_method_types: ['card'],
      payment_method_collection: 'always',
      allow_promotion_codes: true,
      subscription_data: {
        // ZeloChat does NOT offer a free trial — the user explicitly disabled
        // 'trialing' in requireActiveZelochatSubscription.
        metadata: {
          user_id: user.id,
          plan_tier: plan.tier,
          source: 'zelochat',
        },
      },
      metadata: {
        user_id: user.id,
        plan_tier: plan.tier,
        source: 'zelochat',
      },
      success_url: `${origin}/?billing=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?billing=canceled`,
    }, {
      idempotencyKey: `checkout-${user.id}-${plan.tier}-${idempotencyBucket}`,
    });

    // Pre-record an incomplete row so the webhook has something to find when
    // checkout.session.completed fires. Only insert if the user has no row at
    // all, or update the latest row if it's not already active for chat/bundle.
    const nowIso = new Date().toISOString();
    if (existing.length === 0) {
      await supabase.from('subscriptions').insert({
        user_id: user.id,
        provider_customer_id: stripeCustomerId,
        payment_provider: 'stripe',
        plan_tier: plan.tier,
        status: 'incomplete',
        created_at: nowIso,
        updated_at: nowIso,
      });
    } else {
      const latest = existing[0];
      if (!(latest.status === 'active' && ['chat', 'bundle'].includes(latest.plan_tier))) {
        await supabase
          .from('subscriptions')
          .update({
            provider_customer_id: stripeCustomerId,
            payment_provider: 'stripe',
            plan_tier: plan.tier,
            status: 'incomplete',
            updated_at: nowIso,
          })
          .eq('id', latest.id);
      }
    }

    if (!session.url) {
      throw new Error('Stripe não retornou URL de checkout.');
    }
    res.json({ url: session.url });
  } catch (err) {
    sendBillingError(res, err);
  }
}

/**
 * POST /api/billing/portal
 *
 * Returns: { url } — Stripe Billing Portal URL for the authed user.
 */
export async function createPortalSession(req: Request, res: Response): Promise<void> {
  try {
    const user = await authenticate(req);
    const stripe = getStripe();
    const supabase = getServiceSupabase();

    const { data: row } = await supabase
      .from('subscriptions')
      .select('provider_customer_id, payment_provider')
      .eq('user_id', user.id)
      .eq('payment_provider', 'stripe')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // P0.19 — drop email lookup. If we have no DB row tying THIS user to a
    // Stripe customer, opening the Customer Portal would let them manage a
    // billing record they may not own (cross-product PDV subscription, an
    // unrelated account that happens to share email). Force the user through
    // Checkout first; the portal only opens once we have provenance.
    const customerId = row?.provider_customer_id ?? null;
    if (!customerId) throw new Error('NO_CUSTOMER');

    const origin = getReturnOrigin(req);
    const portalConfig = process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID;

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/?billing=portal-return`,
      ...(portalConfig ? { configuration: portalConfig } : {}),
    });

    res.json({ url: session.url });
  } catch (err) {
    sendBillingError(res, err);
  }
}

/**
 * POST /api/billing/sync
 *
 * Optional fallback called by the frontend after Checkout returns. Forces a
 * read from Stripe for the most recent subscription on the user's customer
 * and writes the canonical state into the DB — useful if the webhook hasn't
 * landed yet (Stripe can take up to ~30s).
 *
 * The webhook is the source of truth in steady state; this endpoint just
 * shrinks the "I paid but the app still says I'm not active" window.
 */
export async function syncFromStripe(req: Request, res: Response): Promise<void> {
  try {
    const user = await authenticate(req);
    const stripe = getStripe();
    const supabase = getServiceSupabase();

    const { data: existingRows } = await supabase
      .from('subscriptions')
      .select('id, provider_customer_id, payment_provider, status')
      .eq('user_id', user.id)
      .eq('payment_provider', 'stripe')
      .order('updated_at', { ascending: false });

    const candidate = existingRows?.[0];
    // P0.19 — drop email-based lookup. Same rationale as createPortalSession.
    // Without a DB-rooted customer_id, we have nothing to sync; report and bail.
    const customerId = candidate?.provider_customer_id ?? null;
    if (!customerId) {
      res.json({ synced: false, reason: 'no_stripe_customer' });
      return;
    }

    const catalog = getPlanCatalog();
    const priceToTier: Record<string, 'chat' | 'bundle'> = {
      [catalog.chat.priceId]: 'chat',
      [catalog.bundle.priceId]: 'bundle',
    };

    let chosen: Stripe.Subscription | null = null;
    let chosenTier: 'chat' | 'bundle' | null = null;

    const checkoutSessionId = typeof req.body?.sessionId === 'string'
      ? req.body.sessionId.trim()
      : '';

    if (checkoutSessionId) {
      // P2.13 — Checkout return sync must prove the session belongs to the
      // authenticated user's Stripe customer before we mirror anything into
      // Supabase. Portal returns still use the legacy "latest subscription"
      // sync below because Stripe Billing Portal does not return a checkout id.
      const checkout = await stripe.checkout.sessions.retrieve(checkoutSessionId, {
        expand: ['subscription', 'subscription.items.data.price'],
      });
      if (stripeObjectId(checkout.customer) !== customerId) {
        res.status(403).json({ synced: false, reason: 'checkout_customer_mismatch' });
        return;
      }
      if (!checkout.subscription) {
        res.json({ synced: false, reason: 'checkout_without_subscription' });
        return;
      }

      chosen = typeof checkout.subscription === 'string'
        ? await stripe.subscriptions.retrieve(checkout.subscription, { expand: ['items.data.price'] })
        : checkout.subscription;

      for (const item of chosen.items.data) {
        const priceId = typeof item.price === 'string' ? item.price : item.price?.id;
        const tier = priceId ? priceToTier[priceId] : undefined;
        if (tier) {
          chosenTier = tier;
          break;
        }
      }
    } else {
      const subs = await stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 5,
        expand: ['data.items.data.price'],
      });

      // Pick the most recent chat/bundle subscription.
      for (const sub of subs.data) {
        for (const item of sub.items.data) {
          const priceId = typeof item.price === 'string' ? item.price : item.price?.id;
          const tier = priceId ? priceToTier[priceId] : undefined;
          if (tier) {
            if (!chosen || sub.created > chosen.created) {
              chosen = sub;
              chosenTier = tier;
            }
          }
        }
      }
    }

    if (!chosen || !chosenTier) {
      res.json({ synced: false, reason: 'no_chat_subscription' });
      return;
    }

    const statusMap: Record<string, string> = {
      active: 'active',
      trialing: 'trialing',
      past_due: 'past_due',
      canceled: 'canceled',
      unpaid: 'past_due',
      incomplete: 'incomplete',
      incomplete_expired: 'canceled',
      paused: 'paused',
    };

    const payload = {
      provider_subscription_id: chosen.id,
      provider_customer_id: customerId,
      payment_provider: 'stripe' as const,
      plan_tier: chosenTier,
      status: statusMap[chosen.status] ?? chosen.status,
      current_period_end: chosen.current_period_end
        ? new Date(chosen.current_period_end * 1000).toISOString()
        : null,
      cancel_at_period_end: !!chosen.cancel_at_period_end,
      billing_type: 'CREDIT_CARD',
      updated_at: new Date().toISOString(),
    };

    if (candidate) {
      await supabase.from('subscriptions').update(payload).eq('id', candidate.id);
    } else {
      await supabase.from('subscriptions').insert({
        ...payload,
        user_id: user.id,
        created_at: new Date().toISOString(),
      });
    }

    res.json({ synced: true, planTier: chosenTier, status: payload.status });
  } catch (err) {
    sendBillingError(res, err);
  }
}

/**
 * POST /api/billing/change-plan
 *
 * Body: { targetPlan: 'chat' | 'bundle' }
 * Returns: { ok: true, planTier, status, currentPeriodEnd, prorationBRL? }
 *
 * Swaps the user's existing Stripe subscription to the requested plan tier
 * via stripe.subscriptions.update — no Checkout, no Portal redirect, no
 * trip to ZeloPDV's site. Allowed transitions: pdv→bundle, chat→bundle,
 * bundle→chat. Cancel-at-period-end is cleared as part of the swap.
 *
 * Proration goes to the next invoice (no immediate charge), so a declined
 * card here doesn't surface — the next invoice attempt will. We mirror the
 * canonical state into Supabase right after Stripe confirms; the ZeloPDV
 * webhook lands within ~30s with the same payload (idempotent merge).
 */
export async function changePlan(req: Request, res: Response): Promise<void> {
  try {
    const user = await authenticate(req);
    const stripe = getStripe();
    const catalog = getPlanCatalog();

    const targetPlan = req.body?.targetPlan as string | undefined;
    if (targetPlan !== 'chat' && targetPlan !== 'bundle') {
      throw new Error('INVALID_PLAN');
    }

    const supabase = getServiceSupabase();
    const { data: row } = await supabase
      .from('subscriptions')
      .select('id, status, plan_tier, provider_subscription_id, provider_customer_id, current_period_end, cancel_at_period_end')
      .eq('user_id', user.id)
      .eq('payment_provider', 'stripe')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!row || !row.provider_subscription_id) {
      throw new Error('NO_SUBSCRIPTION');
    }

    // Status guardrails — fail fast on irreversible / mid-flight states.
    switch (row.status) {
      case 'canceled':
      case 'incomplete_expired':
        throw new Error('SUBSCRIPTION_NOT_RESUMABLE');
      case 'past_due':
      case 'unpaid':
        throw new Error('SUBSCRIPTION_PAYMENT_ISSUE');
      case 'paused':
        // P1.29 — 'paused' is a voluntary pause, not a payment issue. Give a
        // distinct error so the frontend can show the correct message.
        throw new Error('SUBSCRIPTION_PAUSED');
      case 'incomplete':
        throw new Error('SUBSCRIPTION_INCOMPLETE');
    }

    const currentPlan = row.plan_tier as 'pdv' | 'chat' | 'bundle';
    if (currentPlan === targetPlan) {
      throw new Error('SAME_PLAN');
    }
    // Allowed: pdv→bundle, chat→bundle, bundle→chat. Block *→pdv and pdv→chat.
    const allowed =
      (currentPlan === 'pdv' && targetPlan === 'bundle') ||
      (currentPlan === 'chat' && targetPlan === 'bundle') ||
      (currentPlan === 'bundle' && targetPlan === 'chat');
    if (!allowed) {
      throw new Error('INVALID_TRANSITION');
    }

    // Fetch the live Stripe subscription to get the item id for the in-place swap.
    let sub: Stripe.Subscription;
    try {
      sub = await stripe.subscriptions.retrieve(row.provider_subscription_id, {
        expand: ['items.data.price'],
      });
    } catch (err) {
      // Redact PII: log customer reference via helper, not the raw Stripe error object
      const stripeMsg = err instanceof Error ? err.message : String(err);
      console.error('[billing] change-plan: stripe.retrieve failed — customer:', redactCustomerId(row.provider_customer_id), '— stripe:', stripeMsg);
      throw new Error('STRIPE_ERROR');
    }

    if (row.provider_customer_id && sub.customer !== row.provider_customer_id) {
      throw new Error('CUSTOMER_MISMATCH');
    }
    if (sub.status === 'canceled') {
      throw new Error('SUBSCRIPTION_NOT_RESUMABLE');
    }

    // Identify which subscription_item carries the plan price. If the sub has a
    // single recurring item, use it. Otherwise match against known price IDs.
    const knownPriceIds = new Set<string>([catalog.chat.priceId, catalog.bundle.priceId]);
    const pdvPriceId = process.env.STRIPE_PRICE_PDV;
    if (pdvPriceId) knownPriceIds.add(pdvPriceId);

    const item = sub.items.data.length === 1
      ? sub.items.data[0]
      : sub.items.data.find((i) => {
          const priceId = typeof i.price === 'string' ? i.price : i.price?.id;
          return priceId ? knownPriceIds.has(priceId) : false;
        });
    if (!item) {
      throw new Error('NO_MATCHING_ITEM');
    }

    const targetPriceId = catalog[targetPlan].priceId;

    // Idempotency: 1-minute bucket per user/target so an accidental retry
    // within the same minute hits the same Stripe response without double-billing.
    const minuteBucket = Math.floor(Date.now() / 60000);
    const idempotencyKey = `change-plan-${user.id}-${targetPlan}-${minuteBucket}`;

    let updated: Stripe.Subscription;
    try {
      updated = await stripe.subscriptions.update(
        row.provider_subscription_id,
        {
          items: [{ id: item.id, price: targetPriceId }],
          proration_behavior: 'create_prorations',
          payment_behavior: 'error_if_incomplete',
          cancel_at_period_end: false,
          metadata: {
            ...(sub.metadata ?? {}),
            plan_tier: targetPlan,
            last_change_source: 'zelochat',
            last_change_at: new Date().toISOString(),
          },
        },
        { idempotencyKey },
      );
    } catch (err) {
      // Redact PII: log customer reference via helper, not the raw Stripe error object
      const stripeMsg = err instanceof Error ? err.message : String(err);
      console.error('[billing] change-plan: stripe.update failed — customer:', redactCustomerId(row.provider_customer_id), '— stripe:', stripeMsg);
      if (isPaymentActionRequired(err)) {
        throw new Error('PAYMENT_ACTION_REQUIRED');
      }
      throw new Error('STRIPE_ERROR');
    }

    const statusMap: Record<string, string> = {
      active: 'active',
      trialing: 'trialing',
      past_due: 'past_due',
      canceled: 'canceled',
      unpaid: 'past_due',
      incomplete: 'incomplete',
      incomplete_expired: 'canceled',
      paused: 'paused',
    };

    const mappedStatus = statusMap[updated.status] ?? updated.status;
    const periodEndIso = updated.current_period_end
      ? new Date(updated.current_period_end * 1000).toISOString()
      : null;

    // Mirror canonical state into Supabase so the UI reflects the new plan
    // immediately (don't wait for the ZeloPDV webhook). If this write fails
    // we don't roll Stripe back — the webhook will reconcile within ~30s.
    const { error: dbErr } = await supabase
      .from('subscriptions')
      .update({
        plan_tier: targetPlan,
        status: mappedStatus,
        current_period_end: periodEndIso,
        cancel_at_period_end: !!updated.cancel_at_period_end,
        provider_subscription_id: updated.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    if (dbErr) {
      console.error('[billing] change-plan: stripe ok, db update failed, webhook will reconcile', dbErr);
    }

    res.json({
      ok: true,
      planTier: targetPlan,
      status: mappedStatus,
      currentPeriodEnd: periodEndIso,
    });
  } catch (err) {
    sendBillingError(res, err);
  }
}
