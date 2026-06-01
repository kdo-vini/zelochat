# ZeloChat UX Audit

> Ver também: [[CODE_REVIEW]] · [[FIXES_PROGRESS]] · [[ZeloChat.audit-report]] · [[ZeloChat.audit-performance]]

## Executive Summary
- The chat UI already has meaningful quality work:
  - virtualized session list after 80 rows
  - escalation banner and SLA timer
  - attachment preview
  - manual/AI toggle visible in the header
- The main UX/runtime risks are not aesthetics. They are operator-trust issues:
  - old messages are not loadable in the main UI even though backend support exists
  - message delivery/read ticks never advance in realtime
  - some cross-tab actions do not fan out
  - scroll behavior jumps to bottom on any message update
  - loading states are minimal and mostly text-only

## Confirmed Findings

[P1] The chat detail screen exposes only the newest 50 messages

Area:
UX

Status:
Confirmed risk

Evidence:
- File(s): `src/services/waApi.ts`, `src/hooks/useWhatsAppSessions.ts`, `src/components/views/ChatView.tsx`, `server/router.ts`
- Function/component/route:
  - `getSession()`
  - `getOlderMessages()`
  - `hydrateSession()`
  - `GET /api/sessions/:jid/messages`
- Relevant behavior:
  - `src/services/waApi.ts:102-123` exposes both first-page and older-message APIs.
  - `src/hooks/useWhatsAppSessions.ts:216-245` hydrates only the first page.
  - Current-head search found `getOlderMessages()` unused outside `src/services/waApi.ts`.
- Why the evidence supports the finding:
  - Operators cannot access older context from the main chat flow even though the backend already supports it.

Why this matters:
- Technical impact:
  - Thread context is artificially cut off.
- Business impact:
  - Operators can answer without critical prior details.
- Heavy-user impact:
  - Frequent repeat customers accumulate long histories quickly.
- Customer/support impact:
  - Retakes and clarifications become slower and more error-prone.

How to reproduce or validate:
1. Open a conversation with more than 50 messages.
2. Scroll upward in the current UI.
3. Confirm there is no wired older-history load path.

Recommended fix:
- Minimal safe fix:
  - Wire `getOlderMessages()` into a top-scroll loader.
- Long-term fix:
  - Virtualized infinite history with anchor preservation.
- DB migration/index/RLS change if needed:
  - No immediate DB change required.
- Risk of the fix:
  - Low to medium.

Confidence:
High

[P2] Delivery/read status updates are broadcast by the backend but ignored by the frontend

Area:
UX

Status:
Confirmed bug

Evidence:
- File(s): `server/router.ts`, `server/ws.ts`, `src/hooks/useWhatsAppSessions.ts`, `src/types.ts`, `src/components/views/MessageBubble.tsx`
- Function/component/route:
  - `messages.update` webhook branch
  - WebSocket event union/handler
  - message ticks in `MessageBubble`
- Relevant behavior:
  - `server/router.ts:552-581` broadcasts `message_status`.
  - `server/ws.ts:5-21` defines `message_status` as a typed event.
  - `src/hooks/useWhatsAppSessions.ts:619-620` ignores unknown event types after explicit branches; there is no `message_status` branch.
  - `src/types.ts:244` only models message status values and `MessageBubble` can render them, but the client never updates them from the realtime event.
- Why the evidence supports the finding:
  - The backend sends delivery/read updates, but the frontend never consumes them.

Why this matters:
- Technical impact:
  - Outbound message status stays stale in the UI.
- Business impact:
  - Operators lose confidence about whether customers actually received or read a reply.
- Heavy-user impact:
  - More concurrent chats mean more reliance on accurate delivery signals.
- Customer/support impact:
  - Increases unnecessary resend behavior and confusion.

How to reproduce or validate:
1. Send a manual outbound message.
2. Wait for WhatsApp delivery/read receipt webhook.
3. Confirm the bubble ticks never update in the UI.

Recommended fix:
- Minimal safe fix:
  - Handle `message_status` in `useWhatsAppSessions` and map WhatsApp status to local `MessageStatus`.
- Long-term fix:
  - Persist outbound lifecycle more explicitly and surface failed/pending states too.
- DB migration/index/RLS change if needed:
  - Not required for the first step.
- Risk of the fix:
  - Low.

Confidence:
High

[P2] Chat view auto-scrolls to the bottom on any message update

Area:
UX

Status:
Confirmed risk

Evidence:
- File(s): `src/components/views/ChatView.tsx`
- Function/component/route: message-scroll effect
- Relevant behavior:
  - `src/components/views/ChatView.tsx:1027-1029` calls `scrollTo(0, scrollHeight)` whenever `activeSessionId` or `activeSessionMessages` changes.
- Why the evidence supports the finding:
  - Any message append, transcript update, or future older-message merge will snap the operator back to the bottom.

Why this matters:
- Technical impact:
  - Scroll anchor is not preserved.
- Business impact:
  - Reviewing earlier context during a live conversation becomes frustrating.
- Heavy-user impact:
  - More frequent realtime updates mean more jumps.
- Customer/support impact:
  - Operators can lose their place while investigating a conversation.

How to reproduce or validate:
1. Open a conversation and scroll upward.
2. Let a new message or transcript update arrive.
3. Confirm the view jumps back to the bottom.

Recommended fix:
- Minimal safe fix:
  - Auto-scroll only when the operator is already near the bottom.
- Long-term fix:
  - Preserve scroll anchors and add explicit “jump to latest” behavior.
- DB migration/index/RLS change if needed:
  - No.
- Risk of the fix:
  - Low.

Confidence:
High

[P2] Session delete does not fan out to other tabs

Area:
UX

Status:
Confirmed risk

Evidence:
- File(s): `server/messageHandler.ts`, `src/hooks/useWhatsAppSessions.ts`, `server/ws.ts`
- Function/component/route:
  - `deleteSession()`
  - local delete handling in hook
- Relevant behavior:
  - `server/messageHandler.ts:1620-1645` deletes rows but does not broadcast a `session_deleted` event.
  - `src/hooks/useWhatsAppSessions.ts:288-295` removes the session only in the tab that initiated delete.
  - `server/ws.ts:5-21` has no `session_deleted` event type.
- Why the evidence supports the finding:
  - Other tabs remain stale until refresh.

Why this matters:
- Technical impact:
  - Cross-tab state divergence.
- Business impact:
  - Attendants may keep working from a deleted conversation.
- Heavy-user impact:
  - More tabs/attendants make the inconsistency more visible.
- Customer/support impact:
  - Creates “I still see it here” confusion.

How to reproduce or validate:
1. Open the same inbox in two tabs.
2. Delete a conversation in tab A.
3. Confirm it remains visible in tab B until refresh.

Recommended fix:
- Minimal safe fix:
  - Add a dedicated `session_deleted` WebSocket event.
- Long-term fix:
  - Complete the cross-tab conversation-state contract for all destructive actions.
- DB migration/index/RLS change if needed:
  - No.
- Risk of the fix:
  - Low.

Confidence:
High

[P2] Realtime delete events can miss multi-JID family views

Area:
UX

Status:
Confirmed risk

Evidence:
- File(s): `server/messageHandler.ts`, `src/hooks/useWhatsAppSessions.ts`
- Function/component/route:
  - `deleteMessageByWhatsAppId()`
  - `message_deleted` handling
- Relevant behavior:
  - `server/messageHandler.ts:1123-1133` broadcasts `message_deleted` using `family.latest.remote_jid`.
  - `src/hooks/useWhatsAppSessions.ts:589-595` applies the deletion only when `session.id === data.sessionId`.
- Why the evidence supports the finding:
  - In multi-JID families, the broadcast key can differ from the JID cached by another tab/view.

Why this matters:
- Technical impact:
  - Deleted messages can remain visible in some family views.
- Business impact:
  - Operators may act on stale content.
- Heavy-user impact:
  - More multi-JID families mean more inconsistent views.
- Customer/support impact:
  - Undermines trust in delete-for-everyone behavior.

How to reproduce or validate:
1. Create a phone-family with multiple `remote_jid` rows.
2. Delete a message while one UI copy is keyed to another JID in the family.
3. Confirm the deletion event is ignored in that UI until rehydrate.

Recommended fix:
- Minimal safe fix:
  - Emit delete events using the same stable key the UI uses for the active family.
- Long-term fix:
  - Introduce a canonical conversation-family ID.
- DB migration/index/RLS change if needed:
  - Likely if a family entity is introduced.
- Risk of the fix:
  - Medium.

Confidence:
High

[P3] Loading states are functional but minimal; skeleton coverage is low

Area:
UX

Status:
Product suggestion

Evidence:
- File(s): `src/components/views/ChatView.tsx`, `src/components/views/DashboardView.tsx`
- Function/component/route: loading states
- Relevant behavior:
  - `src/components/views/ChatView.tsx:1566-1568` renders text-only “Carregando conversas…”.
  - `src/components/views/DashboardView.tsx:223-229` renders a spinner section for overview load.
- Why the evidence supports the finding:
  - The product loads functionally, but most major surfaces rely on text/spinner states rather than shape-preserving skeletons.

Why this matters:
- Technical impact:
  - No technical correctness issue.
- Business impact:
  - Lower perceived polish and more layout shift during slow connections.
- Heavy-user impact:
  - Slow notebooks and slow networks feel rougher.
- Customer/support impact:
  - Operators may interpret slow load as broken load.

How to reproduce or validate:
1. Throttle network.
2. Open chat and dashboard.
3. Observe text/spinner states rather than skeleton placeholders.

Recommended fix:
- Minimal safe fix:
  - Add skeletons to inbox rows and dashboard cards.
- Long-term fix:
  - Create a shared loading-state system for operator workflows.
- DB migration/index/RLS change if needed:
  - No.
- Risk of the fix:
  - Low.

Confidence:
High

## Positive UX Notes
- Session list virtualization is already present after 80 rows.
- Escalation state is visually obvious in both list and details panel.
- The AI/manual toggle is visible in the chat header.
- Message bubbles already support audio transcript status and attachment previews.
