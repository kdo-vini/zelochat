# Outbound RPC proof on disposable PostgreSQL 17

Run from the repository root with Node 24 and Docker:

```sh
node scripts/verification/outbound-postgres.mjs
```

This is the separate `verify-outbound-postgres` CI job. Unit tests deliberately
exclude `*.integration.test.ts`; a unit success does not certify SQL integration.
The production verification job requires both source/image verification and this
SQL job to pass.

The harness starts a fresh `postgres:17-alpine` container with `--network none`,
without publishing a host port. Its Node 24 verifier shares only that container's
loopback namespace. The database name, test credential and loopback URL are fixed
test constants; inherited database URLs and credentials are never selected.
Before creating its own random owner and company, the test verifies PostgreSQL
17, the expected database, a random per-run nonce, and empty company/job tables.
It does not read, select or modify a pre-existing tenant. No linked Supabase
project, provider, business worker or WhatsApp transport is used.

`fixtures/outbound-base.sql` contains six literal support table definitions and
their primary keys copied from the PDV baseline identified by
`fixtures/outbound-base.manifest.json`. The fixture checksum is checked before
starting containers. The small `auth.users` identity table, three database roles,
schema grants, and selected prerequisite DDL from migration 048 are explicit test
scaffolding. Thirteen original Chat migrations listed in the harness are applied
unchanged from `supabase/migrations`; each normalized SHA-256 is printed in the
run. All functions under test come from those migration files. There are no fake
implementations of the business RPCs.

The proof executes calls as `service_role` and checks three actual transaction
orders, observing waiting database sessions in `pg_stat_activity`:

1. Human takeover holds the control row before claim: claim waits, then returns
   no job and cancels the stale candidate.
2. Claim succeeds, then takeover wins the gate before transport start: start
   waits and refuses the stale epoch; the job is cancelled.
3. Transport start wins the gate first: takeover waits for its commit and the
   authorized job remains `dispatch_started`.

It also verifies that anonymous and authenticated roles cannot execute claim,
transport start or the lock gate, that the service role can, and that rejected
calls leave the job queued. These are real PostgreSQL locks and original RPC
results, not mocked database responses.

The scope is outbound claim/start arbitration and those RPC ACLs. It does not
certify all live RLS policies, unrelated support-table foreign keys/triggers,
customer identity/order-creation paths, or external message delivery. Takeover
transactions in the races explicitly exercise the control row and original lock
gate; they do not call the HTTP takeover handler. Missing unrelated business
dependencies are not replaced with stub RPCs.

The harness has a five-minute overall deadline, a 30-second startup deadline,
and bounded Docker/restore commands. The integration test has a 60-second
deadline, eight-second SQL statement limits, five-second token/lock waits with
observable polling, and bounded session shutdown. Success and failure both
remove the two generated container names; cleanup errors fail the run instead
of hiding a preceding failure. Database data lives only in the disposable
container. Docker images may remain cached for the next run.

When intentionally refreshing the support fixture, review the original baseline
DDL and update its source identity and normalized LF checksum together. Do not
replace a migration RPC with a test implementation to make this proof pass.
