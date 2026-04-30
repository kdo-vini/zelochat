# Session Handoff — 2026-04-29 (Sprint 18 close)

> ✅ **Sprint 19 overnight chain completed em 2026-04-30T03:00:00Z.** 4 tasks shipped: P3 copy + P2.11 + P1.37 + P2.1. Ver `git log --since="3 hours ago" --oneline` pra commits.

Sessão original ~14h + continuação Sprint 18 (rotação Whatsmiau + admin painel fix). 27+ commits em produção. Este doc é o **briefing pro próximo agente** começar limpo.

## 📖 Leia ANTES de qualquer coisa

1. **[CLAUDE.md](./CLAUDE.md)** — contexto do projeto, regras de ouro, shared-DB com ZeloPDV, funções críticas.
2. **[CODE_REVIEW.md](./CODE_REVIEW.md)** — auditoria sênior original (24 P0 / 47 P1 / 38 P2 / 24 P3).
3. **[FIXES_PROGRESS.md](./FIXES_PROGRESS.md)** — tracker linha-a-linha do que foi shipped, drafted, blocked.
4. **[BILLING.md](./BILLING.md)** — runbook Stripe/Asaas.

Os comentários `🚨 CRITICAL — butterfly effect` no código (grep `🚨 CRITICAL` em `server/` e `src/`) marcam funções cuja quebra cascateia em perda de dinheiro do cliente. Trate-os como contratos.

## ✅ Estado de produção (live em `main`)

- **24/24 P0s shipped** ✅
- **35/47 P1s closed** (28 explicit + 7 verificados via cross-fix — ver §"P1s closed via cross-fix" abaixo)
- **9 P1s pending** + **3 deferred** (multi-replica, single-node Railway hoje)
- **1 P2 shipped** (P2.5)
- **3 migrations aplicadas em prod**: `014_zelochat_rls_hardening`, `015_wa_message_id_idempotency`, `016_webhook_events_raw` (+ `017_webhook_events_raw_auth_status` via MCP, sem arquivo local)
- **1 migration aplicada do PDV repo**: `empresa_perfil_update_with_check`
- **Type-check verde** nos dois tsconfigs.
- Último commit em `origin/main`: ver `git log -1 --oneline`.

### Sprint 18 close (2026-04-29)
- ✅ **P0.1 verdict — Plano D adotado**: investigação via `WEBHOOK_DEBUG_HEADERS` provou que Whatsmiau aceita o config `headers.apikey` mas não forwarda. URL-as-secret (sufixo 16-hex random no instance name = 64 bits) é o auth boundary atual.
- ✅ **Rotação das 2 instâncias legacy**: Donutopia agora em `zelo-28400a79-71e670ef209c9597` (connected, 13+ events recebidos). Casa dos Salgados em `whatsmiau_instance=NULL` aguardando primeiro `/api/qr` amanhã cedo (auto-cria com pattern random).
- ✅ **P1.4 (instance redaction)** + **P1.13 (subscription sweeper, cron 6h)** shipped.
- ✅ **PDV admin panel fix** ([zelopdv@34a7b3a](https://github.com/kdo-vini/zelopdv/commit/34a7b3a)): painel agora respeita `manually_extended_until` em todas as telas (subscriptions, users, dashboard). Skip analytics — domain decision pendente.

### P1s closed via cross-fix (não na lista de "shipped explicit", mas verificados como resolvidos)
- **P1.1** — escalation update empresa-scoped via P0.22 fix
- **P1.11** — `broadcastLegacyLifecycleEvent` agora scoped via `getBoundEmpresaId()` desde P0.2 narrowing
- **P1.25** — `syncFromStripe` filtra `['chat','bundle']` em `existingRows` (`billing.ts:219`)
- **P1.26** — `createPortalSession` exige `provider_customer_id` do DB (`billing.ts:362`); email-lookup removido
- **P1.27** — `idempotencyKey` em Checkout cobre double-click (`billing.ts:295`); pre-record de `incomplete` row
- **P1.41** — `webhook_token` wired em `getEmpresaAndTokenForInstance` (dormente apenas pelo bug Whatsmiau-side, código completo)
- **P1.42** — `zelochat_sessions_empresa_remote_unique` UNIQUE INDEX em migration 000 (linha 99-100)
- **P1.44** — `zelochat_increment_unread` RPC em migration 000 (linha 500)

## 💰 Cliente atual

- **Casa dos Salgados** (`leri.nascimento@hotmail.com`, empresa `70ec4c72-…`, instance `zelo-70ec4c72`)
- Contrato R$3k, `manually_extended_until = 2026-05-31`. ✅ Renovação já alinhada com o cliente.
- **Donutopia** é teste pessoal do founder — pode quebrar.

## 🔥 Incidente da sessão (resolvido)

Deploy do P0.14 ativo (`a6912ff`) usou `supabase-js .upsert(..., { ignoreDuplicates: true })`. Esse padrão **não retorna a row em insert fresco** — minha checagem `data.length === 0` interpretava todo insert como duplicate → 4h de inbound silenciosamente perdidos. Hotfix `28dd528` trocou pra INSERT puro com catch de `error.code === '23505'`.

**Estrago real**: 0 mensagens em Casa dos Salgados. 2 em Donutopia (Gustavo "Opa" recuperado manualmente; Ricardo perdido — last_message overwritten pelo reply da AI). Whatsmiau **não expõe history endpoint**, validei com 12+ paths.

## 🟡 Pendente — sem urgência operacional

### P0 com follow-up
- ~~**P0.5 cleanup**~~: ✅ rodado em 2026-04-29 (Sprint 16). 0 órfãos restantes.
- **P0.1 strict mode — DESCONTINUADO em favor de URL-as-secret (Plan D)**: investigação em 2026-04-29 (Sprint 18, diagnóstico `WEBHOOK_DEBUG_HEADERS`) provou que **Whatsmiau v2 aceita o campo `headers.apikey` em `/webhook/set/{instance}` mas NÃO forwarda esse header nas entregas reais** (sensitive=[] em todos os 14+ events recebidos pós-config; só headers HTTP padrão + Railway proxy). Bug Whatsmiau-side, sem ETA. **Não flipar `WEBHOOK_REQUIRE_TOKEN=1` — 401 em 100% do tráfego legítimo.** Adoção definitiva: URL-as-secret. Novas instâncias já usam `zelo-{empresa8}-{16hex}` = 64 bits de entropia. Instâncias legacy (Donutopia + Casa dos Salgados, ambas `zelo-{empresa8}` enumerável) **rotacionadas em Sprint 18** — ver runbook abaixo em §"Como flipar P0.1 strict mode" (mantido por completude, mas o caminho atual é rotação, não strict).

### P1s pending — actively shippable (9)
| ID | Descrição | Risco | File hints |
|---|---|---|---|
| P1.2 | `extractAttachmentDataUrl` confia em `mediaUrl` do payload | Médio | `messageHandler.ts:193-219` |
| P1.8 | Phone normalization landline (10 dig) vs mobile (11 dig) edge case | Baixo | `messageHandler.ts:95-101`, `domain/chat.ts:52-59` |
| P1.28 | `'trialing'` users locked out sem path claro | UX | `requireActiveZelochatSubscription` rejeita trialing |
| P1.29 | `'paused'` status sem UI pra unpause | UX | `billing.ts` |
| P1.37 | Paywall banner flicker on `subscriptionLoading=true` | Cosmético | `AppShell.tsx:573` |
| P1.40 | Forms perdem state on session expiry | Médio | múltiplos |

### P1s deferred — multi-replica (não fazer enquanto single-node Railway)
- **P1.16** — `recordAiFailure` in-memory; multi-replica = sem escalação consistente
- **P1.17** — `configStore` desync entre réplicas
- **P1.43** — `getAllSessions` table scan (escala >2k sessions)

CLAUDE.md já flag "single-replica deploy invariant". Resolver antes de scale horizontal.

### P1s shipped na Sprint 17/18
- ✅ P1.4 — instance names redatados em logs via `server/redact.ts`. Pattern `zelo-***4c72`.
- ✅ P1.13 — subscription sweeper (`server/subscriptionSweeper.ts` + cron 6h + CLI `scripts/sweep-canceled-subscriptions.ts`).

### Sugestão de defesa permanente
~~Persistir o payload BRUTO de webhook em uma tabela `webhook_events_raw` ANTES de processar.~~ ✅ Shipped em Sprint 16: tabela `zelochat_webhook_events_raw` + helper `server/webhookLog.ts` + wiring em `/webhook/:instance`. Replay query: `SELECT * FROM zelochat_webhook_events_raw WHERE processed_at IS NULL OR processing_error IS NOT NULL ORDER BY received_at DESC`.

### P2 e P3 — não tocados
37 P2s e 24 P3s da auditoria (1 P2 shipped: P2.5). Maioria é hardening / a11y / perf. Lista completa em CODE_REVIEW.md.

## 🎯 Próximas sprints recomendadas

### Sprint 19 — P1 batch final (~3-5h, single agent)
Fechar os P1s shipáveis hoje:
- P1.2 — `extractAttachmentDataUrl` allowlist Whatsmiau egress hosts
- P1.8 — landline vs mobile family separation
- P1.40 — form state hydration on session expiry
- P1.37 — paywall banner: hide on `subscriptionLoading=true`

### Sprint 20 — P2 LGPD + a11y (~4-6h, single agent)
Privacy + UX são os que mais geram churn em SaaS BR:
- P2.1 — substituir `confirm()`/`alert()` nativo por `ConfirmDelete` modal existente (8+ spots)
- P2.2 — modal a11y: `role="dialog"`, focus trap, return-focus, Escape close
- P2.9 — backup export PII redaction (LGPD)
- P2.14 — PII redaction em logs Stripe (LGPD)

### Sprint 21 — Stripe UX gaps (~2-3h)
- P1.28 — trialing user lockout: surfacear path claro (banner + Checkout que NÃO cria duplicate sub)
- P1.29 — paused subscription: UI pra unpause via portal, não via Checkout

### Sprints paralelizáveis (overnight-safe — ver §"Schedule overnight" abaixo)
Ver lista de candidatos seguros pra `/schedule` em §"Schedule overnight runners".

### Multi-replica readiness (NÃO fazer enquanto single-node)
- P1.16, P1.17, P1.43 — todos in-memory state que quebra com 2+ réplicas
- Cross-cutting #1 em CODE_REVIEW.md detalha todos os singletons

## 🌙 Schedule overnight runners — guia pro próximo agente

Operador (Vinicius) pode usar `/schedule` pra rodar trabalho enquanto dorme. **Mas tem trade-off real:** push automático = código em prod sem revisão visual. Critério pra ser overnight-safe:

1. ✅ **Frontend-only sem affecting webhook/AI/order pipeline** — quebra de UI é detectável de manhã, não causa data loss / silent failure.
2. ✅ **Additive logging / observability** — só adiciona console.log ou colunas, não muda comportamento.
3. ✅ **Pure refactor sem behavior change** — consolidar constantes, renomear, etc.
4. ❌ **NÃO scheduler:** webhook handler, AI dispatch (`generateAndSendReply`, `criar_pedido`), order pipeline, billing, schema migrations, anything multi-replica, anything que precisa visual UX validation.

**Specific concern do operador**: AI ativando sozinha durante Railway downtime já aconteceu pré-fix. Confirmar que NENHUM scheduled run toca:
- `auto_reply` debounce/scheduling
- Order confirmation regex
- `criar_pedido` / `confirmPendingOrder` / `cancelPendingOrder`
- Webhook ingest path (`/webhook/:instance`, `processWebhookEvent`)
- Whatsmiau API calls que mudam connection state

### Overnight-safe candidates (ranked por confiança)

**Tier S — quase zero risco, escolha primeira**:
- **P3 batch — copy/PT polish**: rename "Triggers personalizados" → "Gatilhos personalizados", "macro" jargon, smart-quote consistency. Só strings de UI.
- **P2.11 — consolidar `priceBRL` constants** em um arquivo só. Pure refactor.
- **P3 — Camera button no `ProfileView.tsx:113` adicionar `onClick` ou remover**. 1 linha.

**Tier A — risco baixo, bem escopado**:
- **P2.1 — substituir `confirm()`/`alert()` nativo por `ConfirmDelete` modal**. 8+ spots, mas pattern repetido. Modal já existe (`ConfirmDelete.tsx`).
- **P1.37 — paywall banner: hide on `subscriptionLoading=true`**. 1 condição em `AppShell.tsx:573`.
- **P2.17 — log unknown WhatsApp message types** em `extractText`. Pure additive logging.
- **P2.25 — profile picture re-validation** (Whatsmiau URL expira em 24-48h). Frontend-only fallback.

**Tier B — rodar em /schedule mas com cautela** (incluir verificação extra no prompt):
- **P2.2 — modal a11y** (focus trap, Escape close). Touches multiple modals — agente precisa testar cada um.
- **P2.9 — backup export PII redaction**. Touches export logic mas não runtime path.
- **P2.14 — PII redaction em logs Stripe**. Touches billing logging mas não billing logic.
- **P2.22 — `manager_history` JSONB cap** at last 100 entries. Touches escalation flow (read+write) — careful.

**❌ NÃO scheduler overnight**:
- Qualquer P1 pendente que toca pipeline (P1.2 webhook, P1.40 forms hydration)
- Multi-replica P1s (P1.16, P1.17, P1.43)
- P2.18, P2.20, P2.21 (AI dispatch path)
- P2.15, P2.16 (Whatsmiau path)
- P2.10, P2.12, P2.13 (Stripe path)
- P2.6 (memoização — perf optimizations frequentemente quebram coisas)
- P2.4 (chat list virtualization)
- P2.23, P2.24 (DB migrations)

### Template de prompt pra schedule overnight

```
Implementa [P2.X / P3.X] descrito em [CODE_REVIEW.md linha X].
Repo: zelochat (este). Branch: criar feature branch a partir de main.

Constraints (TIER A SaaS):
- Type-check verde nos 2 tsconfigs (`npm run lint` + `npx tsc --noEmit -p server/tsconfig.json`)
- NÃO mexer em: webhook handler, AI dispatch, order pipeline, billing.ts, qualquer migration
- Adicionar entrada em FIXES_PROGRESS.md (Sprint XX)
- Commit message convention: ver últimos commits via `git log -5 --oneline`
- Se quebrar build/type-check, NÃO fazer push — abrir PR com `[BLOCKED]` no título

Verificação obrigatória antes de push:
- Build verde
- Comportamento observável: [descrever o que muda visualmente / no log / no DB]
- Rollback: o que fazer se algo quebrar de manhã

Push direto pra main OK se type-check verde e mudança = TIER S/A acima. Pra TIER B, abrir PR pra review.
```

## 🐛 Bugs reportados pelo user que NÃO foram fixados

1. **WebSocket falhando às vezes** (logs do user mostraram `wss://…/ws?token=… failed`). Provavelmente transient durante Railway redeploys (ele teve 24+ redeploys hoje). O `wsConnected` indicator (P1.33 shipped) deve cobrir o feedback visual. Se persistir após Railway estabilizar, investigar.

## ⚠️ Riscos a NÃO esquecer

1. **Tabelas compartilhadas com ZeloPDV** — ver §"Shared database with ZeloPDV" em CLAUDE.md. Lista do que NÃO mexer daqui.
2. **Singleton `boundEmpresaId`** — agora narrowed para SÓ broadcast lifecycle legacy. Não trazer de volta o default em helpers operacionais.
3. **Order confirmation 3-layer trap** — CLAUDE.md §"Order confirmation flow". Inline 🚨 CRITICAL em `generateAndSendReply`, `confirmPendingOrder`, `processWebhookEvent`.
4. **`upsert(..., { ignoreDuplicates: true })` do supabase-js** — JÁ NOS QUEIMOU UMA VEZ. Não retorna row em insert fresco. Use INSERT puro + catch de 23505.

## 🚀 Como verificar tudo está OK em prod

```sql
-- 1. Confirmar wa_message_id sendo populado em msgs novas
SELECT
  COUNT(*) AS total_user_msgs_recent,
  COUNT(*) FILTER (WHERE wa_message_id IS NOT NULL) AS with_wa_id
FROM zelochat_messages
WHERE role = 'user' AND sent_at > now() - interval '1 hour';
-- Esperado: with_wa_id == total. Se não, hotfix do P0.14 regrediu.

-- 2. RLS policies hardened
SELECT tablename, COUNT(*) AS policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename LIKE 'zelochat_%'
GROUP BY tablename;
-- Esperado: 4 policies em pending_orders / messages / escalation_events / sessions / drivers / triggers / quick_responses.

-- 3. Subscription da Casa dos Salgados ativa
SELECT id, status, plan_tier, current_period_end, manually_extended_until
FROM subscriptions
WHERE id = '8edfe91d-585d-4c1c-9bad-c34c223816f3';
-- Esperado: status='active', manually_extended_until > now().

-- 4. Confirmar empresa_perfil UPDATE policy tem WITH CHECK
SELECT policyname, qual, with_check
FROM pg_policies
WHERE schemaname='public' AND tablename='empresa_perfil' AND cmd='UPDATE';
-- Esperado: qual = with_check = (auth.uid() = user_id)
```

Se algo aqui não bater, **investigar antes de mudar mais qualquer coisa**.

---

## 🔐 Como flipar P0.1 strict mode (`WEBHOOK_REQUIRE_TOKEN=1`)

Hoje o `/webhook/:instance` está em validate-if-present: aceita header `apikey` ausente (loga warning), rejeita 401 se presente e mismatch. Strict mode rejeita 401 em ausência também — fecha o vetor de webhook-spoof de vez.

**Pré-requisito**: cada empresa em uso (hoje 2 — Donutopia + Casa dos Salgados) precisa ter o Whatsmiau configurado pra enviar `apikey: <webhook_token>` em cada POST do webhook.

### Passo 1 — pegar os tokens

```sql
SELECT user_id, whatsmiau_instance, webhook_token
FROM empresa_perfil
WHERE whatsmiau_instance IS NOT NULL;
```

Cada linha = 1 par `(instance, token)`. Token é UUID gerado pela migration 009.

### Passo 2 — configurar Whatsmiau pra enviar o apikey header

Pra cada par `(instance, token)`, atualize o webhook config do Whatsmiau. Via API:

```bash
curl -X POST "https://api.whatsmiau.dev/webhook/set/<instance>" \
  -H "apikey: $WHATSMIAU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "webhook": {
      "enabled": true,
      "url": "https://zelochat-production.up.railway.app/webhook/<instance>",
      "webhookByEvents": false,
      "webhookBase64": true,
      "headers": { "apikey": "<webhook_token>" },
      "events": ["MESSAGES_UPSERT","MESSAGES_UPDATE","MESSAGES_DELETE","CONNECTION_UPDATE","CONTACTS_UPSERT"]
    }
  }'
```

Ou pelo dashboard Whatsmiau (Webhook config da instance) — setar `Custom Headers: apikey = <webhook_token>`.

> **Nota**: Whatsmiau v2 wrapper aceita `headers` no payload do webhook config. Se a flag não aparecer no dashboard, use a API REST direto.

### Passo 3 — observar Railway logs por 24h

Antes de flipar a flag, confirme que o token está chegando em 100% dos webhooks reais:

- ❌ **Indicador de problema**: `[Webhook] token-missing for instance "<X>"` ainda aparece nos logs depois da config.
- ✅ **OK pra flipar**: zero `token-missing` em 24h. Eventual `401 — token mismatch` é OK pra atacante (sinal de que strict bloqueia mesmo).

Tempo recomendado: 24h ou 1 ciclo de pico de pedidos da Casa dos Salgados — qualquer dos dois.

### Passo 4 — setar `WEBHOOK_REQUIRE_TOKEN=1` na Railway

Painel Railway → ZeloChat service → Variables → adicionar `WEBHOOK_REQUIRE_TOKEN=1` → Deploy.

### Passo 5 — verificar pós-flip

```sql
-- Volume normal de events nas últimas horas (deve continuar igual ao baseline)
SELECT date_trunc('minute', received_at) AS minute, COUNT(*)
FROM zelochat_webhook_events_raw
WHERE received_at > now() - interval '30 minutes'
GROUP BY 1 ORDER BY 1 DESC;
```

Logs Railway: 401 só aparece pra requests que não têm apikey (ou wrong). Se aparecer 401 pra requests vindos de instance legítima, reverter `WEBHOOK_REQUIRE_TOKEN` e investigar.

### Rollback

Setar `WEBHOOK_REQUIRE_TOKEN=0` (ou remover a var) → deploy. Volta pro modo validate-if-present sem perder eventos.

---

**Próxima sessão**: cole o prompt do README/CLAUDE no novo chat ou use o starter abaixo.
