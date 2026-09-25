import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  WEBHOOK_RAW_RETENTION_JOB,
  WEBHOOK_RAW_RETENTION_OWNER,
} from '../server/webhookEventsSweeper.js';

const POSTGREST_UNBOUNDED_DELETE = /\.from\(\s*['"]zelochat_webhook_events_raw['"]\s*\)[\s\S]{0,240}\.delete\s*\(/;
const RAW_SQL_DELETE = /DELETE\s+FROM\s+(?:public\.)?zelochat_webhook_events_raw/i;
const APP_PURGE_RPC = /\.rpc\(\s*['"]purge_zelochat_webhook_events_raw_batch['"]/;

function listSourceFiles(root: string, suffixes: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        walk(path);
        continue;
      }
      if (suffixes.some((suffix) => entry.name.endsWith(suffix))) out.push(path);
    }
  };
  walk(root);
  return out;
}

const appSources = [
  ...listSourceFiles('server', ['.ts']),
  ...listSourceFiles('src', ['.ts', '.tsx']),
];

const postgrestHits: string[] = [];
const sqlHits: string[] = [];
const rpcHits: string[] = [];
for (const path of appSources) {
  const source = readFileSync(path, 'utf8');
  if (POSTGREST_UNBOUNDED_DELETE.test(source)) postgrestHits.push(path);
  if (RAW_SQL_DELETE.test(source)) sqlHits.push(path);
  if (APP_PURGE_RPC.test(source)) rpcHits.push(path);
}

assert.deepEqual(postgrestHits, [], 'app must not issue PostgREST delete on zelochat_webhook_events_raw');
assert.deepEqual(sqlHits, [], 'app must not issue raw SQL DELETE on zelochat_webhook_events_raw');
assert.deepEqual(rpcHits, [], 'app must not call purge_zelochat_webhook_events_raw_batch; pg_cron owns retention');

const indexSource = readFileSync('server/index.ts', 'utf8');
assert.doesNotMatch(indexSource, /startWebhookEventsSweeper/);
assert.match(indexSource, /purge-zelochat-webhook-events-raw/);

assert.equal(WEBHOOK_RAW_RETENTION_OWNER, 'pg_cron');
assert.equal(WEBHOOK_RAW_RETENTION_JOB, 'purge-zelochat-webhook-events-raw');

const sweeperSource = readFileSync('server/webhookEventsSweeper.ts', 'utf8');
assert.doesNotMatch(sweeperSource, /getServiceSupabase/);
assert.doesNotMatch(sweeperSource, /startPeriodicTask/);
assert.match(sweeperSource, /delete_account/);

const migration = readFileSync('supabase/migrations/20260918044906_optimize_webhook_raw_io.sql', 'utf8');
assert.match(migration, /zelochat_webhook_events_raw_processed_retention_idx[\s\S]*where processed_at is not null/i);
assert.match(migration, /grant execute on function[\s\S]*to service_role/i);
assert.match(migration, /revoke all on function[\s\S]*from authenticated/i);

console.log('webhookEventsSweeper tests passed');
