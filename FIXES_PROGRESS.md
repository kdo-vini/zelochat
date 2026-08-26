# ZeloChat — Fixes Progress Tracker

**Source review:** [[CODE_REVIEW]] — 6-agent senior audit, 24 P0 / 47 P1 / 38 P2 / 24 P3.
**Customer status:** 1 paying tenant (R$3k contract, Casa dos Salgados). 1 founder test (Donutopia).

### Clientes CRM — rollout (2026-08-26)

- ✅ CRM-DB-024 — agregação de atividade assumia que `zelochat_sessions.last_message_time` era timestamp, mas o banco compartilhado mantém essa coluna como texto ISO → cast protegido por formato antes do `max`, evitando falha da migration 050 e preservando datas válidas — `supabase/migrations/050_customer_read_aggregates_and_conflict_dedupe.sql:58`, `tests/customerRelationshipSchema.test.ts:23`
- ✅ CRM-DB-025 — probe transacional de RLS usava sintaxe inexistente `create temporary function` → função de fixture agora é criada em `pg_temp` e continua descartável via rollback — `supabase/verification/customer_relationship_authz.sql:152`, `tests/customerRelationshipSchema.test.ts:109`
- ✅ CRM-DB-026 — probe de RLS tinha variável PL/pgSQL `table_name` colidindo com `information_schema.columns.table_name` → colunas do catálogo agora são qualificadas e o fixture pode executar no Postgres real — `supabase/verification/customer_relationship_authz.sql:43`
- ✅ CRM-DB-027 — chamadas do fixture temporário não usavam o schema `pg_temp` → invocações agora são qualificadas para funcionar após `set local role` — `supabase/verification/customer_relationship_authz.sql:367`
- ✅ CRM-DB-028 — probe tentava atualizar/deletar `zelochat_person_tags.id`, mas a tabela usa chave composta → fixture agora testa tags por `(empresa_id, pessoa_id, tag_id)` — `supabase/verification/customer_relationship_authz.sql:177`
- ✅ CRM-TEST-023 — timer de limpeza de deduplicação mantinha processos consumidores vivos após o trabalho terminar → o timer agora usa `unref`, preservando a limpeza sem bloquear shutdown e a suíte completa — `server/whatsapp.ts:53`, `tests/crmHardening.test.ts:9`
- ✅ CRM-TEST-022 — endpoints de teste importavam o cliente global de conexão apenas para inferir um telefone, prendendo o processo de testes e podendo usar um número fora do tenant → testes agora exigem o número explícito já coletado pela UI e não carregam o lifecycle global — `server/campaigns/service.ts:1`, `server/automations/router.ts:1`, `tests/crmHardening.test.ts:1`
- ✅ CRM-QUEUE-021 — leases terminais de automações ainda tentavam atualizar a FK exclusiva de campanhas após a separação dos jobs → migration 059 recria a recuperação usando `automation_dispatch_id`, mantendo destinatários e dispatches no mesmo estado terminal — `supabase/migrations/059_automation_dispatch_lease_terminal.sql:1`, `tests/customerAutomations.test.ts:1`
- ✅ CRM-ROLLOUT-020 — não havia controle gradual por empresa nem painel agregado de operação → migration 057 adiciona flags fail-safe para CRM/campanhas/automações, APIs e navegação respeitam o rollout, e métricas/painel registram somente contadores e idade da fila — `server/customers/rollout.ts:1`, `server/customers/metrics.ts:1`, `supabase/migrations/057_customer_crm_rollout.sql:1`

### Clientes CRM — campanhas (2026-08-26)

- ✅ CRM-CAMPAIGNS-015 — não havia uma jornada guiada para campanhas → Clientes agora oferece Segmentos/Campanhas com wizard público → mensagem → teste → revisão → envio/agendamento, contagem de elegíveis/suprimidos e acompanhamento da fila — `src/components/customers/CampaignWizard.tsx:1`, `src/components/customers/CampaignsTab.tsx:1`, `tests/campaignUiGuardrails.test.ts:1`

### Clientes CRM — fundação de acesso (2026-08-25)

- ✅ CRM-IDENTITY-005 — webhook e sessões agora usam o adaptador único `ensure_customer_from_whatsapp`; vínculos inequívocos persistem `pessoa_id`, conflitos/erros ficam sem pessoa e nunca bloqueiam a mensagem/Atendimento, com fallback pessoa-first e nome manual preservado — `server/customers/identity.ts:1`, `server/messageHandler.ts:1020`, `tests/customerIdentityResolution.test.ts:1`
- ✅ CRM-ORDER-006 — pedidos manuais e ZeloMenu tentam o mesmo resolvedor antes da RPC canônica, preservando snapshots e confirmando mesmo em conflito/erro; `Order.personId` é apenas vínculo adicional — `server/canonicalOrders.ts:1`, `server/zelomenuCartSessions.ts:1000`, `tests/customerOrderResolution.test.ts:1`
- ✅ CRM-BACKFILL-007 — backfill paginado/checkpoint/idempotente com dry-run, confirmação textual de empresa e estado server-only; migration usa a próxima versão real 049 (o nome 037 do plano foi ignorado) — `server/customers/backfill.ts:1`, `supabase/migrations/049_customer_backfill_state.sql:1`, `tests/customerBackfill.test.ts:1`
- ✅ CRM-READ-008 — filtros allowlist, cursor estável, regra de atividade de 30 dias e APIs agregadas de clientes, mensagens, pedidos e timeline exigem `pessoas.visualizar` — `server/customers/filters.ts:1`, `server/customers/router.ts:1`, `tests/customerFilters.test.ts:1`
- ✅ CRM-AUDIT-009 — revisão bloqueadora corrigida: contrato de pedido ausente usa fallback legado somente para erro comprovado; dry-run é somente leitura; cursor 049 é textual; fontes RPC são enumeradas; conflitos fazem upsert/dedup; sessão preserva `pessoa_id` existente; caminho legado da IA tenta vínculo fail-soft — `server/customers/orderContract.ts:1`, `server/customers/backfill.ts:1`, `server/ai.ts:2270`, `tests/customerBlockFixes.test.ts:1`
- ✅ CRM-AUDIT-010 — API CRM rejeita operadores PostgREST, pagina por tupla completa, unifica cursor de timeline, aplica tag/atividade antes da página e valida owner/tipo cliente antes de subrotas — `server/customers/filters.ts:1`, `server/customers/service.ts:1`, `server/customers/router.ts:1`
- ✅ CRM-AUDIT-011 — rereview final: fallback Gate A só recua para assinatura legada em erro exato conhecido; conflitos abertos têm chave única parcial + RPC transacional; listagem e timeline usam RPCs server-only com agregação/keyset antes do limite; UUID/ISO canônicos bloqueiam cursores forjados — `supabase/migrations/050_customer_read_aggregates_and_conflict_dedupe.sql:1`, `server/customers/contract.ts:1`, `tests/customerBlockFixes.test.ts:1`

- ✅ CRM-ACCESS-001 — o backend só resolvia `empresa_perfil.user_id` do titular → `requireEmpresaId`/`requireEmpresaAndUserId` agora reutilizam um contexto de ator, dono, empresa e permissões; subusuário ativo usa o cargo compartilhado, vínculos inativos falham fechado, e o cache é indexado pelo ator — `server/accessControl.ts:1`, `server/supabase.ts:83`, `server/router.ts:917`, `tests/customerAccessControl.test.ts:1`
- ✅ CRM-ACCESS-002 — Round 1: `userId` legado voltou a significar `ownerUserId`; exclusão de conta, reativação, Stripe, PIX e onboarding exigem owner explícito, enquanto efeitos de auditoria/rate-limit preservam `actorUserId`; status/cargo de subusuário são revalidados em toda requisição, com cache limitado somente a metadados de owner e limpeza de expirados — `server/accessControl.ts:95`, `server/supabase.ts:84`, `server/router.ts:2596`, `server/billing.ts:156`, `server/billingPix.ts:32`, `tests/customerAccessControl.test.ts:256`
- ✅ CRM-ACCESS-003 — Round 2: onboarding owner-only deixou de retornar 500 para subusuário e Stripe passou a mapear empresa ausente para 404 amigável; mapeadores reais foram extraídos/testados sem expor códigos internos no texto — `server/router.ts:3524`, `server/authErrors.ts:7`, `server/billing.ts:165`, `tests/accessErrorMapping.test.ts:1`
- ✅ CRM-SCHEMA-004 — não havia relacionamento persistente pessoa/empresa no ZeloChat e tags/conflitos podiam perder isolamento no rollout → migration 048 adiciona `pessoa_id` nullable + `owner_user_id` persistido nas sessões, trigger de compatibilidade para writers legados, relacionamento, tags de pessoa e conflitos auditáveis com FKs compostas tenant-safe, RLS/grants server-only e índices; tipos, prova SQL de policies/roles e verificação transacional foram adicionados — `supabase/migrations/048_customer_relationship_foundation.sql:1`, `src/types.ts:57`, `tests/customerRelationshipSchema.test.ts:1`

### Catálogo — separação PDV/ZeloMenu (2026-08-24)

- ✅ CATALOG-VISIBILITY-001 — `ocultar_no_pdv` deixou de bloquear ou publicar
  item no cardápio digital. O resolver de publicação, a disponibilidade usada
  pelo runtime e os snapshots enviados pelo AppShell agora preservam a
  independência entre venda manual interna e publicação customer-facing;
  `tests/zelomenuPublication.test.ts` cobre produto publicado oculto no PDV.
- ✅ CATALOG-VISIBILITY-002 — nenhuma escrita de catálogo foi feita na Bem
  Servido; a migration de contrato metadata-only fica versionada e aplicada no
  ZeloPDV, que é o repo dono do schema compartilhado.

### Contenção arquitetural (2026-08-13) — exclusão de conta

- ✅ DEL-SWEEP-001 — o sweeper não escolhe mais contas vencidas por SELECT direto: usa `claim_due_account_deletions(p_limit)`, renova/valida o token antes de cada efeito externo por `renew_account_deletion_claim` e só conclui por `finalize_claimed_account_deletion`, fechando concorrência entre réplicas, lease vencido e reativação — `server/accountDeletionSweeper.ts`.
- ✅ DEL-SWEEP-002 — a remoção destrutiva de WhatsApp usa somente o pointer capturado atomicamente pelo claim, sem novo lookup e sem `WHATSMIAU_INSTANCE` fallback; remoção/CAS falham fechado — `server/instanceManager.ts`.
- ✅ DEL-SWEEP-003 — limpeza de Storage agora percorre todas as páginas e propaga falhas de list/remove; billing, instância ou storage incompletos bloqueiam a purga DB para retry posterior — `server/accountDeletionSweeper.ts`, `server/billing.ts`.
- ✅ DEL-SWEEP-004 — reativação é uma exceção exata do paywall e adquire um token atômico antes do Stripe; somente o token exato conclui, e resultado externo ambíguo mantém o fence para impedir purge — `server/index.ts`, `server/router.ts`.
- ✅ DEL-SWEEP-005 — QR/connect não pode criar/reusar instância durante purge ou reativação: faz leitura fresca dos dois tokens antes do cache/provider, persiste com CAS de ambos nulos e apaga a criação upstream se perder a corrida — `server/instanceManager.ts`, `server/router.ts`.
- ⏳ Cobertura — RED do novo fence confirmado e teste focado verde; lint, typecheck, build e suíte completa serão reexecutados após fechar a migration compartilhada. A migration precisa entrar antes do deploy automático deste backend.

### Sprint 15 (2026-08-01) — simplificação dos gatilhos personalizados
- ✅ AI-CONFIGS-002 — o atalho redundante “Encaminhar para outra linha” aparecia abaixo do card de gatilhos personalizados, embora a mesma ação já estivesse disponível no dropdown de tipo → removido o botão e seu template exclusivo; a opção **Encaminhar** do dropdown permanece funcionando — `src/components/views/AIConfigsView.tsx`.

### Sprint 14 (2026-07-31) — conexão automática do Zelo Impressão
- ✅ PRINT-AUTO-001 — a primeira instalação exigia código mesmo quando o agente Windows podia autorizar o navegador → `zeloImpressaoClient` tenta `POST /connect` ao detectar o aplicativo aberto, mantém o código como fallback e atualiza a copy da landing, da barra lateral e do fluxo de instalação — `src/services/zeloImpressaoClient.ts:145`, `src/services/printerService.ts:155`, `src/components/PrinterButton.tsx:63`, `src/components/landing/FAQ.tsx:86`.

### Sprint 13 (shipped 2026-07-31) — viewer de PDF inline
- ✅ DOC-001 — PDFs e documentos enviados pelo cliente não eram visualizáveis no app (só no WhatsApp) → visualizador inline via iframe nativo com fallback embed para data URIs; botão de download no header do modal; ícone vermelho para PDFs; migração corrige gap entre limite do servidor (25MB) e bucket Supabase (10MB) — `src/components/views/PDFViewer.tsx:1`, `src/components/views/MessageBubble.tsx:358`, `supabase/migrations/047_media_bucket_size_limit.sql:1`
- ✅ DOC-002 — PDFs encapsulados por wrappers do WhatsApp eram reconhecidos como texto, mas o anexo/base64 não era extraído → normalização recursiva aplicada à entrada/saída, MIME de PDF com parâmetros normalizado e regressão adicionada; bucket remoto atualizado para 25MB via Supabase CLI — `server/messageHandler.ts:751`, `server/messageHandler.ts:2118`, `tests/messageHandlerMedia.test.ts:1`

### Sprint 12 (fix 2026-07-30) — reenvio de mensagem
- ✅ CHAT-RETRY-001 — mensagens manuais que falhavam ficavam apenas com o ícone de erro, sem ação porque não recebem ID do WhatsApp → o menu da mensagem agora permite **Tentar novamente** (reusa o mesmo registro, com trava contra duplo envio) ou **Excluir mensagem** do histórico; as duas ações respeitam o escopo da empresa. Regressão comportamental cobre envio único, colisão, falha, mídia/quote e conteúdo vazio — `src/components/views/MessageBubble.tsx:561`, `src/hooks/useWhatsAppSessions.ts:419`, `server/failedMessageRetry.ts:45`, `tests/retryFailedMessage.test.ts:1`

### Sprint 11 (fix 2026-07-29) — preço da landing
- ✅ LANDING-001 — preço da seção de planos podia ficar preso em `0` enquanto o `IntersectionObserver` aguardava a animação → `NumberTicker` agora renderiza o valor real desde o primeiro paint e só anima mudanças posteriores — `src/components/landing/ui/NumberTicker.tsx:18`

### Sprint 10 (shipped 2026-07-24) — Hotfix pós-refactor do Cérebro IA
- ✅ AI-CONFIGS-001 — refactor removeu bindings ainda usados pela tela e causava `ReferenceError: qrSaveState is not defined` ao abrir respostas rápidas → estado de salvamento, debounce e foco das instruções foram restaurados, com regressão dedicada — `src/components/views/AIConfigsView.tsx:196`, `tests/aiConfigsViewGuardrails.test.ts:1`

### Sprint 8 (shipped 2026-07-24) — IA conhece complementos do cardápio
- ✅ AI-001 — perguntas sobre opções dentro de produtos configuráveis ignoravam grupos/complementos → o prompt agora inclui grupos e opções ativos, preço adicional e obrigatoriedade, mantendo produtos não publicados fora do contexto do cliente; regressão cobre “Monte sua Massa → Nhoque” e produto interno — `server/ai.ts:1663`, `tests/aiPromptGuardrails.test.ts:98`
- ✅ AI-002 — IA respondia "esse horário já passou: 20:08. Agora são 20:09" para pedido imediato (Bem Servido). Causa: `isPastSameDaySchedule` marcava como passado qualquer horário `<=` o minuto atual (tolerância zero) → pedido "pra já" com pickupTime ≈ agora caía em past_time por 1 min de latência. Bug adjacente: o "a"/"as" solto de `collectRequestedTimeMinutes` casava preço/quantidade/tempo-relativo como horário ("a 5 reais" → 05:00, "daqui a 20 minutos" → 20:00, "as 5 da tarde" → falso 05:00). Fix: tolerância de 15 min (`SAME_DAY_PAST_GRACE_MINUTES`) no guard de horário passado + negative lookahead excluindo unidades de preço/quantidade/período no parser. Cobertura: 63 casos de comunicação informal BR — `server/ai.ts:1150`, `server/ai.ts:1203`, `tests/aiScheduleEdgeCases.test.ts`
- ✅ PROD-002 — pedidos entregues acumulavam no quadro de Produção (bug real de prod: 4 pedidos de ontem presos na coluna ENTREGUE). Causa: `ProductionView` renderizava `state.orders` sem filtro de idade, enquanto `useOrders` carrega 14 dias de entregues de propósito (Dashboard/Agenda). Fix: novo helper puro `filterProductionBoardOrders` esconde do quadro (feed + kanban) os entregues fora da janela de permanência (30min medidos a partir de `zelo_orders.closed_at`), preservando-os na Agenda; `closed_at` mapeado para `Order.closedAt`. Tick de 1min re-avalia a janela sem precisar de refetch — `src/domain/productionBoard.ts`, `src/components/views/ProductionView.tsx`, `src/domain/canonicalOrders.ts`, `src/types.ts`, `tests/productionBoard.test.ts`

### Sprint 8 (shipped 2026-07-23) — layout responsivo da Produção
- ✅ PROD-001 — fila de pedidos e colunas do Kanban ganharam largura adaptativa, alças de redimensionamento, persistência local e suporte a teclado — `src/components/views/ProductionView.tsx`, `src/index.css`
- ✅ ZLM-AUTO-001 — Admin do ZeloMenu ganhou a página separada de Configurações com toggle de aceite automático por loja; o bloqueio Pix só permanece com a conferência de comprovante do ZeloChat ativa, e a aprovação da IA executa o aceite transacional ou escala conflitos para atendimento — `../zelomenu/src/pages/SettingsPage.tsx`, `../zelomenu/server/zelomenuCartSessions.ts:1432`, `server/canonicalOrders.ts:75`, `server/ai.ts:3094`

### Sprint 8 (shipped 2026-07-23) — pedidos online nos relatorios
- ✅ ZLM-312 — bilhete de grupo era uma descrição corrida → pedido agora preserva `productName`/`modifierGroups` e a impressão separa produto e cada grupo em linhas legíveis — `src/types.ts`, `src/domain/canonicalOrders.ts`, `src/services/printerService.ts:49`
- ✅ ZLM-311 — pedido ZeloMenu aguardando aceite não imprimia na chegada e grupos saíam truncados → assinatura de pedidos ativa também no Atendimento, `pending_review` imprime imediatamente e a UI ganhou aceite/recusa; bilhete agora quebra linhas preservando todos os complementos — `src/AppShell.tsx:271`, `src/components/views/ProductionView.tsx:622`, `src/services/printerService.ts:25`
- ✅ ZLM-302 — pedidos canonicos entregues agora geram venda idempotente com itens no caixa que cobria o horario da entrega; reparo incluido para entregas ZeloMenu antigas sem sale_id — ../zelopdv/.ai/migrations/canonical_order_sales_2026_07_23.sql:1
- ✅ ZLM-313 — mover pedido falhava com 500/`UNKNOWN_ERROR` porque erros da RPC chegavam como objetos e eram descartados pelo `instanceof Error` → normalizador classifica revisão, estoque, permissão e transição inválida; API e toast exibem orientação em português — `src/domain/orderTransitionError.ts:1`, `server/router.ts:2040`, `src/AppShell.tsx:880`

**Latest hotfix note (2026-07-23) — impressão automática silenciosamente perdida:** reportado em prod: Zelo Impressão conectado, mas pedido do WhatsApp às vezes não sai na impressora, sem erro visível. Causa raiz: `autoPrintOrder` (`src/AppShell.tsx`) só é chamado dentro do handler de `INSERT` do canal Realtime do Supabase em `src/hooks/useOrders.ts` — um evento único, sem replay. Qualquer desconexão momentânea do WebSocket no instante exato da criação do pedido (sono do notebook, wifi, aba em background) perde esse evento pra sempre; o pedido aparece normal na tela via fetch normal, mas a chamada de impressão nunca é feita (não é falha de impressão, é falha de entrega do aviso). Descartada a hipótese alternativa de conflito de impressora com outro app (iFood Gestor de Pedidos): ZeloPDV e ZeloChat imprimem pelo mesmo bridge local (`127.0.0.1:17321`, `zeloImpressaoClient`) e o ZeloPDV nunca apresentou esse sintoma, o que aponta pra camada de entrega do evento no ZeloChat, não pra impressora/USB. Fix: `src/hooks/useOrders.ts` agora reconcilia a cada `refresh()` — poll de 30s + refresh imediato em `visibilitychange` — comparando a lista nova de pedidos com a anterior (`src/domain/orderAutoPrint.ts:selectOrdersToAutoPrint`, pura, com `tests/orderAutoPrint.test.ts`) e reimprimindo qualquer pedido novo/recente (≤15min, status ≠ `delivered`) que o Realtime tenha perdido. O dedupe de "já impresso" em `src/AppShell.tsx` deixou de viver só em memória (`AUTO_PRINT_DEDUPE_WINDOW_MS` de 60s) e agora persiste em `localStorage` (`zelochat_auto_printed_order_ids_v1`, janela de 48h) pra não duplicar impressão entre reloads de aba; a chave usa o prefixo `zelochat_` então é varrida automaticamente por `clearLocalAppState` no logout. Sem migração, sem mudança em `server/`. `npm run lint` + `npm run build` + suíte de testes verdes (as 2 falhas pré-existentes de `auditFixGuardrails.test.ts`/`zelomenuSlug.test.ts` são drift conhecido, não relacionado).
**Latest execution note (2026-06-08 Sprint 67):** Configurar a agenda da IA virou um wizard de 4 passos + edição por linguagem natural ("muda quarta pra 24h" / "bloqueia 25/12 Natal"). Datas bloqueadas agora forçam IA ligada 24h (resolvendo o gap em que cliente ficava sem resposta no feriado quando o schedule semanal silenciava o horário). Backend `POST /api/ai/schedule-parse` cobre schedule + blocked_dates; nunca persiste sem confirmação humana.

**Latest hotfix note (2026-06-11 Sprint 68):** Bundle renovado via AbacatePay no ZeloPDV não pode perder acesso no ZeloChat por causa de `manually_extended_until` vencido. A expiração efetiva agora usa o timestamp mais longo entre `current_period_end` e `manually_extended_until` no backend, frontend e sweeper; o caso real da Casa dos Salgados foi destravado com hotfix na row compartilhada `subscriptions`.

**Latest UI note (2026-06-24):** Checkout público do ZeloMenu (`src/pages/ZeloMenuCartPage.tsx`) virou um wizard mobile-first de 3 passos (sacola → entrega/retirada → confirmar) com slide horizontal por CSS transform e total/CTA fixos no rodapé. Passo de entrega é adaptativo (endereço colapsa na retirada); "Pra já" vs "Agendar (encomenda)" expõe o date/time picker só quando o cliente quer encomendar. Toda a lógica de dados foi preservada (revalidação de preço, cart token, loja fechada/`isOpen`, pedido público, Pix, estado confirmado virou tela de sucesso). Sem frete grátis (não existe no backend). Render only — nenhuma mudança em rota, API ou estado compartilhado.

**Latest hotfix note (2026-07-22):** Bug real de prod — pedidos vindos do ZeloMenu não pareciam poder ser excluídos ("Excluir" não fazia efeito). Causa raiz confirmada via consulta direta ao Supabase (`zelo_order_events`): o backend (`transition_zelo_order` RPC, `cancel` de `pending_review`) **funcionava corretamente**; o bug era 100% client-side, dois problemas empilhados: (1) `src/hooks/useOrders.ts` usava `.or('status.not.in.(...), created_at.gte.X')` — como é um OR, qualquer pedido criado nos últimos 14 dias passava pelo filtro *independente do status*, então um pedido já cancelado continuava aparecendo na Produção; (2) `canonicalStatusToUi` (`src/domain/canonicalOrders.ts`) não tinha case pra `cancelled`/`rejected`, caindo no `default: 'pending'` — o pedido cancelado reaparecia com badge "Pendente", idêntico a um pedido ativo de verdade. Resultado: excluir um pedido cancelava no banco mas o card "ressuscitava" com a mesma cara de antes. Fix: `.or()` agora só aplica o lookback de 14 dias a `delivered`/`closed` (os únicos status terminais com slot na UI); `cancelled`/`rejected` ficam sempre excluídos. Corrigido também bug adjacente em `ProductionView.tsx:668` — o handler de confirmação de exclusão não dava `await` em `onDelete`, então qualquer erro real de exclusão seria engolido silenciosamente sem feedback ao operador. Nenhuma migração necessária — os dois pedidos já estavam corretamente `cancelled` no banco (confirmado via `zelo_order_events`), só sumiram da tela depois do fix do filtro. `canonicalStatusToUi` não foi alterado (com o filtro corrigido, `cancelled`/`rejected` nunca mais chegam ao frontend, então o `default: 'pending'` fica inalcançável — não vale adicionar case morto). Arquivos: `src/hooks/useOrders.ts`, `src/components/views/ProductionView.tsx`.

**Latest hotfix note (2026-07-23):** Simulador de atendimento (Bem Servido) disse "fechado, reabrimos amanhã às 11:00" testado às 08:56 de quinta-feira — sendo que a loja abre HOJE às 11:00 (janela `thu: 11:00–13:30`). Causa raiz: `resolveWeeklyStatus`/`isOpenAt` calculavam a próxima abertura corretamente (quinta, hoje), mas o label enviado ao prompt (`server/ai.ts`) era só o nome do dia por extenso ("quinta-feira às 11:00"), sem dizer que era HOJE. O aviso explícito "HOJE é {dia}" só existia no branch de dia totalmente fechado (`closedDays` legado) — não dispara pra lojas com múltiplas janelas por dia que estão fechadas *entre* janelas (ex.: antes do almoço abrir). Sem esse anchor, o gpt-4o-mini teve que adivinhar se "quinta-feira" era hoje ou não, e chutou errado ("amanhã"). Fix: nova `buildNextOpenLabel()` resolve hoje/amanhã/dia-da-semana de forma determinística no código (comparando `nextOpen.day` com `weekdayKeyInTz(now)` e com o dia seguinte), em vez de deixar a inferência pro modelo. Arquivo: `server/ai.ts`.

### Sprint 9 (shipped 2026-07-24) — AppShell refactor + teste pipeline + doc cleanup
- ✅ APP-001 — AppShell monolithic (1543 lines) split: `useAutoPrint` hook extracted (`src/hooks/useAutoPrint.ts`), `Sidebar.tsx` + `MobileBottomNav.tsx` + `MainContent.tsx` created. AppShell final: 1063 lines (−31%). `server/router.ts` inline normalization replaced with `normalizeLoose` from `conversationState.ts`. Reviewed by Claude Opus: 2 P0 + 2 P1 + 4 P2, all fixed. `src/AppShell.tsx`, `src/hooks/useAutoPrint.ts`, `src/components/Sidebar.tsx`, `src/components/MainContent.tsx`, `src/components/MobileBottomNav.tsx`, `server/router.ts`
- ✅ TEST-001 — Hard-button/soft-confirm normalization test suite: 77 tests covering 12 CONFIRMAR variants, 10 CANCELAR variants, 13 near-misses (P1.15 regression), soft-confirm sim/s/nao/n, button ID override (CONFIRM_ORDER/CANCEL_ORDER wins over text). Run via `npx tsx tests/orderConfirmationPipeline.test.ts`. `tests/orderConfirmationPipeline.test.ts`
- ✅ DOC-001 — `014_zelochat_rls_hardening.sql` header `DRAFT` → `✅ APPLIED`. `CODE_REVIEW.md` P0.5 trade-off note added (bucket stays public, Whatsmiau constraint). `CURRENT.md` stale entries removed (`ai.ts:1778`, 014 DRAFT, P1 94%→100%). `supabase/migrations/014_zelochat_rls_hardening.sql`, `CODE_REVIEW.md`, `CURRENT.md`
- ✅ DIAG-001 — Strategic HTML report (`diagnostico.html`) mapping risks by priority (0 critical, 3 important, 5 tactical), ecosystem health matrix, timeline suggestion. `diagnostico.html`

**Latest hotfix note (2026-07-23):** Pedido normal recebido pelo cardápio digital estava sendo escalado como "Reclamação ou cliente irritado". Causa raiz: o modelo podia selecionar o gatilho nativo amplo e o backend executava a escalação sem confirmar que a mensagem atual do cliente tinha sinal de reclamação. Fix: o gatilho nativo agora exige sinal explícito na última mensagem do cliente; pedidos, saudações e consultas de status são ignorados como falsa positiva. Condições personalizadas continuam sob controle do dono. Arquivos: `src/domain/escalationIntent.ts`, `server/ai.ts`, `server/builtinTriggers.ts`, `tests/aiToolPlan.test.ts`.

- ✅ ESC-001 — pedido normal era tratado como reclamação → gatilhos nativos agora são validados pela última mensagem do cliente — `server/ai.ts:3697`

**Latest note (2026-07-22):** (1) Landing reposicionada para a narrativa ZeloChat + ZeloMenu — a IA atende e leva o cliente pro cardápio online (não monta pedido); ChatPreview e cards refeitos; ângulo "canal próprio, sem comissão de aplicativo"; preço passou a **R$149 (chat) / R$198 (bundle)** com `src/data/pricing.ts` como fonte única (Hero/BottomCTA/MobileStickyCTA + e-mails de onboarding leem daí). PIX (AbacatePay) passou a cobrar o preço do `pricing.ts` (`server/billingPix.ts`). Cartão/Stripe atualizado no backend em seguida. (2) **Horário de funcionamento por dia + múltiplas janelas** (almoço→fecha→jantar): novo `src/domain/businessHours.ts` + migração `046_empresa_horario_semanal.sql` (coluna `horario_semanal`); editor por dia em `SettingsView` (`BusinessHoursEditor`); `configStore`/`ai.ts` usam `isOpenAt` (IA informativa fora de horário, sem bloqueio duro). O ZeloMenu (repo separado) passou a ler `horario_semanal` e bloquear por janela do dia — o ZeloChat grava o shadow legado (`deriveLegacyFromWeekly`) pra não quebrar o bloqueio existente. Migrações aplicadas no Supabase pelo PO. (3) **Stripe atualizado**: os prices v2 `chat`/`bundle` nunca tiveram assinante, então foram editados in-place no Dashboard de R$147/R$197 para R$149/R$198 — mesmo `price_id`, sem precisar criar price novo nem trocar `STRIPE_PRICE_CHAT`/`STRIPE_PRICE_BUNDLE` no Dokploy. Price v1 do bundle (Casa dos Salgados) não foi tocado. Cartão e PIX agora cobram o mesmo valor exibido no site.

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

### Sprint 70 (2026-07-23) — Pedido manual via RPC canônico

- ✅ PED-MANUAL — operador agora pode criar pedido manual direto no Kanban (walk-in, ligação, WhatsApp esquecido) escrevendo itens com preço unitário; chamada via `POST /api/orders/manual` → RPC `create_zelo_order` (source='manual', p_session_id=null), com idempotência server-side; total derivado automaticamente dos itens, validação de preço obrigatório no form — `server/canonicalOrders.ts:75` · `server/router.ts:1940` · `src/services/waApi.ts:640` · `src/hooks/useOrders.ts:183` · `src/components/views/ProductionView.tsx:48`
- ✅ PED-MANUAL-IDEMP — chave de idempotência da criação manual passou a ser gerada no frontend (estável durante a vida do modal) e propagada até a RPC, em vez de uma chave nova a cada tentativa; fecha o risco de pedido duplicado se o operador reenviar depois de uma resposta perdida — `src/components/views/ProductionView.tsx` · `src/hooks/useOrders.ts` · `src/services/waApi.ts` · `server/router.ts:1945` · `server/canonicalOrders.ts:96`
- ✅ ZLM-TRACK — tela pública do ZeloMenu deixou de mostrar só um "Pedido confirmado!" estático: agora exibe uma linha do tempo ao vivo (Recebido → Confirmado → Em preparo → Pronto → Saiu para entrega/Retirada → Entregue), com polling a cada 8s (pausado com a aba em segundo plano, parado em estado terminal) sobre o endpoint público já existente — sem WebSocket/Realtime novo, já que `zelo_orders` bloqueia `anon` via RLS — `server/zelomenuCartSessions.ts:960` · `src/domain/zelomenuOrderStatus.ts` · `src/pages/ZeloMenuCartPage.tsx:493`
- ✅ ZLM-MASCOTE — mascote oficial do ZeloMenu (`public/zelomenu-mascot-chef.png`) adicionado à tela de pedido confirmado: painel grande à esquerda no desktop, avatar circular acima da linha do tempo no mobile (crop via posicionamento absoluto, já que a arte é quadrada e `object-fit: cover` não recorta imagem com mesma proporção do contêiner) — `src/pages/ZeloMenuCartPage.tsx`
- ✅ ZLM-PALETA — nova identidade visual lilás/roxa do ZeloMenu (aprovada pelo founder, combinando com o mascote) aplicada via classe `.zelomenu-theme` (tokens `--zm-*` em `src/index.css`) SOMENTE nas duas páginas públicas do cliente final (`ZeloMenuStorePage.tsx`, `ZeloMenuCartPage.tsx`); o dashboard operacional do ZeloChat (Kanban, Chat, Configurações etc.) continua verde — são superfícies de produto diferentes. Cores de erro/aviso (`--color-alert*`/`--color-warn*`) mantidas intocadas de propósito.
- ✅ ZLM-MODIFIER-BUG — corrigido bug real reportado em produção: pedidos com produto configurável (ex. "Monte sua Massa" com massa/molho/proteínas) apareciam no Kanban/Pedidos só com o nome base do produto, sem os acompanhamentos escolhidos pelo cliente. Causa: `CANONICAL_ORDER_SELECT`/`canonicalRowToOrder` nunca liam a coluna `zelo_order_items.modifiers` (só `name`), então todo consumidor de `Order.items[].product` (Kanban, cards de produção) perdia a informação — mesmo ela estando salva corretamente no banco. Fix reaproveita `formatModifierAwareCartItem` (já usado no carrinho do ZeloMenu) pra formatar `"Produto (Grupo: opção, opção)"` de forma consistente — `src/domain/canonicalOrders.ts` · teste novo em `tests/canonicalOrders.test.ts`. **Pendência identificada, não corrigida nesta sprint:** o mesmo tipo de perda existe em `LEGACY_CANONICAL_ORDER_SELECT` (usado pela IA em `server/ai.ts` para responder sobre pedidos, e no despacho de entregador em `server/router.ts`) — não mexido agora porque `ai.ts` é função crítica (ver CLAUDE.md) e merece sua própria verificação cuidadosa antes de alterar.
- ✅ ZLM-CART-DETAIL — na etapa "Sacola" do carrinho público, o item com modificadores (ex. "Monte sua Massa (Escolha sua m...") ficava truncado numa linha só (`truncate` CSS), escondendo os grupos escolhidos. Trocado por um bloco de detalhe fixo (não é dropdown/accordion — sempre visível) listando cada grupo com suas opções em linha própria — `src/pages/ZeloMenuCartPage.tsx:1032`. Verificado: mensagem de confirmação por WhatsApp (`buildConfirmedCartCustomerMessage`/`buildCartSummaryLines` em `src/domain/zelomenuCart.ts`) já chama `formatModifierAwareCartItem` corretamente e não tem limite de tamanho no envio (`sendTextMessage` não trunca) — não achei bug de dado faltando nesse texto especificamente; se o operador ainda vir detalhe faltando na mensagem real recebida no WhatsApp, precisa colar o texto exato para investigar mais.

### Sprint 69s (2026-06-24) — Avisos mobile no ZeloMenu público

- ✅ ZLM-208 — carrinho público deixou de ter dois CTAs concorrentes ("Atualizar carrinho" e "Confirmar pedido"): confirmar agora salva o rascunho, revalida automaticamente e só fecha o pedido se não houver ajuste; mudança de preço aparece como toast pedindo para conferir o novo total — `src/pages/ZeloMenuCartPage.tsx:225` · `src/pages/ZeloMenuCartPage.tsx:306`
- ✅ ZLM-209 — link público da loja agora recebe status de expediente calculado pelo backend a partir de horário/dias fechados e mostra na página inicial o aviso "Fora do horário de atendimento" com orientação para agendar em horário disponível — `server/zelomenuCartSessions.ts:211` · `src/pages/ZeloMenuStorePage.tsx:493`
- ✅ ZLM-210 — link público exigia nome/WhatsApp num resumo intermediário e ainda pedia outro toque para abrir o checkout → CTA do cardápio agora cria a sessão sem dados pessoais e abre direto a finalização, onde nome e WhatsApp já são coletados junto com entrega/retirada — `src/pages/ZeloMenuStorePage.tsx:286` · `src/pages/ZeloMenuCartPage.tsx:702`
- ✅ ZLM-211 — pedido público podia avançar sem dados essenciais → nome, WhatsApp, data e horário agora são obrigatórios; entrega também exige endereço; "Pra já" preenche hoje + hora atual automaticamente; validação aparece nos campos e o backend bloqueia confirmação incompleta — `src/domain/zelomenuCheckout.ts:1` · `src/pages/ZeloMenuCartPage.tsx:317` · `server/zelomenuCartSessions.ts:1878`
- ✅ ZLM-212 — ajustar quantidades maiores no carrinho exigia muitos toques em `+`/`−` → número central agora é editável, seleciona o valor ao tocar e abre somente o teclado numérico no celular — `src/pages/ZeloMenuCartPage.tsx:443` · `src/pages/ZeloMenuCartPage.tsx:737`
- ✅ ZLM-213 — edições do carrinho existiam apenas no estado do navegador e voltavam ao snapshot antigo após atualizar a página → checkout agora salva alterações automaticamente com debounce, serializa os PATCHes, ignora respostas antigas e mostra “Salvando alterações…” / “Alterações salvas” — `src/pages/ZeloMenuCartPage.tsx:359`
- ✅ ZLM-214 — ao esvaziar o checkout e voltar ao cardápio, a sacola antiga reaparecia porque o cardápio restaurava um `localStorage` independente e a resposta pública removia o `slug` necessário para localizar essa chave → cache local foi extraído para um módulo compartilhado, o backend preserva somente `source` + `slug` seguros, e cada save atualiza/remove a mesma sacola antes de voltar; confirmação também limpa o cache — `src/domain/zelomenuStoreCartCache.ts:1` · `src/pages/ZeloMenuCartPage.tsx:272` · `server/zelomenuCartSessions.ts:947`
- ✅ ZLM-215 — fotos verticais e horizontais deixavam cards do ZeloMenu visualmente irregulares → cards agora usam moldura quadrada fixa com `object-contain`, respiro interno e área de informações padronizada; a imagem inteira permanece visível sem distorção ou crop automático — `src/pages/ZeloMenuStorePage.tsx:630`

### Sprint 69r (2026-06-23) — Bulk selection no Cardápio do ZeloChat

- ✅ CAT-301 — Cardápio era 100% item-a-item → tela agora tem modo de seleção em lote com checkboxes por produto, categoria, subcategoria e itens sem categoria, reaproveitando o padrão operacional de bulk action do app sem inflar o CRUD base — `src/components/views/CatalogView.tsx:101`
- ✅ CAT-302 — publicar vários itens no link exigia abrir produto por produto → ação em lote "Publicar no link" entregue no Cardápio, visível só quando a assinatura libera `menu_publication`, com sucesso parcial tratado e seleção preservada só para falhas — `src/components/views/CatalogView.tsx:170` · `src/hooks/useCatalogBulkController.ts:120` · `src/AppShell.tsx:1332`
- ✅ CAT-303 — exclusão em lote não existia no Cardápio → ação "Excluir selecionados" entregue com confirmação explícita e reaproveitando o fluxo seguro de `deleteProduto` para manter cleanup de publicação/imagem — `src/components/views/CatalogView.tsx:186` · `src/hooks/useCatalogBulkController.ts:120`
- ✅ ZLM-206 — rollout comercial do ZeloMenu estava pouco claro no tracker canônico → `ZELOMENU_LINEAR_PLAN.md` agora separa explicitamente o que já foi entregue (entitlement novo, pricing, guards, addon `menu` de R$40 / PDV+Menu R$99) do que ainda falta no repo ZeloPDV (páginas `/assinatura` e `/extensoes`, retirada do addon novo de Pedidos/Cozinha e limpeza da copy comercial) — `ZELOMENU_LINEAR_PLAN.md:1931`
- ✅ ZLM-207 — campo de WhatsApp do menu público aceitava letras e feedback transitório aparecia como texto inline → jornada pública do ZeloMenu agora mascara o telefone enquanto digita, limita a 11 dígitos, envia só números para a API e usa toast visual para erros/confirmações de store/cart, com container melhor no mobile — `src/pages/ZeloMenuStorePage.tsx:42` · `src/pages/ZeloMenuCartPage.tsx:64` · `src/contexts/ToastContext.tsx:85`

### Sprint 69q (2026-06-23) — Rollout ZeloMenu completo (ZLM-205 pricing + ZLM-203 link público + T5 pedidos)

- ✅ ZLM-205 — schema PDV-owned aplicado no Supabase real: `subscriptions.has_zelo_menu` + `empresa_perfil.zelomenu_slug` (única) + coluna na view `user_entitlements`; backfill exato (chat/bundle→true, pdv→false) verificado via PostgREST — `/home/vinicius/code/zelopdv/.ai/migrations/zelomenu_entitlement_and_slug_2026_06_23.sql`
- ✅ ZLM-205 — 3 prices Stripe LIVE criados (catálogo, sem tocar assinatura): chat v2 R$147 `price_1TlbH2LUJWyE4PkYSqFSXXVY`, bundle v2 R$197 `price_1TlbH2LUJWyE4PkYlS4IxMhs`, addon menu R$40 `price_1TlbH4LUJWyE4PkYX0kdJhAw`
- ✅ ZLM-205 — ZeloPDV `pricing.js` billing-safe (legacy price IDs no reverse-lookup → assinantes atuais não quebram), guards de capability, webhook grava `has_zelo_menu`, admin toggle — `zelopdv/src/lib/pricing.js`, `zelopdv/src/lib/guards.js:311`, `zelopdv/src/routes/api/billing/webhook/+server.js`, `zelopdv/admin-dashboard/src/routes/subscriptions/+page.svelte`
- ✅ ZLM-205 — ZeloChat copy 97→147 / 147→197 — `src/data/pricing.ts`
- ✅ ZLM-203 — link público por slug ponta a ponta: domínio `zelomenuSlug.ts`, endpoints `GET /public-api/zelomenu/store/:slug` + `POST .../store/:slug/cart`, bootstrap `public_order`, confirm→Pedidos, `GET/PUT /api/zelomenu/slug`, página `/menu/:slug` e card self-service — `src/domain/zelomenuSlug.ts`, `server/zelomenuCartSessions.ts`, `server/router.ts`, `src/pages/ZeloMenuStorePage.tsx:1`, `src/components/zelomenu/PublicLinkCard.tsx:1`, `src/App.tsx`
- ✅ T5/ZLM-301 — materialização one-way segura em `pedidos`/`pedido_itens` (gate `pdv_core`, espelha o balcão do PDV via RPC `proximo_numero_pedido`, sem tocar `vendas`; chat-only intocado) — `server/zelomenuCartSessions.ts` (`materializeOrderToPedidosBestEffort`)
- ✅ Validação — `npm run lint`, `npm run build`, `tests/zelomenuSlug.test.ts`, `tests/zelomenuEntitlements.test.ts`, `tests/zelomenuCart.test.ts` (ZeloChat) e `tests/pricing.acessos.test.js` (ZeloPDV) passaram; `npm test` segue só com `auditFixGuardrails` (drift conhecido)
- 🟥 Pendências de operação (não código) — envs Dokploy `STRIPE_PRICE_CHAT`/`STRIPE_PRICE_BUNDLE`→v2 (liga aumento ZeloChat); migrar Agreste pro R$147 com aviso (D-104); sync bidirecional de pedidos (cutover) validar no Donutopia antes

### Sprint 69p (2026-06-23) — ZLM-204 entrega por bairro + ZLM-205 resolver de capability (local)

- ✅ ZLM-204 — bairro fora da tabela estourava `INVALID_DELIVERY_NEIGHBORHOOD` e travava a confirmação → agora `resolveDeliveryFeeForNeighborhood()` (domínio puro, compartilhado server+front) devolve `{ fee, toConfirm }`: bairro listado soma taxa (match case/acento-insensitive), bairro livre/ausente vira taxa "a confirmar" sem bloquear (D-081/D-082/D-083) — `src/domain/zelomenuCart.ts:148`, `server/zelomenuCartSessions.ts:536`
- ✅ ZLM-204 — taxa "a confirmar" propagada para forçar conferência humana: snapshot `deliveryFeeToConfirm`, mensagem ao cliente, card de revisão do Chat e aviso ao gerente no aceite — `src/domain/zelomenuCart.ts:53`, `server/zelomenuCartSessions.ts:962`, `src/components/views/ChatView.tsx:3326`
- ✅ ZLM-204 — UI pública trocou o `<select>` de bairro por `<input list>`+`<datalist>` (escolhe cadastrado com a taxa ou digita o seu); resumo mostra "Entrega: a confirmar" para bairro fora da tabela — `src/pages/ZeloMenuCartPage.tsx:725`, `src/pages/ZeloMenuCartPage.tsx:146`
- ✅ ZLM-205 (parte local / D-103) — resolver read-only de capability do ZeloMenu, domínio puro, fonte única no repo: computa a matriz de ZLM-005 a partir de `plan_tier`+ativo, fail-safe ON em chat/bundle (D-014), legado `has_pedidos_addon` só libera pedidos/cozinha (D-099), mesas-com-cozinha libera `kitchen_queue` (D-100) — `src/domain/zelomenuEntitlements.ts:1`
- ✅ ZLM-205 (parte local) — seam ÚNICO para o futuro `has_zelo_menu` (`hasZeloMenuFlag`), exposto em `useSubscription().capabilities`; quando o ZeloPDV publicar a coluna, basta adicioná-la ao SELECT do hook e passar o valor — `src/hooks/useSubscription.ts:88`
- 🟥 ZLM-205 restante — price IDs Stripe (`chat`=147/`bundle`=197/novo `menu`=40), coluna `has_zelo_menu` e grandfather (CS pinada, Agreste migrada) seguem **bloqueados no repo ZeloPDV** (D-104); nada disso é DDL/Stripe executável neste repo
- ✅ Validação — `npm run lint`, `npm run build`, `node --import tsx tests/zelomenuEntitlements.test.ts` e `node --import tsx tests/zelomenuCart.test.ts` passaram; `npm test` segue somente com a falha conhecida `tests/auditFixGuardrails.test.ts` → "webhook has explicit rollout bypass name" — `tests/zelomenuEntitlements.test.ts:1`, `tests/zelomenuCart.test.ts:1`

### Sprint 69o (2026-06-23) — ZLM-201 fechado com imagem owned

- ✅ ZLM-201 — o modal de publicação do `Cardápio` agora aceita upload de imagem própria com preview, mantém a opção de link HTTPS e grava a URL owned em `foto_url` sem mexer em `produtos`; a publicação pública continua vindo da camada `zelomenu_product_publications` — `src/components/views/catalog/CatalogModals.tsx:435`, `src/services/zelomenuPublicationImages.ts:1`, `src/domain/zelomenuPublicationImages.ts:1`
- ✅ ZLM-201 — cleanup operacional da foto owned fechado: troca/remoção de imagem apaga o objeto antigo em best-effort, exclusão do produto limpa a foto vinculada e o purge de conta remove o prefixo `zelomenu-products/{userId}` do bucket `logos` — `src/components/views/CatalogView.tsx:386`, `src/hooks/useCatalog.ts:373`, `server/accountDeletionSweeper.ts:62`
- ✅ ZLM-201 — ticket de publicação self-service agora cobre publicação real, modifiers/adicionais/variações e imagem própria ponta a ponta; próximos gaps end-to-end saem de `ZLM-201` e passam para `ZLM-203` (slug/public_order) e `ZLM-205` (billing/entitlements) — `CURRENT.md:40`, `ZELOMENU_LINEAR_PLAN.md:1785`
- ✅ Validação ZLM-201 — `npm run lint`, `npm run build`, `node --import tsx tests/zelomenuPublication.test.ts`, `node --import tsx tests/zelomenuCart.test.ts`, `node --import tsx tests/zelomenuModifiers.test.ts` e `node --import tsx tests/zelomenuPublicationImages.test.ts` passaram; `npm test` segue somente com a falha conhecida `tests/auditFixGuardrails.test.ts` → "webhook has explicit rollout bypass name" — `tests/zelomenuPublicationImages.test.ts:1`

### Sprint 69n (2026-06-23) — Publicação real do ZeloMenu no Cardápio

- ✅ ZLM-201 parcial — `useCatalog` passou a carregar e gravar `zelomenu_product_publications`, mantendo a separação entre produto base e publicação online e limpando a publicação do estado local quando um produto é excluído — `src/hooks/useCatalog.ts:96`, `src/hooks/useCatalog.ts:318`
- ✅ ZLM-201 parcial — tela `Cardápio` agora mostra estados reais `Publicado`, `Não publicado`, `Pausado`, `Inativo`, `Sem estoque` e `Sem categoria`; o operador abre a publicação por produto e configura publicar/despublicar, pausa, nome público, descrição, foto por link e ordem — `src/components/views/CatalogView.tsx:126`, `src/components/views/catalog/CatalogModals.tsx:436`
- ✅ ZLM-201 parcial — carrinho público e IA passam a receber catálogo já resolvido pela publicação: só item publicado e disponível fica `available`, nome/descrição/foto/ordem vêm do overlay e preço base continua em `produtos.preco` — `server/configStore.ts:544`, `src/domain/zelomenuPublication.ts:157`, `src/pages/ZeloMenuCartPage.tsx:752`
- ✅ Validação ZLM-201 — `npm run lint`, `npm run build`, `node --import tsx tests/zelomenuPublication.test.ts` e `node --import tsx tests/zelomenuCart.test.ts` passaram; `npm test` rodou e segue somente com a falha conhecida `tests/auditFixGuardrails.test.ts` → "webhook has explicit rollout bypass name" — `tests/zelomenuPublication.test.ts:1`
- 🟨 ZLM-201 restante naquela fatia — modifiers/adicionais/variações (`zelomenu_modifier_groups`/`zelomenu_modifier_options`) e ownership/upload de imagem ainda não tinham entrado; o fechamento veio na Sprint 69o.

### Sprint 69l (2026-06-23) — Prontidão de publicação do ZeloMenu

- ✅ ZLM-201 parcial — criado painel de "Publicação no ZeloMenu" dentro do Cardápio, mostrando quantos produtos estão prontos para o link, quantos estão inativos, sem estoque ou sem categoria, e uma lista acionável para editar os itens com atenção — `src/components/views/CatalogView.tsx:598`
- ✅ ZLM-201 parcial — regras de prontidão saíram do React para domínio puro (`published`, `hidden`, `out_of_stock`, `missing_category`), permitindo trocar a regra derivada atual por uma publicação real sem reescrever a UI — `src/domain/zelomenuPublication.ts:1`
- ✅ ZLM-201 parcial — cobertura nova para os estados de publicação e resumo; `npm run lint` passou junto com os testes focados de publicação e recuperação de carrinho — `tests/zelomenuPublication.test.ts:1`, `tests/run-unit-tests.ts:30`
- 🟥 ZLM-201 bloqueio restante — nome público, descrição, foto, ordem pública e modifiers dependem da camada de publicação PDV-owned definida em ZLM-004; este repo não deve criar esse schema nem alterar `produtos`/`categorias`/`subcategorias`

### Sprint 69m (2026-06-23) — Rollout de migrations Supabase

- ✅ Segurança/RPC — aplicado no Supabase real `zelochat_fix_rls_gaps_2026_06_23`: policies de INSERT/DELETE do bucket `zelochat-media` restritas a `service_role`, `zelochat_decrement_stock` recriada com `search_path` seguro e execute revogado de `public`/`anon`/`authenticated`; `zelochat_increment_unread` também teve execute revogado para papéis públicos — `supabase/migrations/034_fix_rls_gaps.sql:1`
- ✅ Billing compartilhado — aplicado/registrado `trial_expired_status_2026_06_17`; auditoria antes da execução mostrou 0 assinaturas locais vencidas ainda em `trialing`, então não houve reclassificação visível nesta rodada — `/home/vinicius/code/zelopdv/.ai/migrations/trial_expired_status_2026_06_17.sql:1`
- ✅ ZLM-101 prod schema — estruturas `zelomenu_cart_sessions`/`zelomenu_cart_tokens` e policies/grants finais aplicados no Supabase real (`zelomenu_cart_sessions_tables_2026_06_23` + `zelomenu_cart_sessions_policies_grants_2026_06_23`); verificado RLS ligado, 4 policies por tabela, `anon` sem grants e `authenticated`/`service_role` só com `SELECT/INSERT/UPDATE/DELETE` — `supabase/migrations/041_zelomenu_cart_sessions.sql:1`
- ✅ ZLM-201/ZLM-004 prod schema — camada PDV-owned de publicação (`zelomenu_product_publications`, `zelomenu_modifier_groups`, `zelomenu_modifier_options`) aplicada no Supabase real via `zelomenu_publication_schema_2026_06_23`; verificado RLS, policies, grants mínimos, constraints/FKs/índices e bloqueio de acesso anônimo por chave pública — `/home/vinicius/code/zelopdv/.ai/migrations/zelomenu_publication_schema_2026_06_23.sql:1`
- ✅ Validação rollout — `node --import tsx tests/zelomenuCart.test.ts` passou; no ZeloPDV, `npm test -- tests/zelomenuPublicationSchema.test.js` passou; advisors Supabase rodados e não apontaram alerta novo específico das tabelas ZeloMenu além de índices recém-criados ainda sem uso.

### Sprint 69k (2026-06-22) — Impressão no aceite + reimpressão manual (ZeloMenu)

- ✅ ZLM-106 — confirmado que o pedido aceito já imprime no momento certo: o aceite do ZeloMenu (ZLM-104) cria a row em `zelochat_orders` só no aceite humano, e o INSERT realtime dispara `autoPrintOrder` — ou seja, impressão no aceite, não na confirmação do cliente — `src/hooks/useOrders.ts:161`, `src/AppShell.tsx:342`
- ✅ ZLM-106 — auto-impressão passou a respeitar "se configurado": só dispara quando a integração de impressão está ativa (`printer.connected`), eliminando toast de erro a cada pedido em máquinas sem Zelo Impressão; toast do pedido manual ficou preciso conforme a conexão — `src/AppShell.tsx:342`, `src/AppShell.tsx:840`
- ✅ ZLM-106 — adicionada reimpressão manual: botão "Imprimir pedido" no drawer de detalhe da Produção, com estado de envio e feedback explícito de sucesso/falha (falha nunca silenciosa); aviso quando a impressão não está conectada — `src/AppShell.tsx:359` (`reprintOrder`), `src/components/views/ProductionView.tsx:607`
- ✅ ZLM-106 — validação: `npm run lint` e `npm run build` passaram; `npm test` segue falhando só no drift conhecido de `tests/auditFixGuardrails.test.ts`. Sem teste automatizado novo — a mudança é fiação de UI + gate sobre o caminho de impressão client-side (fala com o app desktop em `127.0.0.1`, sem harness de teste existente)

### Sprint 69j (2026-06-22) — Recuperação de carrinho abandonado do ZeloMenu

- ✅ ZLM-105 — novo sweeper de fundo manda UMA mensagem de recuperação para carrinho `cart_open` parado entre 2h e 24h, com link fresco; roda 3min após o boot e a cada 15min — `server/abandonedCartSweeper.ts:1`, `server/index.ts:441`
- ✅ ZLM-105 — invariante "no máximo uma recuperação" garantida por claim race-safe na flag `metadata.recoveryNudgeSentAt`; nunca dispara para carrinho confirmado/aguardando pagamento/aceito/cancelado/arquivado e respeita o gate global da IA (não nuda com IA desligada nem fora da janela) — `server/zelomenuCartSessions.ts:1308`, `src/domain/zelomenuCart.ts:227`
- ✅ ZLM-105 — tail de emissão de token público extraído para `issueFreshCartToken` e reusado na abertura do carrinho e na recuperação (o token original não é recuperável do banco, só o hash) — `server/zelomenuCartSessions.ts:566`
- ✅ ZLM-105 — cobertura nova do predicado puro de elegibilidade + builder da mensagem (PT-BR, sem jargão técnico); `npm run lint` e `npm run build` passaram, `npm test` segue falhando só no drift conhecido de `tests/auditFixGuardrails.test.ts` sobre rollout de webhook — `tests/zelomenuAbandonedCart.test.ts:1`

### Sprint 69i (2026-06-22) — Aceite manual do ZeloMenu no Chat

- ✅ ZLM-104 — ZeloChat ganhou revisão autenticada do pedido do cardápio por conversa (`GET /api/zelomenu/cart-sessions/review`) e ação de aceite (`POST /api/zelomenu/cart-sessions/:id/accept`) sem depender do fluxo legado de `zelochat_pending_orders` — `server/router.ts:2803`, `server/zelomenuCartSessions.ts:946`
- ✅ ZLM-104 — o aceite agora revalida antes de materializar produção, bloqueia Pix pendente/ajuste necessário, grava `acceptedAt` + `acceptedBy*` + `productionOrderId` no metadata da sessão e arquiva o carrinho aceito para liberar o próximo pedido da conversa — `server/zelomenuCartSessions.ts:988`
- ✅ ZLM-104 — o Chat ganhou modal de revisão/aceite em cima do card “Pedido recebido pelo cardápio”, sem jogar o operador para o Kanban cedo demais; a confirmação final ao cliente passa a usar copy própria de “pedido confirmado” já em produção — `src/components/views/ChatView.tsx:1016`, `src/domain/chatFeedback.ts:173`, `src/domain/zelomenuCart.ts:200`
- ✅ ZLM-104 — cobertura ampliada com guardrail do review flow e mensagem final de aceite; `npm run lint` e `npm run build` passaram, `npm test` segue falhando só no drift conhecido de `tests/auditFixGuardrails.test.ts` sobre rollout de webhook — `tests/zelomenuReviewGuardrails.test.ts:1`, `tests/zelomenuCart.test.ts:121`

### Sprint 69h (2026-06-22) — IA passa a abrir o carrinho novo do ZeloMenu

- ✅ ZLM-101 — a tool `criar_pedido` agora abre `zelomenu_cart_sessions` no fluxo `whatsapp_order`, gera link absoluto de revisão/confirmação e envia o handoff novo ao cliente pelo WhatsApp — `server/ai.ts:4248`, `src/domain/zelomenuCart.ts:111`
- ✅ ZLM-101 — rollout mantido com fallback explícito para `zelochat_pending_orders` e botões legados se a abertura do carrinho novo falhar, preservando o piloto da Casa dos Salgados — `server/ai.ts:4286`, `tests/aiZeloMenuGuardrails.test.ts:1`
- ✅ ZLM-101 — suíte ampliada para URL/copy do link e guardrails da IA; `npm run lint` e `npm run build` passaram, `npm test` segue falhando apenas no drift conhecido de `tests/auditFixGuardrails.test.ts` sobre rollout de webhook — `tests/zelomenuCart.test.ts:52`, `CURRENT.md:20`

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

- ✅ ZLM-301 — consumidores de pedidos migrados para `zelo_orders` e transições CAS via RPC — `server/canonicalOrders.ts`, `src/hooks/useOrders.ts`
# Sprint 2026-08-26 — Clientes CRM

- ✅ CRM-16/17 — automações não tinham regras/ledger comum e carrinho podia seguir caminho separado → migration 054, avaliador idempotente, API protegida por `clientes.comunicar`, sweeper fail-soft e fila única do carrinho atrás de `ZELOCHAT_AUTOMATION_LEDGER=1` — `server/automations/rules.ts`, `server/automations/evaluator.ts`, `server/automations/router.ts`, `server/automations/sweeper.ts`, `server/zelomenuCartSessions.ts`
- ✅ CRM-DB-029 — Gate B não tinha evidência de volume/qualidade → dry-run somente leitura reproduziu o preview do backfill no Supabase conectado: 2.035 sessões, 1 vínculo potencial, 0 conflitos e 2.034 sem correspondência; nenhum dado foi escrito — `supabase/verification/customer_relationship_authz.sql`, `CURRENT.md`
- ✅ CRM-DB-030 — histórico remoto registrado pelo MCP ficou com timestamps gerados diferentes dos nomes locais → reconciliação foi documentada e mantida pendente de CLI autenticada (`supabase migration repair`); nenhum registro interno foi alterado manualmente — `CURRENT.md`, `docs/ai/ZeloChat.memory.md`
- ✅ CRM-DB-031 — baixa correspondência não podia ser distinguida de falta de dados → diagnóstico somente leitura confirmou 78 clientes, 40 contatos em formato utilizável e 2.033 sessões com telefone válido; piloto deve tratar a qualidade/normalização do contato antes do vínculo real — `CURRENT.md`, `docs/ai/ZeloChat.memory.md`
- ✅ CRM-DB-032 — Gate C precisava de um piloto real controlado → Donutopia processou 9 sessões, gravou checkpoint terminal sem vínculos/conflitos/falhas e ativou somente `crm_enabled`; campanhas, automações e outbound permaneceram desligados — `zelochat_customer_backfill_state`, `zelochat_crm_rollout_flags`
- ✅ CRM-DB-033 — métricas iniciais do piloto não estavam materializadas → registradas 2 clientes, 2 com telefone e 0 conflitos para Donutopia; fila outbound permaneceu vazia — `zelochat_crm_metrics_daily`
- ✅ CRM-DB-034 — ativação gradual precisava de um tenant pagante com volume real → Casa dos Salgados processou 1.716 sessões, vinculou 1, registrou 1.715 incompletas, ativou somente CRM e manteve campanhas/automações/outbound desligados; Agreste ficou fora por `trial_expired` — `zelochat_customer_backfill_state`, `zelochat_crm_rollout_flags`, `zelochat_crm_metrics_daily`
- ✅ CRM-DB-035 — stream compartilhado não estava representado no diretório canônico do PDV → migrations CRM `048`–`059` foram copiadas semanticamente para `supabase/migrations` com os timestamps remotos e registradas no commit `9173002`; nenhum DDL foi reaplicado — `../zelopdv/supabase/migrations/20260826110656_048_customer_relationship_foundation.sql`
- ✅ CRM-DB-036 — verificação do ledger falhava por manifesto de baseline defasado → hashes/bytes do manifesto foram alinhados aos arquivos atualmente versionados; `node scripts/verify-migration-ledger.mjs` passou com 107/107 artefatos, 59/59 versões históricas e 23 migrations futuras — `../zelopdv/supabase/baselines/20260813091000/manifest.json`
- ✅ CRM-DB-037 — conferência visual autenticada precisava de cobertura responsiva → Playwright validou Clientes em 360/390/768/1440, filtro único, ficha/tabs, permissão e ausência de overflow; validação publicada permanece pendente de deploy autorizado — `tests/customers-crm.spec.ts`
- ✅ CRM-UI-038 — leitor via o botão “Novo cliente” mesmo sem `pessoas.gerenciar` e o atalho podia enviar um JID no lugar do UUID da sessão → criação agora fica oculta para leitores e o retorno ao Atendimento valida/passa somente o `sessionId` real — `src/components/views/CustomersView.tsx`, `src/components/customers/CustomerMessagesTab.tsx`, `src/domain/customerMessages.ts`
- ✅ CRM-UI-039 — o atalho de Atendimento usava a primeira mensagem da linha do tempo e podia abrir uma conversa antiga → agora resolve a sessão da mensagem mais recente e só oferece o atalho quando esse UUID está presente no detalhe — `src/components/customers/CustomerMessagesTab.tsx`
