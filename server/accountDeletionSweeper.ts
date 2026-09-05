import { isShuttingDown } from './runtime/backgroundWork.js';
import { startPeriodicTask } from './runtime/periodicTask.js';
import { getServiceSupabase } from './supabase.js';
import { deleteDedicatedInstance } from './instanceManager.js';
import { cancelStripeSubscriptionForUser } from './billing.js';

/**
 * Account-deletion sweeper — runs the irreversible purge for accounts whose
 * 14-day grace period has elapsed.
 *
 * Self-service deletion (PDV /api/account/delete and ZeloChat DELETE /api/account)
 * does NOT purge immediately — it stamps `empresa_perfil.deletion_scheduled_at =
 * now() + 14d` and cancels billing at period end. The user can reactivate any time
 * before then. This sweeper finds rows whose schedule is due and, for each:
 *   1. cancels the Stripe subscription immediately (no-op for Pix/AbacatePay
 *      customers — those are one-time charges with no recurrence to cancel)
 *   2. deletes the Whatsmiau WhatsApp instance
 *   3. removes the account's storage objects (all buckets)
 *   4. finalizes the service-role claim (which validates the fencing token and
 *      purges PDV + ZeloChat data and the auth identity in one transaction).
 *
 * Lives in the ZeloChat backend because it already has the service role, Stripe,
 * Whatsmiau and storage access; it purges PDV-only accounts too (the dedicated
 * instance delete is a no-op when the account has no assigned instance).
 *
 * Schedule: 3 min after startup, then hourly. Idempotent.
 */

const STARTUP_DELAY_MS = 3 * 60 * 1000;
const INTERVAL_MS = 60 * 60 * 1000;
const BATCH = 50;

export interface DueAccount {
  empresaId: string;
  userId: string;
  claimToken: string;
  whatsmiauInstance: string | null;
}

export interface DeletionSweepResult {
  due: number;
  purged: number;
  errors: Array<{ empresaId: string; error: string }>;
}

interface StorageError {
  message?: string;
}

interface StorageObject {
  id?: string | null;
  name: string;
}

interface AccountDeletionStorageBucket {
  list(
    prefix: string,
    options: { limit: number; offset: number },
  ): Promise<{ data: StorageObject[] | null; error: StorageError | null }>;
  remove(paths: string[]): Promise<{ data: unknown; error: StorageError | null }>;
}

export interface AccountDeletionStorage {
  from(bucket: string): AccountDeletionStorageBucket;
}

const STORAGE_PAGE_SIZE = 1000;

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}

async function removeStorageObjects(
  storage: AccountDeletionStorage,
  bucket: string,
  paths: string[],
  label: string,
  beforeExternalEffect?: () => Promise<void>,
): Promise<void> {
  for (let offset = 0; offset < paths.length; offset += STORAGE_PAGE_SIZE) {
    const chunk = paths.slice(offset, offset + STORAGE_PAGE_SIZE);
    await beforeExternalEffect?.();
    const { error } = await storage.from(bucket).remove(chunk);
    if (error) throw new Error(`storage remove ${bucket}/${label} failed: ${messageOf(error)}`);
  }
}

export async function removeStoragePrefix(
  storage: AccountDeletionStorage,
  bucket: string,
  prefix: string,
  beforeExternalEffect?: () => Promise<void>,
): Promise<void> {
  const paths: string[] = [];
  for (let offset = 0; ; offset += STORAGE_PAGE_SIZE) {
    await beforeExternalEffect?.();
    const { data, error } = await storage.from(bucket).list(prefix, {
      limit: STORAGE_PAGE_SIZE,
      offset,
    });
    if (error) throw new Error(`storage list ${bucket}/${prefix} failed: ${messageOf(error)}`);

    const page = data ?? [];
    paths.push(...page.filter((object) => object.id).map((object) => `${prefix}/${object.name}`));
    if (page.length < STORAGE_PAGE_SIZE) break;
  }

  await removeStorageObjects(storage, bucket, paths, prefix, beforeExternalEffect);
}

export interface AccountDeletionPurgeDependencies {
  storage: AccountDeletionStorage;
  renewClaim(account: DueAccount): Promise<boolean>;
  cancelBilling(userId: string): Promise<void>;
  deleteDedicatedInstance(empresaId: string, instance: string, claimToken: string): Promise<void>;
  finalizeDatabasePurge(account: DueAccount): Promise<void>;
}

async function renewClaimOrThrow(
  account: DueAccount,
  renewClaim: AccountDeletionPurgeDependencies['renewClaim'],
): Promise<void> {
  if (!await renewClaim(account)) {
    throw new Error('Account deletion claim expired or was superseded');
  }
}

export async function purgeAccountReliably(
  account: DueAccount,
  deps: AccountDeletionPurgeDependencies,
): Promise<void> {
  await renewClaimOrThrow(account, deps.renewClaim);
  await deps.cancelBilling(account.userId);

  if (account.whatsmiauInstance) {
    await renewClaimOrThrow(account, deps.renewClaim);
    await deps.deleteDedicatedInstance(account.empresaId, account.whatsmiauInstance, account.claimToken);
  }

  const renewBeforeStorageEffect = () => renewClaimOrThrow(account, deps.renewClaim);
  await removeStoragePrefix(
    deps.storage,
    'zelochat-media',
    `send/${account.empresaId}`,
    renewBeforeStorageEffect,
  );

  await removeStoragePrefix(
    deps.storage,
    'zelochat-media',
    `received/${account.empresaId}`,
    renewBeforeStorageEffect,
  );

  await removeStoragePrefix(
    deps.storage,
    'delivery-assets',
    account.empresaId,
    renewBeforeStorageEffect,
  );

  await removeStoragePrefix(
    deps.storage,
    'logos',
    `zelomenu-products/${account.userId}`,
    renewBeforeStorageEffect,
  );

  await removeStorageObjects(
    deps.storage,
    'logos',
    [
      `${account.userId}.png`,
      `${account.userId}.jpg`,
      `${account.userId}.jpeg`,
      `${account.userId}.webp`,
    ],
    account.userId,
    renewBeforeStorageEffect,
  );

  await renewClaimOrThrow(account, deps.renewClaim);
  await deps.finalizeDatabasePurge(account);
}

export interface AccountDeletionSweepDependencies {
  claimDueAccounts(): Promise<DueAccount[]>;
  purgeAccount(account: DueAccount): Promise<void>;
}

export async function runAccountDeletionSweep(
  deps: AccountDeletionSweepDependencies,
): Promise<DeletionSweepResult> {
  const result: DeletionSweepResult = { due: 0, purged: 0, errors: [] };
  let due: DueAccount[];
  try {
    due = await deps.claimDueAccounts();
  } catch (error) {
    throw new Error(`account deletion due query failed: ${messageOf(error)}`, { cause: error });
  }

  result.due = due.length;
  if (!due.length) return result;

  console.log(`[account-deletion-sweeper] purging ${due.length} due account(s)`);
  for (const account of due) {
    if (isShuttingDown()) break;
    try {
      await deps.purgeAccount(account);
      result.purged += 1;
    } catch (error) {
      const msg = messageOf(error);
      result.errors.push({ empresaId: account.empresaId, error: msg });
      console.error(`[account-deletion-sweeper] purge failed for empresa=${account.empresaId}:`, msg);
    }
  }
  console.log(`[account-deletion-sweeper] done: purged=${result.purged}/${result.due} errors=${result.errors.length}`);
  return result;
}

export async function sweepDueAccountDeletions(): Promise<DeletionSweepResult> {
  const supabase = getServiceSupabase();

  return runAccountDeletionSweep({
    claimDueAccounts: async () => {
      const { data, error } = await supabase.rpc('claim_due_account_deletions', {
        p_limit: BATCH,
      });
      if (error) throw new Error(error.message);
      return ((data ?? []) as Array<{
        empresa_id: string | null;
        user_id: string | null;
        whatsmiau_instance: string | null;
        purge_token: string | null;
      }>).map((row) => {
        if (!row.empresa_id || !row.user_id || !row.purge_token) {
          throw new Error('claim_due_account_deletions returned an incomplete claim');
        }
        return {
          empresaId: row.empresa_id,
          userId: row.user_id,
          claimToken: row.purge_token,
          whatsmiauInstance: row.whatsmiau_instance,
        };
      });
    },
    purgeAccount: (account) => purgeAccountReliably(account, {
      storage: supabase.storage as unknown as AccountDeletionStorage,
      renewClaim: async (dueAccount) => {
        const { data, error } = await supabase.rpc('renew_account_deletion_claim', {
          p_empresa_id: dueAccount.empresaId,
          p_user_id: dueAccount.userId,
          p_purge_token: dueAccount.claimToken,
        });
        if (error) throw new Error(error.message);
        return data === true;
      },
      cancelBilling: cancelStripeSubscriptionForUser,
      deleteDedicatedInstance,
      finalizeDatabasePurge: async (dueAccount) => {
        const { data, error } = await supabase.rpc('finalize_claimed_account_deletion', {
          p_empresa_id: dueAccount.empresaId,
          p_user_id: dueAccount.userId,
          p_purge_token: dueAccount.claimToken,
        });
        if (error) throw new Error(error.message);
        if (data !== true) throw new Error('Account deletion claim is stale or no longer due');
      },
    }),
  });
}


export function startAccountDeletionSweepLoop(): void {
  startPeriodicTask('accountDeletionSweeper', sweepDueAccountDeletions, STARTUP_DELAY_MS, INTERVAL_MS);
}
