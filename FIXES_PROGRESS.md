# ZeloChat — Fixes Progress Tracker

**Source review:** [[CODE_REVIEW]] — 6-agent senior audit, 24 P0 / 47 P1 / 38 P2 / 24 P3.
**Customer status:** 1 paying tenant (R$3k contract, Casa dos Salgados). 1 founder test (Donutopia).

**Latest execution note (2026-06-08 Sprint 67):** Configurar a agenda da IA virou um wizard de 4 passos + edição por linguagem natural ("muda quarta pra 24h" / "bloqueia 25/12 Natal"). Datas bloqueadas agora forçam IA ligada 24h (resolvendo o gap em que cliente ficava sem resposta no feriado quando o schedule semanal silenciava o horário). Backend `POST /api/ai/schedule-parse` cobre schedule + blocked_dates; nunca persiste sem confirmação humana.

**Latest hotfix note (2026-06-11 Sprint 68):** Bundle renovado via AbacatePay no ZeloPDV não pode perder acesso no ZeloChat por causa de `manually_extended_until` vencido. A expiração efetiva agora usa o timestamp mais longo entre `current_period_end` e `manually_extended_until` no backend, frontend e sweeper; o caso real da Casa dos Salgados foi destravado com hotfix na row compartilhada `subscriptions`.

## 📊 Status atual (2026-05-01 Sprint 46)

| Tier | Total | Closed | Pending | Deferred | % |
|---|---|---|---|---|---|
| **P0** | 24 | **24** | 0 | 0 | **100% ✅** |
| **P1** | 47 | **44** | 0 | 3 | **94% ✅** |
| **P2** | 38 | 24 | 14 | 0 | 63% |
| **P3** | 24 | 5 | 19 | 0 | 21% |

**P1 status:** todos os P1 acionáveis estão fechados. Restam apenas 3 deferred para quando sair do single-node backend: P1.16, P1.17, P1.43.

**P2/P3 status:** a maioria dos P2 críticos de UX, segurança, áudio, billing e performance já foi fechada nas Sprints 21-27 e 39-43. Os P3 ainda são polimento/backlog leve.

**Próximo trabalho recomendado:** seguir o backlog ativo do [[AI_BACKEND_ROADMAP]], com a proxima fatia sugerida em audio, estados vazios e polimentos P2/P3.

Use this doc to know **at a glance** what's safe in production right now and what's still on fire. Each fix has a `Status`, the `Files touched`, and the `Risk` it eliminates. Fixes that need a prod migration are marked `BLOCKED — needs operator approval` until the user signs off on applying.

## P1s closed via cross-fix (verificados 2026-04-29 Sprint 18 close)

Não estão na lista de "shipped explicit" mas foram verificados como já resolvidos por outras correções:

| ID | Como foi closed | File hint |
|---|---|---|
| P1.1 | escalation update empresa-scoped via P0.22 fix | `escalation.ts:299, 337` |
| P1.11 | `broadcastLegacyLifecycleEvent` scoped via `getBoundEmpresaId()` (P0.2 narrowing) | `whatsapp.ts:25-30` |
| P1.25 | `syncFromStripe` filtra `['chat','bundle']` em existingRows | `billing.ts:219` |
| P1.26 | `createPortalSession` exige `provider_customer_id` (DB-rooted) | `billing.ts:362` |
| P1.27 | `idempotencyKey` cobre double-click + pre-record `incomplete` | `billing.ts:295,298` |
| P1.41 | `webhook_token` wired em `getEmpresaAndTokenForInstance` (dormant pelo bug Whatsmiau-side, código completo) | `instanceManager.ts:117-147`, `router.ts:436-510` |
| P1.42 | `zelochat_sessions_empresa_remote_unique` UNIQUE INDEX | `migration 000:99-100` |
| P1.44 | `zelochat_increment_unread` RPC | `migration 000:500` |

## P1s actively pending (0 — todos fechados)

| ID | Descrição | Risco | Sprint sugerido |
|---|---|---|---|
| ✅ P1.2 | `extractAttachmentDataUrl` confia em `mediaUrl` do payload — allowlist HTTPS + hostname | Médio (auth boundary) | Sprint 20 |
| ✅ P1.8 | Phone normalization landline (10 dig) vs mobile (11 dig) — normalize 11-digit com '9' | Baixo (UX) | Sprint 20 |
| P1.16 | `recordAiFailure` in-memory, multi-replica = sem escalação | Deferred | quando scale |
| P1.17 | `configStore` desync entre réplicas | Deferred | quando scale |
| ✅ P1.28 | `'trialing'` users locked out sem path claro — UI + backend guard | UX | Sprint 20 |
| ✅ P1.29 | `'paused'` status sem UI pra unpause — badge dinâmico + portal routing | UX | Sprint 20 |
| ✅ P1.37 | Paywall banner flicker on `subscriptionLoading=true` | Cosmético | Sprint 19 |
| ✅ P1.40 | Forms perdem state on session expiry — `useLocalDraft` hook + toast | Médio (complexo) | Sprint 20 |
| P1.43 | `getAllSessions` table scan (escala >2k sessions) | Deferred | quando scale |

---

## Legend

- ✅ **Shipped** — code merged in this branch, type-checks clean, no prod migration needed.
- 🟢 **partial** — fix shipped for the prospective surface; historical/legacy data still at risk. See per-row caveat.
- 🟡 **Drafted** — code or migration written but **not applied** to prod. Ready for review + apply.
- 🟥 **Blocked — operator approval** — fix touches shared infra (ZeloPDV) or needs a destructive prod migration.
- ⏳ **Pending** — not started yet.
- ❌ **Won't fix in this branch** — out of scope (e.g., touches ZeloPDV-owned tables).

---

## P0 — Ship-blocking fixes

| ID | Title | Status | Files | Notes |
|----|-------|--------|-------|-------|
| P0.1 | `/webhook/:instance` no caller authentication | ✅ via Plan D (URL-as-secret) | `server/router.ts:436`, `server/instanceManager.ts:165` | Header-based auth NOT VIABLE — Whatsmiau v2 accepts `headers.apikey` config but doesn't forward (Sprint 18 diagnostic confirmed). Pivoted to URL-as-secret: new instances use `zelo-{empresa8}-{16hex}` = 64 bits entropy. Legacy enumerable instances rotated in Sprint 18. Token-validation code kept dormant; if Whatsmiau ever fixes forwarding, `WEBHOOK_REQUIRE_TOKEN=1` becomes viable without code change (`auth_status` column is the canary). |
| P0.2 | `boundEmpresaId` singleton breaks 2nd tenant | ✅ | `server/supabase.ts:263`, `server/messageHandler.ts` (multiple), `server/ai.ts:903`, `server/whatsapp.ts:27` | All operational helpers now require `empresaId: string` — TypeScript enforces. Singleton narrowed to ONLY `broadcastLegacyLifecycleEvent` in whatsapp.ts which no-ops in multi-tenant (closes P1.11 fan-out leak too). |
| P0.3 | `getEmpresaForInstance` cache-fallback on DB error | ✅ | `server/instanceManager.ts:149` | Removed entirely (dead code after P0.1 migrated all callers to `getEmpresaAndTokenForInstance`, which fails closed). On Supabase blip, webhook returns 404 → Whatsmiau retries → recovered DB processes once (idempotent via wa_message_id from P0.14). |
| P0.4 | `/api/produtos` proxy unauthenticated | ✅ | `server/router.ts:1374` | `requireEmpresaId(req)` validates JWT locally before proxying upstream. Paywall middleware also gates it. |
| P0.5 | `zelochat-media` bucket public + enumerable filenames | ✅ | `server/supabase.ts:188`, `server/messageHandler.ts:198`, `server/router.ts:726`, `scripts/cleanup-orphan-media.ts` | NEW uploads scoped per-empresa with 128-bit random slug. Dry-run revealed only 4 historical files at old paths, ALL ORPHANS (not referenced in `zelochat_messages.content`). Cleanup script `scripts/cleanup-orphan-media.ts` lists the 4 explicit names and uses Storage API to delete (Supabase blocks direct DELETE FROM storage.objects). Run once via `npx tsx scripts/cleanup-orphan-media.ts`. |
| P0.6 | `empresa_perfil` UPDATE policy missing `WITH CHECK` | ✅ | `zeloPDV-Prod/.ai/migrations/empresa_perfil_update_with_check.sql` (local — PDV gitignora `.ai/`) | Migration aplicada em prod via MCP em 2026-04-29. Verificada: `qual = with_check = (auth.uid() = user_id)`. Fecha vetor de roubo de empresa via `UPDATE empresa_perfil SET user_id = …`. Aplicada do repo PDV (tabela é PDV-owned). |
| P0.7 | `zelochat_pending_orders` RLS on but no policies | ✅ | `supabase/migrations/014_zelochat_rls_hardening.sql` | Migration APPLIED em prod (version 20260429192428, verified 2026-04-30 via MCP). |
| P0.8 | `zelochat_messages` no UPDATE/DELETE; `zelochat_escalation_events` no INSERT/DELETE | ✅ | `supabase/migrations/014_zelochat_rls_hardening.sql` + `server/escalation.ts:293-340` | Migration APPLIED em prod (same as P0.7). Code-side `.eq('empresa_id')` already added (P1.1 closed). |
| P0.9 | Affirmative-text regex prematurely confirms orders | ✅ | `server/ai.ts:34, 786` | Whitelist exact-match w/ accent-strip + trailing punct. |
| P0.10 | Negative-text regex aggressively cancels orders | ✅ | `server/ai.ts:34, 787` | Same fix as P0.9. |
| P0.11 | `justConfirmedMap` in-memory only — duplicate orders after restart | ✅ | `server/ai.ts:35-66, 905-915` | DB fallback via `wasOrderRecentlyConfirmedInDb`. |
| P0.12 | Role CHECK widening migration not in source control | ✅ | `supabase/migrations/000_zelochat_schema.sql` | Verified live + captured. |
| P0.13 | Hard-button short-circuit re-fires idempotent reply on Whatsmiau retry | ✅ | `server/router.ts:177-188` | `prevHandledAt` retry detection at top of serialize block. |
| P0.14 | No idempotency on inbound webhook (`wa_message_id` UNIQUE missing) | ✅ | `supabase/migrations/015_wa_message_id_idempotency.sql` + `server/messageHandler.ts:430` + `server/index.ts:114` | Migration applied. Code-side `upsertInboundUserMessage` with `onConflict: 'empresa_id,wa_message_id'` shipped. `handleIncomingMessage` returns `boolean`; index.ts skips auto-reply on duplicate webhook redelivery. |
| P0.15 | Paywall bypassed on every operational endpoint | ✅ | `server/index.ts:42` | Global middleware on `/api/*` w/ minimal exempt list. |
| P0.16 | Frontend has no paywall gate, only banner | ✅ | `src/AppShell.tsx:718` | Paywall placeholder for any view except settings/profile/novidades. |
| P0.17 | `isEmpresaSubscriptionActive` fails OPEN on DB error | ✅ | `server/supabase.ts:80-150` | Fail-closed cache w/ positive-cache fallback. |
| P0.18 | Two parallel Stripe Checkout sessions can both be paid | ✅ | `server/billing.ts:259` | `idempotencyKey: checkout-${user.id}-${tier}-${5min-bucket}` on `stripe.checkout.sessions.create`. |
| P0.19 | Stripe email-lookup adopts cross-product customer | ✅ | `server/billing.ts:246, 344, 391` | Email lookup removed from Checkout/Portal/sync. DB `provider_customer_id` is the only source. |
| P0.20 | Logout doesn't clear `localStorage` — cross-tenant leak on shared device | ✅ | `src/services/authService.ts:40` | `clearLocalAppState()` wipes `zelochat_*` keys. |
| P0.21 | `useOrders.ts` reads/mutates `zelochat_orders` w/ no `empresa_id` filter | ✅ | `src/hooks/useOrders.ts:47, 179, 191` | Defense-in-depth `.eq('empresa_id', empresaId)` on every CRUD op. |
| P0.22 | `confirmPendingOrder` driver lookup missing `empresa_id` filter | ✅ | `server/ai.ts:483` + `server/escalation.ts:293, 337` | Driver lookup + escalation update/acknowledge paths all scoped. |
| P0.23 | Core schema not in source control | ✅ | `supabase/migrations/000_zelochat_schema.sql` | ZeloChat-only snapshot. Idempotent. |
| P0.24 | `whatsmiau_instance` partial UNIQUE not in source | ✅ | `supabase/migrations/000_zelochat_schema.sql` | Verified live + captured. |

---

## What's intentionally NOT being changed

These are out of scope or unsafe to change from this branch:

- **All ZeloPDV-owned tables**: `empresa_perfil` core columns, `subscriptions`, `super_admins`, `produtos`, `categorias`, `vendas*`, `caixas*`, `mesas*`, `comandas*`. Adding/altering columns from this repo would clobber ZeloPDV's migration history.
- **The `subscriptions` table CHECK constraints, RLS policies, plan_tier values**: ZeloPDV's billing webhook writes here. Changing the schema would break ZeloPDV's webhook handler.
- **`auth.users` and Supabase storage `objects` schema**: Supabase platform-owned.
- **The Whatsmiau API contract**: third-party. Wiring `webhook_token` (P0.1) requires their dashboard config too.
- **The single `boundEmpresaId` deploy invariant**: until the customer goes multi-tenant, the app assumes 1 replica + 1 empresa. This is fine for now; **flagged in CLAUDE.md** as a deployment constraint.

---

## P2s closed via previous sprints (verificados 2026-04-30)

| ID | Como foi closed | Sprint |
|---|---|---|
| P2.1 | `confirm()`/`alert()` → `ConfirmModal` + `useToast` em 8 callsites | Sprint 19 |
| P2.5 | segundo WebSocket unauthenticated em `useOrders` removido | Sprint 11 |
| P2.11 | `priceBRL` consolidado em `src/data/pricing.ts` | Sprint 19 |

---

## Sprint history

### Sprint 69g (2026-06-22) — Confirmação do carrinho ZeloMenu no ZeloChat

- ✅ ZLM-103 — carrinho público agora confirma via rota dedicada, revalida antes de fechar e grava o estado canônico `confirmed_waiting_review` ou `confirmed_waiting_payment` sem criar pedido operacional falso no legado — `server/zelomenuCartSessions.ts:806`
- ✅ ZLM-103 — confirmação envia o próximo passo ao cliente pelo WhatsApp e persiste a mensagem no chat, com card separado de "pedido recebido pelo cardápio" para não parecer produção já aceita — `server/zelomenuCartSessions.ts:876`, `src/domain/chatFeedback.ts:173`
- ✅ ZLM-103 — UI pública exibe estado confirmado, bloqueia edição após confirmação e cobre a regra de Pix/comprovante com testes de domínio — `src/pages/ZeloMenuCartPage.tsx:177`, `tests/zelomenuCart.test.ts:52`

### Sprint 69f (2026-06-22) — UI pública inicial do carrinho ZeloMenu

- ✅ ZLM-102 — rota pública `/menu/carrinho/:token` criada no frontend, consumindo o backend novo de carrinho sem depender do app autenticado nem do fluxo legado de pending order — `src/App.tsx:1`, `src/pages/ZeloMenuCartPage.tsx:1`
- ✅ ZLM-102 — tela pública cobre catálogo por categoria, carrinho editável, retirada/entrega, data/horário, pagamento, observações, banner de revalidação e tratamento de link `stale` em PT-BR — `src/pages/ZeloMenuCartPage.tsx:1`, `src/services/zelomenuApi.ts:1`
- ✅ ZLM-102 — verificação passou em `npm run lint` e `npm run build`; `npm test` segue falhando apenas no drift conhecido e não relacionado de `tests/auditFixGuardrails.test.ts` sobre rollout de webhook — `CURRENT.md:19`

### Sprint 69e (2026-06-22) — Backend base das sessões de carrinho do ZeloMenu

- ✅ ZLM-101 — backend do carrinho novo criado em tabelas ZeloChat-owned (`zelomenu_cart_sessions` + `zelomenu_cart_tokens`), com `ordering_id`, snapshots de carrinho/cliente/fulfillment/preço/pagamento, token hash e índice de um carrinho ativo por conversa/contexto — `supabase/migrations/041_zelomenu_cart_sessions.sql`, `server/zelomenuCartSessions.ts`
- ✅ ZLM-101 — rotas mínimas entregues para abrir carrinho `whatsapp_order` autenticado e consumir/editar carrinho público por token (`POST /api/zelomenu/cart-sessions/whatsapp`, `GET/PATCH /public-api/zelomenu/cart/:token`) sem tocar no fluxo legado da Casa dos Salgados — `server/router.ts`
- ✅ ZLM-101 — suíte inicial adicionada para token/path/pricing do carrinho e `npm run lint` passou; `npm test` continua com a falha já conhecida e não relacionada em `tests/auditFixGuardrails.test.ts` sobre drift do rollout de webhook — `tests/zelomenuCart.test.ts`, `tests/run-unit-tests.ts`, `CURRENT.md:19`

### Sprint 69d (2026-06-22) — Planejamento de entitlements e navegação

- ✅ ZLM-005 — matriz de entitlement fechada por capability (`chat_app`, `pdv_core`, `menu_publication`, `ordering_review`, `kitchen_queue`, `mesas`, `acessos`), separando motor interno compartilhado de acesso comercial às superfícies dos apps — `ZELOMENU_LINEAR_PLAN.md:819`, `ZELOMENU_LINEAR_PLAN.md:1399`
- ✅ ZLM-005 — rollout futuro do ZeloMenu desvinculado do legado `has_pedidos_addon`; a flag antiga fica grandfathered e o novo entitlement comercial vai para `ZLM-205` no repo PDV/shared billing — `ZELOMENU_LINEAR_PLAN.md:819`, `ZELOMENU_LINEAR_PLAN.md:1480`
- ✅ ZLM-005 — próximo passo do MVP redefinido para `ZLM-101`, com `ZLM-205` correndo em paralelo para preços/flags compartilhadas — `CURRENT.md:39`

### Sprint 69c (2026-06-22) — Planejamento do catálogo/publicação do ZeloMenu

- ✅ ZLM-004 — interface do módulo `Catalog/Menu Publication` fechada com corte explícito entre catálogo base comum (`produtos`, `categorias`, `subcategorias`) e overlay de publicação do ZeloMenu, evitando poluir o produto operacional com nome público, descrição, foto, visibilidade e ordem — `ZELOMENU_LINEAR_PLAN.md:807`, `ZELOMENU_LINEAR_PLAN.md:1059`
- ✅ ZLM-004 — adicionais/variações definidos como `modifier_groups` e `modifier_options` ligados ao produto base, com preço final calculado por `preco_base + price_delta`, sem duplicar preço base por canal — `ZELOMENU_LINEAR_PLAN.md:813`, `ZELOMENU_LINEAR_PLAN.md:1084`
- ✅ ZLM-004 — próximo bloqueio arquitetural redefinido para `ZLM-005`, antes de qualquer UI nova ou sync visível com PDV — `CURRENT.md:40`

### Sprint 69b (2026-06-22) — Planejamento do novo módulo Ordering

- ✅ ZLM-003 — interface do módulo `Ordering` fechada como aggregate único com `ordering_id`, seam externo `apply(command)` + `getSnapshot(ref)`, estados pré-aceite separados do destino operacional e materialização em `pedidos`/`pedido_itens` ou `comandas` só no `accept` — `ZELOMENU_LINEAR_PLAN.md:795`
- ✅ ZLM-003 — origem operacional por contexto documentada: `whatsapp_order -> pedidos.origem='zelochat'`, `public_order -> pedidos.origem='zelomenu'` (repo PDV), `table_order -> comandas` com tickets `origem='comanda'` — `ZELOMENU_LINEAR_PLAN.md:799`
- ✅ ZLM-003 — próximo bloqueio técnico redefinido para `ZLM-004`, porque `Ordering` já foi fechado e agora falta travar `cart_snapshot`, publicação, adicionais e variações antes de schema/UI — `CURRENT.md:35`

### Sprint 69 (2026-06-22) — Hotfix confirmação de pedido e alertas de produção

- ✅ Gatilho de novo pedido desacoplado da IA — pedidos confirmados por `confirmPendingOrder` agora disparam gatilhos `notify_manager` de evento real (“Novo pedido” e pedidos grandes por quantidade) depois que entram em `zelochat_orders`, sem depender do modelo chamar `dispatch_trigger` no mesmo turno — `src/domain/orderEventTriggers.ts:45`, `server/ai.ts:121`, `server/ai.ts:692`
- ✅ Card de conferência não parece mais pendência atual — os cards técnicos antigos do chat agora dizem que registram a etapa de conferência e orientam o operador a olhar os cards seguintes/status da produção, evitando parecer que um pedido já confirmado ainda espera o cliente — `src/domain/chatFeedback.ts:141`, `src/domain/chatFeedback.ts:190`
- ✅ Matching de salgados assados mais robusto — a IA passa a reconhecer grafias comuns como “esfirra/esfiha” e “hambúrguer/hamburguinho” como produtos de cento assado, reduzindo escalações frias de “produto não encontrado” em pedidos da Casa dos Salgados — `src/domain/conversationState.ts:533`, `src/domain/conversationState.ts:673`
- Verificação — `npx tsx tests/orderEventTriggers.test.ts`, `npx tsx tests/conversationState.test.ts`, `npm run lint`; `npm test` segue falhando apenas no drift conhecido de webhook em `tests/auditFixGuardrails.test.ts` já listado em [[CURRENT]].

### Sprint 68 (2026-06-11) — Hotfix bundle renovado bloqueado por extensão manual vencida

- ✅ Billing/shared subscription expiry — `server/supabase.ts`, `server/subscriptionSweeper.ts`, `src/hooks/useSubscription.ts` e `src/components/billing/BillingCards.tsx` passaram a usar a expiração efetiva mais longa entre `current_period_end` e `manually_extended_until`, em vez de priorizar cegamente a extensão manual. Isso corrige o caso em que o bundle já foi renovado no ZeloPDV, mas uma extensão manual antiga e vencida ainda existia na mesma row e fazia o ZeloChat enxergar a assinatura como expirada.
- ✅ Regressão coberta — novo `tests/subscriptionExpiry.test.ts` reproduz o caso real: `current_period_end` no futuro com `manually_extended_until` no passado deve continuar liberando `bundle`, enquanto extensões futuras ainda estendem o acesso normalmente.
- ✅ Operação manual — hotfix aplicado na `subscriptions.id=8edfe91d-585d-4c1c-9bad-c34c223816f3` (Casa dos Salgados): `manually_extended_until` zerado, preservando `status='active'`, `plan_tier='bundle'` e `current_period_end=2026-07-11T02:59:59.999Z`.
- Verificação — `node ./node_modules/tsx/dist/cli.mjs tests/subscriptionExpiry.test.ts`, `npm run lint` e `npm run build`.

### Sprint 67c (2026-06-08) — Datas bloqueadas ativam IA 24h

- ✅ Schedule gate respeita blocked_dates — `evaluateAiSchedule` ganha early-return quando hoje (resolvido no fuso da empresa via `Intl.DateTimeFormat('en-CA', { timeZone })`) está em `blockedDates`: força `effectiveEnabledNow=true`. Fecha o gap em que cliente mandava mensagem em feriado e ficava sem resposta porque o schedule semanal estava em "off" (caso Casa dos Salgados, sábado 14h cai no turno humano). Order guards em `server/ai.ts` inalterados — IA continua recusando `criar_pedido` em datas bloqueadas, loja não opera — `src/domain/aiSchedule.ts:181`, `src/domain/aiSchedule.ts:222`
- ✅ `always_off` ainda vence — kill-switch deliberado do operador respeitado mesmo em data bloqueada. Apenas `scheduled` e `always_on` recebem o boost.
- ✅ Parser extension — `server/scheduleParser.ts` ganha campo `blockedDates` no input/output. System prompt ensina o LLM a adicionar/remover datas ("bloqueia 25/12 Natal", "tira a folga do dia 15"), usar campo `today` para resolver "amanhã"/"próxima sexta", e retornar a LISTA COMPLETA resultante (não diff). Validação no backend rejeita formato ISO inválido.
- ✅ Frontend NL flow — `AiGlobalScheduleCard` agora recebe `blockedDates` + `onUpdateBlockedDates` como props. Preview do proposal mostra diff "+ adicionadas / − removidas" com data formatada em dd/mm/yyyy. Confirmação salva `state.blockedDates` (AppShell auto-persiste em 800ms) ANTES de aplicar mudança de schedule — `src/components/views/SettingsView.tsx:471`, `src/components/views/SettingsView.tsx:954`
- ✅ Hint no card de resumo — explicitamente diz "Em datas bloqueadas, a IA cobre 24h (mas não aceita pedidos)" + lista as próximas 3 datas bloqueadas como confirmação visual.
- ✅ Testes — 3 asserções novas em `tests/aiSchedule.test.ts`: blocked date força AI on mesmo no turno humano, `always_off` vence, timezone resolve corretamente (UTC vs BRT na virada do dia). 34/34 passando.
- Verificação — `npm run lint` + suites `aiSchedule`, `aiScheduleWizard`, `configStore` (70 testes verdes).

### Sprint 67b (2026-06-08) — Wizard + edição por IA da agenda

- ✅ Wizard guiado — 4 passos (cenário → dias → horário → preview visual) substitui o editor 7-cards como ponto de entrada principal. Lógica pura em `src/domain/aiScheduleWizard.ts` (`buildScheduleFromWizard`, `reverseEngineerWizardState`, `summarizeScheduleResult`); UI em `src/components/settings/ScheduleWizard.tsx`. Cenário escolhido define polaridade automática: "IA cobre quando ninguém atende" → inverted=true, "IA atende em horário específico" → inverted=false, "IA atende sempre" → always_on.
- ✅ Visual preview 24h — `src/components/settings/ScheduleVisualPreview.tsx` renderiza barras horizontais por dia em 48 segmentos de meia hora (brand color = IA ativa). Usado dentro do wizard (passo final) e no card de resumo após salvar.
- ✅ Edição por linguagem natural — `POST /api/ai/schedule-parse` (em `server/scheduleParser.ts`) usa gpt-4o-mini com `response_format=json_object` pra converter "muda quarta pra 24h" / "domingo só de tarde" / etc. em `AiScheduleDays`. Validação no backend via `normalizeAiScheduleDays`. Nunca persiste — retorna proposta pra UI mostrar diff e operador confirmar.
- ✅ Reverse-engineer — saved schedule pré-preenche o wizard quando o operador clica "Reconfigurar". Pattern matching reconhece "human_covers_business" e "ai_covers_business"; padrões hand-edited (horários diferentes por dia) retornam null e o wizard começa em branco.
- ✅ Editor avançado preservado — disclosure "Editar manualmente (avançado)" mantém o editor dia-a-dia (Off/24h/Horário + toggle DENTRO/FORA) intacto pra padrões que não cabem no wizard.
- ✅ Testes — 7 testes novos em `tests/aiScheduleWizard.test.ts`: Casa dos Salgados scenario (build + evaluator end-to-end), commercial hours, always_on, reverse-engineer de ambos os padrões, rejeição de schedule não-uniforme, geração de summary. 26/26 passando. Total combinado 56/56 entre as suites de agenda.
- Verificação — `npm run lint`, suites `aiSchedule`, `aiScheduleWizard`, `configStore`, `aiRouteGuards`, `aiSimulatorScheduleGuard` (101 testes verdes).

### Sprint 67 (2026-06-08) — Agenda da IA por dia da semana

- ✅ Per-day schedule — modo `scheduled` agora aceita janela diferente por dia (Off / 24h / Horário específico) na coluna nova `empresa_perfil.ai_schedule_days` (JSONB); avaliação `evaluateAiSchedule` prioriza per-day quando presente e cai pra single-window legacy quando `NULL` — `src/domain/aiSchedule.ts:88`, `src/domain/aiSchedule.ts:182`, `server/configStore.ts:80`, `server/router.ts:1547`, `supabase/migrations/040_ai_schedule_per_day.sql`
- ✅ UI per-day — `AiGlobalScheduleCard` ganhou editor 7-dias com 3 estados por dia (Desligada/24h/Horário). Seed inicial usa a janela legacy do operador (não horário comercial) pra não sobrescrever o agendamento dele em save acidental; aviso amarelo quando legacy cruza madrugada — `src/components/views/SettingsView.tsx:524`, `src/components/views/SettingsView.tsx:639`
- ✅ Toggle de polaridade per-day (Casa dos Salgados) — campo `inverted` em cada `AiScheduleDay`. UI mostra dois botões dentro de "Horário": "IA ligada DENTRO" / "IA ligada FORA" — permite descrever o turno humano em vez do turno da IA, resolve o padrão "humanos 06–18h, IA cobre o resto" sem precisar de wrap entre dias. Default `false` mantém comportamento; rows JSONB pré-existentes sem o campo continuam idênticos — `src/domain/aiSchedule.ts:24`, `src/domain/aiSchedule.ts:140`, `src/components/views/SettingsView.tsx:835`
- ✅ Backward compat — fallback resilient quando coluna não existe: hidratação no backend (`configStore.ts`), select no hook (`useEmpresaPerfil.ts`), persistência no `POST /api/ai-settings` — clientes antigos com `ai_schedule_days = NULL` mantêm comportamento legacy bit-a-bit idêntico até re-salvarem.
- ✅ Testes — 13 asserções novas em `tests/aiSchedule.test.ts`: domingo 24h, sábado 13:00–23:59, dia desligado, per-day vence legacy, normalizer rejeita payload malformado, padrão Casa dos Salgados (inverted 06-18) em 02h/12h/22h, inverted opcional no normalizer. 30/30 passando.
- Verificação — `npm run lint` + suites `aiSchedule`, `configStore`, `aiSimulatorScheduleGuard`, `aiRouteGuards`.

### Sprint 66 (2026-06-05) — Hotfix reconexão WhatsApp após instância apagada

- ✅ QR Code WhatsApp — quando a instância salva no banco foi apagada fora do ZeloChat e o provedor retorna 404, `/api/qr` e `/api/qr/refresh` limpam somente esse ponteiro, recriam a instância da empresa e tentam buscar o QR de novo no mesmo fluxo — `server/router.ts:1038`, `server/instanceManager.ts:275`, `server/whatsapp.ts:638`
- Verificação — `npm run lint` e `npx tsc --noEmit -p server/tsconfig.json`.

### Sprint 65 (2026-06-04) — Agenda da IA alinhada ao simulador

- ✅ Agenda da IA — pedido implícito, pergunta de produto/cardápio, Pix, retirada, horário e continuação curta agora bloqueiam antes da OpenAI quando hoje está em `blocked_dates` e não há data futura explícita; o prompt também destaca “hoje bloqueado” como aviso crítico — `server/ai.ts:952`, `server/ai.ts:959`, `server/ai.ts:2312`, `server/ai.ts:3421`
- ✅ Confirmação segura — pendência antiga com data bloqueada ou horário inválido é revalidada e limpa antes de aceitar “sim”, “só isso” ou botão de confirmação — `server/ai.ts:584`, `server/ai.ts:3273`
- ✅ Simulador de atendimento — dry-run do Cérebro IA passa pela mesma validação de agenda da produção antes do modelo e marca `criar_pedido` como bloqueado quando a tool sair com data/horário inválidos; rascunho de regras longas não é mais cortado em 1.200 caracteres — `server/aiSimulator.ts:37`, `server/aiSimulator.ts:71`, `server/aiSimulator.ts:145`
- ✅ Testes — cobertura para Casa dos Salgados/feriado: pedido sem “hoje”, pergunta “tem coxinha?”, Pix/retirada, “só isso” após contexto de retirada, pedido futuro livre, tool com `pickupDate` bloqueado e aviso crítico no prompt — `tests/aiSimulatorScheduleGuard.test.ts:59`, `tests/run-unit-tests.ts:21`
- Verificação — `npx tsx tests/aiSimulatorScheduleGuard.test.ts`, `npx tsc --noEmit -p server/tsconfig.json`, `npx tsx tests/aiPromptGuardrails.test.ts`, `npm run lint`.

### Sprint 64 (2026-06-03) — Incidente externo no WhatsApp + ajustes defensivos

- ✅ Incidente — causa confirmada fora do ZeloChat: instabilidade no proxy do provedor WhatsApp; `/api/healthz` estava verde porque só mede liveness do backend Express, não saúde da integração WhatsApp — `INCIDENTS.md:35`
- ✅ Ajuste defensivo — timeout ao preparar QR mantém a tela em tentativa automática e não deixa o operador preso numa ação manual repetitiva — `server/whatsapp.ts:674`, `src/components/views/SettingsView.tsx:188`
- ✅ Ajuste defensivo — envio manual aceita IDs de mensagem em formatos aninhados do provedor e retorna erro controlado quando o envio falha, sem transformar erro pós-envio no banco em 500 — `server/whatsapp.ts:143`, `server/router.ts:205`
- ✅ Copy/docs — mensagens visíveis não expõem nomes de provedores internos; convenção documentada para futuras IAs/devs — `CLAUDE.md:46`, `AGENTS.md:56`
- ✅ Revert — removido o ajuste extra de status por endpoint per-instância porque não era necessário para a causa raiz confirmada — commit `8ee2d8c`.
- Verificação — `npx tsc --noEmit -p server/tsconfig.json`, `npm run lint` e `npm run build` passaram. `npx tsx tests/auditFixGuardrails.test.ts` passou nos novos guardrails e segue falhando apenas no drift conhecido de webhook documentado em [[CURRENT]].

### Sprint 63 (2026-06-01) — Review de warnings/dependências

- ✅ Dependências — `localtunnel` removido de `devDependencies`; o script real de túnel já usa cloudflared, e a remoção elimina o audit HIGH via `localtunnel -> axios@0.21.4` sem trocar runtime de produção — `package.json`, `package-lock.json`, `scripts/tunnel.js`
- ✅ Docs — review de `npm audit`, `npm outdated`, `npm ls`, build warning e guardrail de webhook documentado sem duplicar no vault; `obsidian/DEV_SETUP.md`, `obsidian/CURRENT.md` e `obsidian/ZeloChat.memory.md` são symlinks para os arquivos atualizados — `DEV_SETUP.md`, `CURRENT.md`, `docs/ai/ZeloChat.memory.md`
- ⚠️ Pendentes — `npm run build` ainda avisa chunk app >500 kB (`index-BgmHYe4Y.js` 569.66 kB / 162.59 kB gzip); `npm test` ainda falha em `tests/auditFixGuardrails.test.ts` por drift entre `WEBHOOK_ALLOW_MISSING_TOKEN_DURING_ROLLOUT` esperado e `WEBHOOK_REQUIRE_TOKEN` usado no código atual; majors de dependências exigem migração dedicada.
- Verificação — `npm audit --audit-level=low` passou com 0 vulnerabilidades, `npm ls --depth=0` passou, `npm run lint` passou, `npm run build` passou com aviso de chunk, `npm test` falhou apenas no guardrail de webhook citado acima.

### Sprint 62 (2026-06-01) — Estoque como regra operacional da IA

- ✅ Update banner/cache — Nginx agora serve shell SPA (`index.html` e fallback `/app/*`) com `no-store`, mantém assets Vite hashados como `immutable`, e o banner remove o `?appVersion=...` da URL após carregar; evita necessidade de Ctrl+F5 pós-deploy — `nginx.frontend.conf`, `src/components/shared/UpdateAvailableBanner.tsx`, `tests/updateReloadGuardrails.test.ts`
- ✅ Stock availability — produto com `controlar_estoque=true` e `estoque_atual<=0` deixa de entrar no cardápio da IA; produtos com estoque limitado mostram o teto no prompt; `criar_pedido` bloqueia quantidade acima do estoque antes de abrir pedido pendente e a confirmação recheca o estoque atual antes de criar o pedido real — `server/configStore.ts`, `server/ai.ts`
- ✅ Sync-config — `/api/sync-config` não aceita mais snapshot de catálogo do navegador como fonte da verdade; depois do sync, o backend recarrega o catálogo compartilhado direto do banco para preservar `controlar_estoque`/`estoque_atual` — `server/router.ts`
- ✅ Frontend/simulador — estado local e simulador da IA passam a considerar `controlar_estoque` e `estoque_atual` ao montar produtos disponíveis — `src/AppShell.tsx`, `src/services/openaiService.ts`
- ✅ Comportamento WhatsApp — classificador determinístico de turno cobre `sem obs`, `não muda nada`, `sim, sem cebola`, `cancelar só a coca`, emojis de entusiasmo e hard-button exato; edição de pending order agora é processada no mesmo turno em vez de pedir repetição — `src/domain/conversationState.ts`, `server/ai.ts`, `server/router.ts`, `tests/aiTurnDecision.test.ts`
- ✅ Obsidian — comportamento geral da IA documentado no vault para continuidade — `obsidian/AI_BEHAVIOR_RULES.md`
- Verificação: `npx tsx tests/aiPromptGuardrails.test.ts`, `npx tsx tests/aiTurnDecision.test.ts`, `npx tsx tests/conversationEdgeCases.test.ts`, `npx tsx tests/conversationState.test.ts`, `npx tsx tests/routerWebhookGuardrails.test.ts`, `npx tsx tests/updateReloadGuardrails.test.ts`, `npx tsc --noEmit -p server/tsconfig.json`, `npm run lint`, `npm run build`.

### Sprint 61 (2026-05-31) — Docs AI-first + fixes P2 + Tags QA close

- ✅ Tags feature — QA completo: lint OK, badges sidebar (`ChatView.tsx:1915`), cascade delete (migrations 031/032), AI injection por tag (`ai.ts` `buildTagsBlock()`). Arquivo de spec deletado.
- ✅ P2.1 — `alert()` nativo trocado por toast em `ProfileView.tsx:191`
- ✅ Áudio — `durationSeconds` capturado de `audioMessage.seconds` no webhook; fallback usa valor real quando disponível
- ✅ Docs — Convenção AI-first adicionada ao CLAUDE.md; `docs/ai/` audit files adicionados ao vault Obsidian; HOME.md expandido com seção de auditorias detalhadas
- ✅ P2.20 confirmed closed — `replyDebouncer.ts` staged 10s (verificado por subagent)
- ✅ P2.18 confirmed closed — auto-escalate após 3 falhas Whisper (verificado por subagent)

### Sprint 60 (2026-05-26) - Encaminhar cliente para outra linha

- Gatilhos personalizados - novo tipo `redirect_contact` com telefone dedicado e mensagem opcional para encaminhar clientes para delivery, trailer ou outra unidade - `server/triggers.ts`, `server/router.ts`, `src/components/views/AIConfigsView.tsx`, `supabase/migrations/038_zelochat_trigger_redirect_contact.sql`
- Fluxo seguro da IA - `redirect_contact` usa a tool existente `dispatch_trigger`, perde para escalação humana, vence criação de pedido no mesmo turno e só envia/persiste a mensagem com link `wa.me`, mantendo `auto_reply` ativo - `server/ai.ts`, `tests/aiToolPlan.test.ts`, `tests/aiPromptGuardrails.test.ts`
- Banco - migration `zelochat_trigger_redirect_contact` aplicada em prod via Supabase MCP em 2026-05-26 e verificada com `redirect_phone`, `redirect_message` e CHECK de `kind` atualizado.
- Novidades - entrada curta para operador sobre encaminhar clientes para outro WhatsApp - `src/data/changelog.ts`
- Verificação - `npx tsx tests/aiToolPlan.test.ts`, `npx tsx tests/aiPromptGuardrails.test.ts`, `npx tsc --noEmit -p server/tsconfig.json`, `npm run lint` e `npm run build` passaram.

### Sprint 59 (2026-05-19) - Hotfix envio manual WhatsApp

- Atendimento manual - envios feitos pelo operador agora passam número em dígitos para o Whatsmiau, em vez do JID técnico da conversa, alinhando o payload com o contrato de envio do provedor - `server/whatsapp.ts`
- Ciclo de envio - texto, mídia e áudio só viram `sent` quando o Whatsmiau retorna um ID real de mensagem; resposta ambígua agora marca a bolha como `failed` e evita falso sucesso visual - `server/whatsapp.ts`, `server/router.ts`
- Novidades - entrada curta para operador sobre o retorno do envio manual - `src/data/changelog.ts`
- Verificação - `npx tsx tests/auditFixGuardrails.test.ts`, `npm run lint`, `npx tsc --noEmit -p server/tsconfig.json` e `npm run build` passaram.

### Sprint 58 (2026-05-15) - P0/P1 do re-audit ZeloChat

- Segurança tags - aplicar/remover tags valida sessão e tag dentro da mesma empresa, leituras ignoram junções envenenadas e migration `033_zelochat_session_tags_tenant_enforcement.sql` remove inconsistências antes de adicionar FKs compostas por empresa - `server/tags.ts`, `server/router.ts`, `supabase/migrations/033_zelochat_session_tags_tenant_enforcement.sql`
- Webhook - `/webhook/:instance` agora exige token por padrão, aceita header ou `?token=`, registra webhooks com URL tokenizada e mantém apenas o bypass explícito `WEBHOOK_ALLOW_MISSING_TOKEN_DURING_ROLLOUT=1` para rollout emergencial - `server/router.ts`, `server/whatsapp.ts`
- Conversas - `/api/sessions` passou a aceitar `limit`, `cursor`, `status`, `q` e `tagId`; o hook e a tela de chat carregam mais conversas sob demanda e mensagens antigas no topo da conversa - `server/messageHandler.ts`, `server/router.ts`, `src/services/waApi.ts`, `src/hooks/useWhatsAppSessions.ts`, `src/components/views/ChatView.tsx`, `supabase/migrations/035_zelochat_sessions_pagination_indexes.sql`
- Envio manual - mensagens enviadas pelo painel agora criam uma intenção persistida antes do WhatsApp, depois viram `sent` ou `failed`; eco `fromMe` só é ignorado quando o banco já tem o `wa_message_id`, permitindo reparar o caso "WhatsApp enviou, DB falhou" - `server/router.ts`, `server/messageHandler.ts`, `src/components/views/MessageBubble.tsx`, `supabase/migrations/034_zelochat_outbound_message_lifecycle.sql`
- Áudio - quando a transcrição termina depois do timeout inicial, o backend rearma o debounce da IA se o áudio ainda é o último turno não respondido e a conversa continua em IA/sem escalação - `server/messageHandler.ts`, `server/index.ts`, `tests/audioTranscriptionRearm.test.ts`
- Docs/tests - memória do audit atualizada e guardrails estáticos adicionados para os fixes críticos - `docs/ai/ZeloChat.memory.md`, `tests/auditFixGuardrails.test.ts`
- Verificação - `npm run lint`, `npx tsc --noEmit -p server/tsconfig.json`, `npx tsx tests/audioTranscriptionRearm.test.ts`, `npx tsx tests/auditFixGuardrails.test.ts` e `npm run build` passaram.

### Sprint 57 (2026-05-15) - Hotfix de escala para loja heavy-user

- Conversas - carregamento inicial limita o payload de `zelochat_sessions`, remove `customer_profile` da lista e quebra a consulta de atividade recente em chunks menores para evitar `TypeError: fetch failed` no backend - `server/messageHandler.ts`
- Acoes em massa - marcar como lida e arquivar agora resolvem familias em lote por JID/telefone, evitando uma query dupla por conversa selecionada - `server/messageHandler.ts`
- Dashboard - overview busca menos colunas de sessoes/mensagens, remove o texto completo das mensagens da metrica de primeira resposta e registra aviso se bater o teto defensivo de leitura - `server/dashboardMetrics.ts`
- Pedidos - lista operacional carrega apenas pedidos ativos ou recentes, com colunas explicitas e limite defensivo para evitar historico inteiro no navegador - `src/hooks/useOrders.ts`
- Catalogo - leituras e mutacoes nas tabelas compartilhadas do PDV agora filtram explicitamente por `id_usuario` e usam limites defensivos - `src/hooks/useCatalog.ts`
- Persistencia local - `localStorage` deixa de regravar em toda mudanca de chat/pedido e roda somente quando o slice persistido muda - `src/AppShell.tsx`
- Observabilidade - requests acima de 2s passam a gerar `console.warn` com empresa, rota, status e duracao - `server/observability.ts`, `server/index.ts`, `server/supabase.ts`
- Tags - mapa de tags do chat ganhou cache curto no navegador e continua invalidando por WebSocket - `src/components/views/ChatView.tsx`
- Verificacao - `npm run lint` e `npx tsc --noEmit -p server/tsconfig.json` passaram.

### Sprint 56 (2026-05-09) - Ordem real da lista de conversas

- Hotfix chat - lista de conversas agora usa a mensagem visivel mais recente para ordenar, com conversas fixadas no topo; mudancas de leitura/status/perfil nao puxam mais chats antigos para "recentes" - `server/messageHandler.ts`, `src/hooks/useWhatsAppSessions.ts`, `src/components/views/ChatView.tsx`
- Continuidade multi-JID - quando um contato tem mais de uma linha tecnica, a conversa canonica acompanha a linha da mensagem mais recente para manter historico e recencia consistentes - `server/messageHandler.ts`
- Verificacao - `npm run lint` passou.

### Sprint 55 (2026-05-09) - Reload do painel mais leve

- Chat-first incremental - catálogo e respostas rápidas entram após idle; pedidos, motoboys e gatilhos carregam sob demanda por view; a última conversa aberta é restaurada sem escolher a primeira automaticamente - `src/AppShell.tsx`, `src/hooks/useCatalog.ts`, `src/hooks/useOrders.ts`, `src/hooks/useDrivers.ts`, `src/hooks/useTriggers.ts`, `src/hooks/useQuickResponses.ts`

- Performance boot - perfil da empresa agora carrega em uma única leitura de `empresa_perfil` no ambiente atualizado, mantendo fallback compacto para bases antigas sem disparar uma query por coluna - `src/hooks/useEmpresaPerfil.ts`
- Conversas - reload deixou de buscar foto de perfil pelo Whatsmiau para cada chat sem imagem salva; usa apenas a URL já persistida na sessão e evita dezenas de chamadas `/profile-picture` - `src/AppShell.tsx`
- Sync inicial - removido disparo imediato redundante de `/api/sync-config` no token e bloqueado o primeiro PATCH de `blocked_dates/manager_history` causado só pela hidratação inicial - `src/AppShell.tsx`
- Novidades - entrada curta para operador sobre o painel abrir mais rápido - `src/data/changelog.ts`
- Verificação - `npm run lint`, `npx tsc --noEmit -p server/tsconfig.json`, `npm run build` e `git diff --check` passaram.

### Sprint 54 (2026-05-09) - Conversas fixadas sem trocar histórico

- Hotfix chat - fixar/desafixar conversa não altera mais a recência técnica de todas as linhas da família do contato, evitando troca de JID canônico e abertura de um chat aparentemente sem histórico - `server/messageHandler.ts`
- Continuidade frontend - ao abrir uma conversa, se o backend devolver o mesmo contato com outro JID canônico, o hook substitui a linha antiga em vez de criar uma segunda conversa parcial - `src/hooks/useWhatsAppSessions.ts`
- Novidades - entrada curta para operador explicando que conversas fixadas agora abrem mantendo o histórico correto - `src/data/changelog.ts`
- Verificação - `npm run lint`, `npx tsc --noEmit -p server/tsconfig.json`, `npm run build` e `git diff --check` passaram.

### Sprint 53 (2026-05-09) - Pedido manual assistido no chat

- Atendimento manual - menu da IA no chat ganhou a ação `Criar pedido`, que lê a conversa, pré-preenche um card de pedido e deixa o operador revisar/salvar sem sair da thread - `src/components/views/ChatView.tsx`, `src/services/openaiService.ts`, `src/AppShell.tsx`
- Fluxo de pedido - a IA automática agora recebe uma instrução extra quando já perguntou sobre observações e o cliente só agradece ou se despede, para chamar `criar_pedido` em vez de repetir resumo ou encerrar sem abrir a confirmação - `server/ai.ts`
- Novidades - changelog consolidado com uma entrada só, em linguagem de operador, para a melhoria do pedido manual assistido e da confirmação mais esperta - `src/data/changelog.ts`
- Verificação - `npm run lint`, `npx tsc --noEmit -p server/tsconfig.json` e `npm run build` passaram.

### Sprint 52 (2026-05-06) - Comprovante Pix como trava de pedido

- Piloto Pix - empresas habilitadas por `pix_receipt_config.available=true` ganham toggle no Cerebro IA para exigir comprovante por imagem/PDF antes de confirmar pedidos Pix - `src/components/views/AIConfigsView.tsx`, `src/AppShell.tsx`, `src/hooks/useEmpresaPerfil.ts`
- Fluxo seguro - `criar_pedido` salva pedido Pix como pendente e pede comprovante; botao/texto "Confirmar" fica bloqueado ate aprovacao e a confirmacao final continua usando `confirmPendingOrder` - `server/ai.ts`, `server/router.ts`
- Validador dedicado - OpenAI Responses API le imagem/PDF em servico isolado e o backend compara deterministicamente beneficiario, valor, data e confianca antes de aprovar - `server/pixReceiptValidator.ts`, `src/domain/pixReceipt.ts`, `tests/pixReceipt.test.ts`
- Continuidade - config Pix agora tambem e normalizada no sync do backend; falha de cliente OpenAI vira rejeicao controlada; e pendencia Pix fica preservada quando o cliente ja recebeu o pedido de comprovante mas a persistencia do historico falhou - `server/configStore.ts`, `server/pixReceiptValidator.ts`, `server/ai.ts`
- Auditoria e rollout - nova migration `020_pix_receipt_confirmation.sql` adiciona config em `empresa_perfil`, status/snapshot em `zelochat_pending_orders` e snapshot aprovado em `zelochat_orders`; uso de IA entra em `pix_receipt_validation`.
- QA preview Donutopia - login no preview, card de comprovante Pix visivel em Cerebro IA com IA desligada, toggle/config salvando e validacao de beneficiario vazio bloqueando o submit. API `/api/ai/health` retornou `pixReceiptConfigured=true`, `pixReceiptEnabled=true`, `aiEnabled=false`.
- QA multimodal - OpenAI Responses aprovou PDF e imagem sinteticos com beneficiario Donutopia, valor R$90,00 e data atual. Achado de QA: constraint de `zelochat_ai_usage_daily.feature` ainda rejeitava `pix_receipt_validation`; corrigido na migration `021_pix_receipt_ai_usage_feature.sql`.
- QA ao vivo - comprovante real enviado pelo WhatsApp passou pelo webhook local, foi aprovado e confirmou o pedido Pix. Achado de QA: imagem real em base64 era barrada pelo parser global de 100kb antes do router; `/webhook/*` agora usa limite de 40mb e mantém o cap real de mídia no `messageHandler` - `server/index.ts`.
- Verificacao - `npx tsx tests/pixReceipt.test.ts` (17 casos), `npm run lint`, `npx tsc --noEmit -p server/tsconfig.json`, `npm run build` e `git diff --check` passaram.

### Sprint 51 (2026-05-04) - Metricas internas de IA e unidade brasileira

- Metricas internas - chamadas de IA do ZeloChat agora gravam uso agregado por empresa/dia/fonte/modelo, sem armazenar conteudo de cliente, telefone, JID, prompt ou resposta - `server/aiUsage.ts`, `supabase/migrations/018_zelochat_ai_usage_daily.sql`
- Painel interno - a central de gastos de IA do admin-dashboard passa a somar PDV + ZeloChat por empresa, mantendo a leitura restrita a super admins - `../zeloPDV-Prod/admin-dashboard/src/routes/ai-usage/+page.svelte`
- Cardapio seguro - o backend usa `eh_item_por_unidade`, apelidos descritos nas instrucoes da empresa e regra nativa brasileira para converter "cento" em 100 e "meio cento" em 50 quando o produto e por unidade - `server/ai.ts`, `server/configStore.ts`
- Escalacao conservadora - produto inexistente/ambivalente ou quantidade sem unidade clara escala para humano em vez de inventar, limpar pendencia ou responder em loop - `server/ai.ts`
- Type-check/build: `npx tsc --noEmit -p server/tsconfig.json`, `npm run lint`, `npm run build` e admin-dashboard `npm run build` verdes.

### Sprint 50 (2026-05-04) - Multiplas acoes seguras da IA

- P1 roadmap - A IA agora consegue executar acoes seguras em sequencia no mesmo turno: por exemplo, consultar um pedido anterior e depois abrir o fluxo de confirmacao de um novo pedido - `server/ai.ts`
- Regra central preservada - escalacao humana vence qualquer outra acao emitida pela IA; se houver pedido de humano, reclamacao ou irritacao durante uma pendencia, o pedido pendente fica preservado e a conversa vai para atendimento humano - `server/ai.ts`
- Seguranca operacional - depois de consultas/notificacoes intermediarias, o backend revalida `auto_reply` e status da sessao antes de criar pedido ou enviar nova resposta automatica - `server/ai.ts`

### Sprint 49 (2026-05-02) - Gestão por conversa backend

- Gestao por conversa saiu do fluxo frontend-only: `POST /api/ai/manager` agora usa a OpenAI apenas para sugerir acoes e deixa o backend validar e executar cada alteracao - `server/router.ts`, `server/managerAssistant.ts`, `server/aiRouteGuards.ts`
- A conversa gerencial agora consegue bloquear/liberar datas, ligar/desligar IA, consultar saude, ajustar avisos de hoje, horarios, dias fechados e notificacoes ao cliente; instrucoes da IA entram apenas como rascunho para revisao humana - `server/managerAssistant.ts`, `src/components/views/AIConfigsView.tsx`, `src/services/waApi.ts`
- UI do Cerebro IA passou a refletir o estado retornado pelo backend e atualizar a prontidao da IA depois das acoes, mantendo historico persistido em `empresa_perfil.manager_history` - `src/components/views/AIConfigsView.tsx`, `src/AppShell.tsx`
- Verificacao pendente: o shell do sandbox Windows continua falhando antes de iniciar processos (`CreateProcessWithLogonW`), e o workspace nao tem `node_modules`; `npm run lint`, `npm run build`, commit e push precisam rodar quando o ambiente local voltar.

### Sprint 48 (2026-05-01) - IA mais consistente por loja

- Autoatendimento da IA agora chama a OpenAI com `temperature: 0.3` em todos os turnos do atendimento automatico e follow-ups de ferramentas, reduzindo variacao em respostas de cardapio, disponibilidade e fluxo de pedido - `server/ai.ts`
- Instrucoes do dono deixam de ser tratadas apenas como "tom e estilo": agora entram como regras operacionais da loja para respostas fixas, apelidos de produtos, explicacoes comerciais e fluxo de atendimento, mantendo bloqueio contra sobrescrever preco final, taxa, datas, horarios, Pix, escalacao humana e tool calls - `server/ai.ts`
- Limite das instrucoes do dono subiu de 1.2k para 10k caracteres, evitando truncar regras longas como as da Casa dos Salgados. O simulador de atendimento usa a mesma temperatura da producao - `server/ai.ts`, `server/aiSimulator.ts`
- Simulador exposto no Cerebro IA: operador pode testar uma mensagem de cliente usando as instrucoes atuais do campo, sem enviar WhatsApp e sem gravar pedido - `src/components/views/AIConfigsView.tsx`, `src/services/openaiService.ts`
- Verificacao verde: `npm run lint`, `npm run build`

### Sprint 47 (2026-05-01) - Apagar mensagem real no WhatsApp

- Delete real - mensagens enviadas pelo painel agora carregam `wa_message_id`, exibem lixeira apenas quando ha ID do WhatsApp e chamam `DELETE /v2/chat/deleteMessageForEveryone/:instance` para apagar para todos - `server/router.ts`, `server/whatsapp.ts`, `src/components/views/MessageBubble.tsx`
- Persistencia/local state - a mensagem apagada tambem sai de `zelochat_messages` e do estado em tempo real via `message_deleted`, incluindo eventos `messages.delete` vindos do Whatsmiau - `server/messageHandler.ts`, `src/hooks/useWhatsAppSessions.ts`
- Sem edicao fake - a documentacao publica do Whatsmiau nao mostra endpoint de edicao de mensagem, entao a UI nao oferece editar.

### Sprint 46 (2026-05-01) — IA com visão para imagens

- ✅ IA multimodal — imagens recebidas pelo WhatsApp agora entram no contexto da OpenAI como `image_url` quando ha URL/base64 valido. O envio fica limitado as 3 imagens recentes do cliente para controlar custo e latencia — `server/ai.ts`, `src/domain/chat.ts`
- ✅ Mídia inbound — extração de anexos agora cobre `data.base64`, `message.base64`, `{image,audio,document,video}Message.base64` e URLs publicas allowlisted, mantendo limite de 25 MB antes do decode — `server/messageHandler.ts`
- ✅ Guardrail Pix/pedido — prompt fixo orienta a agradecer comprovante Pix sem prometer validacao bancaria, interpretar fotos de lanche/preparo e nunca criar pedido apenas por imagem ambigua — `server/ai.ts`
- ✅ Novidades — entrada do dia consolidada para incluir entendimento de imagens sem passar de 4 cards em 2026-05-01 — `src/data/changelog.ts`

### Sprint 45 (2026-05-01) — IA assistida no atendimento manual

- ✅ UX — Botão de IA no canto direito do campo do chat em modo Manual. O operador pode escolher "Melhorar mensagem" para corrigir e deixar o rascunho mais amigável, ou "Gerar resposta" para sugerir uma resposta com base no contexto da conversa. A IA só preenche o campo; o envio continua 100% manual — `src/components/views/ChatView.tsx`, `src/services/openaiService.ts`
- ✅ Novidades — entrada consolidada no topo do changelog, substituindo a entrada anterior de mensagens não-texto para manter o limite de 4 entradas por dia — `src/data/changelog.ts`
- ✅ Docs — `SESSION_HANDOFF.md` removido por estar obsoleto; `FIXES_PROGRESS.md` e `AI_BACKEND_ROADMAP.md` voltaram a ser as fontes úteis para continuidade
- Verificação verde: `npm run lint`, `npx tsc --noEmit -p server/tsconfig.json`, `npm run build`

### Sprint 44 (2026-05-01) — Simulador de atendimento + P2 fixes

- ✅ Simulador de atendimento — novo dry-run da pipeline da IA, sem escrita no banco e sem envio no WhatsApp. Retorna resposta, ferramentas chamadas e se criaria pedido, para testar instruções antes de publicar — `server/aiSimulator.ts`, `server/router.ts`
- ✅ Contexto mais limpo para a OpenAI — reações e votos em enquete deixam de entrar no histórico enviado ao modelo, porque não carregam intenção acionável do cliente — `server/ai.ts`
- ✅ Resiliência — carregamento de configurações da IA no backend ganhou timeout de 3s para não travar webhook durante instabilidade do Supabase — `server/configStore.ts`

### Sprint 43 (2026-05-01) — Code-review follow-ups + UX polish

Saída do audit Sprint 35-41 (senior code reviewer):

- ✅ P1 cardápio fuzzy match assimétrico — `resolveCatalogProduct` agora só auto-resolve quando os tokens do cliente são **subconjunto** do produto, nunca o contrário. Antes "café com leite e açúcar" virava "café" silenciosamente; agora o pedido fica não-resolvido e a IA pede verificação. Acrescentado log `[AI] catalog fuzzy match: input=… → product=…` para visibilidade em produção — `server/ai.ts`
- ✅ P1 sanitização de placeholders não-texto — `cleanText` em `messageHandler.ts` agora strips CR/LF/backticks/angle-brackets/control chars e limita 200 chars (configurável). Cobre vCard FN/TEL, nome/endereço de localização, nome/opções de enquete e emoji de reação antes de virarem `last_message` ou row em `zelochat_messages` — `server/messageHandler.ts`
- ✅ P1 rate limit de IA com chave por usuário + ceiling por empresa — `checkAiRouteRateLimit` agora exige `userId` e cobra dois buckets em paralelo: `u:{empresa}:{user}:{kind}` (40/5min ou 12/1h) e `e:{empresa}:{kind}` (200/5min ou 60/1h). Cumpre o compromisso do roadmap "limites por empresa **e por usuário**". Erro 429 distingue limite de usuário vs limite de empresa. Single-replica state mantido (Map) — `server/aiRouteGuards.ts`, `server/router.ts`, `server/supabase.ts` (novo `requireEmpresaAndUserId`)
- ✅ UX — Bolinha de não-lidas no menu agora é verde estilo WhatsApp e mostra **número de conversas com não-lidas** (não a soma de mensagens). Cada conversa específica mantém o badge com a contagem de mensagens. Bolinha vira vermelha apenas quando há escalações pendentes — `src/AppShell.tsx`
- ✅ UX — Painel "Saúde da IA" no Cérebro IA consome o endpoint `/api/ai/health` (Sprint 39) e mostra prontidão operacional (cardápio carregado, horários, entrega, gerente, Pix, IA ligada, datas bloqueadas) com botão de refresh. Antes o endpoint existia sem UI consumidora — `src/components/views/AIConfigsView.tsx`, `src/services/waApi.ts`
- ✅ Refactor — `validateManagerPhone` em `escalation.ts` distingue `missing` vs `invalid` no log de aviso (em vez de "managerPhone not configured" para tudo). Útil pra triagem quando o dono digitou número inválido — `server/escalation.ts`
- ✅ Helpers em `server/ai.ts` exportados (`safeForPrompt`, `resolveCatalogProduct`, `buildSystemInstruction`, `planToolCallsForTurn`, `CREATE_ORDER_TOOL`, etc.) — preparação para o simulador de atendimento, entregue na Sprint 44. Não há call site novo aqui, só `export` adicionado — superfície aumentada mas semantics inalteradas
- Type-check verde: frontend `tsc --noEmit`, server `tsc --noEmit -p server/tsconfig.json`. `vite build` clean (chunk maior 196 kB pós-split)

### Sprint 42 (2026-05-01) — P3 bundle split

- ✅ P3 — Dividir bundle grande (`AI_BACKEND_ROADMAP.md`). Entrada único de 1 095 kB (304 kB gzip) substituída por 18 chunks. Maior chunk agora é `supabase-vendor` com 196 kB (51 kB gzip); chunk de entrada caiu para 406 kB (118 kB gzip) — sem aviso de chunk grande — `vite.config.ts`
- `manualChunks` isola cinco grupos de fornecedores: `react-vendor` (React + ReactDOM + react-router-dom), `motion-vendor` (framer Motion), `supabase-vendor` (@supabase/supabase-js), `icons-vendor` (lucide-react), `dnd-vendor` (@hello-pangea/dnd)
- Lazy-loading adicionado a 9 views em `AppShell.tsx` (`DashboardView`, `ProductionView`, `CalendarView`, `AIConfigsView`, `SettingsView`, `ProfileView`, `DriversView`, `CatalogView`, `NovidadesView`). `ChatView` permanece eager (view padrão e mais usada). `Suspense` boundary dentro do gate de paywall — o spinner de fallback aparece apenas no primeiro carregamento de cada view, nunca na carga inicial nem durante resolução de auth/assinatura
- Type-check verde: frontend `tsc --noEmit`

### Sprint 41 (2026-05-01) - Mensagens nao-texto mais uteis

- ✅ P2 novo / roadmap WhatsApp - Mensagens de localização, contatos, enquetes, reações, figurinhas, produto/pedido e tipos não suportados agora geram placeholders claros em PT-BR e logs melhores. Reações e votos em enquete são persistidos/broadcast, mas não disparam auto-resposta da IA - `server/messageHandler.ts`
- Novidades: 4ª e última entrada do dia, consolidando tipos de mensagem do WhatsApp - `src/data/changelog.ts`
- Type-check verde: server `tsc --noEmit -p server/tsconfig.json`

### Sprint 40 (2026-05-01) - Cardapio inteligente primeira fatia

- ✅ P1 novo / roadmap cardápio - `criar_pedido` agora resolve variações simples de produto com normalização sem acento, caixa, pontuação, plural/singular e contenção de tokens. Quando há um único produto compatível, o backend usa o nome/preço real do catálogo para recalcular total e montar resumo; quando há ambiguidade, mantém o caminho seguro de pedir verificação ao cliente - `server/ai.ts`
- Novidades: entrada PT-BR consolidada para melhor entendimento de nomes do cardápio - `src/data/changelog.ts`
- Type-check verde: server `tsc --noEmit -p server/tsconfig.json`

### Sprint 39 (2026-05-01) - Saude da IA por empresa

- ✅ P2 novo / roadmap confiança - Backend ganhou `/api/ai/health`, um resumo autenticado e seguro da prontidão da IA por empresa. Ele informa apenas presença/contagem: cardápio, horários, entrega, telefone do gerente, Pix, IA ligada, datas bloqueadas e status geral - `server/aiHealth.ts`, `server/router.ts`
- Type-check verde: server `tsc --noEmit -p server/tsconfig.json`

### Sprint 38 (2026-05-01) - Limites de custo nas rotas internas de IA

- ✅ P1 novo / roadmap custo - Rotas internas de IA agora têm limite por empresa, limite de tamanho de payload e validação rígida antes de chamar o modelo. `/api/ai/complete` aceita no máximo 40 chamadas a cada 5min, 40 mensagens e 32k caracteres; geração de instruções aceita 12 chamadas por hora e hint de até 1k caracteres - `server/aiRouteGuards.ts`, `server/router.ts`
- ✅ Compatibilidade do cliente interno - Históricos internos com mensagem sem conteúdo textual agora viram texto vazio/preview antes de chamar o proxy, evitando rejeição por payload inválido - `src/services/openaiService.ts`
- Type-check verde: `npm run lint`, server `tsc --noEmit -p server/tsconfig.json`

### Sprint 37 (2026-05-01) - WebSocket sem token na URL

- ✅ P1 novo / roadmap segurança - A conexão em tempo real não envia mais o JWT na query string. O navegador abre `/ws`, autentica com uma mensagem inicial pelo próprio socket e só recebe eventos depois de `auth_ok`; o backend fecha conexões sem autenticação em 10s e não transmite eventos para sockets anônimos - `server/ws.ts`, `src/hooks/useWhatsAppSessions.ts`
- ⚠️ Compatibilidade de deploy - Frontend e backend precisam subir juntos: frontend antigo ainda tentaria `?token=...`; backend antigo não responderia ao novo handshake `auth_ok`.
- Type-check verde: `npm run lint`

### Sprint 36 (2026-05-01) - Prompt da IA em camadas seguras

- ✅ P1 novo / roadmap IA - Instruções livres do dono agora entram no prompt como preferências de tom e estilo, sanitizadas e limitadas. Elas não podem sobrescrever regras fixas de confirmação de pedido, preço, taxa de entrega, Pix, datas bloqueadas, horário de atendimento, escalação humana ou comportamento das ferramentas - `server/ai.ts`
- Novidades: entrada PT-BR para regras importantes da IA ficarem mais firmes - `src/data/changelog.ts`
- Type-check verde: server `tsc --noEmit -p server/tsconfig.json`

### Sprint 35 (2026-05-01) - Backend como fonte da verdade da IA

- ✅ P0 novo / roadmap IA - O backend agora hidrata o perfil operacional da loja direto do Supabase antes de responder no WhatsApp: dados da empresa, Pix, telefone do gerente, instruções, entrega, horários, datas bloqueadas e cardápio real do PDV por `user_id`. O perfil é revalidado a cada 5 minutos; se essa hidratação falhar, a IA continua fail-closed e não chama a OpenAI com contexto vazio ou antigo - `server/configStore.ts`
- ✅ Redução de dependência do painel - `/api/sync-config` continua existindo como espelho em tempo real quando o operador está logado, mas deixou de ser a única fonte para cardápio/entrega/Pix após reinício do servidor - `server/configStore.ts`, `server/router.ts`
- Novidades: entrada PT-BR para a IA recuperar dados da loja sozinha - `src/data/changelog.ts`
- Type-check verde: frontend `tsc --noEmit` e server `tsc --noEmit -p server/tsconfig.json`

### Sprint 34 (2026-04-30) — Hotfix áudio antes da resposta da IA

- ✅ P0 hotfix — A IA agora aguarda transcrições de áudio pendentes antes de responder, em vez de chamar o modelo com apenas o placeholder `[Áudio]`. Isso evita respostas como “não consigo ouvir áudios” quando a transcrição já está a caminho — `server/ai.ts`, `server/messageHandler.ts`
- ✅ Modelo de transcrição atualizado — transcrição sai de `whisper-1` para `gpt-4o-mini-transcribe`, com prompt curto de contexto para lanchonete brasileira, horários, datas, Pix e produtos comuns — `server/transcription.ts`
- ✅ Operação segura — se a transcrição ainda não terminar em até 90s, a IA não inventa resposta em cima de áudio vazio; o timeout é configurável por `AUDIO_TRANSCRIPTION_WAIT_MS` — `server/messageHandler.ts`
- Novidades: entrada PT-BR para espera de áudio antes da resposta — `src/data/changelog.ts`
- Type-check/build/boot verde: teste direcionado de espera de áudio, frontend `tsc --noEmit`, server `tsc --noEmit -p server/tsconfig.json`, `vite build`, healthcheck local `/api/healthz` com webhook WhatsApp desativado (mantém o aviso existente de chunk >500 kB)

### Sprint 33 (2026-04-30) — Hotfix contexto de agenda da IA

- ✅ P0 hotfix — A IA agora revalida o contexto recente da conversa antes de responder: se ela ou o cliente já citaram uma data bloqueada, produto/pagamento solto não continua o pedido; se o contexto é uma data futura livre, a IA não confunde a continuação com pedido imediato fora do horário atual — `server/ai.ts`
- ✅ Edge cases cobertos — horário sem data cai como hoje quando não há agenda futura; horário futuro dentro da janela não é recusado só porque a loja ainda não abriu; áudio transcrito depois também entra na checagem de data/hora — `server/ai.ts`
- Novidades: entrada PT-BR para o contexto de agenda preservado — `src/data/changelog.ts`
- Teste direcionado verde: replay do print de produção, data bloqueada em 01/05, produto/pagamento após agenda futura válida, horário passado no mesmo dia, horário sem data e áudio transcrito depois
- Type-check/build/boot verde: frontend `tsc --noEmit`, server `tsc --noEmit -p server/tsconfig.json`, `vite build`, healthcheck local `/api/healthz` com webhook WhatsApp desativado (mantém o aviso existente de chunk >500 kB)

### Sprint 32 (2026-04-30) — Hotfix horário passado no mesmo dia

- ✅ P0 hotfix — A IA agora rejeita pedido para hoje em horário que já passou, mesmo quando o horário está dentro da janela de atendimento. Cobre mensagem do cliente antes da OpenAI e a trava final do `criar_pedido` antes de criar pedido pendente — `server/ai.ts`
- Novidades: entrada PT-BR para o bloqueio de horário passado no mesmo dia — `src/data/changelog.ts`
- Type-check/build verde: frontend `tsc --noEmit`, server `tsc --noEmit -p server/tsconfig.json`, `vite build` (mantém o aviso existente de chunk >500 kB)

### Sprint 31 (2026-04-30) — Hotfix horário ativo da IA

- ✅ P0 hotfix — A IA agora trata horário de funcionamento como regra forte no backend: hidrata abertura/fechamento/dias fechados direto do Supabase, bloqueia pedido para “agora/hoje” fora do horário antes da OpenAI e mantém segunda trava no `criar_pedido` para impedir botão de confirmação em horário inválido — `server/configStore.ts`, `server/ai.ts`, `server/router.ts`, `src/AppShell.tsx`
- ✅ Gestão por conversa — O assistente interno agora recebe data e hora atuais de Brasília e ignora anos antigos do histórico, evitando bloqueios de calendário em 2023 ou datas erradas — `src/services/openaiService.ts`
- Novidades: entrada PT-BR para o respeito ao horário de atendimento — `src/data/changelog.ts`
- Type-check/build verde: frontend `tsc --noEmit`, server `tsc --noEmit -p server/tsconfig.json`, `vite build` (mantém o aviso existente de chunk >500 kB)

### Sprint 30 (2026-04-30) — Hotfix datas bloqueadas da IA

- ✅ P0 hotfix — A IA agora trata datas bloqueadas como regra forte no backend: hidrata `blocked_dates` direto do Supabase, bloqueia mensagens que já pedem/encomendam para uma data bloqueada antes de chamar a OpenAI e mantém uma segunda trava no `criar_pedido` para impedir botão de confirmação em feriado ou bloqueio manual — `server/configStore.ts`, `server/ai.ts`
- ✅ Deploy hotfix — Configuração ausente de price ID do Stripe não derruba mais o servidor inteiro no import: WhatsApp/IA e `/api/healthz` sobem normalmente; ações de cobrança falham fechadas com erro claro até a env ser configurada — `server/billing.ts`
- Novidades: entrada PT-BR para o aviso imediato de data bloqueada — `src/data/changelog.ts`
- Type-check/build verde: frontend `tsc --noEmit`, server `tsc --noEmit -p server/tsconfig.json`, `vite build` (mantém o aviso existente de chunk >500 kB)

### Sprint 29 (2026-04-30) — Printer failure visibility

- ✅ P3 — Falha na impressão automática de pedido agora aparece como aviso para o operador, além do erro interno da impressora. Isso evita pedido novo ficando sem comanda impressa sem ninguém perceber — `src/AppShell.tsx`
- Type-check/build verde: frontend `tsc --noEmit`, server `tsc --noEmit -p server/tsconfig.json`, `vite build`

### Sprint 28 (2026-04-30) — Profile logout hardening

- ✅ P3 — Logout no perfil agora trata erro do Supabase: se o servidor não confirmar o encerramento da sessão, o modal mostra uma mensagem clara em português e permite tentar novamente, em vez de navegar como se tivesse dado certo — `src/components/views/ProfileView.tsx`
- Type-check/build verde: frontend `tsc --noEmit`, server `tsc --noEmit -p server/tsconfig.json`, `vite build`

### Sprint 27 (2026-04-30) — AppShell render containment

- ✅ P2.6 — `AppShell` agora memoiza as bordas das views e passa fatias estáveis de estado para telas que não consomem conversas. Mensagens novas no WhatsApp deixam de forçar repaint do kanban, agenda, configurações, perfil, motoboys e catálogo quando esses dados não mudaram — `src/AppShell.tsx`, `src/components/views/DashboardView.tsx`, `src/components/views/ProductionView.tsx`, `src/components/views/CalendarView.tsx`, `src/components/views/AIConfigsView.tsx`, `src/components/views/SettingsView.tsx`, `src/components/views/ProfileView.tsx`
- Type-check/build verde: frontend `tsc --noEmit`, server `tsc --noEmit -p server/tsconfig.json`, `vite build`

### Sprint 26 (2026-04-30) — Modal accessibility closeout

- ✅ P2.2 — Dialog surfaces now use the shared accessible modal primitive: `role="dialog"`, `aria-modal`, labelled titles, focus trap, Escape close, and return-focus. Covered confirmation modals, plan-change, catalog CRUD, new conversation, image/video preview, Calendar/Kanban/Production order drawers, and manual order modal. Remaining `fixed inset-0` usages are click-away/backdrop surfaces, not standalone dialogs — `src/components/Modal.tsx`, `src/components/views/CalendarView.tsx`, `src/components/views/KanbanView.tsx`, `src/components/views/ProductionView.tsx`, `src/components/views/MessageBubble.tsx`
- Type-check verde: frontend `tsc --noEmit` + `tsc --noEmit -p server/tsconfig.json`

### Sprint 25 (2026-04-30) — Chat list performance

- ✅ P2.4 — Lista de conversas agora usa windowing quando passa de 80 conversas: renderiza só linhas visíveis + overscan, reduzindo DOM e timers SLA ativos em listas grandes — `src/components/views/ChatView.tsx`
- Type-check verde: frontend `tsc --noEmit` + `tsc --noEmit -p server/tsconfig.json`

### Sprint 24 (2026-04-30) — Modal accessibility + billing edge cases

- ✅ P2.12 — `change-plan` agora detecta erro Stripe de confirmação/autenticação do cartão e retorna `PAYMENT_ACTION_REQUIRED`; frontend mostra ação de abrir portal em vez de erro genérico — `server/billing.ts`, `src/components/views/PlanChangeModal.tsx`
- ✅ P2.23 — Verificado como fechado via schema commitado: `zelochat_orders` tem RLS ligada + policy `zelochat_orders_empresa_owner` em `000_zelochat_schema.sql`, antes da publicação realtime — `supabase/migrations/000_zelochat_schema.sql`
- 🟢 P2.2 parcial ampliado — `PlanChangeModal`, modais de catálogo e "Nova conversa" agora usam o primitive acessível (`role="dialog"`, `aria-modal`, focus trap, Escape, return-focus). Restam drawers/overlays de detalhe antes de contar P2.2 como fechado — `src/components/views/PlanChangeModal.tsx`, `src/components/views/catalog/CatalogModals.tsx`, `src/components/views/ChatView.tsx`
- Type-check verde: frontend `tsc --noEmit` + `tsc --noEmit -p server/tsconfig.json`

### Sprint 23 (2026-04-30) — P2 billing + WhatsApp hardening + audio recovery

- ✅ P2.10 — Stripe price IDs não têm mais fallback hardcoded: `STRIPE_PRICE_CHAT` e `STRIPE_PRICE_BUNDLE` agora são obrigatórios, com runbook atualizado — `server/billing.ts`, `BILLING.md`, `CLAUDE.md`
- ✅ P2.13 — retorno `?billing=success` só chama sync quando há `session_id`; backend valida que o Checkout Session pertence ao Stripe customer do usuário antes de espelhar assinatura — `src/AppShell.tsx`, `server/billing.ts`
- ✅ P2.15 — `fetchInstanceQR()` não faz mais sleeps de retry dentro do handler HTTP; retorna `connecting` rápido quando Whatsmiau ainda não entregou o QR — `server/whatsapp.ts`
- ✅ P2.18 — falhas consecutivas de transcrição de áudio agora escalam o atendimento após 3 tentativas, com aviso claro ao cliente e contador single-replica documentado — `server/messageHandler.ts`
- ✅ P2.21 — resposta da IA revalida `auto_reply`/`status` depois da chamada OpenAI e aborta se o operador assumiu a conversa durante o voo — `server/ai.ts`
- ✅ P2.25 — avatar de contato agora cai para iniciais estáveis quando a foto do Whatsmiau expira ou quebra, evitando imagem quebrada no chat — `src/components/ContactAvatar.tsx`, `src/components/views/ChatView.tsx`
- 🟢 P2.2 parcial — `ConfirmModal` agora usa o novo primitive acessível (`role="dialog"`, `aria-modal`, focus trap, Escape, return-focus). Não contado como fechado até migrar os modais custom restantes — `src/components/Modal.tsx`, `src/components/ConfirmModal.tsx`
- Novidades: entrada PT-BR para o handoff de áudio com falha — `src/data/changelog.ts`
- Type-check verde: frontend `tsc --noEmit` + `tsc --noEmit -p server/tsconfig.json`

### Sprint 22 (2026-04-30) — Tier 1 UX batch (mobile + churn prevention)

- ✅ P2.3 / P2.7 — Mobile chat detail panel: header button "Detalhes" (Info icon, `md:hidden`) abre overlay full-screen com backdrop animado no mobile; desktop inalterado (`md:flex` inline) — `src/components/views/ChatView.tsx`
- ✅ P2.8 — Onboarding phone validator agora rejeita 10-dígitos landline; aceita apenas 11-dígitos mobile (DDD + 9 + 8 dígitos); inline error PT-BR com highlight vermelho no campo; mensagem de ajuda contextual — `src/pages/OnboardingPage.tsx`
- ✅ P2.20 — `auto_reply` rate limit: máx 3 respostas AI por contato por 60s; cap-hit loga `[auto_reply] rate-limit hit for empresa=X jid=Y`; sliding window in-memory (single-replica concern documented inline em `server/index.ts`) — `server/index.ts`
- Type-check verde: frontend `tsc --noEmit` + `tsc --noEmit -p server/tsconfig.json`

---

### Sprint 21 (2026-04-30) — P2 security/LGPD + operational health

- ✅ P2.14 — PII redacted from billing logs: `redactEmail()` + `redactCustomerId()` helpers em `server/redact.ts`; aplicados em todos os logs de `server/billing.ts` que continham email, customer_id, last4
- ✅ P2.16 — `messages.update` broadcast agora valida `empresa_id === empresaId` antes de transmitir pro frontend; JID format check também — `server/router.ts`
- ✅ P2.9 — "Exportar backup" agora exporta apenas config (businessInfo, triggers, quickResponses, aiInstructions, drivers, blockedDates, deliveryConfig). Sessions, messages, orders e managerHistory excluídos. Arquivo renomeado `zelochat-config-*` + `_notice` explicativo — `src/components/views/SettingsView.tsx`
- ✅ P2.19 — `startPendingOrderSweeper()`: roda 2min após boot + a cada 24h, deleta `zelochat_pending_orders` com `expires_at < NOW() - 7 days` — `server/pendingOrderSweeper.ts` (novo) + wired em `server/index.ts`
- ✅ P2.22 — `managerHistory` capped em 100 entries via `.slice(-100)` nos dois paths de append — `src/components/views/AIConfigsView.tsx`
- ✅ P2.17 — `extractText` agora loga `[extractText] unknown message type:` antes do fallback `return null` — `server/messageHandler.ts`
- Type-check verde: frontend `tsc --noEmit` + `tsc --noEmit -p server/tsconfig.json`

---

### Sprint 20 (2026-04-30) — P1 security + billing UX + form persistence

- ✅ P1.2 — `isAllowedMediaUrl` allowlist: HTTPS + hostname against `storage.googleapis.com`, `supabase.co`, `whatsmiau.dev` etc. Blocks attacker-controlled URLs in webhook payload — `server/messageHandler.ts`
- ✅ P1.8 — `buildContactKey` normalizes 11-digit mobile (DDD + '9' + 8 digits) to 10-digit base; `formatPhone` handles 10-digit local numbers — `src/domain/chat.ts`, `server/messageHandler.ts`
- ✅ P1.28 — Trialing users: backend blocks duplicate Stripe checkout with `TRIALING_USE_PORTAL` error; frontend shows "período de avaliação" headline + routes to portal — `server/billing.ts`, `src/components/views/SettingsView.tsx`
- ✅ P1.29 — Paused subscription: `needsPortal` includes `'paused'`; dynamic badge (`STATUS_LABEL` map + color classes); `SUBSCRIPTION_PAUSED` error replaces misleading `SUBSCRIPTION_PAYMENT_ISSUE` — `server/billing.ts`, `src/components/views/SettingsView.tsx`
- ✅ P1.40 — `useLocalDraft` hook: debounced localStorage persistence, server-sync guard, `isDirtyVsServer`, `hasStoredDraft`; wired into `SettingsView` (business info + hours) and `AIConfigsView` (AI instructions); restore toast on mount — `src/hooks/useLocalDraft.ts`, `src/components/views/SettingsView.tsx`, `src/components/views/AIConfigsView.tsx`
- Type-check verde: frontend `tsc --noEmit` + `tsc --noEmit -p server/tsconfig.json`

### Sprint 19 (overnight automated, 2026-04-30)

- ✅ P3 — copy polish (PT consistency + remove dead Camera button) — task 1
- ✅ P2.11 — `priceBRL` constants consolidados em `src/data/pricing.ts` — task 2
- ✅ P1.37 — paywall banner hide on `subscriptionLoading=true` — task 3
- ✅ P2.1 — confirm/alert nativos substituídos por `ConfirmModal` + `useToast` — task 4
  - Novo `src/components/ConfirmModal.tsx` (shared, reused in all 8 callsites)
  - `CatalogModals.ConfirmDelete` delegado ao novo `ConfirmModal`
  - 8 callsites migrados: CalendarView, AIConfigsView, ChatView (×2), DriversView, ProductionView, ProfileView, SettingsView
  - 2 alert() → useToast (CalendarView: info + error)
- Type-check verde nos 2 tsconfigs

### Sprint 1 (shipped 2026-04-29) — revenue + correctness
- ✅ P0.9, P0.10 — order-confirm regex
- ✅ P0.11 — last_confirmed_at DB fallback
- ✅ P0.15, P0.16 — paywall middleware + frontend gate
- ✅ P0.17 — fail-closed subscription cache
- ✅ P0.20 — logout localStorage clear
- ✅ Type-check clean (`npm run lint` and `tsc --noEmit -p server/tsconfig.json`)

### Sprint 2 (shipped 2026-04-29) — schema in source control
- ✅ P0.23, P0.12, P0.24 — captured live schema as `000_zelochat_schema.sql`. ZeloChat-only, idempotent, with explicit ZeloPDV-boundary header.
- 📝 Old `001_*.sql … 013_*.sql` retained as historical record; superseded by `000_*.sql` for fresh-DB bootstrap.

### Sprint 4 (shipped 2026-04-29) — P0.14 activation + P0.5 hardening + P0.3 dead code + P0.2 singleton kill
- ✅ P0.14 — `upsertInboundUserMessage` with `onConflict: 'empresa_id,wa_message_id'` shipped. `handleIncomingMessage` returns boolean; `index.ts` skips auto-reply on duplicate redelivery. Whatsmiau retries no longer create double messages or double-fire AI.
- 🟢 P0.5 — NEW media uploads now use `${prefix}/${empresaId}/${randomHex16}-${fileName}`. Cross-tenant enumeration of new files is combinatorially infeasible (128-bit slug + scoped path). Historical files remain at old paths until a retroactive cleanup migration runs.
- ✅ P0.3 — `getEmpresaForInstance` (with stale-cache fallback) deleted. Webhook path now exclusively uses `getEmpresaAndTokenForInstance` which fails closed → Whatsmiau retries → idempotent processing via wa_message_id.
- ✅ P0.2 — `boundEmpresaId` singleton kill. All operational helpers (`getSession`, `getAllSessions`, `markSessionAsRead`, `deleteSession`, `addAssistantMessage`, `addToolMessage`, `setAutoReply`, `updateSessionName`, `handleIncomingMessage`, `generateAndSendReply`) require `empresaId: string` — TS enforces. The singleton is narrowed to ONLY `broadcastLegacyLifecycleEvent` in whatsapp.ts, which no-ops in multi-tenant mode (closes P1.11 fan-out leak too).
- Type-check clean: `npm run lint` ✅ + `npx tsc --noEmit -p server/tsconfig.json` ✅

### Sprint 3 (shipped 2026-04-29) — remaining P0s
**Code (no migration needed) — applied:**
- ✅ P0.1 — webhook_token validate-if-present (flip with `WEBHOOK_REQUIRE_TOKEN=1` once Whatsmiau is configured)
- ✅ P0.4 — `/api/produtos` proxy now requires JWT (`requireEmpresaId`)
- ✅ P0.13 — hard-button retry idempotency (prevents double-ack on Whatsmiau redeliveries)
- ✅ P0.18 — Stripe Checkout `idempotencyKey` (5-min bucket — double-click safe, retries-after-decline fresh)
- ✅ P0.19 — Stripe email-lookup removed (Checkout/Portal/sync all DB-rooted)
- ✅ P0.21 — `useOrders.ts` defense-in-depth empresa filter on every CRUD
- ✅ P0.22 — driver lookup + escalation update/acknowledge paths empresa-scoped (also closes P1.1)
- ✅ Critical-function butterfly-effect docs added to `generateAndSendReply`, `confirmPendingOrder`, `processWebhookEvent`, `/webhook/:instance`, paywall middleware
- ✅ CLAUDE.md gained "Shared database with ZeloPDV" + "Critical functions" sections

**Migrations APPLIED (and code activation):**
- ✅ `014_zelochat_rls_hardening.sql` — APPLIED. Adds policies for `zelochat_pending_orders` (P0.7), UPDATE/DELETE on `zelochat_messages` (P0.8), INSERT/DELETE on `zelochat_escalation_events` (P0.8), DELETE on `zelochat_sessions`.
- ✅ `015_wa_message_id_idempotency.sql` — APPLIED. Code-side activation also shipped: `server/messageHandler.ts` now uses `upsertInboundUserMessage` with `onConflict: 'empresa_id,wa_message_id'`, returns `boolean`; `server/index.ts` skips auto-reply when handler returns `false` (duplicate redelivery). Closes P0.14 fully.

### Sprint 5 (shipped 2026-04-29) — P0.6 from PDV repo + P0.5 retroactive
- ✅ P0.6 — `empresa_perfil` UPDATE policy gained `WITH CHECK (auth.uid() = user_id)`. Closes empresa transfer/theft vector. Applied to prod via Supabase MCP. SQL doc at `zeloPDV-Prod/.ai/migrations/empresa_perfil_update_with_check.sql` (PDV gitignora `.ai/`).
- ✅ P0.5 retroactive — dry-run via `storage.objects` revealed only 4 historical files at old enumerable paths, all confirmed orphans (zero references in `zelochat_messages.content`). One-off cleanup script `scripts/cleanup-orphan-media.ts` ships in this commit; run with `npx tsx scripts/cleanup-orphan-media.ts` to remove them via Storage API.
- **All 24 P0s now addressed.** 24 fully closed pending one-time script execution for P0.5 cleanup.

### Sprint 18 (shipped 2026-04-29) — P0.1 pivot to URL-as-secret + legacy instance rotation
- ✅ **P0.1 verdict — Whatsmiau headers config is UI-only, doesn't actually forward.** WEBHOOK_DEBUG_HEADERS diagnostic captured 2 events post-deploy + 14 events post-reconnect from Donutopia, all with `sensitive=[]` (zero auth-shaped headers arrived). Body keys also clean (no embedded auth). Strict-mode header validation is not viable; abandoning that path.
- ✅ **Adopted URL-as-secret as the auth boundary.** New instances created via `createInstance()` already use `zelo-{empresa8}-{16hex}` = 64 bits of entropy → unguessable URL path. Token-validation code in `/webhook/:instance` left dormant (no-op until Whatsmiau fixes header forwarding); `auth_status` column on `zelochat_webhook_events_raw` is the canary.
- ✅ **Removed diagnostic + log spam.** `WEBHOOK_DEBUG_HEADERS` block deleted (purpose served). The `[Webhook] token-missing` warning log removed — would fire on 100% of real traffic now and is pure noise. Strict-mode reject + token-mismatch logs preserved (real attack signals).
- ✅ **Rotated 2 legacy instances** (Donutopia `zelo-28400a79` + Casa dos Salgados `zelo-70ec4c72`, both enumerable from empresa UUID). Whatsmiau DELETE + DB null. Customers reconnect via existing /api/qr flow → auto-creates new instance with random suffix. Casa dos Salgados scheduled for tomorrow morning (operator confirmed both empresas idle now).
- ✅ Documented URL-as-secret as the auth boundary in `CLAUDE.md` §"Webhook auth boundary".
- Type-check ✅

### Sprint 17 (shipped 2026-04-29) — P0.1 strict-mode prep + P1.13 sweeper + P1.4 redaction
- ✅ **P0.1 strict-mode visibility** — `zelochat_webhook_events_raw.auth_status` (migration `017_webhook_events_raw_auth_status.sql`). Router stamps each row with `token_match` / `token_missing` / `token_mismatch`. Pre-flip query: `SELECT auth_status, COUNT(*) FROM zelochat_webhook_events_raw WHERE received_at > now() - interval '24 hours' GROUP BY 1`. Zero `token_missing` over 24h = safe to set `WEBHOOK_REQUIRE_TOKEN=1`. Whatsmiau-side headers already configured for both active empresas (Donutopia + Casa dos Salgados) via `POST /webhook/set/{instance}` with `headers: {apikey: webhook_token}`.
- ✅ **P1.13** — subscription sweeper (`server/subscriptionSweeper.ts` + CLI `scripts/sweep-canceled-subscriptions.ts`). Resolves "active" via the same `resolveActiveSubscription` predicate as the paywall (manually_extended_until OR provider status), defaults 30-day grace, dry-run by default in CLI mode. Wired in `server/index.ts` to run 5min after boot + every 6h. Conservative: customer churn → Whatsmiau instance reaped → re-scan QR re-provisions on renewal. Customer data (messages, sessions, orders) NOT touched.
- ✅ **P1.4** — instance names redacted in logs (`server/redact.ts` w/ `redactInstance` + `redactToken`). Touched: `server/router.ts` `/webhook/:instance` (5 spots), `server/whatsapp.ts` (7 spots — incl. the global `[WhatsApp] Instances found` JSON dump that previously leaked the entire fleet's names + ownerJids; now logs only count), `server/subscriptionSweeper.ts` (3 spots). Defense-in-depth: pre-P0.1 instance name was the auth boundary; even post-`webhook_token` a leaked name still confirms tenant existence + narrows attacker search. Pattern: `zelo-70ec4c72` → `zelo-***4c72`, enough suffix for ops correlation.
- Type-check ✅

### Sprint 16 (shipped 2026-04-29) — webhook_events_raw defense + P0.5 cleanup executado
- ✅ **Defense permanente contra futuros P0.14**: nova tabela `zelochat_webhook_events_raw` (migration `016_webhook_events_raw.sql`, APLICADA em prod via MCP) registra cada payload de `/webhook/:instance` ANTES do processamento. RLS on, 0 policies (service-role only) — payloads contêm telefones/conteúdo de outros tenants se a resolução de instance falhar. Helper em `server/webhookLog.ts` com `recordRawWebhookEvent` + `markWebhookEventProcessed`. Wired em `router.ts /webhook/:instance` após o ack (não bloqueia Whatsmiau). Falhas de log são swallowed — defense layer não pode quebrar o ack path. Base64 de mídia é stripped antes do insert pra manter row size bounded. Próxima regressão na persistência vira reprocessável via SELECT em `zelochat_webhook_events_raw WHERE processed_at IS NULL OR processing_error IS NOT NULL`.
- ✅ P0.5 cleanup — `npx tsx scripts/cleanup-orphan-media.ts` rodado. 4 órfãos pré-P0.5 deletados via Storage API. Verificação: 0 arquivos restantes em paths enumeráveis. Bucket fully clean.
- ✅ Type-check `npm run lint` + `tsc -p server/tsconfig.json`

### Sprint 15 (shipped 2026-04-29) — Recovery dos dados perdidos pela regressão P0.14
**Análise de impacto:**
- 2 sessions afetadas: Gustavo + Ricardo (ambas Donutopia — empresa de teste do founder)
- **Casa dos Salgados (R$3k cliente real): 0 mensagens perdidas** ✅
- Janela: 18:00–22:00 UTC em 2026-04-29

**Tentativa de recovery via Whatsmiau API:**
- Probe em /v2/chat/findMessages, /evolution/chat/findMessages, /chat/fetchMessages, /message/findMessages, vários paths e variantes do instance ID. Todos 404.
- Conclusão: Whatsmiau **não expõe endpoint de histórico de mensagens** — só envio + webhook config (/webhook/find/{instance} funciona). Histórico é "fire-and-forget"; perdido é perdido.

**Recovery manual (apenas para Gustavo):**
- "Opa" recuperado a partir de `zelochat_sessions.last_message` (que ensureSession atualizou mesmo quando o upsert falhou). INSERT manual em `zelochat_messages` com `wa_message_id = NULL` (sem ID original; partial unique index só constrange when not-null, então OK).
- Ricardo: texto original perdido para sempre — `last_message` foi sobrescrito pelo reply da AI antes de eu poder fazer recovery. Lesson: ensureSession sobrescreve last_message tanto em msgs user quanto assistant.

**Lessons learned:**
1. Sempre que mexer em paths críticos de persistência, fazer dry-run com SQL `RETURNING` em ambiente real ANTES de deploy.
2. Whatsmiau não tem fallback de history — toda perda em janela de bug é definitiva. Considerar persist webhook payload BRUTO em uma tabela de log antes de processar (defesa contra futuros bugs similares).

### Sprint 14 (shipped 2026-04-29) — P1.35 quick-response error feedback
- ✅ P1.35 — `scheduleQrSave` em `AIConfigsView` agora mostra toast em failure. Antes só limpava `qrSaveState` e logava no console — operador via "Saving..." piscar e sumir, achava que tinha salvo, próxima vez que abria viu a mudança perdida.
- Type-check ✅

### Sprint 13 (shipped 2026-04-29) — CORS leak + rate limit
- ✅ P1.5 — CORS callback agora `cb(null, false)` em vez de throw. Antes a Error message expunha `FRONTEND_URL` em respostas 500 — qualquer atacante descobria a allowlist via origin proibido.
- ✅ P1.3 — rate limit per-empresa em `/api/whatsapp/validate-numbers`: 200 números/hora. Antes só cap de 50 por request mas sem janela — operador (ou token comprometido) podia rodar em loop e usar Whatsmiau como enumerador grátis de telefones com WhatsApp.
- Type-check ✅

### Sprint 12 (shipped 2026-04-29) — P1.34 sync-config feedback
- ✅ P1.34 — `syncConfigToServer` antes silenciava todo erro com `catch {}`. Agora track consecutive failures via ref e mostra UM toast após 5 falhas seguidas (~3s sem sync funcionando). On success, reseta o contador e — se o toast tinha aparecido — mostra "voltou a sincronizar". One-shot, não spam.
- Type-check ✅

### Sprint 11 (shipped 2026-04-29) — Dead-code cleanup
- ✅ P1.14 — `wipeAuthInfo` + import `rmSync` removidos. Era safety-net pré-Whatsmiau (era Baileys local). Hoje todo auth está upstream — código + footgun do `rmSync` em path relativo.
- ✅ P2.5 — segundo WebSocket em `useOrders` deletado. Era unauthenticated (sem token), redundante com a Supabase realtime subscription que já cobre INSERT/UPDATE/DELETE em zelochat_orders desde migration 012.
- Type-check ✅

### Sprint 10 (shipped 2026-04-29) — P1 batch 3
- ✅ P1.23 — `confirmPendingOrder` retry message: era "Toque em ✅ Confirmar de novo" mas o botão original já foi consumido pelo WhatsApp. Agora pede "responda *Sim*" — soft-confirm em router.ts pega e roda confirm de novo (FIX H1 mantém pending row intacta).
- ✅ P1.38 — OAuth callback timeout 8s → 20s. Conexões 3G/4G no celular do dono não cabiam em 8s, virava "OAuth falhou" injusto.
- ✅ P1.39 — `useNotificationSound` requer 3 falhas consecutivas pra flipar unlocked=false. Antes UM hiccup (GC, throttle) re-mostrava o banner.
- Type-check ✅

### Sprint 9 (shipped 2026-04-29) — P1 batch 2
- ✅ P1.7 — `wasSentByServer` TTL 30s → 10min. Cobre redeploys (2-3min) + Whatsmiau queue lag. NOTA: ainda não sobrevive a process restart — solução completa via `wa_message_id` UNIQUE persisting fica TODO. Inline doc explica.
- ✅ P1.12 — cache de 5s na `/evolution/instances` list. Antes /api/status (polled @ 3s pelo card) gerava load no Whatsmiau + log da inventário completo de instâncias.
- ✅ P1.19 — log warning quando OpenAI emite múltiplos tool_calls (raro). Refactor pra processar todos em sequência fica TODO.
- ✅ P1.22 — `clearPendingOrder` em best-effort no catch do `criar_pedido`. Antes setPendingOrder podia ter sucesso e algo downstream falhar → pending row órfã, customer dizia "sim" e o soft-confirm rodava sobre order fantasma.
- Type-check ✅

### Sprint 8 (shipped 2026-04-29) — Hotfix do P0.14 + P1 batch
- 🔥 **HOTFIX 28dd528** — `upsert(..., { ignoreDuplicates: true })` do supabase-js NÃO retorna a row em insert fresco. Minha checagem `data.length === 0` interpretava todo insert como duplicate → 531 mensagens user esperadas, **0 persistidas com wa_message_id desde o deploy**. Casa dos Salgados estava perdendo TODA mensagem inbound (last_message do session row mascarava). Trocou pra INSERT puro com catch do código 23505 (Postgres unique_violation).
- ✅ UX flicker WhatsApp `desconectado` por 3s ao trocar view: módulo-level cache de `lastKnownWaStatus` sobrevive remounts do `WhatsAppIntegrationCard`. Antes initial state hardcoded 'disconnected' fazia badge piscar vermelho até o /api/status responder.
- ✅ P1.21 — soft-confirm regex agora não strip-digit ("10s" / "5min" não viram mais "s" / "min"). Mesma whitelist exact-match do P0.9/P0.10.
- ✅ P1.9 — cap de 25MB em mídia inbound base64. Antes vídeo 50MB era decodado direto pra Buffer (~75MB) no event loop — múltiplos paralelos = OOM/backend crash.
- ✅ P1.20 — conversation history capped em últimas 60 turnos antes de mandar pra OpenAI. Antes cliente que chateia há meses gerava prompt linearmente crescente, escalando custo + latência sem teto.
- ✅ P1.15 — hard-button regex agora normaliza accent + emoji + punct + case e match por token "confirmar"/"cancelar". Antes exact-match "✅ Confirmar" perdia variantes ("✅Confirmar", "Confirmar ✅", "CONFIRMAR", VS16) que caíam no AI como freeform → duplicate-order risk.
- ✅ P1.6 — per-empresa in-flight mutex em `getOrCreateOwnInstanceForEmpresa`. Duas abas abrindo /api/qr simultaneamente não criam mais instâncias órfãs no Whatsmiau. Multi-node deploy precisaria de advisory lock — flagged inline.
- Type-check ✅

### Sprint 7 (shipped 2026-04-29) — P1 segurança batch (D)
- ✅ P1.18 — sanitização ampla em `criar_pedido`: `customerName`, `deliveryAddress`, `deliveryNeighborhood`, `pickupTime`, `paymentMethod` agora todos passam por `safeForPrompt` antes de persistir em `zelochat_pending_orders`. Antes só `observations` era sanitizado — quebra de linha ou backtick num customerName injetado podia virar prompt-injection ao ser lido em turnos posteriores.
- ✅ P1.24 — `phoneToJid` (em escalation.ts E ai.ts) agora valida estritamente: aceita só 10-11 dígitos (Brasil sem DDI, prepend 55) ou 12-13 dígitos começando com 55. Antes "211999998888" passava → JID inválido → Whatsmiau silenciava entrega → gerente nunca recebia notificação de escalação.
- ✅ P1.10 — `confirmPendingOrder` e `cancelPendingOrder` agora try/catch do `sendTextMessage`. Em failure, persiste a tentativa com prefixo `[FALHA NO ENVIO — reenviar manualmente]` em `zelochat_messages` pra que o operador veja no chat history. Pedido em DB não é afetado (já rolou). Antes Whatsmiau 5xx fazia o pedido ser criado sem o customer receber confirmação, customer ligava perguntando "foi?".
- Type-check ✅

### Sprint 6 (shipped 2026-04-29) — P1 user-facing UX batch (C)
- ✅ P1.30 — drag-and-drop status update agora rolls back optimistic state em failure + toast "Voltei pra coluna anterior".
- ✅ P1.31 — `handleAddOrder/EditOrder/DeleteOrder` em AppShell agora try/catch + toast de sucesso/erro + rollback.
- ✅ P1.32 — sign-up "Verifique seu e-mail" tem botão "Reenviar e-mail de confirmação" + estados sending/sent/error visíveis. Operador não-técnico não fica preso achando que sistema quebrou.
- ✅ P1.33 — novo state `wsConnected` no `useWhatsAppSessions` separa o WebSocket layer da WhatsApp layer. AppShell renderiza pill âmbar "Reconectando ao servidor…" quando WS dropou mas WhatsApp ainda está OK. Antes, operador via "Conectado" falso enquanto WS estava drop.
- ✅ P1.36 — trigger CRUD em `AIConfigsView` agora reporta toda failure via toast (antes era `void X.catch(()=>{})`); deleção também faz toast de success.
- 🆕 Sistema de toast in-app: `src/contexts/ToastContext.tsx` + `<ToastProvider>` envolvendo `<Routes>` em `App.tsx`. Reuse via `useToast()` hook em qualquer componente. Variantes success/error/info, stacking top-right, auto-dismiss (4s success/info, 8s error). Lucide icons + Motion animations.
- Type-check ✅

**Type-check status:** `npm run lint` ✅ + `npx tsc --noEmit -p server/tsconfig.json` ✅

---

## Operational notes for the live customer

- The paywall middleware will return **402** on previously-open routes. Watch Dokploy/backend logs for `[paywall] gate error` and customer-support tickets in the first hour after deploy.
- The fail-closed subscription cache means a Supabase outage will lock out users whose cache hasn't been seeded. First request after deploy warms the cache.
- The order-confirm DB lookup adds one extra Supabase round-trip per `criar_pedido` tool call — single-digit ms.
- The frontend logout now wipes `localStorage` keys — users will lose UI prefs (sidebar width, calendar mode) on next login. Acceptable tradeoff for the cross-tenant data leak.

---

## How to update this file

When you ship/draft a fix:
1. Flip the row in the table above (⏳ → 🟡 / ✅ / 🟥).
2. Add a one-line entry to the relevant Sprint section.
3. If the fix changes a CRITICAL function (one whose breakage cascades), add an inline JSDoc-style comment to the function explaining the chain effect — see `server/ai.ts` `generateAndSendReply` for the pattern.

If you're closing out a sprint:
1. Run `npm run lint` AND `npx tsc --noEmit -p server/tsconfig.json`. Both must pass.
2. Write a short post-deploy checklist at the bottom of the sprint section.
