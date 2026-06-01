# ZeloChat Billing — Stripe operator runbook

**Status:** prod-ready, sem operação manual no fluxo normal. Setup é uma vez.

> Ver também: [[CLAUDE]] · [[FIXES_PROGRESS]] · [[INCIDENTS]]

## Arquitetura

```
   Browser ──▶ chat.zelopdv.com.br      (Dokploy — nginx serve SPA + reverse-proxy /api)
                       │
                       │ /api/billing/{checkout,portal,sync}   (same-origin)
                       ▼
              chat.zelopdv.com.br (backend container — Express)
                       │
                       │ stripe.checkout.sessions.create
                       │ stripe.billingPortal.sessions.create
                       ▼
                    Stripe
                       │
                       │ webhooks (events)
                       ▼
            zelopdv.com.br/api/billing/webhook   (já existe e já trata
                       │                          plan_tier='chat'/'bundle')
                       ▼
            Supabase  public.subscriptions       (tabela compartilhada
                                                   ZeloChat ↔ ZeloPDV)
```

**Pontos-chave:**

- **Mesma conta Stripe** que ZeloPDV. Não criar nova.
- **Mesma tabela `subscriptions`** (Supabase compartilhado). ZeloChat lê, ZeloPDV escreve via webhook.
- **Sem trial** no plano `chat` — `payment_method_collection: 'always'`, cobra na hora.
- **Sem webhook próprio** no ZeloChat. O webhook em `zelopdv.com.br/api/billing/webhook` já mapeia eventos Stripe → `subscriptions` para qualquer `plan_tier`.

## Variáveis de ambiente

Coloque as quatro obrigatórias no **Dokploy** (serviço `zelochat-backend`):

| Variável                                   | Valor                                                    | Obrigatória? |
| ------------------------------------------ | -------------------------------------------------------- | ------------ |
| `STRIPE_SECRET_KEY`                        | `sk_live_…` (mesma do ZeloPDV)                          | ✅ Sim       |
| `PUBLIC_APP_URL`                           | `https://chat.zelopdv.com.br`                            | ✅ Sim       |
| `STRIPE_PRICE_CHAT`                        | `price_…` do plano Chat na conta Stripe correta                  | ✅ Sim      |
| `STRIPE_PRICE_BUNDLE`                      | `price_…` do pacote Chat + PDV na conta Stripe correta            | ✅ Sim      |
| `STRIPE_BILLING_PORTAL_CONFIGURATION_ID`   | `bpc_…` (se quiser portal customizado)                  | ⚪ Não      |

**Frontend (mesmo Dokploy)**: como roda same-origin via nginx, o frontend NÃO precisa de `VITE_API_URL` em build — `src/config.ts` cai automaticamente em `window.location.origin`. Se quiser override (ex.: separar frontend/backend em domínios diferentes), passe `VITE_API_URL` como build-arg no `Dockerfile.frontend`.

## Como editar envs no Dokploy

Abra o serviço backend no painel Dokploy → aba **Environment** → cole as variáveis no editor (uma por linha, `KEY=value`) e clique em **Save**. Em seguida **Redeploy** para o container pegar os novos valores.

Alternativa via SSH na VPS: as envs ficam materializadas no docker-compose gerado pelo Dokploy; nunca edita lá diretamente — o painel sobrescreve.

## Webhook do Stripe (já está configurado pelo ZeloPDV)

Verificação rápida:

1. Stripe Dashboard → Developers → Webhooks
2. Deve haver um endpoint apontando para `https://zelopdv.com.br/api/billing/webhook`
3. Eventos assinados precisam incluir:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`

Se algum estiver faltando, marque a checkbox e salve.

## Customer Portal (Stripe Dashboard)

Settings → Billing → Customer portal → certifique-se que está ativo e que permite:

- ✅ Customers can cancel subscriptions
- ✅ Customers can update payment methods
- ✅ Customers can view billing history / download invoices

Não precisa criar configuração custom — o default funciona. Só defina a `STRIPE_BILLING_PORTAL_CONFIGURATION_ID` se quiser uma config diferente da default.

## Fluxos cobertos (sem operação manual)

| Cenário                                       | O que acontece                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| Usuário novo se cadastra                      | Onboarding livre. Tenta conectar WhatsApp → vê paywall.                       |
| Clica "Ativar ZeloChat Pro"                   | `POST /api/billing/checkout` → redireciona para Stripe Checkout.              |
| Paga                                          | Stripe webhook → `subscriptions.status='active'`. Volta com `?billing=success`. |
| Volta no app                                  | App chama `/api/billing/sync` (fallback se webhook tá lento) + refresh hook.   |
| WhatsApp libera                               | `requireActiveZelochatSubscription` deixa passar. QR Code aparece.            |
| Usuário ativo clica em "Gerenciar assinatura" | `POST /api/billing/portal` → Stripe Billing Portal.                           |
| Cancela no portal                             | Webhook → `cancel_at_period_end=true`. App mostra "Cancela em DD/MM".         |
| Período expira                                | Webhook → `status='canceled'`. App volta a mostrar paywall.                    |
| Pagamento falha (cartão expirado)             | Webhook → `status='past_due'`. App mostra "Regularizar pagamento".            |
| Clica "Regularizar"                           | Vai pro Customer Portal pra atualizar cartão.                                 |

## Edge cases conhecidos

- **Usuário com plano `pdv` querendo upgrade pra `chat`/`bundle`**: hoje o endpoint `/api/billing/checkout` recusa via `ALREADY_ACTIVE` se já tem chat/bundle ativo, mas para upgrade de `pdv`→`chat` ele cria checkout nova. Isso resulta em duas subscriptions Stripe. Se isso virar comum, plugar no endpoint `/api/billing/change-plan` que já existe no ZeloPDV.

- **Webhook atrasado**: o `?billing=success` chama `/api/billing/sync` para forçar leitura via Stripe API e flipar a row pra `active` na hora. Se Stripe estiver muito lento mesmo assim, o usuário vê paywall por 30-60s; uma volta na settings resolve.

- **Stripe customer órfão**: se o usuário cancelar e voltar meses depois com email diferente, o checkout cria customer novo. O endpoint reusa pela coluna `provider_customer_id` no DB → email no Stripe → cria novo. Sem ação manual necessária.

## Smoke test em prod (5 min)

Numa conta de teste:

1. Cadastra → tenta gerar QR Code → vê paywall ✓
2. Clica "Ativar ZeloChat Pro" → vai pro Stripe Checkout ✓
3. Paga com card de teste real (use uma conta sua) ✓
4. Volta com `?billing=success` → paywall some, QR Code aparece ✓
5. Vai em Settings → vê "Gerenciar assinatura" → clica → portal abre ✓
6. Cancela no portal → volta → vê "Cancela em DD/MM" ✓
7. (Opcional) No Stripe Dashboard → cancela imediatamente → vê paywall em ~10s ✓

Se algum passo falhar, cheque logs do Dokploy (painel do serviço → aba **Logs** ou `docker logs -f <container>` via SSH) e Stripe Dashboard → Developers → Events.
