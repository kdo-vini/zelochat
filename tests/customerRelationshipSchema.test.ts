import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { assert, assertEqual, assertIncludes, runSuite } from './testHarness.js';

const migrationPath = resolve('supabase/migrations/048_customer_relationship_foundation.sql');
const verificationPath = resolve('supabase/verification/customer_relationship_authz.sql');
const migration = existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8').replace(/\r\n/g, '\n').toLowerCase()
  : '';
const compactMigration = migration.replace(/\s+/g, ' ');
const types = readFileSync(resolve('src/types.ts'), 'utf8');

await runSuite('customer relationship schema', [
  {
    name: 'adds nullable people links and tenant/activity indexes to sessions',
    run: () => {
      assertIncludes(migration, 'add column if not exists pessoa_id uuid', 'sessions accepts a nullable pessoa_id');
      assertIncludes(migration, 'add column if not exists owner_user_id uuid', 'sessions persist the person owner key');
      assertIncludes(migration, 'set owner_user_id = ep.user_id', 'session owner backfill comes from empresa_perfil');
      assertIncludes(migration, 'precondition_failed: zelochat_sessions has an owner backfill orphan', 'orphan sessions fail before owner NOT NULL');
      assertIncludes(migration, 'alter column owner_user_id set not null', 'session owner key is required after deterministic backfill');
      assertIncludes(compactMigration, 'foreign key (empresa_id, owner_user_id) references public.empresa_perfil(id, user_id)', 'session empresa FK is composite and tenant-safe');
      assertIncludes(compactMigration, 'foreign key (owner_user_id, pessoa_id) references public.pessoas(id_usuario, id)', 'session person FK is composite and tenant-safe');
      assertIncludes(compactMigration, 'on delete cascade', 'session person link cascades with the person');
      assert(!/create (or replace )?function public\.zelochat_validate_session_person_tenant/.test(migration)
        && !/create trigger trg_zelochat_sessions_person_tenant/.test(migration), 'session tenant invariant does not depend on a mutable-owner trigger');
      assertIncludes(compactMigration, 'zelochat_sessions_empresa_pessoa_activity_idx on public.zelochat_sessions (empresa_id, pessoa_id, updated_at desc)', 'session listing index is tenant/person/activity ordered');
      assertIncludes(migration, 'zelochat_sessions_empresa_activity_idx', 'session activity listing index exists');
    },
  },
  {
    name: 'creates relationship notes with bounded lengths and tenant-safe ownership',
    run: () => {
      assertIncludes(migration, 'create table if not exists public.zelochat_customer_relationships', 'relationship table exists');
      assertIncludes(compactMigration, 'unique (empresa_id, pessoa_id)', 'one relationship exists per tenant/person');
      assertIncludes(migration, 'length(internal_notes) <= 4000', 'internal notes are bounded to 4000 characters');
      assertIncludes(migration, 'length(ai_summary) <= 600', 'AI summary is bounded to 600 characters');
      assertIncludes(migration, 'foreign key (id_usuario, pessoa_id)', 'relationship person FK includes the owner tenant key');
      assertIncludes(migration, 'foreign key (empresa_id, id_usuario)', 'relationship empresa FK includes the owner tenant key');
    },
  },
  {
    name: 'creates person tags with composite tenant FKs and listing indexes',
    run: () => {
      assertIncludes(migration, 'create table if not exists public.zelochat_person_tags', 'person tag table exists');
      assertIncludes(migration, 'foreign key (id_usuario, pessoa_id)', 'person tag person FK is tenant-safe');
      assertIncludes(migration, 'foreign key (empresa_id, tag_id)', 'person tag tag FK is tenant-safe');
      assertIncludes(migration, 'zelochat_person_tags_empresa_person_idx', 'person tag listing index exists');
      assertIncludes(migration, 'on delete cascade', 'person tag links clean up with their parent records');
    },
  },
  {
    name: 'creates auditable match conflicts with constrained state',
    run: () => {
      assertIncludes(migration, 'create table if not exists public.zelochat_person_match_conflicts', 'match conflict table exists');
      assertIncludes(migration, "check (state in ('open', 'resolved', 'dismissed'))", 'match conflict state is constrained');
      assertIncludes(migration, 'resolved_at timestamptz', 'match conflict stores resolution time');
      assertIncludes(migration, 'resolved_by uuid', 'match conflict stores resolver');
      assertIncludes(migration, 'resolution_reason text', 'match conflict stores resolution reason');
      assertIncludes(migration, 'zelochat_person_match_conflicts_empresa_state_idx', 'match conflict listing index exists');
    },
  },
  {
    name: 'keeps CRM tables server-only while enabling RLS explicitly',
    run: () => {
      for (const table of [
        'zelochat_customer_relationships',
        'zelochat_person_tags',
        'zelochat_person_match_conflicts',
      ]) {
        assertIncludes(migration, `alter table public.${table} enable row level security`, `${table} enables RLS`);
        assertIncludes(migration, `revoke all on table public.${table} from public, anon, authenticated`, `${table} is not granted to browser roles`);
        assertIncludes(migration, `grant all on table public.${table} to service_role`, `${table} is granted to the server role`);
      }
      assert(!migration.includes('auth.role()'), 'migration does not use deprecated auth.role()');
      assert(!/grant\s+[^;]*\bto\s+authenticated/i.test(migration), 'migration does not expose CRM grants to authenticated');
    },
  },
  {
    name: 'publishes discriminated customer and timeline contracts',
    run: () => {
      for (const typeName of [
        'CustomerSummary',
        'CustomerDetail',
        'CustomerFilters',
        'CustomerActivityState',
        'CustomerTimelineEntry',
        'CustomerTimelineEvent',
      ]) {
        assert(new RegExp(`export (type|interface) ${typeName}\\b`).test(types), `${typeName} is exported as a type`);
      }
      assertIncludes(types, "kind: 'message'", 'timeline has a message discriminant');
      assertIncludes(types, "kind: 'order'", 'timeline has an order discriminant');
      assertIncludes(types, "kind: 'relationship'", 'timeline has a relationship discriminant');
      assertIncludes(types, "export type CustomerActivityState = 'active' | 'inactive'", 'activity state is explicit and safe');
      for (const status of ['pending_payment', 'pending_review', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'rejected', 'cancelled']) {
        assertIncludes(types, `'${status}'`, `timeline order status includes ${status}`);
      }
    },
  },
  {
    name: 'uses the next unique migration version in the repository',
    run: () => {
      const migrationFiles = readdirSync(resolve('supabase/migrations'));
      const versions = new Map<string, string[]>();
      for (const file of migrationFiles) {
        const version = /^(\d+)_/.exec(file)?.[1];
        if (!version) continue;
        versions.set(version, [...(versions.get(version) ?? []), file]);
      }
      assertEqual(versions.get('048')?.length ?? 0, 1, 'CRM migration has one 048 file');
      assert(!migrationFiles.includes('036_customer_relationship_foundation.sql'), 'old duplicate 036 CRM migration is absent');
      for (const [version, files] of versions) {
        assert(files.length === 1 || version === '034', `migration version ${version} is unique (034 is the known historical duplicate)`);
      }
    },
  },
  {
    name: 'runs executable tenant and RLS probes when a database is configured',
    run: () => {
      const databaseUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
      if (!databaseUrl || !existsSync(verificationPath)) {
        console.log('  SKIP database runtime verification (SUPABASE_DB_URL/DATABASE_URL or verification SQL unavailable)');
        return;
      }
      const result = spawnSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '--file', verificationPath], {
        stdio: 'inherit',
        timeout: 60_000,
      });
      assert(result.status === 0, 'runtime RLS and tenant-FK verification passes');
    },
  },
]);
