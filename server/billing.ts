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
 * - POST /api/billing/checkout — start a Stripe Checkout session for the
 *   chat or bundle plan. NO TRIAL — the chat plan charges immediately.
 *   Pre-records an 'incomplete' row so the webhook has something to update.
 * - POST /api/billing/portal   — open Stripe Billing Portal for self-service
 *   cancel / update card / view invoices.
 * - POST /api/billing/sync     — manual fallback if a webhook is delayed: the
 *   client calls this after returning from Checkout to flip the row to active
 *   without waiting for the webhook race.
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
    const zelopdvUrl = process.env.ZELOPDV_URL || 'https://www.zelopdv.com.br';
    res.status(409).json({
      error: 'Você já tem ZeloPDV. Faça upgrade pro Pacote Gestão + Atendimento por R$ 147/mês (economiza R$ 9 vs Chat avulso).',
      code: 'PDV_UPGRADE_AVAILABLE',
      upgradeUrl: `${zelopdvUrl}/assinatura?upgrade=bundle`,
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
