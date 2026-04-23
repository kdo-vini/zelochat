# Code Review — ZeloChat

Reviewed: `src/App.tsx`, `src/services/openaiService.ts`, `src/components/views/*`, `src/types.ts`, `src/constants.ts`, `server/{index,router,messageHandler,ai,whatsapp,ws}.ts`.

Verdict up front: the server side (Baileys + Express + WS) is reasonable for an early prototype. The frontend is riddled with AI slop — two parallel architectures coexisting (one real, one aspirational), a critical API-key leak, and duplicated AI logic between client and server. Do **not** ship to production in current state.

---

## Critical

- **`src/services/openaiService.ts:4-7` + `vite.config.ts:10`** — **OpenAI API key is bundled into the browser.** `vite.config.ts` injects `process.env.OPENAI_API_KEY` via `define`, and `openaiService.ts` instantiates `new OpenAI({ apiKey: ..., dangerouslyAllowBrowser: true })`. Every visitor who opens DevTools can read the key and drain your OpenAI credit. The server already has a proper `server/ai.ts` wrapping OpenAI — the frontend must call that via HTTP. **Fix:** delete `openaiService.ts` entirely, remove the `define` block from `vite.config.ts`, and add server routes (`POST /api/ai/client-reply`, `/api/ai/owner-context`, `/api/ai/manager-chat`) that the frontend calls with `fetch`. The existing `/api/ai/reply` route in `server/router.ts` is a good template.

- **`server/router.ts:51-73` (POST /api/send)** — **No authentication, no rate limiting, no input validation.** Anyone on the same network (or internet, if exposed) can POST arbitrary messages to arbitrary WhatsApp JIDs using the connected account. This is a textbook spam-cannon / account-ban scenario. `jid` is not validated (format, ownership), `message` has no length cap, and the server also has `app.use(express.json())` with the default 100 KB limit but no other guards. **Fix:** add auth middleware (even a shared bearer token from `.env` is better than nothing for now), validate `jid` matches `/^\d{10,15}@s\.whatsapp\.net$/`, cap message length (e.g. 4096 chars), and add `express-rate-limit` on `/api/send` and `/api/ai/reply`.

- **`server/index.ts:12` — no CORS middleware at all.** Browsers will block cross-origin requests by default, but when you eventually expose this server anywhere other than `localhost`, any page the operator visits can post to these endpoints with cookies/credentials. Combined with the no-auth issue above, that's CSRF on send-WhatsApp-message. **Fix:** add `cors({ origin: process.env.ALLOWED_ORIGIN, credentials: false })` explicitly — do not use the default wide-open `cors()`.

- **`src/App.tsx:56-59` — stale-state closure in `triggerAIReply`.** The comment in the code literally says "it's okay to just use the `state` from closure here if it's well updated." It isn't. `triggerAIReply` is called from `simulateCustomerMessage` one tick after `setState`, so `state.sessions` inside this function does **not** contain the user message just added. The AI therefore sees a history missing the message it is replying to. **Fix:** either pass the updated history in as a parameter from the caller, or use a `useRef` mirror (`stateRef.current`) kept in sync via `useEffect`. Current "it's probably fine" reasoning is exactly the kind of bug that blows up in prod.

- **`src/App.tsx:75, 135, 163` — non-unique message IDs.** `id: Date.now().toString()` collides when two messages fire in the same millisecond (e.g. user send + AI reply queued in quick succession). In `AIConfigsView.tsx:34,49` the user and assistant messages in `managerHistory` both use `Date.now().toString()` and can collide, producing React key warnings and broken AnimatePresence. **Fix:** use `crypto.randomUUID()` (already works in all modern browsers) or the `makeId()` helper that already exists in `server/messageHandler.ts:62` — port it to the frontend.

- **`src/components/views/AIConfigsView.tsx:55-60` — unvalidated AI-generated state mutation.** `result.actions` comes straight from the LLM and is spread into `blockedDates` without validating shape (`action.payload.date`, `action.payload.reason`). A malformed response (missing fields, wrong types) will silently corrupt state and all downstream date logic. This is also a prompt-injection vector: a customer message reflected into context could coerce the model to emit a `BLOCK_DATE` action. **Fix:** validate each action's payload against a schema (zod or a manual shape-check) and ignore malformed ones. Also: `BLOCK_DATE` should only be produced by the **manager** chat, not anywhere customer input can influence.

---

## High

- **Two parallel architectures — one real, one ghost.** `CLAUDE.md` describes `src/agents/`, `src/domain/`, `src/orchestration/`, `src/state/` with strict rules ("Agents are pure functions", "orchestration is the only place that combines AI + state mutations"). None of that is wired up. `App.tsx` imports from `./types` and `./constants` (flat files), and calls `./services/openaiService` directly — ignoring the entire `src/agents/`, `src/domain/`, `src/orchestration/`, `src/state/`, `src/constants/`, `src/types/` trees. Either delete the unused folders (grep shows no production imports) or migrate App.tsx onto them. Keeping both is guaranteed to produce drift and wasted agent cycles. **Recommendation:** commit to one. Given the small surface area, deleting the unused folders is faster; the "agents/orchestration" abstraction is over-engineering for a demo that has a single reducer's worth of logic.

- **Duplicated & divergent AI prompts.** `src/services/openaiService.ts:33-53` (frontend) and `server/ai.ts:23-45` (server) both build a "Casa dos Salgados" system prompt, and they already disagree: the server hardcodes menu/hours and ignores `state.businessInfo`, `blockedDates`, `dailyContext`, `alertTriggers`. The `TODO` on `server/ai.ts:22` acknowledges this. Once the frontend stops calling OpenAI directly (see Critical #1), the server prompt becomes the single source of truth — but it needs the state. **Fix:** frontend `POST /api/ai/client-reply` with `{ jid, state }` body, server builds the prompt from the posted state.

- **`server/index.ts:20-39` + `server/ai.ts:50-88` — race/duplicate-reply bug.** `onIncomingMessage` fires `handleIncomingMessage` synchronously, then schedules an AI reply via `setTimeout(1500ms)`. If two messages arrive within that window (very common — customers send "oi" then their actual question), two parallel `generateAndSendReply` calls run, each sees the same or a partial history, and the customer gets two overlapping AI responses on WhatsApp. **Fix:** per-jid debounce — keep a `Map<jid, NodeJS.Timeout>`, clear it on each new inbound, only fire after the debounce settles. Also consider a per-jid `inFlight` lock to prevent overlap.

- **`server/whatsapp.ts:99-102` — recursive reconnect without backoff.** On `connection === 'close'` with `shouldReconnect`, it calls `startWhatsApp()` recursively. No exponential backoff, no attempt counter. A persistent error (invalid creds, rate-limit, WhatsApp-side ban) produces a tight reconnect loop that will hammer the WA servers and likely get you banned faster. **Fix:** add exponential backoff (1s → 2s → 4s → max 60s) and a max-retries circuit breaker. Also: the recursion means old `sock.ev` listeners may stack — you should `sock?.end()` / null out before starting fresh.

- **`server/messageHandler.ts:27` — entire session store is in-memory.** `const sessions = new Map<...>()`. Every server restart wipes conversation history, auto-reply preferences, everything. The WhatsApp creds in `auth_info_baileys/` survive, so the account stays connected, but the AI's memory of every ongoing customer conversation is gone. For a tool whose job is customer service continuity, this is a data-loss bug waiting to happen. **Fix:** at minimum, persist to a JSON file on every mutation (cheap). Better: the Supabase migration mentioned in `CLAUDE.md` brainstorming.

- **`src/components/views/SettingsView.tsx:13-14` — hardcoded `localhost:3001` URLs.** `API_BASE = http://${window.location.hostname}:3001` and `WS_URL = ws://...:3001/ws`. Breaks the moment you deploy behind HTTPS or a reverse proxy. The `vite.config.ts` already proxies `/api` to port 3001 — use relative URLs: `fetch('/api/status')` and `new WebSocket(\`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws\`)`. Also requires the backend proxy to support WS upgrade (Vite does).

- **`src/hooks/useWhatsApp.ts` — unused hook.** Not imported anywhere (grep confirms); `SettingsView.tsx` re-implements the exact same WebSocket+REST logic inline at lines 5-69. This is classic AI-generated dead code. **Fix:** either use the hook in SettingsView, or delete it.

- **`src/constants/` and `src/types/` directories — unused duplicates.** `App.tsx` and all views import from `src/types.ts` and `src/constants.ts` (flat files). The `src/types/` and `src/constants/` folders exist with their own `index.ts` but nothing imports them. Delete or migrate. Same for `src/agents/`, `src/domain/`, `src/orchestration/`, `src/state/`, `src/services/geminiService.ts` (the latter is referenced in CLAUDE.md but does not exist in the repo — another slop artifact).

- **`@google/genai` dependency in `package.json`.** Not imported anywhere in the reviewed files. Adds ~MB to `node_modules` with no purpose. Remove.

- **`src/services/openaiService.ts:105` — fragile JSON extraction.** `text.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim()` then `JSON.parse`. Falls over on nested code fences, explanatory prose before/after JSON, etc. `getGeneralManagerResponse` at line 154 does this correctly via `response_format: { type: "json_object" }`. **Fix:** apply the same response_format to `getOwnerResponse`.

- **`src/App.tsx:89` — unreadCount logic reads stale `activeSessionId`.** Inside `setState`, `activeSessionId` is read from closure. If the user switches chats between the setTimeout firing and the state update resolving, the wrong session's unreadCount is preserved. Minor, but symptomatic of the pattern. **Fix:** functional updates only, or mirror `activeSessionId` in a ref.

- **`server/router.ts:52` — body destructured without type guards.** `const { to, message } = req.body`. If `to` is not a string (object, array, null), `sock.sendMessage` will fail in ways Baileys doesn't always handle gracefully. Add `typeof to === 'string'` checks.

---

## Medium

- **`openaiService.ts:56`, `145` and `server/ai.ts:61` — `messages: any[]` abuse.** OpenAI's SDK exports `ChatCompletionMessageParam`. Use it. The `any` exists purely to avoid one import.

- **`src/App.tsx:37, 25 (constants.ts:25)` — dates hardcoded to `'2026-04-23'`.** DashboardView "Pedidos Hoje" filters by this exact string. The moment the date changes, the dashboard reads zero. **Fix:** `format(new Date(), 'yyyy-MM-dd')`.

- **`src/App.tsx:64-72` — alert extraction is fragile.** Regex `<ALERT>(.*?)<\/ALERT>` assumes the model cooperates. If the model wraps output in markdown, adds whitespace, or uses Unicode look-alike tags, alerts silently drop. If it mis-emits overlapping tags, they leak into user-visible output. **Fix:** move alert detection server-side where you can also log misbehaviour, and use `response_format: "json_object"` with an `alerts: string[]` field instead of inline markup.

- **`src/App.tsx:34` — `INITIAL_STATE.sessions[0].id` assumed to exist.** If `sessions` is ever empty, this throws at render. Cheap fix: `INITIAL_STATE.sessions[0]?.id ?? ''`.

- **`src/App.tsx:298` — `activeSession` can be undefined** if `sessions` is empty (fallback `|| state.sessions[0]` is itself undefined in that case). The `.customerName` access on line 298 will throw. Guard with an empty-state view.

- **`src/components/views/KanbanView.tsx:33-79` — `<React.Fragment>` wrapping a single `<Draggable>`.** Does nothing. Remove.

- **`src/components/views/AIConfigsView.tsx:296` — `defaultValue={state.aiInstructions}`** on a controlled-ish textarea. Using `defaultValue` with an `onChange` that updates state creates an uncontrolled-then-edited component; edits to `state.aiInstructions` from elsewhere will NOT re-render the textarea. Use `value={state.aiInstructions}`.

- **`src/components/views/AIConfigsView.tsx:121, 244` — a rotated `<Plus>` icon used as an "X / delete" button.** Confusing to read at a glance; lucide-react has `<X>`. Also the "add driver/macro" Plus and the "delete" rotated-Plus look identical in a screenshot.

- **`src/components/views/DriversView.tsx:28` — `wa.me` link opened with `window.open`.** Pop-up blockers on some browsers will silently swallow this when called inside a `<select onChange>` handler (not a direct click). Move the WhatsApp link to a button.

- **`src/components/views/ProfileView.tsx:65` — "Encerrar Sessão" only wipes `localStorage.removeItem('zelochat_state')`.** But the app doesn't persist state to localStorage anywhere. Cosmetic logout. Either implement persistence or remove the button.

- **`src/components/views/SettingsView.tsx:296` — "Criptografia de ponta a ponta conforme o padrão WhatsApp"** displayed in the Security card. The app stores plaintext messages in server memory and exposes an unauthenticated JSON export of all state (`line 299-307`). That claim is misleading to operators.

- **`server/messageHandler.ts:132` — `unreadCount += 1` has no "mark as read" counterpart exposed.** Only `setAutoReply` exists. Front-end will perpetually show growing unread badges. Add `markRead(jid)`.

- **`server/messageHandler.ts:41-55` — `formatPhone` assumes Brazilian numbers.** Falls through to the raw JID number for anything else. Fine for now, but worth a comment.

- **`server/whatsapp.ts:60-68` — `makeWASocket` with no `browser` or `printQRInTerminal` options.** Recent Baileys versions need explicit `browser` config to avoid some pairing quirks. Low priority but worth testing on a fresh device.

- **`server/ws.ts:16-19` — no per-client ping/heartbeat.** Long-idle WS clients behind NAT/proxies will disconnect silently. Frontend reconnects every 5s in `SettingsView.tsx:54`, so impact is bounded, but server-side heartbeat (`ws` library supports `pingTimeout`) would be cleaner.

- **`src/types.ts:14` — `messages: ChatMessage[]` inside session; `dailyContext: { id, text }[]` / `alertTriggers: { id, name, active }[]` inline.** Inline object types are fine until you need to import them elsewhere. You already have `src/types/` folder with separate files — ironic.

- **`src/constants.ts:102` — the `aiInstructions` string literal starts with "Você é o assistente virtual da lanchonete ZeloChat"** while `openaiService.ts:34` also hardcodes "${state.businessInfo.name}" in an outer template. When the operator edits the business name in Settings, the prompt shows the new name in the header but the `aiInstructions` body still says "ZeloChat". Minor prompt confusion.

- **`src/App.tsx` is 427 lines and holds all chat UI + owner input + side nav.** The chat pane alone is ~130 lines of JSX. Extract `<ChatView />` into `src/components/views/ChatView.tsx` for parity with the other views. This is the biggest easy win for maintainability.

- **No `React.ErrorBoundary` anywhere.** A single broken view crashes the whole app. Wrap the `{activeView === '...' && <View ... />}` block in `App.tsx:386` in an ErrorBoundary with a reload button.

- **`tsconfig.json` not reviewed in depth**, but scan of the files shows no use of strict `unknown` in catch blocks, `any` in `messages` arrays, and `error: any` in `server/router.ts:69`. Tighten once the above is addressed.

---

## Summary

Overall quality: prototype-grade with serious production blockers. The server-side architecture (Express + Baileys + WS broadcast) is decent for an MVP — clear file boundaries, reasonable separation of concerns. The frontend is the problem: `App.tsx` ignores the elaborate `agents/domain/orchestration/state` architecture its own CLAUDE.md mandates, and a parallel AI service file leaks the OpenAI key into every browser that loads the page.

Biggest risk, by a wide margin: **OpenAI API key in the browser bundle** (`src/services/openaiService.ts` + `vite.config.ts` define block). Anyone hitting the deployed site can exfiltrate it. This is a "fix today, not this week" issue.

Top 3 to fix first, in order:
1. **Kill client-side OpenAI.** Delete `openaiService.ts`, remove `define` from `vite.config.ts`, route all three AI agents through new server endpoints. Server-side prompt needs the posted state to replace the hardcoded Casa dos Salgados data in `server/ai.ts`.
2. **Lock down the server.** Add shared-secret auth + rate limiting on `/api/send` and `/api/ai/reply`, explicit CORS allowlist, and `jid` format validation. Right now the server is an open WhatsApp spam relay.
3. **Collapse the two architectures.** Either delete the unused `src/{agents,domain,orchestration,state,constants,types}/` trees, or migrate onto them. Update CLAUDE.md to match reality. While you're there: extract `<ChatView />` from `App.tsx`, fix the stale-closure bug in `triggerAIReply`, and replace `Date.now()` message IDs with `crypto.randomUUID()`.

Files touched in this review (all absolute):
- `C:\Users\Vinicius\Desktop\Code\zelochat\zelochat\src\App.tsx`
- `C:\Users\Vinicius\Desktop\Code\zelochat\zelochat\src\services\openaiService.ts`
- `C:\Users\Vinicius\Desktop\Code\zelochat\zelochat\src\components\views\AIConfigsView.tsx`
- `C:\Users\Vinicius\Desktop\Code\zelochat\zelochat\src\components\views\SettingsView.tsx`
- `C:\Users\Vinicius\Desktop\Code\zelochat\zelochat\src\components\views\KanbanView.tsx`
- `C:\Users\Vinicius\Desktop\Code\zelochat\zelochat\src\components\views\CalendarView.tsx`
- `C:\Users\Vinicius\Desktop\Code\zelochat\zelochat\src\components\views\DashboardView.tsx`
- `C:\Users\Vinicius\Desktop\Code\zelochat\zelochat\src\components\views\DriversView.tsx`
- `C:\Users\Vinicius\Desktop\Code\zelochat\zelochat\src\components\views\ProfileView.tsx`
- `C:\Users\Vinicius\Desktop\Code\zelochat\zelochat\src\types.ts`
- `C:\Users\Vinicius\Desktop\Code\zelochat\zelochat\src\constants.ts`
- `C:\Users\Vinicius\Desktop\Code\zelochat\zelochat\server\index.ts`
- `C:\Users\Vinicius\Desktop\Code\zelochat\zelochat\server\router.ts`
- `C:\Users\Vinicius\Desktop\Code\zelochat\zelochat\server\messageHandler.ts`
- `C:\Users\Vinicius\Desktop\Code\zelochat\zelochat\server\ai.ts`
- `C:\Users\Vinicius\Desktop\Code\zelochat\zelochat\server\whatsapp.ts`
- `C:\Users\Vinicius\Desktop\Code\zelochat\zelochat\server\ws.ts`
- `C:\Users\Vinicius\Desktop\Code\zelochat\zelochat\vite.config.ts`
- `C:\Users\Vinicius\Desktop\Code\zelochat\zelochat\package.json`
