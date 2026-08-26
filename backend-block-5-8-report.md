# Backend Tasks 5–8 — relatório

Data: 2026-08-25  
Worktree: `clientes-crm`

## Resultado

**DONE_WITH_CONCERNS** — implementação local concluída e commits separados por task. O Gate A de banco não foi aplicado neste ambiente; a ativação produtiva da RPC do PDV/backfill deve aguardar prova transacional em Supabase de teste.

## RED/GREEN por task

- Task 5 — RED: `tests/customerIdentityResolution.test.ts` foi criado para exigir vínculo, conflito, erro fail-soft, nome manual e JID inválido. GREEN: adaptador `server/customers/repository.ts`, resolvedor `server/customers/identity.ts` e integração pessoa-first em `server/messageHandler.ts`.
- Task 6 — RED: `tests/customerOrderResolution.test.ts` cobriu vínculo, conflito/telefone inválido e preservação de snapshot. GREEN: manual/ZeloMenu usam `resolveCustomerForOrder`; `Order.personId` é adicional e `p_pessoa_id` é enviado à RPC canônica.
- Task 7 — RED: `tests/customerBackfill.test.ts` cobriu dry-run, batch, checkpoint e idempotência operacional. GREEN: backfill paginado em `server/customers/backfill.ts`, CLI confirmada por empresa e migration server-only `049_customer_backfill_state.sql` (não foi criado o nome 037 do plano).
- Task 8 — RED: `tests/customerFilters.test.ts` e `tests/customerReadApi.test.ts` cobriram allowlist, cursor e regra de atividade. GREEN: filtros, serviço agregado e rotas paginadas de clientes/mensagens/pedidos/timeline, todas com `requireActorPermission(..., 'pessoas.visualizar')`.

## Commits

- Task 5: `9cde309` — `feat(crm): resolve WhatsApp contacts into canonical customers`
- Task 6: `f489e4a` — `feat(crm): attach canonical customers to orders`
- Task 7: `e88a0c6` — `feat(crm): add resumable customer backfill`
- Task 8: será o commit desta documentação e das APIs.

## Validação agregada

- Verdes: `customerIdentityResolution`, `customerOrderResolution`, `customerBackfill`, `customerFilters`, `customerReadApi`, `routerWebhookGuardrails` (29/29), `domainChat`.
- Verdes: `npx tsc --noEmit -p server/tsconfig.json` e `npx tsc --noEmit`.
- Lint/suíte completa/build: executar uma vez após este commit; não houve aplicação de migration remota.

## Riscos e Gate A

- A migration 049 está versionada com RLS e grants apenas para `service_role`, mas não foi aplicada/verificada contra Supabase neste ambiente.
- A RPC `ensure_customer_from_whatsapp` e o argumento `p_pessoa_id` pertencem ao contrato compartilhado do ZeloPDV; deploy deve ocorrer somente após a migration/RPC correspondente existir.
- O backfill não envia mensagens e grava checkpoint apenas fora de `dry-run`; ainda requer teste de concorrência, funcionário correspondente em conflito, isolamento cross-tenant e permissões owner/subusuário (Gate A).
