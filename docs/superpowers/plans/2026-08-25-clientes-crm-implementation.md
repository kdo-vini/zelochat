# Clientes CRM — Plano de implementação

> **Para o agente implementador:** executar este plano em ordem, com testes antes da implementação e commits pequenos. Não habilitar campanhas ou automações antes dos gates de identidade, permissões e backfill.

**Objetivo:** entregar Clientes como CRM conversacional nativo do ZeloChat, incluído no plano atual, com `pessoas` do ZeloPDV como cadastro mestre, navegação mobile-first, mensagens consolidadas, campanhas e cinco jornadas automáticas.

**Especificação aprovada:** [`docs/superpowers/specs/2026-08-25-clientes-crm-design.md`](../specs/2026-08-25-clientes-crm-design.md)

**Arquitetura:** o ZeloPDV permanece dono da identidade compartilhada (`pessoas`, identidades e vínculo com pedidos). O ZeloChat possui relacionamento, segmentos, campanhas, regras, dispatches e fila. O backend Express resolve ator, dono, empresa e permissões antes de usar o cliente `service_role`. A UI React consome APIs server-side paginadas; não acessa diretamente as novas tabelas CRM.

**Tecnologias:** PostgreSQL/Supabase, RLS e RPCs SQL, Express/TypeScript, React 19, Tailwind, testes unitários com o harness `tsx`, Vitest no ZeloPDV e Playwright para responsividade.

## Regras de execução

- Trabalhar em branches `codex/clientes-crm` separadas nos repositórios ZeloPDV e ZeloChat.
- Aplicar e publicar primeiro as migrations do ZeloPDV; só depois publicar consumidores no ZeloChat.
- Em migrations numeradas do ZeloChat, ajustar o número caso outra migration entre antes da execução.
- Nunca aceitar `empresa_id` ou `id_usuario` do body; ambos vêm do contexto autenticado.
- Toda escrita via `service_role` deve validar permissão antes da consulta ou mutação.
- Não alterar diretamente o estado de sessões no React; usar `useWhatsAppSessions` ou uma extração compatível.
- Não duplicar mensagens: `zelochat_messages` continua sendo a única fonte.
- Todas as automações nascem desativadas.
- Manter textos de UI em português brasileiro e sem nomes de provedores internos.
- Ao concluir cada task, atualizar `CURRENT.md`/`FIXES_PROGRESS.md` conforme as regras de cada repositório.

## Sequência e gates

1. **Fundação PDV:** schema de identidade, vínculo de pedidos, RPCs e permissões.
2. **Fundação ZeloChat:** contexto de ator, schema de relacionamento e resolução de pessoa.
3. **Gate A:** normalização, concorrência, isolamento e permissões aprovados.
4. **Backfill e CRM somente leitura:** criar/vincular pessoas, listar e abrir fichas.
5. **Gate B:** relatório do backfill sem merges ambíguos e Atendimento intacto.
6. **Escrita e mensagens:** cadastro, edição, exclusão, merge e composer compartilhado.
7. **Campanhas:** segmentos, audiência congelada, fila, limites e pausa.
8. **Automações:** aniversário, reativação, pós-compra, VIP e carrinho abandonado.
9. **Gate C:** piloto por empresa, métricas, rollback operacional e ativação gradual.

---

## Task 1 — Criar a identidade canônica no ZeloPDV

**Repositório:** `C:\Users\Vinicius\Desktop\code\zelopdv`

**Arquivos:**

- Criar: `supabase/migrations/20260825120000_customer_identity_foundation.sql`
- Criar: `tests/customerIdentitySchema.test.js`
- Modificar: `src/routes/gestao/pessoas/+page.svelte`
- Modificar: `src/routes/gestao/acessos/+page.svelte`

**Passos:**

1. Escrever testes Vitest que leiam a migration e exijam:
   - colunas `aniversario_dia`, `aniversario_mes`, `aniversario_ano` e `updated_at` em `pessoas`;
   - check que dia e mês sejam preenchidos juntos;
   - tabela `pessoa_identities` com unique `(id_usuario, kind, value_normalized)`;
   - índice parcial de uma identidade primária de telefone por pessoa;
   - RLS owner-scoped e escrita protegida por `pessoas.gerenciar`;
   - função `normalize_brazilian_phone(text)` sem remoção do nono dígito;
   - RPC `ensure_customer_from_whatsapp` restrita a `service_role`.
2. Rodar `npm test -- customerIdentitySchema.test.js` e confirmar falha.
3. Implementar migration forward-only e idempotente.
4. Na RPC, usar advisory transaction lock derivado de owner + telefone normalizado.
5. Fazer a RPC retornar um JSON estável:

   ```json
   { "status": "linked|created|conflict|invalid", "pessoaId": "uuid|null", "reason": "string|null" }
   ```

6. Adicionar aniversário à tela Pessoas sem alterar a compatibilidade de `contato`.
7. Adicionar `clientes.comunicar` ao grupo “Pessoas / Fiado” da tela de acessos.
8. Rodar `npm test -- customerIdentitySchema.test.js`, `npm run check` e `npm run verify:migrations`.
9. Commit: `feat(pessoas): add canonical customer identities`.

**Critérios locais:** duas chamadas concorrentes para o mesmo owner/telefone não podem criar duas pessoas; funcionário correspondente deve produzir conflito.

## Task 2 — Vincular pedidos e tornar a exclusão CRM-safe no ZeloPDV

**Repositório:** `C:\Users\Vinicius\Desktop\code\zelopdv`

**Arquivos:**

- Criar: `supabase/migrations/20260825123000_customer_order_links.sql`
- Criar: `tests/customerOrderLinksSchema.test.js`
- Modificar: migration nova com `create_zelo_order`/funções canônicas substituídas integralmente
- Modificar: `src/routes/gestao/pessoas/+page.svelte`

**Passos:**

1. Escrever teste que exija `zelo_orders.pessoa_id references pessoas(id) on delete set null` e índice `(empresa_id, pessoa_id, created_at desc)`.
2. Exigir no teste que `fiado_excluir_pessoa`:
   - preserve o bloqueio para saldo diferente de zero;
   - desvincule `vendas.id_cliente`, `vendas.id_pessoa` e `zelo_orders.pessoa_id`;
   - remova a pessoa somente após os vínculos financeiros serem preservados.
3. Rodar o teste e confirmar falha.
4. Implementar a migration sem editar migrations já aplicadas.
5. Estender a criação canônica de pedido com `p_pessoa_id uuid default null`, validando que a pessoa pertence ao owner da empresa.
6. Manter `customer_snapshot` obrigatório/inalterado mesmo quando existe `pessoa_id`.
7. Ajustar a confirmação de exclusão em Pessoas para explicar que vendas/pedidos permanecem sem vínculo.
8. Rodar `npm test -- customerOrderLinksSchema.test.js`, suíte completa e `npm run check`.
9. Commit: `feat(orders): link canonical customers without losing snapshots`.

## Task 3 — Resolver ator, dono e permissões no backend do ZeloChat

**Repositório:** ZeloChat

**Arquivos:**

- Criar: `server/accessControl.ts`
- Criar: `tests/customerAccessControl.test.ts`
- Modificar: `server/supabase.ts`
- Modificar: `server/router.ts`

**Contexto:** hoje `resolveEmpresaAndUserIdFromToken` procura `empresa_perfil.user_id = auth.uid()`. Isso funciona para owner, mas não resolve subusuário nem suas permissões.

**Passos:**

1. Criar teste para a função pura `resolveActorAccess` usando repositório injetável, cobrindo:
   - owner recebe todas as capacidades;
   - subusuário ativo resolve `owner_user_id`, empresa e JSON de permissões;
   - subusuário inativo falha fechado;
   - permissão ausente retorna `FORBIDDEN`;
   - cache é indexado pelo ator, não pelo owner.
2. Rodar `npx tsx tests/customerAccessControl.test.ts` e confirmar falha.
3. Implementar:

   ```ts
   export interface ActorAccessContext {
     actorUserId: string;
     ownerUserId: string;
     empresaId: string;
     isOwner: boolean;
     permissions: Record<string, boolean> | null;
   }

   export function actorCan(context: ActorAccessContext, permission: string): boolean;
   export async function requireActorAccess(req: Request): Promise<ActorAccessContext>;
   export async function requireActorPermission(req: Request, permission: string): Promise<ActorAccessContext>;
   ```

4. Fazer `requireEmpresaId` reutilizar o novo contexto sem quebrar rotas existentes.
5. Padronizar códigos internos `UNAUTHORIZED`, `EMPRESA_NOT_FOUND`, `FORBIDDEN`; a UI recebe mensagens amigáveis.
6. Adicionar um endpoint temporário de leitura `GET /api/access/me` somente se necessário para a UI esconder ações; ele retorna capacidades, não o JSON completo do cargo.
7. Rodar teste isolado, `npm test` e `npm run lint`.
8. Commit: `feat(auth): enforce shared role permissions in ZeloChat`.

## Task 4 — Criar o schema de relacionamento do ZeloChat

**Arquivos:**

- Criar: `supabase/migrations/048_customer_relationship_foundation.sql` (next unique version after the current `047`)
- Criar: `tests/customerRelationshipSchema.test.ts`
- Modificar: `src/types.ts`

**Passos:**

1. Escrever teste de schema exigindo:
   - `zelochat_sessions.pessoa_id` com cascade e índice tenant/pessoa/atividade;
   - `zelochat_customer_relationships` unique por empresa/pessoa;
   - notas com 4.000 caracteres e resumo com 600;
   - `zelochat_person_tags` com FKs compostas tenant-safe;
   - `zelochat_person_match_conflicts` com estado e auditoria;
   - RLS e índices de listagem.
2. Rodar `npx tsx tests/customerRelationshipSchema.test.ts` e confirmar falha.
3. Implementar migration aditiva, aceitando `pessoa_id null` durante rollout.
4. Adicionar a `src/types.ts` os tipos aprovados `CustomerSummary`, `CustomerDetail`, `CustomerFilters`, `CustomerActivityState` e tipos de timeline.
5. Não remover `customer_profile`; documentar fallback temporário.
6. Rodar teste isolado, `npm test` e `npm run lint`.
7. Commit: `feat(crm): add customer relationship schema`.

## Task 5 — Encapsular resolução de identidade e integrá-la ao webhook

**Arquivos:**

- Criar: `server/customers/identity.ts`
- Criar: `server/customers/repository.ts`
- Criar: `tests/customerIdentityResolution.test.ts`
- Modificar: `server/messageHandler.ts`
- Modificar: `server/router.ts`

**Passos:**

1. Escrever testes com dependências injetadas para `ensureCustomerForSession`:
   - `linked/created` grava `session.pessoa_id`;
   - `conflict` cria/atualiza conflito e persiste a mensagem sem pessoa;
   - erro de RPC não perde a mensagem nem bloqueia Atendimento;
   - nome observado não substitui nome manual válido;
   - grupos, broadcasts e JIDs inválidos não criam pessoa.
2. Rodar o teste e confirmar falha.
3. Implementar um adaptador único para a RPC PDV-owned; não reimplementar normalização em JavaScript para decidir merge.
4. Em `ensureSession`, resolver a pessoa após extrair empresa/JID/telefone e antes do upsert, mas tratar a resolução como best-effort.
5. Fazer `fetchSessionFamily` priorizar `pessoa_id`; usar `buildContactKey` apenas quando `pessoa_id` é nulo.
6. Incluir `pessoa_id` nas colunas de sessão e nos payloads internos necessários, sem expor dados cross-tenant.
7. Adicionar comentário `FIX 2026-08-25` no ponto crítico do webhook explicando o fallback que preserva mensagens.
8. Rodar `customerIdentityResolution`, `routerWebhookGuardrails`, `domainChat`, suíte completa e lint.
9. Commit: `feat(crm): resolve WhatsApp contacts into canonical customers`.

## Task 6 — Resolver pessoas na criação de pedidos

**Arquivos:**

- Criar: `tests/customerOrderResolution.test.ts`
- Modificar: `server/canonicalOrders.ts`
- Modificar: `server/zelomenuCartSessions.ts`
- Modificar: `src/hooks/useOrders.ts`
- Modificar: `src/types.ts`

**Passos:**

1. Testar que pedidos manual, ZeloChat e ZeloMenu passam `pessoa_id` quando a identidade é inequívoca.
2. Testar que conflito/telefone inválido mantém o pedido com snapshot e `pessoa_id null`.
3. Testar que resposta/erro de resolução nunca impede confirmação do pedido.
4. Implementar `resolveCustomerForOrder` reutilizando `server/customers/identity.ts`.
5. Estender o mapeamento de `Order` com `personId?: string`, sem substituir `customerName`/`customerPhone`.
6. Rodar testes de pedido, carrinho, checkout, canonical orders, suíte e lint.
7. Commit: `feat(crm): attach canonical customers to orders`.

## Task 7 — Construir backfill paginado, retomável e observável

**Arquivos:**

- Criar: `server/customers/backfill.ts`
- Criar: `scripts/backfill-customers.ts`
- Criar: `tests/customerBackfill.test.ts`
- Criar: `supabase/migrations/037_customer_backfill_state.sql`
- Modificar: `package.json`

**Passos:**

1. Testar checkpoint por empresa e cursor, reexecução idempotente e batch limitado.
2. Testar resultados separados: `linked`, `created`, `incomplete`, `conflict`, `failed`.
3. Testar que backfill nunca chama serviço de envio.
4. Criar tabela de estado/execuções com totais e último cursor, acessível apenas ao backend.
5. Implementar fases independentes:
   - identidades de `pessoas.contato`;
   - famílias de sessões;
   - vínculos únicos de pedidos;
   - migração do `customer_profile` mais recente para `ai_summary`.
6. Adicionar `npm run backfill:customers -- --empresa=<uuid> --dry-run`.
7. O modo dry-run deve produzir contagens sem escrever; o modo real exige confirmação textual do `empresa_id`.
8. Rodar teste isolado, dry-run em fixture/local, suíte e lint.
9. Commit: `feat(crm): add resumable customer backfill`.

**Gate A:** antes de continuar, aplicar migrations em ambiente de teste e provar: concorrência sem duplicação, funcionário em conflito, RLS cross-tenant negada e permissões owner/subusuário corretas.

## Task 8 — Criar API de Clientes somente leitura

**Arquivos:**

- Criar: `server/customers/router.ts`
- Criar: `server/customers/service.ts`
- Criar: `server/customers/filters.ts`
- Criar: `tests/customerFilters.test.ts`
- Criar: `tests/customerReadApi.test.ts`
- Modificar: `server/router.ts`

**Passos:**

1. Testar parser allowlist de `CustomerFilters`; rejeitar chaves arbitrárias/SQL.
2. Testar cursor estável, busca por nome/telefone, `tipo='cliente'`, exclusão de funcionários e filtros ativo/inativo.
3. Fixar regra de atividade em função pura:
   - última compra entregue quando existe compra;
   - última conversa apenas sem compras;
   - threshold da regra de reativação, padrão 30 dias.
4. Implementar:
   - `GET /api/customers`;
   - `GET /api/customers/:personId`;
   - mensagens, pedidos e timeline paginados.
5. Exigir `pessoas.visualizar` em todas as rotas de leitura.
6. Agregar contagens no servidor; não carregar toda a base no navegador.
7. Rodar testes isolados, suíte e lint.
8. Commit: `feat(crm): expose paginated customer read APIs`.

## Task 9 — Adicionar Clientes à navegação centralizada

**Arquivos:**

- Criar: `src/domain/navigation.ts`
- Criar: `tests/navigation.test.ts`
- Modificar: `src/components/Sidebar.tsx`
- Modificar: `src/components/MobileBottomNav.tsx`
- Modificar: `src/AppShell.tsx`
- Modificar: `src/components/MainContent.tsx`

**Passos:**

1. Testar configuração única com posição desktop e mobile:
   - desktop: Métricas, Atendimento, Clientes, Produção, Motoboys;
   - mobile restaurante: Atendimento, Clientes, Produção, Mais;
   - mobile geral: Atendimento, Clientes, Mais;
   - Métricas aparece dentro de Mais no mobile;
   - Clientes exige `pessoas.visualizar`.
2. Rodar teste e confirmar falha.
3. Extrair a definição de navegação; evitar arrays duplicados por viewport.
4. Adicionar `customers` ao tipo `View`, `GENERAL_ALLOWED_VIEWS` e lazy-load em `MainContent`.
5. Renomear apenas o label `dashboard` para Métricas; preservar o identificador.
6. Fazer Mais indicar estado ativo quando a tela atual pertence ao bottom sheet.
7. Rodar teste, suíte, lint e build.
8. Commit: `feat(nav): add Clientes and simplify mobile navigation`.

## Task 10 — Implementar a lista e os filtros mobile-first

**Arquivos:**

- Criar: `src/components/views/CustomersView.tsx`
- Criar: `src/components/customers/CustomerList.tsx`
- Criar: `src/components/customers/CustomerFiltersPanel.tsx`
- Criar: `src/components/customers/CustomerListRow.tsx`
- Criar: `src/hooks/useCustomers.ts`
- Criar: `src/services/customerApi.ts`
- Criar: `tests/customerUiGuardrails.test.ts`

**Passos:**

1. Criar guardrail de fonte garantindo um único botão `Filtros` e ausência de pills permanentes de VIP/aniversariantes/ativos/inativos na toolbar.
2. Testar serialização dos filtros e reset de cursor quando busca/filtro muda.
3. Implementar estados loading, vazio, erro amigável, paginação e refresh.
4. Mobile: lista em tela inteira e filtros em bottom sheet.
5. Desktop: lista à esquerda e espaço de detalhe à direita; filtros em popover/painel ancorado.
6. Mostrar somente nome, WhatsApp/“Sem WhatsApp”, atividade, estado e uma métrica de valor por linha.
7. Garantir targets mínimos de 44px e navegação por teclado.
8. Rodar testes, lint e build.
9. Commit: `feat(crm): add mobile-first customer list and filters`.

## Task 11 — Implementar ficha consolidada e escrita segura

**Arquivos:**

- Criar: `src/components/customers/CustomerDetail.tsx`
- Criar: `src/components/customers/CustomerSummaryTab.tsx`
- Criar: `src/components/customers/CustomerOrdersTab.tsx`
- Criar: `src/components/customers/CustomerRelationshipTab.tsx`
- Criar: `src/components/customers/CustomerEditDialog.tsx`
- Criar: `server/customers/mutations.ts`
- Criar: `tests/customerMutations.test.ts`
- Modificar: `server/customers/router.ts`
- Modificar: `src/services/customerApi.ts`

**Passos:**

1. Testar allowlist de escrita: nome, telefones, aniversário, notas, tags e bloqueio.
2. Testar `pessoas.gerenciar` para criar/editar/tag/merge/excluir.
3. Testar nome manual protegido contra atualização posterior do WhatsApp/IA.
4. Implementar `POST`, `PATCH`, `DELETE` e prévia/execução de merge.
5. Exclusão deve chamar a RPC PDV-owned; saldo em aberto retorna código estável e mensagem amigável.
6. Exibir confirmação informando que conversas/relacionamento serão removidos e pedidos/vendas serão preservados sem vínculo.
7. Mobile abre detalhe em tela inteira com Voltar; desktop mantém split view.
8. Separar “Dados confirmados” de “Resumo automático”.
9. Rodar testes, lint e build.
10. Commit: `feat(crm): add complete customer profile management`.

## Task 12 — Reutilizar thread e composer no CRM

**Arquivos:**

- Criar: `src/components/chat/ConversationThread.tsx`
- Criar: `src/components/chat/ConversationComposer.tsx`
- Criar: `src/components/customers/CustomerMessagesTab.tsx`
- Criar: `tests/customerMessages.test.ts`
- Modificar: `src/components/views/ChatView.tsx`
- Modificar: `src/hooks/useWhatsAppSessions.ts`
- Modificar: `server/customers/router.ts`

**Passos:**

1. Antes da extração, adicionar testes/guardrails para lifecycle `sending → sent|failed`, retry, anexos e paginação.
2. Extrair componentes do Atendimento sem mudar seu comportamento visual.
3. A aba Mensagens consulta todas as sessões da pessoa e ordena mensagens pela linha do tempo, mantendo o `session_id` original.
4. Envio pelo CRM escolhe a identidade primária/JID válido e usa o mesmo fluxo de intenção persistida de `/api/send`.
5. Exigir `pessoas.visualizar` para ler e `clientes.comunicar` para enviar.
6. Ao abrir Atendimento a partir do CRM, selecionar a sessão pelo hook; não mutar `sessions` diretamente.
7. Rodar testes de chat, retry, mídia, suíte, lint e build.
8. Commit: `refactor(chat): share conversation thread with customer CRM`.

**Gate B:** executar backfill dry-run e real em tenant piloto; conferir totais, amostra de identidades, conflitos, mensagens e pedidos. O Atendimento deve continuar funcionando mesmo quando a API de Clientes é deliberadamente indisponibilizada.

## Task 13 — Criar segmentos e schema de campanhas

**Arquivos:**

- Criar: `supabase/migrations/038_customer_campaigns.sql`
- Criar: `server/campaigns/filters.ts`
- Criar: `server/campaigns/service.ts`
- Criar: `server/campaigns/router.ts`
- Criar: `tests/customerCampaignSchema.test.ts`
- Criar: `tests/campaignAudience.test.ts`
- Modificar: `server/router.ts`
- Modificar: `src/types.ts`

**Passos:**

1. Testar tabelas de segmentos, campanhas e recipients, estados válidos, RLS e unique campanha/pessoa.
2. Testar filtros JSON com allowlist e nome de segmento único por empresa.
3. Testar preview com elegíveis e suprimidos por motivo.
4. Testar congelamento: editar segmento depois de agendar não altera recipients.
5. Implementar CRUD de segmentos/drafts, preview, teste e schedule.
6. Exigir `pessoas.visualizar` para preview e `clientes.comunicar` para teste/agendamento.
7. Implementar opt-out determinístico em módulo puro compartilhado com webhook.
8. Rodar testes, suíte e lint.
9. Commit: `feat(crm): add saved segments and frozen campaign audiences`.

## Task 14 — Criar fila persistente e worker de saída

**Arquivos:**

- Criar: `supabase/migrations/039_customer_outbound_jobs.sql`
- Criar: `server/outbound/queue.ts`
- Criar: `server/outbound/worker.ts`
- Criar: `server/outbound/policy.ts`
- Criar: `tests/outboundQueue.test.ts`
- Modificar: `server/index.ts`
- Modificar: `server/campaigns/router.ts`

**Passos:**

1. Testar claim com lease, idempotência, retry limitado e recuperação de lease expirado.
2. Testar limites: concurrency 1/instância, 12 inícios/minuto, padrão 50/dia e hard cap 200/dia.
3. Testar que desconexão pausa novos jobs sem marcar enviados ou perder a fila.
4. Persistir intenção de mensagem antes do envio e gravar resultado em recipient/job.
5. Resolver credenciais/instância no momento do envio; jobs não armazenam segredos.
6. Implementar pausa, retomada e cancelamento sem apagar histórico.
7. Iniciar worker de forma idempotente em `server/index.ts`.
8. Rodar testes de fila, retry, suíte e lint.
9. Commit: `feat(crm): add durable outbound campaign queue`.

## Task 15 — Implementar UI de campanhas

**Arquivos:**

- Criar: `src/components/customers/CampaignsTab.tsx`
- Criar: `src/components/customers/CampaignWizard.tsx`
- Criar: `src/components/customers/CampaignRecipients.tsx`
- Criar: `src/hooks/useCampaigns.ts`
- Modificar: `src/services/customerApi.ts`
- Criar: `tests/campaignUiGuardrails.test.ts`

**Passos:**

1. Testar sequência obrigatória: público → mensagem → teste → revisão → envio/agendamento.
2. Exibir claramente elegíveis, sem telefone, conflitos, funcionários e bloqueados.
3. Bloquear agendamento até que o teste e a prévia estejam concluídos na versão atual do draft.
4. Implementar acompanhamento de queued/sent/failed/suppressed, pausa e retomada.
5. Nunca mostrar nomes internos do canal/provedor.
6. Rodar testes, lint, build e verificação manual mobile/desktop.
7. Commit: `feat(crm): add guided campaign workflow`.

## Task 16 — Criar regras e ledger das cinco automações

**Arquivos:**

- Criar: `supabase/migrations/040_customer_automations.sql`
- Criar: `server/automations/rules.ts`
- Criar: `server/automations/evaluator.ts`
- Criar: `server/automations/sweeper.ts`
- Criar: `server/automations/router.ts`
- Criar: `tests/customerAutomations.test.ts`
- Modificar: `server/index.ts`
- Modificar: `server/router.ts`

**Passos:**

1. Testar defaults e validação de cada tipo; todas começam `enabled=false`.
2. Testar chaves idempotentes de aniversário, reativação, pós-compra, VIP e carrinho.
3. Testar timezone `America/Sao_Paulo`, janelas e cooldowns.
4. Testar supressão por conflito, bloqueio, sem telefone, pedido aberto e promoção recente.
5. Implementar avaliador puro que produz dispatch elegível/suprimido; o worker apenas envia jobs já aprovados.
6. Implementar API de ler/editar/testar/habilitar/desabilitar/histórico com `clientes.comunicar`.
7. Iniciar sweeper idempotente; um tick com falha não derruba o processo.
8. Rodar testes, suíte e lint.
9. Commit: `feat(crm): add editable customer journeys`.

## Task 17 — Incorporar carrinho abandonado ao ledger comum

**Arquivos:**

- Modificar: `server/abandonedCartSweeper.ts`
- Modificar: `server/zelomenuCartSessions.ts`
- Modificar: `src/domain/zelomenuCart.ts`
- Modificar: `tests/zelomenuAbandonedCart.test.ts`
- Modificar: `server/automations/evaluator.ts`

**Passos:**

1. Estender testes existentes para exigir uma única fonte de decisão e uma única chave idempotente por carrinho.
2. Fazer o sweeper existente criar dispatch/job quando a regra estiver ativa; não criar segundo sweeper.
3. Preservar link novo, janela configurável 2–24h e exclusão de carrinho confirmado/cancelado/arquivado.
4. Durante rollout, manter comportamento legado atrás de flag e impedir que ambos enviem.
5. Remover flag legado somente após confirmar ledger/telemetria no piloto.
6. Rodar testes de carrinho, automações, suíte e lint.
7. Commit: `refactor(crm): unify abandoned-cart recovery with automations`.

## Task 18 — Implementar UI de automações

**Arquivos:**

- Criar: `src/components/customers/AutomationsTab.tsx`
- Criar: `src/components/customers/AutomationRuleCard.tsx`
- Criar: `src/components/customers/AutomationEditor.tsx`
- Criar: `src/hooks/useCustomerAutomations.ts`
- Modificar: `src/services/customerApi.ts`
- Criar: `tests/automationUiGuardrails.test.ts`

**Passos:**

1. Testar que a ação de ativar exige mensagem, horário, público e limite válidos.
2. Mostrar cinco jornadas prontas, sem construtor visual genérico.
3. Permitir teste no próprio número, histórico e desativação imediata.
4. Mostrar estado “Pausada porque o WhatsApp está desconectado” com orientação amigável.
5. Rodar testes, lint, build e verificação manual.
6. Commit: `feat(crm): add automation control center`.

## Task 19 — Responsividade, acessibilidade e E2E

**Arquivos:**

- Criar: `tests/customers-crm.spec.ts`
- Modificar: `playwright.config.ts` somente se projetos de viewport forem necessários
- Modificar: componentes CRM conforme resultados

**Passos:**

1. Criar fixtures/API mocks determinísticos para não depender de dados reais.
2. Cobrir viewports 360×800, 390×844, 768×1024 e 1440×900.
3. Validar:
   - barra mobile com quatro itens e Métricas dentro de Mais;
   - botão Filtros e bottom sheet/popover;
   - lista → ficha → voltar no mobile;
   - split view no desktop;
   - tabs Resumo/Mensagens/Pedidos/Relacionamento;
   - ações inacessíveis sem permissão;
   - foco, Escape, labels e ausência de overflow horizontal.
4. Rodar `npm run test:e2e -- customers-crm.spec.ts`, `npm test`, `npm run lint` e `npm run build`.
5. Commit: `test(crm): cover mobile-first customer workflows`.

## Task 20 — Piloto, métricas, documentação e rollout

**Arquivos:**

- Criar: `server/customers/metrics.ts`
- Modificar: `server/observability.ts` ou módulo equivalente
- Modificar: `src/data/changelog.ts`
- Modificar: `CURRENT.md`
- Modificar: `FIXES_PROGRESS.md`
- Modificar: `docs/ai/ZeloChat.memory.md`
- Modificar no ZeloPDV: `CURRENT.md`, `FIXES_PROGRESS.md` e memória correspondente
- Excluir ao final: `docs/superpowers/specs/2026-08-25-clientes-crm-design.md`

**Passos:**

1. Adicionar feature flag interna por empresa para navegação/API e flags separadas para campanhas/automações.
2. Medir apenas metadados: totais, conflitos, fila, envios, falhas, supressões, respostas, pedidos atribuídos e opt-outs; nunca conteúdo.
3. Criar painel/log operacional para idade da fila, leases presos e desconexões.
4. Rodar piloto nesta ordem:
   - CRM somente leitura;
   - criação/edição/mensagens;
   - campanhas manuais;
   - automações, inicialmente desligadas.
5. Para cada etapa, documentar rollback: desabilitar flag e manter dados/migrations aditivos.
6. Validar `git diff --check`, suíte, lint, build e E2E nos dois repositórios.
7. Solicitar revisão de código focada em tenant isolation, service role, idempotência e exclusão.
8. Atualizar changelog com no máximo quatro entradas do dia e linguagem de produto.
9. Após a feature estar realmente entregue, remover a spec temporária conforme a convenção do repositório.
10. Commits finais separados: `docs: record Clientes CRM rollout` em cada repositório.

**Gate C / definição de pronto:**

- Migrations PDV e ZeloChat aplicadas na ordem documentada.
- Backfill completo por empresa, com conflitos revisáveis e sem merge automático ambíguo.
- RLS e APIs negam acesso cross-tenant.
- Owners e subusuários respeitam as três permissões.
- Atendimento continua funcional quando CRM/worker estão pausados.
- Campanhas respeitam audiência congelada, limites, pausa, opt-out e idempotência.
- Cinco automações estão disponíveis e desligadas por padrão.
- UI passa nos quatro viewports e não expõe termos internos.
- Nenhuma mensagem ou pedido foi duplicado durante testes de concorrência/retry.

## Comandos finais de verificação

### ZeloPDV

```bash
npm test
npm run check
npm run verify:migrations
npm run build
git diff --check
```

### ZeloChat

```bash
npm test
npm run lint
npm run build
npm run test:e2e -- customers-crm.spec.ts
git diff --check
```

## Estratégia de commits

Manter cada task em um commit independente. Não misturar migrations PDV-owned com UI do ZeloChat. Se uma task precisar de mais de um commit, separar nesta ordem: teste falhando/contrato, implementação, integração e documentação. Nunca fazer push ou deploy antes de todos os gates da fase correspondente.
