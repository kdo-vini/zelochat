# Conversation ordering wire contract — v1

This folder is the recorded, code-generated truth of the HTTP/JSON contract
between ZeloMenu (authority, this repo) and ZeloChat (consumer). It exists
because the two repos were built against private test doubles that silently
diverged — see `ultra-review-contract.md` in the ZeloChat worktree's
`.superpowers/sdd/2026-09-03-handoff/` for the full audit of what that drift
cost in production.

**Rule: the ZeloChat consumer copies this folder verbatim into
`tests/fixtures/zelomenu-wire/v1/` and asserts its own request/response
handling against these exact files. Never hand-edit a copy on the consumer
side — regenerate here and re-copy.**

## Files

- `snapshot.partial-montavel.json` — a "Monte Sua Massa"-style cart mid-way
  through configuration: line 1 has its massa (`variacao`) group already
  satisfied, its molho (`adicional`, required) group missing (blocking), its
  acompanhamentos group partially chosen (non-blocking, `até 2`), and its
  paid `adicional` group untouched (non-blocking); line 2 has nothing chosen
  at all, so it additionally surfaces a blocking `variacao`/size requirement.
  Fulfillment and payment are both unset (`fulfillment.type: null`,
  `payment.declaredMethod: null`).
- `snapshot.ready.json` — the same shape completed: delivery with address and
  fee, payment Pix, `readyForConfirmation: true`, `confirmationAction` present
  with a real-looking (HMAC-shaped, 43-char base64url) `confirmationToken`,
  and `revision > 1` (it took an update after the initial open to get ready).
- `snapshot.confirmed.json` — the ready order after a successful
  `confirm_draft`. Auto-accept is intentionally disabled in the fixture
  generator so this freezes at `state: 'confirmed_waiting_review'`, the state
  a restaurant operator actually sees before acting on the order — not every
  order reaches `'accepted'` immediately. Closed snapshots always carry
  `readyForConfirmation: false`.
- `snapshot.cancelled.json` — a fresh cart cancelled via `cancel_draft`, also
  with `readyForConfirmation: false`.
- `snapshot.review-required.json` — a ready order whose delivery fee changed
  between the summary and the confirm click: `confirm_draft` returns
  `requires_review` instead of `confirmed`, so the order stays
  `state: 'cart_open'` with `requiresReview: true` and
  `fulfillment.deliveryFeeToConfirm: true`. `confirmationAction` is `null`
  because a fee-to-confirm order can never be `readyForConfirmation`.
- `requirement-types.json` — the exhaustive list of `OrderingRequirement`
  `type` values (and, for `modifier_group`, `kind` values), each with its
  field list. Generated from `server/conversationOrderingWireContract.ts`,
  which uses `satisfies Record<OrderingRequirement['type'], …>` against the
  real union in `server/conversationOrderRequirements.ts` — adding or
  removing a requirement type fails that file's typecheck until this catalog
  is updated.
- `errors.json` — every `error` code the internal ordering surface (router +
  domain + Supabase-RPC adapter) can return, with its HTTP status. Statuses
  are verified live against `createInternalOrderingRouter` in
  `server/conversationOrderingWireFixtures.test.ts` (except the three
  transport-level codes sourced from `server/index.ts`). Two codes are worth
  reading closely before wiring consumer error handling:
  - `PEDIDO_INDISPONIVEL` is returned at **both** 400 (thrown as a domain
    `ConversationOrderingError`, e.g. a materialization failure) and 500 (an
    unexpected/non-domain exception reaches the router's catch-all) — same
    code string, different status, depending on the failure path.
  - `CONFIRMACAO_INDISPONIVEL` is a service-availability fault (missing RPC
    or missing token secret) but is returned as 400, not 503/500, because it
    is absent from the 409 allowlist in `sendOrderingError`. Recorded as-is;
    changing that mapping is out of scope for this fixture.
- `commands.accepted.json` — command bodies the parser (`parseInternalOrderingCommand`
  in `server/internalOrdering.ts`) accepts: items carrying `lineId`,
  per-group/option selections with quantity, notes, `removedLineIds`,
  fulfillment `pickup`/`delivery` (there is **no** `'scheduled'` enum value —
  scheduling is `asap: false` + `pickupDate`/`pickupTime` on either type),
  `paymentMethod`, the `conversationControlId` + `conversationEpoch` permit
  (epoch is always a decimal **string**, never a number), `messageId`,
  `confirm_draft` with `confirmationToken`, and `cancel_draft`.
- `commands.rejected.json` — command bodies the parser rejects, taken
  directly from the real-wrong shapes the ZeloChat consumer has sent in
  production (see `ultra-review-contract.md`): echoed `deliveryFee`/
  `deliveryFeeToConfirm`, `fulfillment.type: null`, an invalid fulfillment
  enum, an item without `lineId`, an item echoing priced fields,
  `conversationEpoch` sent as a `number` instead of a decimal string, and
  `confirm_draft` with no `confirmationToken` (mandatory since ZM1 step 3 —
  text "sim" and button taps both reuse the token already visible to them
  via `confirmationAction`). Every entry here always maps to HTTP 400
  `COMANDO_INVALIDO` with `detail` equal to `expectedError.message`.

## How to regenerate

```bash
npx tsx scripts/generateConversationOrderingWireFixtures.ts
npm test -- conversationOrderingWireFixtures
```

The test fails loudly if the generated content differs from what is
committed here — that is intentional drift detection. Regenerate, review the
diff like any other code change, and commit both the source change and the
regenerated JSON together.

## Synthetic persistence values

The recorder executes the real materializer and the real
`SupabaseConversationOrderingAdapter`, including its scoped reads and row
mapping. With database access intentionally unavailable, only the persistence
boundary is synthetic: session/ordering/order UUIDs, database timestamps, the
canonical order's initial `pending_review` status, and the confirm-time
delivery-change RPC outcome are deterministic stand-ins for values normally
created by PostgreSQL. The fake returns the exact snake_case row shape consumed
by the production adapter. Catalog pricing, requirements, readiness, delivery
snapshot shaping, and the customer phone derived from `remoteJid` all come from
production functions rather than fixture-specific calculations.
