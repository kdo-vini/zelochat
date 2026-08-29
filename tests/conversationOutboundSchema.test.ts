import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve('supabase/migrations/063_conversation_outbound_foundation.sql');

assert(existsSync(migrationPath), 'migration 063_conversation_outbound_foundation.sql must exist');

const sql = readFileSync(migrationPath, 'utf8').replace(/\r\n/g, '\n');
const migrationFiles = readdirSync(resolve('supabase/migrations'));
const versions = new Map<string, string[]>();

for (const file of migrationFiles) {
  const version = /^(\d+)_/.exec(file)?.[1];
  if (!version) continue;
  versions.set(version, [...(versions.get(version) ?? []), file]);
}

assert.match(sql, /create table public\.zelochat_conversation_ai_control/i);
assert.match(sql, /identity_key text not null/i);
assert.match(sql, /unique \(empresa_id, identity_key\)/i);
assert.match(sql, /mode text not null default 'ai'.*'ai','human'/is);
assert.match(sql, /epoch bigint not null default 0/i);
assert.match(sql, /create table public\.zelochat_conversation_control_events/i);
assert.match(sql, /add column if not exists outbound_origin text/i);
assert.match(sql, /add column if not exists conversation_control_id uuid/i);
assert.match(sql, /where status in \('sending','dispatch_started'\)/i);
assert.match(sql, /grant all on table .* to service_role/i);
assert.doesNotMatch(sql, /grant .* to (anon|authenticated)/i);

assert.equal(versions.get('063')?.length ?? 0, 1, 'migration version 063 must be unique');
