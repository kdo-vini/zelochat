import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(resolve('supabase/migrations/052_customer_campaigns.sql'), 'utf8');

assert.match(migration, /create table if not exists public\.zelochat_segments/i);
assert.match(migration, /create table if not exists public\.zelochat_campaigns/i);
assert.match(migration, /create table if not exists public\.zelochat_campaign_recipients/i);
assert.match(migration, /unique\s*\(campaign_id,\s*pessoa_id\)/i);
assert.match(migration, /eligible.*suppressed.*queued.*sending.*sent.*failed.*cancelled/s);
assert.match(migration, /enable row level security/i);
assert.match(migration, /revoke all on table public\.zelochat_campaigns from public, anon, authenticated/i);
assert.match(migration, /clientes\.comunicar/i);
console.log('customerCampaignSchema: ok');
