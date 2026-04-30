# Session Handoff — 2026-04-30 (Sprint 21 close)

> Single-page operator runbook + briefing for the next agent. **The live audit tracker is [FIXES_PROGRESS.md](./FIXES_PROGRESS.md)** — this doc only captures what FIXES_PROGRESS doesn't (operator notes, prod verification queries, current customer state).

## 📖 Read first

1. **[CLAUDE.md](./CLAUDE.md)** — project context, shared-DB boundary with ZeloPDV, critical-functions index.
2. **[CODE_REVIEW.md](./CODE_REVIEW.md)** — original senior audit (24 P0 / 47 P1 / 38 P2 / 24 P3).
3. **[FIXES_PROGRESS.md](./FIXES_PROGRESS.md)** — live tracker. Update whenever shipping a fix.
4. **[BILLING.md](./BILLING.md)** — Stripe/Asaas runbook.

Inline `🚨 CRITICAL` JSDoc comments mark functions whose breakage cascades to customer money loss. `grep -rn "🚨 CRITICAL" server/ src/` to enumerate.

## ✅ Estado de produção (live em `main`)

- **24/24 P0s closed** ✅
- **41/47 P1s closed** (87%) — 0 actively pending, 3 deferred to multi-replica (P1.16, P1.17, P1.43)
- **10/38 P2s closed** (26%) — Sprint 21 batch landed: P2.9, P2.14, P2.16, P2.17, P2.19, P2.22 (plus P2.1, P2.5, P2.11 from earlier sprints)
- **5 migrations live in prod**: `014_zelochat_rls_hardening`, `015_wa_message_id_idempotency`, `016_webhook_events_raw`, `016b_webhook_events_raw_auth_status`, `empresa_perfil_update_with_check` (from PDV repo)
- **Type-check verde** nos dois tsconfigs
- Último commit: `git log -1 --oneline`

## 💰 Cliente atual

- **Casa dos Salgados** (`leri.nascimento@hotmail.com`, empresa `70ec4c72-…`, instance rotated Sprint 18 — agora pattern `zelo-{empresa8}-{16hex}`)
- Contrato R$3k, `manually_extended_until = 2026-05-31`
- **Donutopia** = founder test tenant — pode quebrar, sem impacto comercial

## 🎯 Sugestões de próxima sprint

Critério de prioridade: customer-impact > LGPD > tech debt > a11y.

### Tier 1 — UX gaps que viram churn em SaaS BR
- **P2.3 / P2.7** — chat detail panel `hidden md:flex`. Operador no celular não consegue escalar manualmente nem ver log de escalação. Mobile-first é hard requirement no público alvo (donos de lanchonete).
- **P2.8** — onboarding step 2 phone validator aceita 10-dígitos landline como WhatsApp. Conta não recebe mensagens, customer churn em D+1.
- **P2.20** — `auto_reply` debounce de 1500ms. Customer mandando "msg, msg, msg, msg" em 2s gera 4× cost OpenAI. Cap por contato/minuto.

### Tier 2 — operacional / observabilidade
- **P2.21** — escalation race: in-flight reply pode disparar depois de `auto_reply=false`. Customer escalado vê AI ainda respondendo. `escalation.ts:200-208` vs `index.ts:87`.
- **P2.18** — Whisper transcription failure loop: customer dirigindo manda 5 áudios, AI responde "não entendi" cada vez. Auto-escalar após 3 falhas consecutivas de transcrição.
- **P2.25** — profile picture URLs Whatsmiau expiram em 24-48h. Re-validar ou proxy via Storage.

### Tier 3 — performance (ainda não dói, mas vai doer)
- **P2.4** — chat list não virtualizada + SLA timer per row. Tanks scroll @ 200+ chats.
- **P2.6** — `AppShell` re-render em todo WS message. Memoize.

### Multi-replica readiness (NÃO fazer enquanto single-node Railway)
- P1.16, P1.17, P1.43 — todos in-memory state que quebra com 2+ réplicas. Resolver antes de scale horizontal.

## 🌙 Schedule overnight — guia rápido

**Critério overnight-safe**: frontend-only OU additive logging OU pure refactor. NÃO scheduler webhook handler, AI dispatch, order pipeline, billing, schema migrations, multi-replica concerns.

**Bons candidatos pra `/schedule`**:
- P3 batch (copy/PT polish, dead button onClick, etc.) — Tier S
- P2.4 / P2.6 (perf) só se vier com benchmark antes/depois
- P2.25 (profile pic re-validation) — frontend fallback

**NUNCA scheduler**:
- Qualquer P1 deferred (multi-replica)
- P2.18 / P2.20 / P2.21 (AI dispatch path)
- Anything Whatsmiau API call que muda connection state

## ⚠️ Riscos a NÃO esquecer

1. **Tabelas compartilhadas com ZeloPDV** — ver §"Shared database with ZeloPDV" em CLAUDE.md. Lista do que NÃO mexer daqui.
2. **Singleton `boundEmpresaId`** — agora narrowed para SÓ broadcast lifecycle legacy. Não trazer de volta o default em helpers operacionais.
3. **Order confirmation 3-layer trap** — CLAUDE.md §"Order confirmation flow". Inline 🚨 CRITICAL em `generateAndSendReply`, `confirmPendingOrder`, `processWebhookEvent`.
4. **`upsert(..., { ignoreDuplicates: true })` do supabase-js** — JÁ NOS QUEIMOU UMA VEZ (P0.14 hotfix Sprint 8). Não retorna row em insert fresco. Use INSERT puro + catch de `error.code === '23505'`.
5. **URL-as-secret é o auth boundary** — não regenerar `webhook_token` em `empresa_perfil` (dormente mas reservada). Whatsmiau v2 não forwarda `headers.apikey`, então strict mode (`WEBHOOK_REQUIRE_TOKEN=1`) NÃO É VIÁVEL hoje.
6. **Local dev steals prod webhook** — sempre setar `WHATSMIAU_DISABLE_WEBHOOK_REGISTER=1` em `.env` local antes de `npm run dev:server`.

## 🚀 Verificação de saúde de produção

```sql
-- 1. wa_message_id sendo populado (P0.14 idempotency funcionando)
SELECT
  COUNT(*) AS total_user_msgs_recent,
  COUNT(*) FILTER (WHERE wa_message_id IS NOT NULL) AS with_wa_id
FROM zelochat_messages
WHERE role = 'user' AND sent_at > now() - interval '1 hour';
-- Esperado: with_wa_id == total. Se não, hotfix do P0.14 regrediu.

-- 2. RLS policies hardened (P0.7 + P0.8 — confirma migration 014 ainda live)
SELECT tablename, COUNT(*) AS policy_count
FROM pg_policies
WHERE schemaname = 'public' AND tablename LIKE 'zelochat_%'
GROUP BY tablename;
-- Esperado: policies em pending_orders, messages, escalation_events, sessions, drivers, triggers, quick_responses.

-- 3. Subscription da Casa dos Salgados ativa
SELECT id, status, plan_tier, current_period_end, manually_extended_until
FROM subscriptions
WHERE id = '8edfe91d-585d-4c1c-9bad-c34c223816f3';
-- Esperado: status='active', manually_extended_until > now().

-- 4. empresa_perfil UPDATE policy tem WITH CHECK (P0.6)
SELECT policyname, qual, with_check
FROM pg_policies
WHERE schemaname='public' AND tablename='empresa_perfil' AND cmd='UPDATE';
-- Esperado: qual = with_check = (auth.uid() = user_id)

-- 5. webhook_events_raw rodando (defense-in-depth Sprint 16)
SELECT auth_status, COUNT(*)
FROM zelochat_webhook_events_raw
WHERE received_at > now() - interval '24 hours'
GROUP BY auth_status;
-- Hoje: maioria 'token_missing' (esperado — Whatsmiau não forwarda header).
-- Quando virar majority 'token_match', considerar habilitar WEBHOOK_REQUIRE_TOKEN=1.

-- 6. Pending orders sweeper (P2.19 Sprint 21) está limpando
SELECT COUNT(*) AS expired_unswept
FROM zelochat_pending_orders
WHERE expires_at < NOW() - INTERVAL '7 days';
-- Esperado: 0 ou poucos (sweeper roda a cada 24h).
```

Se algo aqui não bater, **investigar antes de mudar mais qualquer coisa**.

## 📝 Convenção pra updates deste doc

Quando fechar uma sprint:
1. Atualizar §"Estado de produção" com novos counts (puxar de FIXES_PROGRESS.md header).
2. Mover items shippados pra fora de §"Sugestões de próxima sprint".
3. Adicionar novos riscos descobertos em §"Riscos a NÃO esquecer".
4. Adicionar verificação SQL nova se a sprint introduziu defesa permanente.

Não duplicar o tracker de fixes aqui — FIXES_PROGRESS.md é authoritative.
