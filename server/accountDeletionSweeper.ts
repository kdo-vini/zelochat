import { getServiceSupabase } from './supabase.js';
import { deleteInstance } from './instanceManager.js';
import { cancelStripeSubscriptionForUser } from './billing.js';

/**
 * Account-deletion sweeper — runs the irreversible purge for accounts whose
 * 14-day grace period has elapsed.
 *
 * Self-service deletion (PDV /api/account/delete and ZeloChat DELETE /api/account)
 * does NOT purge immediately — it stamps `empresa_perfil.deletion_scheduled_at =
 * now() + 14d` and cancels billing at period end. The user can reactivate any time
 * before then. This sweeper finds rows whose schedule is due and, for each:
 *   1. cancels the Stripe subscription immediately
 *   2. deletes the Whatsmiau WhatsApp instance
 *   3. removes the account's storage objects (all buckets)
 *   4. calls the service_role `delete_account` RPC (purges PDV + ZeloChat data and
 *      the auth identity in one transaction — which also removes the empresa_perfil
 *      row, so the work is naturally idempotent).
 *
 * Lives in the ZeloChat backend because it already has the service role, Stripe,
 * Whatsmiau and storage access; it purges PDV-only accounts too (deleteInstance is
 * a no-op when there's no instance).
 *
 * Schedule: 3 min after startup, then hourly. Idempotent.
 */

const STARTUP_DELAY_MS = 3 * 60 * 1000;
const INTERVAL_MS = 60 * 60 * 1000;
const BATCH = 50;

interface DueAccount {
  empresaId: string;
  userId: string;
}

export interface DeletionSweepResult {
  due: number;
  purged: number;
  errors: Array<{ empresaId: string; error: string }>;
}

async function removePrefix(bucket: string, prefix: string): Promise<void> {
  try {
    const supabase = getServiceSupabase();
    const { data } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 });
    const paths = (data ?? []).filter((o) => o.id).map((o) => `${prefix}/${o.name}`);
    if (paths.length) await supabase.storage.from(bucket).remove(paths);
  } catch (err) {
    console.warn(`[account-deletion-sweeper] storage cleanup ${bucket}/${prefix} failed:`, err);
  }
}

async function purgeAccount(acc: DueAccount): Promise<void> {
  // 1) Stop billing.
  await cancelStripeSubscriptionForUser(acc.userId);
  // 2) Revoke WhatsApp (no-op if no instance).
  try {
    await deleteInstance(acc.empresaId);
  } catch (err) {
    console.warn('[account-deletion-sweeper] deleteInstance failed (continuing):', err);
  }
  // 3) Storage cleanup (best-effort).
  await Promise.allSettled([
    removePrefix('zelochat-media', `send/${acc.empresaId}`),
    removePrefix('zelochat-media', `received/${acc.empresaId}`),
    removePrefix('delivery-assets', acc.empresaId),
    getServiceSupabase()
      .storage.from('logos')
      .remove([`${acc.userId}.png`, `${acc.userId}.jpg`, `${acc.userId}.jpeg`, `${acc.userId}.webp`])
      .then(() => undefined)
      .catch(() => undefined),
  ]);
  // 4) Purge DB + auth identity.
  const { error } = await getServiceSupabase().rpc('delete_account', {
    p_user_id: acc.userId,
    p_source: 'grace-purge',
  });
  if (error) throw new Error(error.message);
}

export async function sweepDueAccountDeletions(): Promise<DeletionSweepResult> {
  const supabase = getServiceSupabase();
  const nowIso = new Date().toISOString();
  const result: DeletionSweepResult = { due: 0, purged: 0, errors: [] };

  const { data, error } = await supabase
    .from('empresa_perfil')
    .select('id, user_id')
    .not('deletion_scheduled_at', 'is', null)
    .lte('deletion_scheduled_at', nowIso)
    .limit(BATCH);

  if (error) {
    console.error('[account-deletion-sweeper] query failed:', error.message);
    return result;
  }

  const due = (data ?? []).filter((r) => r.user_id) as Array<{ id: string; user_id: string }>;
  result.due = due.length;
  if (!due.length) return result;

  console.log(`[account-deletion-sweeper] purging ${due.length} due account(s)`);
  for (const row of due) {
    try {
      await purgeAccount({ empresaId: row.id, userId: row.user_id });
      result.purged += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ empresaId: row.id, error: msg });
      console.error(`[account-deletion-sweeper] purge failed for empresa=${row.id}:`, msg);
    }
  }
  console.log(`[account-deletion-sweeper] done: purged=${result.purged}/${result.due} errors=${result.errors.length}`);
  return result;
}

let loopHandle: ReturnType<typeof setInterval> | null = null;

export function startAccountDeletionSweepLoop(): void {
  if (loopHandle) return;
  const tick = () => {
    sweepDueAccountDeletions().catch((err) => {
      console.error('[account-deletion-sweeper] tick failed:', err);
    });
  };
  setTimeout(tick, STARTUP_DELAY_MS).unref?.();
  loopHandle = setInterval(tick, INTERVAL_MS);
  loopHandle.unref?.();
}
