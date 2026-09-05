import { isShuttingDown } from './runtime/backgroundWork.js';
import { startPeriodicTask } from './runtime/periodicTask.js';
import { getServiceSupabase } from './supabase.js';
import { deleteInstance } from './instanceManager.js';
import { redactInstance } from './redact.js';
import { getEffectiveSubscriptionExpiryMs } from '../src/domain/subscription.js';

/**
 * Subscription sweeper — closes P1.13.
 *
 * When a customer churns — Stripe webhook (in ZeloPDV repo) flips status off
 * 'active', OR an AbacatePay/Pix charge's current_period_end elapses without
 * a new payment — the customer's Whatsmiau instance keeps running on our bill
 * until reaped. This sweeper finds those orphans and calls `deleteInstance()`
 * (which also clears `empresa_perfil.whatsmiau_instance`).
 *
 * Provider note: both Stripe and AbacatePay write to the same `subscriptions`
 * table. Stripe sets status='canceled'/'inactive' explicitly; AbacatePay
 * subscriptions expire naturally (status stays 'active' but current_period_end
 * passes). The `isActive` check below handles both: it requires status='active'
 * AND expiry > now, so an expired Pix subscription is caught correctly.
 *
 * Grace period (default 7 days) gives customers a window to fix billing issues
 * or pay a new Pix before the instance is reaped. Customer data (messages,
 * sessions, orders) is NOT touched — only the Whatsmiau instance is deleted.
 * If they renew after grace, they re-scan QR and /api/qr auto-provisions a
 * new instance.
 *
 * Schedule: kicked off from server/index.ts on startup (after 5min) + every 6h.
 * Idempotent: re-running after a successful sweep is a no-op.
 *
 * Manual run / dry-run: `npx tsx scripts/sweep-canceled-subscriptions.ts [--dry-run]`
 */

const DEFAULT_GRACE_DAYS = 7;

export interface SweepCandidate {
  empresaId: string;
  userId: string;
  instance: string;
  status: string | null;
  effectiveExpiry: string | null;
  daysSinceExpiry: number | null;
}

export interface SweepResult {
  scanned: number;
  candidates: SweepCandidate[];
  deleted: number;
  errors: Array<{ empresaId: string; instance: string; error: string }>;
  dryRun: boolean;
}

/**
 * Returns empresas whose latest 'chat'/'bundle' subscription is inactive AND
 * whose effective expiry is more than `graceDays` ago. Empresas with no
 * subscription row at all are skipped (could be fresh signup pre-paywall
 * warmup or manually-provisioned test). Empresas without a
 * `whatsmiau_instance` are not candidates (nothing to delete upstream).
 *
 * Two-query JS-side filter rather than a CTE — supabase-js doesn't expose
 * raw SQL and we'd rather avoid an RPC just for this.
 */
export async function findSweepCandidates(
  graceDays = DEFAULT_GRACE_DAYS,
): Promise<SweepCandidate[]> {
  const supabase = getServiceSupabase();

  const { data: empresas, error: epError } = await supabase
    .from('empresa_perfil')
    .select('id, user_id, whatsmiau_instance')
    .not('whatsmiau_instance', 'is', null);

  if (epError) {
    console.error('[sweeper] empresa_perfil read failed:', epError.message);
    return [];
  }
  if (!empresas || empresas.length === 0) return [];

  const userIds = Array.from(
    new Set((empresas as Array<{ user_id: string }>).map((e) => e.user_id)),
  );

  const { data: subs, error: subError } = await supabase
    .from('subscriptions')
    .select('user_id, status, plan_tier, current_period_end, manually_extended_until')
    .in('user_id', userIds)
    .in('plan_tier', ['chat', 'bundle']);

  if (subError) {
    console.error('[sweeper] subscriptions read failed:', subError.message);
    return [];
  }

  const latestByUser = new Map<string, {
    status: string | null;
    expiry: number | null;
  }>();

  for (const row of (subs ?? []) as Array<{
    user_id: string;
    status: string | null;
    current_period_end: string | null;
    manually_extended_until: string | null;
  }>) {
    const expiryMs = getEffectiveSubscriptionExpiryMs(row);
    const prev = latestByUser.get(row.user_id);
    if (!prev || (expiryMs != null && (prev.expiry == null || expiryMs > prev.expiry))) {
      latestByUser.set(row.user_id, { status: row.status, expiry: expiryMs });
    }
  }

  const now = Date.now();
  const graceMs = graceDays * 24 * 60 * 60 * 1000;
  const candidates: SweepCandidate[] = [];

  for (const e of empresas as Array<{ id: string; user_id: string; whatsmiau_instance: string }>) {
    const latest = latestByUser.get(e.user_id);
    let isCandidate = false;
    let effectiveExpiry: string | null = null;
    let daysSinceExpiry: number | null = null;

    if (!latest) {
      // No subscription history. We don't sweep — could be a fresh signup
      // pre-paywall warmup OR a manually-provisioned test account. Logging
      // candidate would be misleading. Skip silently.
      continue;
    }

    const isActive = latest.status === 'active' && latest.expiry != null && latest.expiry > now;
    if (!isActive) {
      const expiredAt = latest.expiry ?? 0;
      effectiveExpiry = expiredAt > 0 ? new Date(expiredAt).toISOString() : null;
      daysSinceExpiry = expiredAt > 0 ? (now - expiredAt) / (24 * 60 * 60 * 1000) : null;
      if (expiredAt > 0 && now - expiredAt > graceMs) {
        isCandidate = true;
      }
    }

    if (isCandidate) {
      candidates.push({
        empresaId: e.id,
        userId: e.user_id,
        instance: e.whatsmiau_instance,
        status: latest.status,
        effectiveExpiry,
        daysSinceExpiry,
      });
    }
  }

  return candidates;
}

/**
 * Sweep canceled/expired subscriptions. Calls deleteInstance(empresaId) for
 * each candidate, which deletes the Whatsmiau instance upstream AND clears
 * `empresa_perfil.whatsmiau_instance`. Customer chat history is preserved.
 *
 * Failures on individual candidates are logged and counted but never thrown —
 * one bad row should not stop the rest of the sweep.
 */
export async function sweepCanceledSubscriptions(
  opts: { dryRun?: boolean; graceDays?: number } = {},
): Promise<SweepResult> {
  const dryRun = opts.dryRun ?? false;
  const graceDays = opts.graceDays ?? DEFAULT_GRACE_DAYS;
  const candidates = await findSweepCandidates(graceDays);

  const result: SweepResult = {
    scanned: candidates.length,
    candidates,
    deleted: 0,
    errors: [],
    dryRun,
  };

  if (candidates.length === 0) {
    console.log(`[sweeper] no candidates (graceDays=${graceDays}). All instances paid for.`);
    return result;
  }

  console.warn(
    `[sweeper] ${dryRun ? 'DRY-RUN — ' : ''}${candidates.length} candidate(s) (graceDays=${graceDays}):`,
  );
  for (const c of candidates) {
    if (isShuttingDown()) break;
    console.warn(
      `  - empresa=${c.empresaId} instance=${redactInstance(c.instance)} status=${c.status ?? 'null'} expired=${c.effectiveExpiry ?? 'null'} (${c.daysSinceExpiry?.toFixed(1) ?? '?'} days ago)`,
    );
  }

  if (dryRun) return result;

  for (const c of candidates) {
    if (isShuttingDown()) break;
    try {
      await deleteInstance(c.empresaId);
      console.log(`[sweeper] deleted instance ${redactInstance(c.instance)} for empresa ${c.empresaId}`);
      result.deleted += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[sweeper] failed to delete instance ${redactInstance(c.instance)} for empresa ${c.empresaId}:`, message);
      result.errors.push({ empresaId: c.empresaId, instance: c.instance, error: message });
    }
  }

  console.log(
    `[sweeper] done — scanned=${result.scanned} deleted=${result.deleted} errors=${result.errors.length}`,
  );
  return result;
}

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const SWEEP_STARTUP_DELAY_MS = 5 * 60 * 1000; // 5min


/**
 * Start the periodic sweep loop. Idempotent — calling twice does not stack.
 * Runs once after a 5-min startup delay (lets paywall cache warm), then every
 * 6 hours. Each tick is independent — one failure does not stop the loop.
 */
export function startSubscriptionSweepLoop(): void {
  startPeriodicTask('subscriptionSweeper', sweepCanceledSubscriptions, SWEEP_STARTUP_DELAY_MS, SWEEP_INTERVAL_MS);
}
