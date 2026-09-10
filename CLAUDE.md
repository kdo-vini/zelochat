# ZeloChat

WhatsApp-native customer service platform for Brazilian lanchonetes. All user-facing text, prompts, and seed data are in **Brazilian Portuguese**.

> **Sprint atual / foco do momento:** ver [[CURRENT]] antes de qualquer tarefa.

## 📖 Required reading before any non-trivial change

This repo has FOUR companion docs at the project root that capture context not visible from the code alone. **Read them before touching anything customer-facing or anything tagged "CRITICAL":**

1. **[[CODE_REVIEW]]** — Senior-tier audit of the codebase (24 P0 / 47 P1 / 38 P2 / 24 P3). Each finding has file:line, repro steps, customer impact, and proposed fix. This is the source-of-truth catalog of known issues.
2. **[[FIXES_PROGRESS]]** — Live tracker of which audit findings are SHIPPED, DRAFTED, BLOCKED, or PENDING. Every fix entry links to the files that changed. Update this whenever you ship a fix or draft a migration.
3. **[[BILLING]]** — Stripe/Asaas runbook. Subscription state, plan tiers, the cross-product (ZeloPDV) shared `subscriptions` table.
4. **[[INCIDENTS]]** — Outage runbook. Symptoms → known root causes → recovery steps for every production incident we've already fixed. **First stop when something looks broken in prod.** Update after every new outage so the next person doesn't re-debug it.

Plus the two §sections in this file ("Shared database with ZeloPDV" and "Critical functions — touch with extreme care") — those are non-obvious tribal knowledge that breaking will cost real customer money.

If you're an AI agent or new dev opening the repo for the first time: read those four docs in order before doing anything else. The audit alone took six senior reviewers ~40k tokens to produce — re-running that work is wasteful and the findings haven't been re-litigated.

## Novidades changelog convention

**Não é todo commit/PR que vira entrada no changelog.** O Novidades é lido pelo dono da lanchonete — só entra o que **realmente muda a experiência dele** (novo recurso visível, correção de bug que ele sentiu, ajuste de comportamento da IA). Refactor interno, ajuste de copy de landing, mudança de infra, tweak de dev tooling, rename de variável, lint fix — **não vão pro changelog**. Na dúvida, não adiciona.

Linguagem: **sempre em português, sem jargão técnico.** Nada de "endpoint", "webhook", "RLS", "deploy", "migration", "schema", "API". Fale como se estivesse explicando pro dono da pizzaria no WhatsApp.

Volume: o changelog deve ser enxuto. Não crie uma entrada para cada commit pequeno. Use no máximo **4 entradas por dia**, consolidando várias melhorias relacionadas em uma entrada clara quando fizer sentido.

Quando for entrada válida, adicione no **topo** de `src/data/changelog.ts`.

```ts
{
  date: 'YYYY-MM-DD',         // today's date
  category: 'big' | 'medium' | 'minor' | 'hotfix',
  title: 'Título em português', // user-friendly, no tech jargon
  description: 'Uma frase clara sobre o que mudou e por que o operador vai gostar.',
}
```

Categories:
- `big` — new major feature visible to the end-user (highlighted card in Novidades)
- `medium` — meaningful improvement or new capability
- `minor` — small polish, copy change, or UX tweak
- `hotfix` — urgent bug fix that broke something in production

## Customer-facing copy

Toda mensagem exibida para operador, dono da loja ou cliente final deve ser em
português brasileiro, clara e orientada à ação. **Nunca exponha nomes de
provedores, serviços internos, endpoints, códigos técnicos ou detalhes de
infraestrutura** em UI, toast, banner, erro de API consumido pelo frontend,
Novidades ou prompts para usuário. Exemplos proibidos em texto visível:
`Whatsmiau`, `Stripe`, `OpenAI`, `Supabase`, `webhook`, `endpoint`,
`timeout of 10000ms exceeded`, `provider`, `upstream`.

Quando precisar explicar uma falha, traduza para o impacto e próximo passo:
- Use: "O WhatsApp ainda está preparando o QR Code. O ZeloChat vai tentar novamente automaticamente."
- Não use: "Whatsmiau ainda está preparando o QR Code" ou "upstream timeout".

Logs internos, comentários técnicos e runbooks podem citar provedores quando
isso ajuda diagnóstico, mas qualquer valor que possa atravessar para a UI deve
ser sanitizado antes da resposta.

## Deploy

Production runs on **Dokploy**, linked directly to the `main` branch on GitHub (`kdo-vini/zelochat`). **Every push to `main` triggers an automatic redeploy** — no manual step needed, no GitHub Actions required. Docker build + container restart typically takes 2–5 minutes after the push lands. Do not tell the user to "manually trigger Dokploy" — it happens automatically on push.

URL: `https://chat.zelopdv.com.br`

### `/api/healthz` is not WhatsApp health

`/api/healthz` is a narrow Express backend liveness/reachability endpoint used
by platform health checks and the app's offline detection flow. Treat it as
"the ZeloChat backend can answer HTTP", not as proof that WhatsApp, webhooks,
QR generation, printer integration, or any upstream provider are healthy.

Do not repurpose `/api/healthz` for WhatsApp diagnostics, do not add auth, and
do not add database/provider calls to it. For WhatsApp incidents, use the
dedicated status/QR endpoints and `scripts/diagnose-webhooks.ts` from the
backend container where production provider credentials are present.

## Commands

```bash
npm run dev          # Frontend only — Vite on port 3000
npm run dev:server   # Backend only — Express on port 3001
npm run dev:all      # Both concurrently
npm run build        # Production build
npm run lint         # TypeScript type-check (tsc --noEmit)
```

## Architecture

```
src/
  App.tsx                  # Root component — all global state lives here
  types.ts                 # Shared TypeScript types (ZeloState, ChatSession, etc.)
  domain/chat.ts           # Pure utilities: normalizePhoneNumber, formatPhone, JID helpers
  hooks/
    useWhatsAppSessions.ts # WebSocket + REST — source of truth for chat sessions
    useSupabaseSession.ts  # Auth (Supabase JWT token)
    useProdutos.ts         # Products from Zelo PDV API
    useDrivers.ts          # Delivery drivers (Supabase)
    useEmpresaPerfil.ts    # Business profile (Supabase)
  services/
    waApi.ts               # All REST calls to /api/* (sessions, send, delete, etc.)
    openaiService.ts       # AI proxy calls via /api/ai/complete
    zeloApi.ts             # Zelo PDV product mapping
    statePersistence.ts    # localStorage state save/load
  components/views/        # One file per nav view (DashboardView, KanbanView, etc.)

server/
  index.ts        # Express entry point, WebSocket wiring, auto-reply debounce
  router.ts       # All API routes (/api/sessions, /api/send, /api/drivers, etc.)
  messageHandler.ts # Supabase read/write for sessions and messages
  whatsapp.ts     # Whatsmiau (Evolution v2) — send fns + bound-empresa lifecycle
  instanceManager.ts # Multi-tenant: empresaId ↔ Whatsmiau instance lookup + create/delete
  ws.ts           # WebSocket broadcast to frontend
  ai.ts           # OpenAI reply generation
  supabase.ts     # Supabase service client + empresa auth
  configStore.ts  # In-memory business config (synced from frontend)
  drivers.ts      # Driver CRUD against Supabase
```

### CustomerOrderingContext — contexto de pedido do cliente

- `server/customers/orderingContext.ts` é o módulo profundo e determinístico; seu adapter de produção fica em `orderingContextAdapter.ts`. A leitura do histórico usa exclusivamente `zelo_orders` com `zelo_order_items` aninhados, sempre filtrada por `empresa_id` + `pessoa_id`, limitada aos 20 pedidos mais recentes nos estados comprometidos `accepted|preparing|ready|out_for_delivery|delivered`.
- Nunca inclua `pending_payment`, `pending_review`, `rejected` ou `cancelled` nos hábitos, nunca leia nem copie de `zelochat_orders` e nunca materialize um novo pedido para formar contexto.
- Tipo de atendimento, endereço e pagamento seguem a precedência `override fixado > último pedido > ausente`. Horário habitual usa mediana **circular** determinística (23:50 + 00:10 = 00:00); recorrência usa mediana linear dos intervalos. Itens frequentes são calculados por `product_id` canônico, servem só como sugestão e **nunca** viram itens padrão automaticamente. `lastOrder` preserva `customer` e todos os campos originais de fulfillment/payment (incluindo `asap`), além das projeções normalizadas e dos itens/modificadores.
- Overrides vivem em `zelochat_customer_relationships.ordering_overrides`. O PATCH aceita somente `fulfillmentType`, `deliveryAddress`, `paymentMethod` e `habitualTime`, permite `null` para remover um campo e exige `pessoas.gerenciar`. O ZeloChat **nunca** faz read/merge/upsert do JSON: `orderingContextAdapter.ts` chama o RPC service-role `patch_zelochat_customer_ordering_overrides`, cujo DDL pertence ao stream compartilhado do ZeloPDV e faz validação empresa/owner/pessoa mais merge atômico no banco.

### Pedido conversacional híbrido — contrato local

- `server/aiWhatsAppOrdering.ts` apenas orquestra: o ZeloMenu continua dono de requisitos, preço, revisão e confirmação. Todo update/confirm/cancel recebe o mesmo `AiTurnPermit.conversationControlId` + `epoch` do outbound; `AI_TURN_REVOKED` é supressão limpa.
- O estado serializado guarda `orderingId`, revisão, permit, IDs de mensagens consumidas, opcionais oferecidos/recusados e o contador de tentativas transitórias. Persistir o ponteiro antes de enfileirar botão ou lista, **e em todo caminho terminal do turno** — se um caminho de saída esquecer de persistir o cursor, a conversa reprocessa o histórico no turno seguinte e um `sim` de confirmação chega ao modelo colado no texto antigo (foi exatamente esse o bug de 2026-09-03). Use `persistOrderingState` em vez de escrever o ponteiro à mão.
- **`server/zeloMenuOrderingWire.ts` é o único lugar que traduz JSON da autoridade.** Todo snapshot — GET, update, confirm, cancel e o `current` de um 409 — passa por `parseOrderingSnapshotWire`, que falha fechado com `ORDERING_WIRE_UNSUPPORTED` em vez de estourar `TypeError`. Nunca leia campos de resposta da autoridade direto em outro módulo.
- **O formato da autoridade tem artefato versionado, não double inventado.** O ZeloMenu gera as fixtures reais (snapshots, tipos de requisito, códigos de erro, corpos aceitos e rejeitados) em `docs/contracts/conversation-ordering-wire/v1/` com teste de drift; o ZeloChat copia a pasta **verbatim** para `tests/fixtures/zelomenu-wire/v1/` e testa contra ela em `tests/zeloMenuWireContract.test.ts`. Ao mexer no contrato: mude o ZeloMenu, regenere as fixtures, recopie e rode o teste de contrato. Uma suíte verde contra double escrito à mão já esconde 20+ divergências reais — não volte a esse padrão.
- Cuidado com dois nomes de campo: a autoridade usa `type` para o tipo do requisito e `name` para o texto, e reserva `kind` para o subtipo do modificador (`adicional`/`variacao`). O ID do requisito é `${lineId}:${groupId}` e **contém `:`**, então IDs de ação usam `|` como separador: `REQ:<requisito>|<opção>|<fingerprint>`, onde o fingerprint amarra `orderingId:revision` e deixa detectar um toque obsoleto sem consulta.
- Rótulos de controle têm limite duro (botão 20, linha de lista 24 caracteres). Delta de preço vai no corpo do texto ou na descrição da linha, **nunca no título** — "Bife acebolado (+R$ 12,00)" estoura o limite e derruba o payload depois da mutação já ter acontecido. Grupo opcional lista todas as opções; não truncar em cinco.
- **Sequência da confirmação, nessa ordem:** o botão/texto resolve o token da revisão que o cliente **viu** (divergência não confirma, reapresenta o resumo atual) → `confirmDraft` com permit e token → persistir o estado → enfileirar a mensagem. Se persistência ou envio falharem depois do confirm, a reconciliação do turno seguinte consulta o snapshot e avisa o cliente uma única vez, idempotente por `orderingId`. Nunca marque o inbound como respondido antes de o envio ser enfileirado.
- Erro da autoridade não é tudo igual: `classifyOrderingFailure` mapeia cada código de `errors.json` em `suppress` (`AI_TURN_REVOKED`, silêncio total), `resync` (adota o `current` do 409 e persiste), `clear_and_tell`, `retry_later` (limitado) ou `escalate`. Mensagem de revalidação escrita pela autoridade não vai literal para o cliente.
- Indisponibilidade da autoridade passa por circuit breaker por empresa (`server/orderingCircuitBreaker.ts`): 5 falhas de transporte em 60 s abrem por 30 s, com **uma** notificação de gerente por abertura, não por conversa. Falha de circuito não gasta o orçamento de tentativas da conversa.
- Log de cada estágio sai por `buildOrderingMetricLine` com `empresaId`, chave de conversa hasheada (sha256 do JID, 12 hex), `orderingId`, `revision`, `stage`, `outcome`, `errorCode`, `durationMs`. Nunca logue JID, telefone, nome, endereço ou texto de mensagem.
- `server/orderingPatchPlanner.ts` valida a hierarquia produto → grupo → opção por linha antes da mutação. Não substituir seleções estruturadas por observações livres nem aceitar opção de outro produto.
- `src/domain/orderingRequirementPresenter.ts` pergunta um requisito bloqueante por vez; opcionais aparecem uma única vez e `sem extras` os recusa. Texto e áudio permanecem alternativas aos controles.
- **Leitura do snapshot é escopada por conversa.** `GET /internal/ordering/:orderingId` no ZeloMenu exige `empresaId` **e** `remoteJid` (sem JID → 400 `CONVERSA_INVALIDA`). `ZeloMenuInternalClient.getOrdering(orderingId, empresaId, remoteJid)` tem os três argumentos obrigatórios e `loadCanonicalSnapshot` ainda confere `snapshot.empresaId`/`remoteJid` contra a conversa local. Não relaxe o JID no ZeloMenu para "resolver" um 400 — ele é parte do limite de tenant. Dobrar o cliente em teste com a assinatura antiga esconde exatamente essa classe de bug.
- **A relevância da busca do cardápio é do ZeloMenu, e tem conjunto de avaliação.** `zelomenuCatalogDiscovery` ranqueia por cobertura: a nota é a fração do peso da consulta que o produto cobre, cada acerto valendo conforme o campo (nome 1,0 · categoria 0,7 · grupo/opção 0,6 · descrição 0,3), com piso em 0,45, stopwords do português (`portugueseStopwords.ts`, lista Snowball) e typo por trigrama e distância de edição. Não compense ranking ruim com lista de palavras no ZeloChat: a frase do cliente vai para a busca como foi escrita, e foi assim que "vc pode mandar o cardapio?" deixou de responder "Batata frita com cheddar e bacon" — a palavra `vc` estava na descrição do produto. Ao mexer em relevância, rode `zelomenuCatalogDiscovery.relevance.test.ts` (consultas reais sobre catálogo real) antes de publicar: a primeira tentativa de reescrita ficou pior que o algoritmo antigo e só dava para saber medindo.
- **Alerta de guard com histórico antigo.** Quando um caminho `guard_*` bloqueia a resposta por causa de uma mensagem mais velha que `ZELOCHAT_STALE_GUARD_ALERT_HOURS` (padrão 24h), sai uma linha `[AiAlert] {"alert":"stale_history_guard",...}` e o rastro do turno recebe `guard_detail.alert`. É a assinatura exata dos defeitos de 09-10/09/2026 — contexto velho ressurgindo como se fosse do turno atual. **Alerta, não suprime:** a decisão do guard continua valendo, porque esses defeitos foram todos de lógica, e lógica errada se conserta em vez de se contornar em silêncio. Consulta: `select created_at, path, guard_detail from zelochat_ai_turn_traces where guard_detail->>'alert' is not null order by created_at desc;`
- **Rastro completo do turno fica no banco, não no log.** `zelochat_ai_turn_traces` (migration 069) guarda, por turno, o texto que entrou, o system prompt exato, as mensagens de runtime enviadas ao modelo e a resposta. **Contém PII do cliente** (histórico, nome, telefone, endereço): RLS ligada, nenhuma policy, `anon`/`authenticated` sem privilégio — só a service role lê. Retenção padrão de 14 dias por `zelochat_prune_ai_turn_traces`, chamada de forma oportunista pelo backend. `ZELOCHAT_AI_TRACE=0` desliga sem deploy de código; `ZELOCHAT_AI_TRACE_KEEP_DAYS` muda a janela. Gravação é fire-and-forget: falhar o rastro nunca pode custar a resposta ao cliente. Nunca exponha essa tabela em rota de frontend nem copie o conteúdo para log.
- **Todo turno da IA deixa um registro de decisão.** `logAiTurnDecision` emite uma linha `[AiTurnDecision]` com `empresaId`, chave de conversa hasheada (sha256 do JID, 12 hex), o caminho que respondeu (`guard_business_hours`, `guard_blocked_date`, …) e as entradas que decidiram — horário lido, tamanho e idade do histórico considerado. **Nunca** texto de mensagem, JID, telefone, nome ou endereço. Foi a falta disso que obrigou a reconstruir uma conversa no banco na mão para descobrir de onde vinha um "18:00" inventado. Ao adicionar um caminho que responde sem passar pelo modelo, registre-o aqui também.
- **Conversa parada recomeça do zero.** `messagesSinceConversationBreak` corta o histórico no último silêncio maior que `CONVERSATION_IDLE_RESET_HOURS` (6h), tanto no que vai para o modelo quanto no gate de follow-up do fluxo canônico. Sem isso a IA continua a conversa de ontem — "Boa" / "Noite" 32 horas depois virava "Que bom! Se precisar de algo é só avisar". Nada é apagado: o resumo do cliente segue no system prompt.
- **Recibo de pedido do ZeloMenu só recebe agradecimento.** `isZeloMenuOrderReceipt` casa o rodapé do template (`Sistema Zelo Menu` + `Pedido #`) e encerra o turno antes de qualquer classificação — o texto contém "cardápio digital" e "Entrega · o quanto antes", então casava com o pedido de cardápio E com a pergunta de taxa.
- Prévia em dry-run (simulador) nunca assume retirada: sem `fulfillment.type` ela pergunta "entrega ou retirada" em vez de montar o resumo. O fluxo real usa os requisitos canônicos do ZeloMenu para o mesmo efeito.
- Antes de qualquer piloto: rascunhos `whatsapp_order` em `cart_open` criados antes do `lineId` não recebem backfill no ZeloMenu e falham em update (`MATERIALIZED_LINE_ID_MISSING`); cancelar/expirar esses rascunhos no ambiente-alvo em vez de reparar.

## Stack

- **Frontend**: React + Vite + TypeScript + Tailwind + Motion (framer)
- **Backend**: Express + Whatsmiau (Evolution v2 API) + tsx (watch mode)
- **Database**: Supabase (PostgreSQL)
- **AI**: OpenAI (gpt-4o-mini) via server-side proxy
- **Auth**: Supabase JWT — token passed as `Authorization: Bearer` to all `/api/*` calls

## Multi-instância Whatsmiau (P0-02 + P1-01)

Cada empresa tem sua própria instância Whatsmiau. Mapeamento em `empresa_perfil.whatsmiau_instance` (TEXT, UNIQUE quando não-NULL).

- **Resolução de instância no SEND**: todas as funções de envio em `server/whatsapp.ts` (`sendTextMessage`, `sendButtonMessage`, `sendMediaMessage`, etc.) aceitam um `empresaId?: string | null` opcional. Internamente chamam `resolveInstance(empresaId)` que delega ao `instanceManager.getInstanceForEmpresa()`. Se `empresaId` não vier (ou empresa ainda não tem instância), cai no `WHATSMIAU_INSTANCE` do env (legacy single-tenant — mantém o beta atual rodando).
- **Webhook por instância**: `POST /webhook/:instance` resolve `empresaId` via `instanceManager.getEmpresaForInstance(instance)`. Whatsmiau registra a URL `${PUBLIC_URL}/webhook/${instance}` para cada empresa nova. A rota legacy `POST /webhook` (apikey-header auth) continua funcionando pra empresas antigas.
- **`instanceManager.ts`** expõe: `getInstanceForEmpresa`, `getOrCreateOwnInstanceForEmpresa`, `getEmpresaForInstance`, `createInstance`, `deleteInstance`, `setConnectionState`. Cache em memória com TTL 60s.
- **Connection lifecycle (status/QR/disconnect) é per-empresa** desde P1-01. As rotas `/api/status`, `/api/qr`, `/api/qr/refresh` e `/api/whatsapp/disconnect` exigem JWT e usam `getOrCreateOwnInstanceForEmpresa()` — nunca caem no FALLBACK_INSTANCE de outra empresa. Helpers em `whatsapp.ts`: `fetchInstanceConnectionState`, `fetchInstanceQR`, `logoutInstance`, `setWebhookForInstance`.
- **Auto-create on first QR**: se a empresa ainda não tem instância (`whatsmiau_instance = NULL`), o primeiro `/api/qr` cria uma chamada `zelo-{empresaId-first-8}-{16hex-random}`, persiste em `empresa_perfil` e registra o webhook `/webhook/{instance}` no Whatsmiau. O sufixo aleatório de 16 hex (64 bits) é o auth boundary efetivo — ver §"Webhook auth boundary" abaixo.

### Webhook auth boundary — URL-as-secret (post-P0.1 investigation)

Investigação em 2026-04-29 (commit 8b367c4 com diagnóstico `WEBHOOK_DEBUG_HEADERS`) provou que **Whatsmiau v2 aceita o campo `headers.apikey` em `/webhook/set/{instance}` (visível em GET) mas não forwarda esse header nas entregas reais.** Bug deles, sem ETA. Logo, `WEBHOOK_REQUIRE_TOKEN=1` (strict mode) NÃO É VIÁVEL — flipar agora 401 100% do tráfego legítimo.

**Auth boundary efetivo hoje: o nome da instância no path da URL.**
- **Instâncias novas**: `zelo-{empresaId8}-{16hex}` = 64 bits de entropia → unguessable. Suporta escala nacional.
- **Instâncias legacy (pré-rotação)**: formato `zelo-{empresaId8}` sem sufixo aleatório. Enumeráveis a partir do UUID da empresa. **Devem ser rotacionadas** (deletar + recriar via fluxo normal de `/api/qr`).
- **Auth via `?token=` na URL está ATIVA.** `/webhook/:instance` extrai o token do query param (Whatsmiau não forwarda o header `apikey`, mas respeita a URL completa). O token deve estar presente na URL registrada — `server/index.ts` garante isso no startup. `WEBHOOK_ALLOW_MISSING_TOKEN_DURING_ROLLOUT=1` é um escape de emergência para rollouts.

**NÃO regenere a coluna `webhook_token` em `empresa_perfil`** — é o segredo que autentica o webhook via `?token=` na URL. Manter estável; nunca expor em logs.
- **Legacy global lifecycle** (`fetchQR`, `disconnectWhatsApp`, `syncStatusFromUpstream` em `whatsapp.ts`) ainda existe pra rodar o auto-reconnect e health check de empresas single-tenant. Os broadcasts WS dessas funções são escopados via `getBoundEmpresaId()` pra não vazar pra outros tenants.
- No startup multi-tenant, `server/index.ts` re-registra os webhooks de todas as instâncias ativas para garantir que o `?token=` esteja sempre na URL registrada no Whatsmiau.

## Database (Supabase)

Tables:
- `zelochat_sessions` — one row per WhatsApp JID per empresa. Columns: `id, empresa_id, remote_jid, customer_name, customer_phone, last_message, last_message_time, unread_count, status, auto_reply, updated_at`
- `zelochat_messages` — messages linked to a session. Columns: `id, empresa_id, session_id, role, content, sent_at`. **`role` CHECK constraint MUST allow `'user'`, `'assistant'`, `'tool'`, AND `'system'`.** See §"Order confirmation flow" below — narrowing this constraint silently breaks the entire order creation pipeline.
- `zelochat_drivers` — delivery drivers per empresa
- `empresa_perfil` — business profile (name, address, pix key, logo)
- `produtos` / `categorias` / `subcategorias` — **shared with ZeloPDV**. Same `auth.users` underlies both apps. ZeloChat writes here to add/edit products; changes reflect in ZeloPDV automatically. FKs: `produtos.id_categoria → categorias.id`, `produtos.id_subcategoria → subcategorias.id`, `subcategorias.id_categoria → categorias.id`. Multi-tenant by `id_usuario` (uuid, `auth.uid()`). RLS already scoped by `id_usuario`. Zero triggers.

Session "families": a contact may have multiple rows (different JIDs for same phone). `fetchSessionFamily` groups them by normalized phone key — always use it instead of querying by JID directly.

## 🛑 Shared database with ZeloPDV — what we MUST NOT touch from this repo

ZeloChat and ZeloPDV are two separate apps that **share one Supabase project** (`xnnjyrblpvsqrtsshawa`). Same `auth.users`, same database, same migrations log. Changing schema from this repo that's owned by ZeloPDV will silently break the other product — and there is no test environment that covers both at once.

### Tables we OWN (safe to migrate from this repo)
- `zelochat_sessions`, `zelochat_messages`, `zelochat_drivers`, `zelochat_orders`,
  `zelochat_triggers`, `zelochat_quick_responses`, `zelochat_pending_orders`,
  `zelochat_escalation_events`
- ZeloChat-specific COLUMNS added to `empresa_perfil` (e.g. `whatsmiau_instance`, `webhook_token`, `ai_enabled`, `manager_phone`, `chave_pix`, `notify_customer_*`, `delivery_config`, `manager_history`, `blocked_dates`, `zelochat_onboarding_done`, `zelochat_disabled_builtin_triggers`, `ai_can_reengage_pending`, `ai_instructions`, `horario_*`, `dias_fechamento`)
- `zelochat-media` storage bucket and its policies
- `zelochat_increment_unread` and `zelochat_orders_set_updated_at` functions

### Tables we DO NOT OWN (NEVER ALTER from this repo)
- **`empresa_perfil`** the table itself, its primary key, its `user_id` FK, and PDV-only columns (`nome_exibicao`, `documento`, `endereco`, `contato`, `timezone`, `logo_url`, `rodape_recibo`, `largura_bobina`, `modulo_pdv_ativo`, `modulo_delivery_ativo`, `pin_admin`, `razao_social`, `plataformas_pagamento`, `last_seen_at`, `onboarding_completed`, `tipo_negocio`). We can ADD columns; we cannot DROP or ALTER theirs.
- **`subscriptions`** — owned by ZeloPDV's webhook handler. Schema, CHECK constraints (`plan_tier`, `status`), RLS. We READ; we never DDL.
- **`super_admins`** — admin pool. ZeloPDV-owned.
- **`produtos`, `categorias`, `subcategorias`** — shared catalog. ZeloChat reads + writes ROWS, but the SCHEMA is ZeloPDV's. Multi-tenant via `id_usuario` (note: PDV uses `id_usuario`, not `empresa_id` — different convention).
- **`vendas*`, `caixas*`, `caixa_*`, `pessoas`, `expenses`, `vendas_pagamentos`, `mesas`, `comandas*`, `email_*`, `subscription_cron_logs`, `admin_activity_logs`** — PDV/admin only.
- **`auth.*` schema** — Supabase platform.
- **`storage.*` schema (objects/buckets table itself)** — Supabase platform; we add policies + buckets, never alter the platform tables.

### Why this matters
Adding `ALTER TABLE empresa_perfil DROP COLUMN ...` from here, or attempting to add a new RLS policy with a name that ZeloPDV already uses, or applying a migration that resets ZeloPDV's `subscriptions_status_check` constraint, will cause one of:
- ZeloPDV's billing webhook handler stops writing rows (revenue lost on PDV side)
- PDV operators can't read their own catalog (RLS misalignment)
- Migration history desyncs and `supabase db reset` produces a different schema than prod
- Worst case: data loss on a column we didn't realize was load-bearing for PDV

### Workflow when you need to change a shared table
1. Open an issue in the ZeloPDV repo describing the change and why ZeloChat needs it.
2. Land the migration in ZeloPDV first.
3. Pull the resulting prod schema back into ZeloChat's `000_zelochat_schema.sql` snapshot via `pg_dump` or the Supabase MCP.
4. Never run a migration from THIS repo against shared tables.

## 🚨 Critical functions — touch with extreme care

These functions are CRITICAL for product correctness. Each one has caused (or has the potential to cause) a customer-visible outage if broken. Inline docs in the source explain the chain effect; this index is just the master list.

| Function | Location | Why it's critical |
|---|---|---|
| `generateAndSendReply` | `server/ai.ts` | The AI dispatch entry point. Bad changes here = duplicate orders, wrong-confirms, prompt-injection. The 3-layer trap from §"Order confirmation flow" lives here. |
| `tryHandleAiWhatsAppOrdering` / `tryHandleAiWhatsAppOrderingButton` | `server/aiWhatsAppOrdering.ts` | Fluxo canônico permanente: confirmação é determinística e orderingId/revision sempre voltam ao ZeloMenu. |
| `confirmPendingOrder` / `cancelPendingOrder` / `clearPendingOrder` | `server/ai.ts` | The pending-order lifecycle. The order between insert/clear/send is load-bearing — see "FIX H1" comment in `confirmPendingOrder`. |
| `dispatchIncomingMessage` and the hard-button short-circuit | `server/router.ts` | Layer 3 of the order-flow trap. Every customer reply path passes through here. |
| `processWebhookEvent` and `/webhook/:instance` | `server/router.ts` | Auth boundary for inbound WhatsApp. Currently relies on instance name as secret (P0.1) — rotation/dedup decisions land here. |
| `requireActiveZelochatSubscription` / `isEmpresaSubscriptionActive` / `resolveActiveSubscription` | `server/supabase.ts` | The paywall + the cache. Failing OPEN here = silent revenue leak across the fleet. |
| `getEmpresaForInstance` / `getInstanceForEmpresa` / `createInstance` | `server/instanceManager.ts` | Multi-tenant routing. A stale cache hit = cross-tenant message leak. |
| `getOrCreateSession` / `appendMessage` / `addToolMessage` | `server/messageHandler.ts` | Message persistence. Every helper defaulting `empresaId = getBoundEmpresaId()` is a cross-tenant hazard once a 2nd customer onboards. |
| The paywall middleware in `server/index.ts` | `server/index.ts:42` | Guards every `/api/*` route. Adding a bypass to the exempt list without thinking through the abuse vector = revenue leak. |
| `clearLocalAppState` (logout) | `src/services/authService.ts` | If new `zelochat_*`-prefixed localStorage keys are introduced, they MUST be wiped here, or the cross-tenant leak via shared device returns. |

When changing any of these, follow the rule: read CLAUDE.md → read CODE_REVIEW.md → read the existing inline docstring → walk through ONE customer scenario in your head before editing.

## Legacy / ignore

- `subscription*` tables — belong to ZeloPDV's paid tier, ZeloChat has its own pricing (§Pricing)

When building product CRUD, stick to: `nome`, `preco`, `id_categoria`, `id_subcategoria`, `controlar_estoque`, `estoque_atual`, `eh_item_por_unidade`, `ocultar_no_pdv`. For anything more granular, direct the user to [zelopdv.com.br](https://zelopdv.com.br) rather than replicating the full PDV admin.

## Environment

```
OPENAI_API_KEY      # Required for AI auto-reply
SERVER_PORT         # Baileys/Express port (default 3001)
FRONTEND_URL        # CORS allowed origin (default http://localhost:3000)
VITE_SUPABASE_URL   # Supabase project URL (frontend)
VITE_SUPABASE_ANON_KEY  # Supabase anon key (frontend)
SUPABASE_URL        # Supabase project URL (server)
SUPABASE_SERVICE_KEY    # Supabase service role key (server)
ZELOMENU_INTERNAL_BASE_URL       # URL privada do ZeloMenu. Default local http://127.0.0.1:3101 — mas em produção
                                  # (NODE_ENV=production ou PUBLIC_APP_URL público) uma chave presente + esta ausente
                                  # NÃO cai mais no default: loga um erro estruturado e desativa o caminho canônico
                                  # (PR 1.6/I-6, server/zeloMenuInternalClient.ts). Sempre setar explicitamente em prod.
ZELO_INTERNAL_API_KEY            # segredo compartilhado, nunca expor em log/copy
ZELOMENU_INTERNAL_TIMEOUT_MS     # timeout do client interno para search/get/update (default 4000)
ZELOMENU_INTERNAL_CONFIRM_TIMEOUT_MS  # timeout maior só para confirm_draft — 5+ round trips no lado da autoridade (default 12000)
AUDIO_TRANSCRIPTION_FETCH_TIMEOUT_MS   # download do áudio do WhatsApp antes de transcrever (default 10000, teto 15000)
AUDIO_TRANSCRIPTION_REQUEST_TIMEOUT_MS # chamada de transcrição em si (default 10000, teto 15000)
AUDIO_TRANSCRIPTION_WAIT_MS      # quanto o turno espera por uma transcrição em andamento antes de responder sem ela
                                  # (default 10000, teto 10000 — depois disso o rearm por settle assume, não o turno atual)
```

Todas as env vars acima recebem uma linha de log única no boot (`[Server] ai-hybrid-ordering env status at startup`) dizendo apenas se cada uma está presente — nunca o valor.

## Whatsmiau API (Evolution API v2 wrapper)

Base URL: `https://api.whatsmiau.dev` — docs: `https://whatsmiau.dev/docs`

**Sending media** — `POST /message/sendMedia/{instance}`:
```json
{ "number": "5511999998888", "mediatype": "image", "media": "https://public-url.com/file.jpg", "caption": "Texto", "mimetype": "image/jpeg", "fileName": "foto.jpg" }
```
- `media` **must be a public HTTPS URL** — base64 strings are NOT accepted (treated as URL → 503/500)
- Flow: upload to Supabase Storage (`zelochat-media` bucket, public) → get public URL → send URL → auto-delete after 10 min
- `mediatype`: `"image"` | `"document"` | `"audio"` | `"video"`

**Receiving media** — webhook with `webhookBase64: true`:
- Whatsmiau embeds base64 in the payload at `data.base64` (or `data.message.imageMessage.base64` as fallback)
- Reconstruct as `data:${mimeType};base64,${raw}` for storage/display

**Webhook** — `POST /webhook/set/{instance}`:
```json
{ "webhook": { "enabled": true, "url": "https://...", "webhookByEvents": false, "webhookBase64": true, "events": ["MESSAGES_UPSERT","CONNECTION_UPDATE","CONTACTS_UPSERT"] } }
```

**Sending audio (PTT)** — `POST /message/sendWhatsAppAudio/{instance}` (different endpoint!):
```json
{ "number": "5511999998888", "audio": "https://public-url.com/voice.mp3", "encoding": true }
```
- Field is `audio`, NOT `media` — sending audio through `sendMedia` with `mediatype:"audio"` is wrong
- Same URL-only constraint: upload to Supabase Storage first, then send URL
- `encoding: true` re-encodes before sending (recommended for compatibility)

**Sending text** — `POST /message/sendText/{instance}`: `{ "number": "...", "text": "..." }`

## WhatsApp gotchas

- **JID format**: `{countryCode+number}@s.whatsapp.net` — e.g. `5514998360854@s.whatsapp.net`. Always include country code (55 for Brazil).
- **Brazilian numbers**: 10–11 digits without DDI → auto-prefix `55` before building JID. Never trust a raw local number as a JID.
- **Phone formatting**: `formatPhone` in `messageHandler.ts` formats `5514XXXXXXXXX` → `(14) XXXXX-XXXX`. Only works for 11-digit local numbers after stripping `55`.
- **Profile pictures**: Whatsmiau returns the URL on `res.data.profilePictureUrl`; wrap fetches in try/catch — private photos throw.
- **Legacy Baileys auth folder**: `server/whatsapp.ts` wipes `auth_info_baileys/` on connect as a safety net so a stale local `creds.json` can never silently re-auth. Folder is gitignored — fine to leave or delete locally.

## 🛑 Order confirmation flow — DO NOT BREAK (cost two days of debugging)

The order pipeline is layered. All three layers must hold or duplicate orders return:

1. **`zelochat_messages.role` CHECK constraint allows `'tool'` and `'system'`.** When the AI calls `criar_pedido`, the happy path executes `addToolMessage(role='tool', …)` to persist the audit trail. If the constraint rejects `'tool'`, the insert throws — and crucially that throw is caught by the same `try` block that wraps `sendButtonMessage`. The code can't tell "buttons failed" from "DB rejected the audit row," so it falls into the catch-fallback path. This is what caused the original duplicate-order bug: every order was double-inserted because the audit insert was throwing on every successful send.
   - The fix migration is `allow_tool_and_system_roles_in_zelochat_messages`.
   - If you ever see `zelochat_messages_role_check` in a server log, drop everything and widen the constraint immediately.

2. **`server/ai.ts` `criar_pedido` catch-fallback must NEVER call `createOrderInDb` or `clearPendingOrder`.** The fallback (when `sendButtonMessage` truly fails) keeps the pending row in place and sends a "responda *Sim* / *Não*" text. Auto-creating the order here is what caused the duplicate: customer saw the buttons (delivered despite the throw), tapped Confirmar, the pending was already cleared, and the click leaked into the AI which re-ran `criar_pedido`.

3. **`server/router.ts` hard button clicks (`CONFIRM_ORDER` / `CANCEL_ORDER` button-id OR exact-match text) MUST short-circuit `dispatchIncomingMessage()` even when no pending order exists.** Reply idempotently ("Seu pedido já foi confirmado!"). If a button click ever reaches the AI as freeform input, the AI will create a new order from scratch.

If you change ANY of these three layers, manually walk through the duplicate-order screenshot in the issue history and verify the fix still holds. Do not trust unit tests alone — the bug only surfaces with the full webhook → AI → DB chain.

## ⚠️ Local dev steals the production webhook (read before running `npm run dev:server`)

The `.env` checked into the repo may point at a production Whatsmiau instance. On startup, `server/whatsapp.ts` calls `setWebhook` (single-tenant) or `setWebhookForInstance` (multi-tenant) with the local server's public URL — in dev that's a Cloudflare tunnel from `scripts/tunnel.js`. This **silently overwrites the production webhook URL on Whatsmiau**, redirecting all real customers' inbound messages to the dev machine. Outbound sends still work (they hit Whatsmiau directly), so the symptom is "app sends but receives nothing in prod" — not an obvious failure.

When this happens, a Dokploy redeploy of the backend fixes it (prod re-registers its own URL on startup with the correct `?token=`).

**Before running any local dev command that boots the backend** (`npm run dev:server`, `npm run dev:all`, `npx tsx server/index.ts`, integration tests that import `server/whatsapp.ts`):

- **Recommended:** set `WHATSMIAU_DISABLE_WEBHOOK_REGISTER=1` in your local `.env`. The guard is wired in `server/whatsapp.ts → registerWebhook()` — when set to `1`/`true`/`yes`, startup logs `[whatsapp] webhook register skipped (WHATSMIAU_DISABLE_WEBHOOK_REGISTER=1)` and skips ALL calls to `setWebhook`. Outbound sends still work; the production webhook URL on Whatsmiau stays untouched.
- Alternative: use a separate sandbox Whatsmiau instance + API key for dev — do not reuse the prod ones.
- Alternative: temporarily clear `WHATSMIAU_API_KEY` / `WHATSMIAU_INSTANCE` before booting the local server.

In production (Dokploy), leave `WHATSMIAU_DISABLE_WEBHOOK_REGISTER` unset (or `0`) so the deploy registers its own webhook URL on startup. Also set `PUBLIC_APP_URL=https://chat.zelopdv.com.br` (or `WEBHOOK_PUBLIC_URL`) so `getPublicWebhookUrl()` resolves to the public domain — without it, the backend falls back to `http://localhost:3001` and Whatsmiau registrations fail.

## Billing — Stripe paywall (R$149/mês plano `chat`, R$198 `bundle`)

ZeloChat compartilha conta Stripe e tabela `subscriptions` com ZeloPDV. Webhook fica em `zelopdv.com.br/api/billing/webhook` (já trata `plan_tier='chat'`/`'bundle'`). ZeloChat só CRIA Checkout sessions e abre Customer Portal via:

- `POST /api/billing/checkout` → `{ planTier: 'chat'|'bundle' }` → retorna `{ url }` (Stripe Checkout). NO TRIAL.
- `POST /api/billing/portal` → `{ url }` (Stripe Billing Portal — cancel/cartão/invoices)
- `POST /api/billing/sync` → fallback chamado pelo frontend após `?billing=success` se webhook tá lento

Source: `server/billing.ts`. Front: `SubscriptionPaywall` + `BillingManagementCard` em `SettingsView.tsx`. AppShell detecta `?billing=success|canceled|portal-return` e força sync + refresh.

**Env vars no Dokploy** (backend) — runbook completo em `BILLING.md`:
- `STRIPE_SECRET_KEY` (obrigatório, mesma do ZeloPDV)
- `PUBLIC_APP_URL=https://chat.zelopdv.com.br` (obrigatório, return URLs)
- `STRIPE_PRICE_CHAT` / `STRIPE_PRICE_BUNDLE` (obrigatórios; sem fallback hardcoded para evitar usar price de produção em dev)

`requireActiveZelochatSubscription()` em `server/supabase.ts` rejeita `'trialing'` propositalmente — política produto é "sem teste grátis".

**Preço exibido = fonte única `src/data/pricing.ts`** (chat R$149 / bundle R$198). Landing, e-mails de onboarding e checkout leem daí. O número tem que bater com o price do Stripe apontado por `STRIPE_PRICE_CHAT`/`STRIPE_PRICE_BUNDLE` — ao mudar o preço, criar o novo price no Stripe e trocar a env no MESMO deploy. Clientes antigos são grandfathered pelo próprio Stripe (a subscription mantém o price antigo até ser migrada) — ver `BILLING.md` §"Mudança de preço e grandfathering".

## Ciclo de vida de instâncias Whatsmiau (JÁ IMPLEMENTADO)

Dois sweepers rodam em background e limpam instâncias órfãs automaticamente:

**`server/subscriptionSweeper.ts`** — assinatura cancelada/expirada:
- Roda 5min após startup + a cada 6h
- Grace period: **7 dias** após expiração. Passado esse prazo, chama `deleteInstance()`.
- Provider-agnostic: tanto Stripe quanto AbacatePay/Pix escrevem na mesma tabela `subscriptions`. O check é `status='active' AND current_period_end > now` — uma assinatura Pix expirada (status='active' mas period_end no passado) é capturada corretamente.
- Dados do cliente (mensagens, sessões, pedidos) são preservados. Só a instância Whatsmiau some.
- Se o cliente renovar depois do grace, `/api/qr` cria a instância nova automaticamente.

**`server/accountDeletionSweeper.ts`** — deleção de conta:
- Roda 3min após startup + a cada hora
- Após 14 dias de grace (`DELETE /api/account` stampa `deletion_scheduled_at`), reclama a conta atomicamente por `claim_due_account_deletions`: antes de cada efeito externo renova/valida o lease por `renew_account_deletion_claim`; cancela Stripe (no-op para clientes Pix — cobrança única, sem recorrência), deleta somente a instância dedicada capturada pelo claim (nunca lookup/fallback legado), limpa todo o Storage por páginas e conclui por `finalize_claimed_account_deletion` com fencing token.
- Qualquer falha externa interrompe antes da purga DB e fica disponível para retry após o lease. Reativação adquire `begin_account_deletion_reactivation` antes do Stripe e só libera o agendamento por `complete_account_deletion_reactivation`; resultado externo ambíguo mantém o fence, e o purge nunca reclama uma conta com reativação pendente.
- QR/connect sempre lê os fences de purge e reativação diretamente antes de retornar cache/criar instância; a gravação do pointer novo também exige ambos nulos e compensa a criação no provedor se perder a corrida.
- **Rollout:** a migration dos RPCs/colunas compartilhados precisa ser aplicada antes do deploy do backend.

## Notificações de status de pedido (JÁ IMPLEMENTADO)

Quando o dono arrasta um card no Kanban, o cliente **já recebe WhatsApp automático** — NÃO é um gap. As flags `notify_customer_preparing`, `notify_customer_ready` e `notify_customer_out_for_delivery` ficam em `empresa_perfil`. A lógica de envio está em `server/router.ts` na rota `PATCH /api/orders/:id/status` (~linha 1484). O texto enviado por status está hard-coded no mesmo bloco. As flags são configuráveis pelo Gerente IA via `SET_CUSTOMER_NOTIFICATION` em `server/managerAssistant.ts`.

## Estoque no cardápio

Produtos com `controlar_estoque = true` exibem badge de estoque colorido na `CatalogView`: verde (>5), âmbar (1–5), vermelho (0 = "Sem estoque"). Produtos sem controle de estoque não mostram nada.

A IA trata estoque como regra operacional:
- `server/configStore.ts` lê `controlar_estoque` e `estoque_atual` das tabelas compartilhadas do ZeloPDV.
- Produto com `controlar_estoque=true` e `estoque_atual<=0` não entra em `getAvailableProducts()` nem no prompt do cardápio.
- Produto com estoque positivo entra no prompt com `estoque atual: N`.
- Antes de abrir `zelochat_pending_orders`, `server/ai.ts` bloqueia qualquer `criar_pedido` com quantidade acima de `estoque_atual` e escala para humano.
- Ao confirmar uma pendência, `confirmPendingOrder()` consulta o estoque atual no banco novamente antes de criar `zelochat_orders`, porque o estoque pode ter mudado entre o resumo da IA e o clique do cliente.
- `/api/sync-config` não aceita catálogo do navegador como fonte de verdade para disponibilidade; o backend recarrega o catálogo direto do banco após o sync para evitar snapshot stale sem estoque.

A baixa de estoque ao confirmar pedido é feita best-effort via RPC `zelochat_decrement_stock`. Se esse RPC falhar, o pedido continua confirmado e o log `[stock] decrement failed` precisa ser investigado com o ZeloPDV.

## Comportamento geral da IA no WhatsApp

Fonte detalhada no vault Obsidian: [[AI_BEHAVIOR_RULES]].

Regras atuais:
- Decisões de pedido pendente são determinísticas primeiro (`src/domain/conversationState.ts`), OpenAI depois.
- Confirmação explícita aceita: `sim`, `ok`, `fechado`, `certinho`, `pode confirmar`, `com certeza`, `👍`, `✅`, `👌`, `🙏`.
- Emoji de entusiasmo (`🔥`, `❤️`, `💕`, `👏`, `😊`) não confirma pedido sozinho.
- Depois da pergunta de observação, `nada`, `sem obs`, `sem alteração`, `não muda nada`, `não, deixa como tá` significam sem alteração e avançam para `criar_pedido`; não repetir resumo.
- `sim, sem cebola`, `fechou, só coloca troco pra 50`, `certo, mas troca a coca` são edição do pending order, não confirmação final.
- `cancelar só a coca`, `cancela a coca` e `cancela a entrega, vou retirar` são edição parcial, não cancelamento do pedido inteiro.
- Hard-button matching só aceita ID real do botão ou label exato. Frases como `confirmar mais tarde?` e `confirmar horário de amanhã` não são botão.

Teste principal: `tests/aiTurnDecision.test.ts`. Ao mudar fluxo de confirmação/observação/pending order, atualize essa suíte antes de mexer no prompt.

## Agenda global da IA (`ai_mode` + per-day schedule)

A IA tem três modos globais em `empresa_perfil.ai_mode`: `always_on`, `always_off`, `scheduled`. O gate fica em `evaluateAiSchedule()` / `isAiGloballyEnabledNow()` em `src/domain/aiSchedule.ts`, chamado pelo `server/ai.ts:generateAndSendReply` antes de qualquer resposta automática.

Quando o modo é `scheduled`, duas fontes de janela coexistem:

1. **Per-day (preferida)** — coluna `empresa_perfil.ai_schedule_days` (JSONB, migration 040). Shape:
   ```json
   { "sun": { "enabled": true, "start": "00:00", "end": "00:00", "inverted": false },
     "mon": { "enabled": true, "start": "06:00", "end": "18:00", "inverted": true },
     ... }
   ```
   Por dia:
   - `enabled=false` → IA desligada o dia todo.
   - `enabled=true && start===end` → 24h (ignora `inverted`).
   - `enabled=true && start<end && inverted=false` → IA ativa **dentro** de `[start, end]`.
   - `enabled=true && start<end && inverted=true` → IA ativa **fora** de `[start, end]` (operador descreve o turno humano e a IA cobre o resto). Caso Casa dos Salgados: humanos 06–18h, IA 18h→06h+1; cada dia continua independente porque a faixa "noite" (`18:00–23:59`) e "madrugada" (`00:00–06:00`) caem ambas no mesmo dia local.
   - `start>end` permanece inválido — para overnight, use `inverted=true` em vez de wrap.
   - Campo `inverted` é opcional no JSONB (default false). Rows pré-existentes sem a chave continuam comportando-se como "ativa dentro" sem nenhuma alteração de comportamento.
   - **Não há wrap entre dias** — para "até o fim do dia" o operador coloca `end='23:59'`. A resolução do dia da semana usa o timezone da empresa via `Intl.DateTimeFormat('en-US', { weekday: 'short' })`.

2. **Single-window legacy** — colunas `ai_schedule_start`/`ai_schedule_end`. Mesma janela todo dia, com suporte a overnight wrap (`start > end`). Continua sendo usada quando `ai_schedule_days IS NULL` — clientes antigos não perdem a agenda até abrirem a tela e salvarem o novo formato.

A migração 040 só adiciona a coluna nullable — contas existentes ficam com `ai_schedule_days = NULL` e mantêm o comportamento legacy bit-a-bit idêntico ao anterior até re-salvarem a agenda. A UI per-day usa a janela legacy do operador como seed inicial (não horário comercial da loja), pra que um save acidental sem mudar nada preserve o agendamento que ele já tinha.

Testes: `tests/aiSchedule.test.ts` cobre legacy + per-day + fallback. Antes de mexer no gate, rodar essa suíte.

### Override por data bloqueada

`empresa_perfil.blocked_dates` (JSONB `[{ date: 'YYYY-MM-DD', reason }]`) tem dois efeitos hoje:

1. **Guards de pedido** (`server/ai.ts`): IA continua recusando `criar_pedido`, retirada, Pix etc. para datas bloqueadas — a loja não está operando.
2. **Override do schedule gate** (`evaluateAiSchedule`): se hoje (no fuso da empresa, resolvido via `Intl.DateTimeFormat('en-CA', { timeZone })`) está em `blocked_dates`, força `effectiveEnabledNow=true` independente da agenda semanal. Justificativa: blocked = dono não vai trabalhar; sem o override, mensagens de cliente em feriado caíam num "AI off" do schedule (ex: Casa dos Salgados, sábado 14h cai no turno humano que não vai existir) e ficavam sem resposta.

`always_off` **vence** sobre o override — kill-switch deliberado do operador é respeitado mesmo em data bloqueada. `always_on` e `scheduled` recebem o boost.

Editor de blocked_dates fica em `CalendarView`; AppShell auto-salva (`saveEmpresa({ blocked_dates })`) debounced. O parser de linguagem natural (`server/scheduleParser.ts`) também consegue propor mudanças em `blockedDates` quando o operador diz "bloqueia 25/12 Natal" — frontend mostra diff (added/removed) antes do operador confirmar.

### UI da agenda (wizard + edição por IA)

A tela em Configurações tem 3 camadas de fluxo, ordenadas por sofisticação:

1. **Wizard** (`src/components/settings/ScheduleWizard.tsx`) — fluxo padrão quando o operador escolhe "Agendada". 4 passos: cenário (3 cards: "IA cobre quando ninguém atende" / "IA atende em horário específico" / "IA atende sempre"), dias, horário, preview visual. State machine pura em `src/domain/aiScheduleWizard.ts` (`buildScheduleFromWizard`, `reverseEngineerWizardState`, `summarizeScheduleResult`). O cenário decide a polaridade (`inverted`): "IA cobre quando ninguém atende" → inverted=true; "IA atende em horário específico" → inverted=false.
2. **Edição por IA (free text)** — depois de salvar, o card de resumo mostra um input "Quero ajustar algo? Descreva em uma frase" + visual preview. Operador digita ex. "muda quarta pra 24h" → frontend chama `POST /api/ai/schedule-parse` → backend usa OpenAI (gpt-4o-mini) com response_format JSON e o prompt em `server/scheduleParser.ts` → retorna `{ mode, scheduleDays, summary }`. UI renderiza a proposta como diff visual; nada salva até o operador clicar "Aplicar mudança". Nunca persiste direto — sempre exige confirmação humana.
3. **Editor manual (avançado)** — disclosure "Editar manualmente (avançado)" expõe o editor dia-a-dia legado (3 botões Off/24h/Horário + toggle IA dentro/fora) para padrões que não couberem no wizard.

`reverseEngineerWizardState` tenta mapear uma `AiScheduleDays` salva de volta para o estado do wizard quando o operador clica "Reconfigurar". Padrões não-uniformes (ex.: horários diferentes em dias diferentes) retornam null e o wizard começa em branco; o operador é orientado para o editor avançado nesses casos.

Testes: `tests/aiScheduleWizard.test.ts` cobre as duas polaridades, reverse-engineer e summary.

## Histórico do cliente (abordagem planejada, não implementada)

Para memória cross-conversation da IA, a abordagem planejada é: manter um campo de resumo minimalista no perfil do cliente (provavelmente em `zelochat_sessions` ou nova tabela) com até X caracteres, que a IA sobrepõe/atualiza incrementalmente a cada conversa. Não é um log completo — é um "perfil vivo" comprimido. Ainda não implementado.

## Web Push / PWA notifications

Service worker em `public/sw.js`, registrado pelo `src/main.tsx` apenas em build prod. Inscrições ficam em `zelochat_push_subscriptions` (uma linha por browser/dispositivo opt-in). Disparos saem do `server/push.ts → sendPushToEmpresa()`, chamado pelo `server/index.ts` logo após `handleIncomingMessage()` resolver `persisted=true`. O SW só mostra o banner se nenhuma aba ZeloChat está visível — a checagem é dentro do `push` handler.

**Setup em produção (uma vez)**:
1. Gerar par VAPID: `npx web-push generate-vapid-keys`
2. Set no Dokploy backend: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:contato@zelopdv.com.br`
3. Aplicar migração `supabase/migrations/039_zelochat_push_subscriptions.sql` no Supabase

Sem essas envs, `/api/push/vapid-public-key` retorna `{enabled:false}` e o banner some — degradação silenciosa, nada quebra.

## UI conventions

- **Nunca usar dados mockados** em placeholders ou textos visíveis — use padrões genéricos como `(XX) XXXXX-XXXX`
- Placeholders devem descrever o formato, não simular dados reais
- `formatPhoneDisplay()` em `App.tsx` formata qualquer número bruto para exibição — usar em todo lugar que exibe telefone

## Architecture rules

- `src/domain/` has zero React or AI dependencies — keep it that way
- Never call AI APIs from React components — always go through `/api/ai/complete`
- Never import Baileys/server code from the frontend — use REST API or WebSocket
- All chat state mutations go through `useWhatsAppSessions` hook — never mutate `sessions` directly in `App.tsx`
- Delete operations must hit the backend first (or optimistic update + rollback on error)

## Documentação — convenção AI-first

Toda IA que trabalhar neste repo **deve manter a documentação automaticamente**. Não é opcional — é o que permite que a próxima IA (ou dev) entre sem perguntar nada.

### Após qualquer fix ou feature
- **[[FIXES_PROGRESS]]**: adicionar entrada na sprint do dia. Formato: `- ✅ <ID> — <o que era> → <o que foi feito> — \`arquivo:linha\``
- **[[CURRENT]]**: atualizar "Em aberto" se o fix fecha algo listado lá

### Após fix crítico em prod (P0/P1 ou que causou outage visível)
- **[[INCIDENTS]]**: nova entrada com: Sintoma (1 linha), Causa-raiz (1 frase), Fix (1 frase + arquivo:linha)
- Comentário inline na função crítica: `// FIX YYYY-MM-DD: <causa em 1 frase> → <fix em 1 frase>`

### Feature entregue
- Deletar o arquivo de spec da feature (specs são temporários, o código é a verdade)
- Se o comportamento for não-óbvio, documentar em CLAUDE.md ou no arquivo relevante

### Início de qualquer sessão de trabalho
1. Ler **[[CURRENT]]** — entender o foco atual
2. Se o foco mudou, atualizar **[[CURRENT]]** antes de começar
3. Para mudanças em funções listadas em "Critical functions", ler o inline docstring completo antes de tocar

### Regra de ouro
> Documentação que não existe não será lembrada. Se você fez algo não-óbvio, documenta agora — não depois.
