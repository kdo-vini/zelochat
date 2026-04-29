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

interface PlanCatalogEntry {
  tier: 'chat' | 'bundle';
  priceId: string;
  label: string;
  priceBRL: number;
}

function getPlanCatalog(): Record<'chat' | 'bundle', PlanCatalogEntry> {
  // Defaults match the live Stripe price IDs in zeloPDV's pricing.js.
  // Override per env for staging / future price changes.
  return {
    chat: {
      tier: 'chat',
      priceId: process.env.STRIPE_PRICE_CHAT || 'price_1TR0xGLUJWyE4PkYcBy0cOoD',
      label: 'ZeloChat Pro',
      priceBRL: 97,
    },
    bundle: {
      tier: 'bundle',
      priceId: process.env.STRIPE_PRICE_BUNDLE || 'price_1TR0xGLUJWyE4PkYY0DMOWLI',
      label: 'ZeloChat + ZeloPDV',
      priceBRL: 147,
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
  const token = extractBearerToken(req);
  if (!token) throw new Error('UNAUTHORIZED');
  const supabase = getServiceSupabase();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Error('UNAUTHORIZED');
  return { id: data.user.id, email: data.user.email ?? null };
}

function sendBillingError(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : 'Unknown error';
  if (message === 'UNAUTHORIZED') {
    res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
    return;
  }
  if (message === 'STRIPE_NOT_CONFIGURED') {
    res.status(500).json({
      error: 'Stripe não configurado no servidor. Defina STRIPE_SECRET_KEY.',
      code: 'STRIPE_NOT_CONFIGURED',
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
  if (message === 'NO_CUSTOMER') {
    res.status(404).json({
      error: 'Nenhum cliente Stripe associado a esta conta. Faça uma assinatura primeiro.',
      code: 'NO_CUSTOMER',
    });
    return;
  }
  if (message === 'PDV_UPGRADE_AVAILABLE') {
    res.status(409).json({
      error: 'Você já tem ZeloPDV. Use "Mudar de plano" para fazer upgrade pro Pacote Gestão + Atendimento (R$ 147/mês — R$ 9 mais barato que Chat avulso).',
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
    console.error('[billing] data integrity error:', message, err);
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
  console.error('[billing] error:', err);
  res.status(500).json({ error: message });
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
    const activeChat = existing.find((row) =>
      ['chat', 'bundle'].includes(row.plan_tier) &&
      row.status === 'active' &&
      row.current_period_end &&
      new Date(row.current_period_end).getTime() > Date.now(),
    );
    if (activeChat) throw new Error('ALREADY_ACTIVE');

    // Safety net: usuário com plano PDV ativo NÃO deve criar nova subscription Chat
    // (resultaria em 2 subscriptions Stripe pro mesmo user, R$ 156 vs R$ 147 do bundle).
    // Bloqueia aqui mesmo se chamarem direto a API; o frontend já redireciona via UX.
    // Plan tier swap pdv→bundle vai pelo endpoint /api/billing/change-plan no zeloPDV-Prod.
    const activePdv = existing.find((row) =>
      row.plan_tier === 'pdv' &&
      row.status === 'active' &&
      row.current_period_end &&
      new Date(row.current_period_end).getTime() > Date.now(),
    );
    if (activePdv) throw new Error('PDV_UPGRADE_AVAILABLE');

    // Reuse a Stripe customer if any prior row has one (prevents orphan customers).
    let stripeCustomerId: string | null = null;
    for (const row of existing) {
      if (row.payment_provider === 'stripe' && row.provider_customer_id) {
        stripeCustomerId = row.provider_customer_id;
        break;
      }
    }
    if (!stripeCustomerId && user.email) {
      const list = await stripe.customers.list({ email: user.email, limit: 1 });
      stripeCustomerId = list.data[0]?.id ?? null;
    }
    if (!stripeCustomerId) {
      const created = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { user_id: user.id },
      });
      stripeCustomerId = created.id;
    }

    const origin = getReturnOrigin(req);
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

    let customerId = row?.provider_customer_id ?? null;
    if (!customerId && user.email) {
      const list = await stripe.customers.list({ email: user.email, limit: 1 });
      customerId = list.data[0]?.id ?? null;
    }
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
    let customerId = candidate?.provider_customer_id ?? null;
    if (!customerId && user.email) {
      const list = await stripe.customers.list({ email: user.email, limit: 1 });
      customerId = list.data[0]?.id ?? null;
    }
    if (!customerId) {
      res.json({ synced: false, reason: 'no_stripe_customer' });
      return;
    }

    const subs = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 5,
      expand: ['data.items.data.price'],
    });

    // Pick the most recent chat/bundle subscription.
    const catalog = getPlanCatalog();
    const priceToTier: Record<string, 'chat' | 'bundle'> = {
      [catalog.chat.priceId]: 'chat',
      [catalog.bundle.priceId]: 'bundle',
    };

    let chosen: Stripe.Subscription | null = null;
    let chosenTier: 'chat' | 'bundle' | null = null;
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
      case 'paused':
        throw new Error('SUBSCRIPTION_PAYMENT_ISSUE');
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
      console.error('[billing] change-plan: stripe.retrieve failed', err);
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
      console.error('[billing] change-plan: stripe.update failed', err);
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
