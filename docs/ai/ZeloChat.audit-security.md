# ZeloChat Security Audit

## Executive Summary
- Tenant resolution and most explicit `empresa_id` filters are materially better than older docs suggested.
- The current head still has one confirmed cross-tenant leak path and one partially unauthenticated webhook boundary.
- Service-role usage remains extensive, so explicit tenant filters are still a first-line control and not just a convenience.

## Confirmed Tenant Boundary Model
- HTTP API tenant resolution: `server/supabase.ts`
- WebSocket tenant resolution: `server/ws.ts`
- Webhook tenant resolution: `server/instanceManager.ts` + `server/router.ts`
- Shared PDV table scope in frontend:
  - `src/hooks/useCatalog.ts`
  - `src/hooks/useEmpresaPerfil.ts`
  - `src/hooks/useOrders.ts`

## Confirmed Findings

[P0] Cross-tenant tag attachment leaks foreign tag metadata and AI instructions into another tenant's conversation

Area:
Security

Status:
Confirmed bug

Evidence:
- File(s): `server/router.ts`, `server/tags.ts`, `supabase/migrations/032_zelochat_session_tags.sql`, `server/ai.ts`
- Function/component/route:
  - `POST /api/sessions/:sessionId/tags/:tagId`
  - `applyTagToSession()`
  - `getSessionTagsFull()`
  - tag injection in `buildSystemInstruction()`
- Relevant behavior:
  - `server/router.ts:1777-1783` accepts arbitrary `tagId` from the authenticated caller.
  - `server/tags.ts:143-154` upserts `(session_id, tag_id, empresa_id)` without verifying that the referenced tag belongs to the same `empresaId`.
  - `supabase/migrations/032_zelochat_session_tags.sql:4-20` has foreign keys to session/tag IDs, but no composite tenant-consistency check.
  - `server/tags.ts:127-140` reads joined `zelochat_tags(...)` back through the junction row filtered only by the junction `empresa_id`.
  - `server/ai.ts:2952-2957` loads session tags and `server/ai.ts:1977` injects them into the system prompt.
- Why the evidence supports the finding:
  - With a known foreign `tagId`, the current code allows binding that foreign tag to the attacker tenant's session and then reading its metadata and AI instructions back into the attacker's context.

Why this matters:
- Technical impact:
  - Breaks tenant isolation and prompt integrity.
- Business impact:
  - One tenant's private operational instructions can leak into another tenant's UI and AI behavior.
- Heavy-user impact:
  - More tags and more operators increase the blast radius if a UUID leaks.
- Customer/support impact:
  - Trust-destroying cross-tenant data leak; qualifies as a scale blocker.

How to reproduce or validate:
1. As tenant A, obtain a valid `tagId` from tenant B.
2. Call `POST /api/sessions/:sessionId/tags/:tagId` for a tenant A session.
3. Reload session tags or trigger AI prompt assembly and confirm the foreign tag metadata/instructions are returned.

Recommended fix:
- Minimal safe fix:
  - Reject any `tagId` whose `zelochat_tags.empresa_id` does not match the authenticated `empresaId`.
- Long-term fix:
  - Enforce tenant consistency in `zelochat_session_tags` with composite-FK or trigger-based validation.
- DB migration/index/RLS change if needed:
  - Yes; add database-level tenant-consistency enforcement to the junction table.
- Risk of the fix:
  - Medium; existing bad rows must be identified before a strict DB constraint lands.

Confidence:
High

[P1] Inbound webhook secret validation is not enforced; missing token is accepted by design

Area:
Security

Status:
Confirmed risk

Evidence:
- File(s): `server/router.ts`, `server/instanceManager.ts`, `supabase/migrations/000_zelochat_schema.sql`
- Function/component/route: `POST /webhook/:instance`
- Relevant behavior:
  - `server/router.ts:681-692` documents webhook token auth as currently dormant.
  - `server/router.ts:703-709` rejects only mismatched tokens.
  - `server/router.ts:710-726` explicitly proceeds when the token is absent unless strict mode is manually enabled.
  - `supabase/migrations/000_zelochat_schema.sql:73-76` shows `webhook_token` exists as a per-tenant secret, but the route does not fail closed on absence today.
- Why the evidence supports the finding:
  - The practical boundary is the instance path alone when the upstream does not forward the token header.

Why this matters:
- Technical impact:
  - Forged inbound events can reach message persistence, AI, and order flows if the instance path is known.
- Business impact:
  - Fake customer messages or order-confirmation events can mutate real conversation state.
- Heavy-user impact:
  - More active conversations mean more ways to hide malicious or forged traffic.
- Customer/support impact:
  - Support/debug complexity rises sharply when webhook origin is not strongly authenticated.

How to reproduce or validate:
1. Call `POST /webhook/:instance` without any token header.
2. Use a valid instance name.
3. Confirm the route acknowledges and processes the payload in default mode.

Recommended fix:
- Minimal safe fix:
  - Add an edge control that can actually be verified today, such as IP allowlist or gateway-signed header.
- Long-term fix:
  - Move to a webhook authentication method that the upstream reliably forwards and fail closed.
- DB migration/index/RLS change if needed:
  - No DB migration required.
- Risk of the fix:
  - Medium; upstream compatibility must be proven before flipping a strict mode that could block real traffic.

Confidence:
High

[P2] Customer/order PII is written to plaintext application logs

Area:
Security

Status:
Confirmed risk

Evidence:
- File(s): `server/ai.ts`
- Function/component/route:
  - `createOrderInDb()` logging
  - AI error logging
- Relevant behavior:
  - `server/ai.ts:1836` logs `JSON.stringify(args)` before order insert.
  - `server/ai.ts:1841-1845` shows that payload includes customer/order fields.
  - `server/ai.ts:3800-3801` logs raw upstream AI error data.
- Why the evidence supports the finding:
  - Railway/application logs become a secondary plaintext store of customer/order data.

Why this matters:
- Technical impact:
  - Increases exposure surface outside the primary database.
- Business impact:
  - LGPD and tenant-trust risk.
- Heavy-user impact:
  - Higher order volume means more PII emitted to logs.
- Customer/support impact:
  - Log viewers gain access to customer data they may not need.

How to reproduce or validate:
1. Trigger an order creation or upstream AI error.
2. Inspect server logs.
3. Confirm customer/order fields appear in plaintext log output.

Recommended fix:
- Minimal safe fix:
  - Remove or redact payload logging.
- Long-term fix:
  - Adopt structured redacted logging with stable IDs only.
- DB migration/index/RLS change if needed:
  - No.
- Risk of the fix:
  - Low.

Confidence:
High

[P2] Repo migration baseline is internally inconsistent on RLS hardening

Area:
Security

Status:
Architecture risk

Evidence:
- File(s): `supabase/migrations/000_zelochat_schema.sql`, `supabase/migrations/014_zelochat_rls_hardening.sql`
- Function/component/route: migration baseline
- Relevant behavior:
  - `supabase/migrations/014_zelochat_rls_hardening.sql:5-6` marks hardening as draft/not yet applied.
  - That file contains missing policies for `zelochat_pending_orders`, `zelochat_messages`, `zelochat_escalation_events`, and `zelochat_sessions`.
  - The repo snapshot and the “draft hardening” file therefore disagree on what the authoritative secure baseline is.
- Why the evidence supports the finding:
  - A reset/bootstrap flow that trusts the snapshot alone may not land on the intended hardened state.

Why this matters:
- Technical impact:
  - Fresh environments can come up weaker than expected.
- Business impact:
  - Security assumptions become environment-dependent.
- Heavy-user impact:
  - Not volume-specific, but dangerous during disaster recovery or new environment creation.
- Customer/support impact:
  - Makes incident response and environment verification harder.

How to reproduce or validate:
1. Compare `000_zelochat_schema.sql` with `014_zelochat_rls_hardening.sql`.
2. Note the hardening file is still marked draft.
3. Confirm the repo has two competing stories for the intended secure baseline.

Recommended fix:
- Minimal safe fix:
  - Reconcile the snapshot and hardening migrations into one authoritative repo state.
- Long-term fix:
  - Treat snapshot capture and incremental migrations as one maintained baseline with no stale “draft” security files.
- DB migration/index/RLS change if needed:
  - Yes; repo baseline cleanup and confirmation of live-policy state.
- Risk of the fix:
  - Medium; must not accidentally regress live policy state while cleaning up migration history.

Confidence:
High

## Hypotheses
- `zelochat-media` is public-by-URL and therefore any leaked URL is readable without auth. Confirmed partially from repo, but public exposure surface depends on actual URL leakage patterns and live storage state.
- Legacy enumerable instance names may still exist in production. This materially changes webhook-auth risk, but live DB state was not available in this audit.

## Recommended Security Implementation Order
1. Fix `zelochat_session_tags` tenant consistency in code and DB.
2. Add a real verifiable auth boundary in front of `/webhook/:instance`.
3. Remove plaintext payload logging from AI/order paths.
4. Reconcile migration baseline and verify live RLS state.
