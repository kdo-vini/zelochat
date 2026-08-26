import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CRM_FEATURES,
  DEFAULT_CRM_ROLLOUT_FLAGS,
  CrmFeatureDisabledError,
  isCrmFeatureEnabled,
  normalizeCrmRolloutFlags,
} from '../server/customers/rollout.js';
import {
  aggregateCrmMetricRows,
  CRM_METRIC_KEYS,
  sanitizeMetricPatch,
  type CrmMetricRow,
} from '../server/customers/metrics.js';

const migration = readFileSync(resolve('supabase/migrations/057_customer_crm_rollout.sql'), 'utf8');

assert.deepEqual(DEFAULT_CRM_ROLLOUT_FLAGS, { crm: false, campaigns: false, automations: false });
assert.deepEqual(CRM_FEATURES, ['crm', 'campaigns', 'automations']);
assert.equal(isCrmFeatureEnabled(DEFAULT_CRM_ROLLOUT_FLAGS, 'crm'), false);
assert.equal(isCrmFeatureEnabled({ crm: true, campaigns: false, automations: false }, 'crm'), true);
assert.equal(isCrmFeatureEnabled({ crm: true, campaigns: false, automations: false }, 'campaigns'), false);
assert.deepEqual(normalizeCrmRolloutFlags({ crm_enabled: true, campaigns_enabled: 1 }), { crm: true, campaigns: false, automations: false });
assert.equal(new CrmFeatureDisabledError('campaigns').code, 'CRM_FEATURE_DISABLED');

for (const key of CRM_METRIC_KEYS) assert.equal(typeof sanitizeMetricPatch({ [key]: 2 })[key], 'number');
assert.deepEqual(sanitizeMetricPatch({ content: 20, phone: 1, jid: 1, jobs_sent: 2 }), { jobs_sent: 2 });

const rows: CrmMetricRow[] = [
  { metric_date: '2026-08-26', customers_total: 3, customers_with_phone: 2, customers_conflicts: 1, profile_views: 4, filter_uses: 5, campaigns_created: 1, campaigns_sent: 2, campaigns_paused: 0, campaigns_failed: 1, automations_enabled: 1, jobs_sent: 3, jobs_failed: 1, jobs_suppressed: 2, responses_attributed: 1, orders_attributed: 1, optouts: 1, queue_size: 4, queue_oldest_seconds: 20, leases_stuck: 0, disconnected: 1 },
  { metric_date: '2026-08-25', customers_total: 2, customers_with_phone: 1, customers_conflicts: 0, profile_views: 1, filter_uses: 1, campaigns_created: 0, campaigns_sent: 1, campaigns_paused: 1, campaigns_failed: 0, automations_enabled: 0, jobs_sent: 1, jobs_failed: 0, jobs_suppressed: 0, responses_attributed: 0, orders_attributed: 0, optouts: 0, queue_size: 2, queue_oldest_seconds: 10, leases_stuck: 1, disconnected: 0 },
];
const totals = aggregateCrmMetricRows(rows);
assert.equal(totals.customers_total, 5);
assert.equal(totals.queue_size, 6);
assert.equal(totals.queue_oldest_seconds, 20);
assert.equal(totals.leases_stuck, 1);
assert(!JSON.stringify(totals).match(/content|jid|message/i));

assert.match(migration, /zelochat_crm_rollout_flags/i);
assert.match(migration, /crm_enabled\s+boolean\s+not null\s+default\s+false/i);
assert.match(migration, /campaigns_enabled\s+boolean\s+not null\s+default\s+false/i);
assert.match(migration, /automations_enabled\s+boolean\s+not null\s+default\s+false/i);
assert.match(migration, /zelochat_crm_metrics_daily/i);
assert.match(migration, /grant all on table public\.zelochat_crm_rollout_flags to service_role/i);

console.log('customerRollout: ok');
