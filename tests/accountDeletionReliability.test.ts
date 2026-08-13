import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  purgeAccountReliably,
  removeStoragePrefix,
  runAccountDeletionSweep,
  type AccountDeletionStorage,
} from '../server/accountDeletionSweeper.js';

type StorageObject = { id: string | null; name: string };

function fakeStorage(pages: StorageObject[][], options: { listErrorAt?: number; removeErrorAt?: number } = {}) {
  const listCalls: Array<{ bucket: string; prefix: string; limit: number; offset: number }> = [];
  const removeCalls: Array<{ bucket: string; paths: string[] }> = [];

  const storage: AccountDeletionStorage = {
    from(bucket: string) {
      return {
        async list(prefix, query) {
          listCalls.push({ bucket, prefix, limit: query.limit, offset: query.offset });
          const pageIndex = query.offset / query.limit;
          if (options.listErrorAt === pageIndex) {
            return { data: null, error: { message: 'list unavailable' } };
          }
          return { data: pages[pageIndex] ?? [], error: null };
        },
        async remove(paths) {
          removeCalls.push({ bucket, paths });
          const callIndex = removeCalls.length - 1;
          if (options.removeErrorAt === callIndex) {
            return { data: null, error: { message: 'remove unavailable' } };
          }
          return { data: paths, error: null };
        },
      };
    },
  };

  return { storage, listCalls, removeCalls };
}

async function run(): Promise<void> {
  const page = (start: number, count: number): StorageObject[] =>
    Array.from({ length: count }, (_, index) => ({ id: `id-${start + index}`, name: `file-${start + index}` }));

  {
    const fake = fakeStorage([page(0, 1000), page(1000, 1000), page(2000, 1)]);
    await removeStoragePrefix(fake.storage, 'zelochat-media', 'send/empresa-1');
    assert.deepEqual(fake.listCalls.map((call) => call.offset), [0, 1000, 2000]);
    assert.deepEqual(fake.removeCalls.map((call) => call.paths.length), [1000, 1000, 1]);
    assert.equal(fake.removeCalls[0].paths[0], 'send/empresa-1/file-0');
    assert.equal(fake.removeCalls[2].paths[0], 'send/empresa-1/file-2000');
  }

  {
    const fake = fakeStorage([page(0, 1)], { listErrorAt: 0 });
    await assert.rejects(
      removeStoragePrefix(fake.storage, 'logos', 'zelomenu-products/user-1'),
      /storage list logos\/zelomenu-products\/user-1 failed: list unavailable/,
    );
    assert.equal(fake.removeCalls.length, 0, 'a failed listing must never be treated as an empty prefix');
  }

  {
    const fake = fakeStorage([page(0, 1)], { removeErrorAt: 0 });
    await assert.rejects(
      removeStoragePrefix(fake.storage, 'delivery-assets', 'empresa-1'),
      /storage remove delivery-assets\/empresa-1 failed: remove unavailable/,
    );
  }

  {
    const fake = fakeStorage([[]]);
    const calls: string[] = [];
    await purgeAccountReliably(
      {
        empresaId: 'empresa-1',
        userId: 'user-1',
        claimToken: 'claim-1',
        whatsmiauInstance: 'instance-captured-by-claim',
      },
      {
        storage: fake.storage,
        renewClaim: async () => { calls.push('renew'); return true; },
        cancelBilling: async (userId) => { calls.push(`billing:${userId}`); },
        deleteDedicatedInstance: async (empresaId, instance, claimToken) => {
          calls.push(`instance:${empresaId}:${instance}:${claimToken}`);
        },
        finalizeDatabasePurge: async (account) => { calls.push(`database:${account.userId}`); },
      },
    );
    assert.equal(calls[0], 'renew');
    assert.equal(calls[1], 'billing:user-1');
    assert.equal(calls[2], 'renew');
    assert.equal(calls[3], 'instance:empresa-1:instance-captured-by-claim:claim-1');
    assert.equal(calls.filter((call) => call === 'renew').length, 8);
    assert.equal(calls.at(-1), 'database:user-1');
  }

  {
    const fake = fakeStorage([[]]);
    let finalized = false;
    await assert.rejects(
      purgeAccountReliably(
        {
          empresaId: 'empresa-1',
          userId: 'user-1',
          claimToken: 'claim-1',
          whatsmiauInstance: 'instance-captured-by-claim',
        },
        {
          storage: fake.storage,
          renewClaim: async () => true,
          cancelBilling: async () => undefined,
          deleteDedicatedInstance: async () => { throw new Error('provider unavailable'); },
          finalizeDatabasePurge: async () => { finalized = true; },
        },
      ),
      /provider unavailable/,
    );
    assert.equal(finalized, false, 'an external cleanup failure must block the irreversible database purge');
  }

  {
    const fake = fakeStorage([[]]);
    let sideEffects = 0;
    await assert.rejects(
      purgeAccountReliably(
        { empresaId: 'empresa-1', userId: 'user-1', claimToken: 'claim-1', whatsmiauInstance: null },
        {
          storage: fake.storage,
          renewClaim: async () => false,
          cancelBilling: async () => { sideEffects += 1; },
          deleteDedicatedInstance: async () => { sideEffects += 1; },
          finalizeDatabasePurge: async () => { sideEffects += 1; },
        },
      ),
      /Account deletion claim expired or was superseded/,
    );
    assert.equal(sideEffects, 0, 'an expired claim aborts before any irreversible side effect');
  }

  await assert.rejects(
    runAccountDeletionSweep({
      claimDueAccounts: async () => { throw new Error('database unavailable'); },
      purgeAccount: async () => undefined,
    }),
    /account deletion due query failed: database unavailable/,
  );

  const indexSource = readFileSync('server/index.ts', 'utf8');
  assert.match(
    indexSource,
    /PAYWALL_EXEMPT_EXACT[\s\S]*['"]\/api\/account\/reactivate['"]/,
    'reactivation is an exact paywall exemption, not a broad account prefix exemption',
  );

  const routerSource = readFileSync('server/router.ts', 'utf8');
  assert.equal(
    (routerSource.match(/err\.message === 'ACCOUNT_DELETION_IN_PROGRESS'/g) ?? []).length,
    2,
    'QR and QR refresh return a controlled conflict while deletion owns the account',
  );
  const reactivateStart = routerSource.indexOf("router.post('/api/account/reactivate'");
  const reactivateEnd = routerSource.indexOf('/**', reactivateStart + 1);
  const reactivateRoute = routerSource.slice(reactivateStart, reactivateEnd);
  assert.match(
    reactivateRoute,
    /rpc\(\s*'begin_account_deletion_reactivation',[\s\S]*p_empresa_id:[\s\S]*p_user_id:/,
  );
  assert.ok(
    reactivateRoute.indexOf("'begin_account_deletion_reactivation'")
      < reactivateRoute.indexOf('setStripeCancelAtPeriodEnd(userId, false)'),
    'the database reactivation fence is acquired before Stripe can be resumed',
  );
  assert.match(reactivateRoute, /Stripe resume[^\n]*failed[\s\S]*res\.status\(502\)[\s\S]*return;/);
  assert.ok(
    reactivateRoute.indexOf('res.status(502)')
      < reactivateRoute.indexOf("'complete_account_deletion_reactivation'"),
    'an ambiguous Stripe failure keeps the reactivation fence and deletion schedule intact',
  );
  assert.match(
    reactivateRoute,
    /rpc\(\s*'complete_account_deletion_reactivation',[\s\S]*p_empresa_id:[\s\S]*p_user_id:[\s\S]*p_reactivation_token:/,
  );
  assert.ok(
    reactivateRoute.indexOf('setStripeCancelAtPeriodEnd(userId, false)')
      < reactivateRoute.indexOf("'complete_account_deletion_reactivation'"),
    'Stripe is resumed before the exact reactivation fence is completed',
  );
  assert.ok(
    !reactivateRoute.includes("'abort_account_deletion_reactivation'"),
    'ambiguous Stripe failures must not release the safety fence automatically',
  );

  const deleteStart = routerSource.indexOf("router.delete('/api/account'");
  const deleteEnd = routerSource.indexOf('/**', deleteStart + 1);
  const deleteRoute = routerSource.slice(deleteStart, deleteEnd);
  assert.match(
    deleteRoute,
    /select\('deletion_scheduled_at, deletion_purge_token, deletion_reactivation_token'\)/,
  );
  assert.ok(
    deleteRoute.indexOf('deletion_scheduled_at')
      < deleteRoute.indexOf('setStripeCancelAtPeriodEnd(userId, true)'),
    'an already scheduled deletion is idempotent before any repeated Stripe effect',
  );
  assert.match(
    deleteRoute,
    /\.is\('deletion_purge_token', null\)[\s\S]*\.is\('deletion_reactivation_token', null\)/,
  );

  const sweeperSource = readFileSync('server/accountDeletionSweeper.ts', 'utf8');
  assert.match(sweeperSource, /rpc\('claim_due_account_deletions',\s*{\s*p_limit:\s*BATCH,?\s*}\)/);
  assert.match(
    sweeperSource,
    /rpc\('finalize_claimed_account_deletion',[\s\S]*p_empresa_id:[\s\S]*p_user_id:[\s\S]*p_purge_token:/,
  );
  assert.match(
    sweeperSource,
    /rpc\('renew_account_deletion_claim',[\s\S]*p_empresa_id:[\s\S]*p_user_id:[\s\S]*p_purge_token:/,
  );
  assert.match(sweeperSource, /whatsmiau_instance:[\s\S]*whatsmiauInstance:/);
  assert.ok(
    !sweeperSource.includes(".from('empresa_perfil')\n        .select('id, user_id')"),
    'the sweeper never bypasses the atomic database claim with a direct due query',
  );

  const instanceManagerSource = readFileSync('server/instanceManager.ts', 'utf8');
  const dedicatedStart = instanceManagerSource.indexOf('export async function deleteDedicatedInstance');
  const dedicatedDelete = instanceManagerSource.slice(dedicatedStart);
  assert.ok(dedicatedStart >= 0, 'a dedicated destructive instance resolver exists');
  assert.ok(!dedicatedDelete.includes('getInstanceForEmpresa('), 'account purge never reaches the legacy instance fallback');
  assert.ok(!dedicatedDelete.includes(".select('whatsmiau_instance')"), 'purge deletes only the instance captured by the database claim');
  assert.match(dedicatedDelete, /\.eq\('deletion_purge_token', claimToken\)/);

  const connectStart = instanceManagerSource.indexOf('export async function getOrCreateOwnInstanceForEmpresa');
  const connectEnd = instanceManagerSource.indexOf('/**', connectStart + 1);
  const connectPath = instanceManagerSource.slice(connectStart, connectEnd);
  assert.match(connectPath, /select\('whatsmiau_instance, deletion_purge_token, deletion_reactivation_token'\)/);
  assert.match(connectPath, /if\s*\(lookupError\)\s*throw/);
  assert.ok(
    connectPath.indexOf('deletion_reactivation_token') < connectPath.indexOf('return createInstance(empresaId)'),
    'fresh deletion/reactivation fence check happens before provider creation',
  );

  const createStart = instanceManagerSource.indexOf('export async function createInstance');
  const createEnd = instanceManagerSource.indexOf('/**', createStart + 1);
  const createPath = instanceManagerSource.slice(createStart, createEnd);
  assert.match(
    createPath,
    /\.is\('deletion_purge_token', null\)[\s\S]*\.is\('deletion_reactivation_token', null\)[\s\S]*\.select\('id'\)[\s\S]*\.maybeSingle\(\)/,
  );
  assert.match(createPath, /deleteProviderInstanceExact\(instanceName\)/);

  const billingSource = readFileSync('server/billing.ts', 'utf8');
  const immediateCancelStart = billingSource.indexOf('export async function cancelStripeSubscriptionForUser');
  const immediateCancelEnd = billingSource.indexOf('// P2.10', immediateCancelStart);
  const immediateCancel = billingSource.slice(immediateCancelStart, immediateCancelEnd);
  assert.match(immediateCancel, /const\s*{\s*data,\s*error\s*}/);
  assert.match(immediateCancel, /if\s*\(error\)\s*throw/);
}

run().then(
  () => console.log('account deletion reliability tests passed'),
  (error) => { console.error(error); process.exit(1); },
);
