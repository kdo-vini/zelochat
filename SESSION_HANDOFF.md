# Session Handoff — 2026-04-29

Sessão única, ~14h de trabalho contínuo, 24+ commits em produção. Este doc é o **briefing pro próximo agente** começar limpo.

## 📖 Leia ANTES de qualquer coisa

1. **[CLAUDE.md](./CLAUDE.md)** — contexto do projeto, regras de ouro, shared-DB com ZeloPDV, funções críticas.
2. **[CODE_REVIEW.md](./CODE_REVIEW.md)** — auditoria sênior original (24 P0 / 47 P1 / 38 P2 / 24 P3).
3. **[FIXES_PROGRESS.md](./FIXES_PROGRESS.md)** — tracker linha-a-linha do que foi shipped, drafted, blocked.
4. **[BILLING.md](./BILLING.md)** — runbook Stripe/Asaas.

Os comentários `🚨 CRITICAL — butterfly effect` no código (grep `🚨 CRITICAL` em `server/` e `src/`) marcam funções cuja quebra cascateia em perda de dinheiro do cliente. Trate-os como contratos.

## ✅ Estado de produção (live em `main`)

- **24/24 P0s endereçados** (1 com resíduo histórico documentado, 1 fora-de-repo já aplicado)
- **~28/47 P1s shipped** (os de maior impacto user-facing fechados)
- **1 P2 shipped** (P2.5 — segundo WS redundante removido)
- **2 migrations aplicadas em prod**: `014_zelochat_rls_hardening`, `015_wa_message_id_idempotency`
- **1 migration aplicada do PDV repo**: `empresa_perfil_update_with_check`
- **Type-check verde** nos dois tsconfigs.
- Último commit em `origin/main`: ver `git log -1 --oneline`.

## 💰 Cliente atual

- **Casa dos Salgados** (`leri.nascimento@hotmail.com`, empresa `70ec4c72-…`, instance `zelo-70ec4c72`)
- Contrato R$3k, `manually_extended_until = 2026-05-31`. Renovar antes disso.
- **Donutopia** é teste pessoal do founder — pode quebrar.

## 🔥 Incidente da sessão (resolvido)

Deploy do P0.14 ativo (`a6912ff`) usou `supabase-js .upsert(..., { ignoreDuplicates: true })`. Esse padrão **não retorna a row em insert fresco** — minha checagem `data.length === 0` interpretava todo insert como duplicate → 4h de inbound silenciosamente perdidos. Hotfix `28dd528` trocou pra INSERT puro com catch de `error.code === '23505'`.

**Estrago real**: 0 mensagens em Casa dos Salgados. 2 em Donutopia (Gustavo "Opa" recuperado manualmente; Ricardo perdido — last_message overwritten pelo reply da AI). Whatsmiau **não expõe history endpoint**, validei com 12+ paths.

## 🟡 Pendente — sem urgência operacional

### P0 com follow-up
- ~~**P0.5 cleanup**~~: ✅ rodado em 2026-04-29 (Sprint 16). 0 órfãos restantes.
- **P0.1 strict mode**: setar `WEBHOOK_REQUIRE_TOKEN=1` na Railway DEPOIS de configurar `apikey: <empresa_perfil.webhook_token>` no dashboard Whatsmiau pra cada empresa. Hoje está em validate-if-present (logs `[Webhook] token-missing` aparecem normalmente). Runbook abaixo em §"Como flipar P0.1 strict mode".

### P1s não shipped (lower impact)
- P1.2 — `extractAttachmentDataUrl` trusts `mediaUrl` (mais leve agora que webhook é auth'd)
- P1.4 — instance names em logs (defense-in-depth)
- P1.8 — phone normalization landline vs mobile families (edge case)
- P1.13 — subscription cancel deveria deleteInstance (precisa cron na PDV side)
- P1.16, P1.17 — multi-replica concerns (single-node Railway hoje)
- P1.25-29 — Stripe (a maioria fechada via P0.18/P0.19)
- P1.37 — paywall banner flicker on subscriptionLoading (cosmético)
- P1.40 — forms preserve nothing on session expiry (complexo)

### Sugestão de defesa permanente
~~Persistir o payload BRUTO de webhook em uma tabela `webhook_events_raw` ANTES de processar.~~ ✅ Shipped em Sprint 16: tabela `zelochat_webhook_events_raw` + helper `server/webhookLog.ts` + wiring em `/webhook/:instance`. Replay query: `SELECT * FROM zelochat_webhook_events_raw WHERE processed_at IS NULL OR processing_error IS NOT NULL ORDER BY received_at DESC`.

### P2 e P3 — não tocados
38 P2s e 24 P3s da auditoria. Maioria é hardening / a11y / perf. Lista completa em CODE_REVIEW.md.

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
