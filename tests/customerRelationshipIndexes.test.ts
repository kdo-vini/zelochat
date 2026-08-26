import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../supabase/migrations/060_customer_fk_indexes.sql', import.meta.url), 'utf8');
const expected = [
  'zelochat_sessions_empresa_owner_idx',
  'zelochat_sessions_owner_person_idx',
  'zelochat_customer_relationships_empresa_owner_idx',
  'zelochat_customer_relationships_person_owner_idx',
  'zelochat_person_tags_empresa_owner_idx',
  'zelochat_person_tags_person_owner_idx',
  'zelochat_segments_empresa_owner_idx',
  'zelochat_campaigns_empresa_owner_idx',
  'zelochat_campaign_recipients_empresa_person_idx',
  'zelochat_outbound_jobs_campaign_idx',
  'zelochat_outbound_jobs_recipient_idx',
  'zelochat_automation_rules_empresa_owner_idx',
  'zelochat_automation_dispatches_outbound_job_idx',
  'zelochat_crm_rollout_flags_updated_by_idx',
];

for (const name of expected) assert.match(sql, new RegExp(`create index if not exists ${name}`), `${name} must be present`);
assert.doesNotMatch(sql, /concurrently/iu, 'migration runner remains transactional');
console.log('customerRelationshipIndexes: ok');
