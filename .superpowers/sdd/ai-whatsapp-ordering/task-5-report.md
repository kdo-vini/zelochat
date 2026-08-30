# Task 5 — Relatório de implementação

Data: 2026-08-30
Worktree: `C:\Users\Vinicius\Desktop\code\zelochat\.worktrees\ai-whatsapp-ordering`
Branch: `codex/ai-whatsapp-ordering`
Base antes da tarefa: `6da6ef9`
Commit da implementação: `17879da` (`feat: adiciona hábitos de pedido ao cliente`)

## Resultado

Foi entregue `CustomerOrderingContext.get({ empresaId, pessoaId })` como módulo de domínio determinístico com adapter injetável. O detalhe de Clientes agora recebe um snapshot calculado exclusivamente a partir de `zelo_orders` e `zelo_order_items`, escopado por empresa e pessoa, limitado aos 20 pedidos comprometidos mais recentes.

Statuses aceitos, documentados e aplicados: `accepted`, `preparing`, `ready`, `out_for_delivery`, `delivered`. Statuses excluídos: `pending_payment`, `pending_review`, `rejected`, `cancelled` e qualquer valor fora da allowlist.

O snapshot contém tipo, endereço estruturado, forma de pagamento, horário habitual, mediana de recorrência, itens frequentes determinísticos, último pedido completo com itens/modificadores e os overrides atuais. Tipo, endereço e pagamento seguem `fixado > último pedido > ausente`; horário fixado vence a mediana calculada. Itens frequentes são somente apoio e nunca viram default automático.

O PATCH `/api/customers/:personId/ordering-overrides` aceita somente `fulfillmentType`, `deliveryAddress`, `paymentMethod` e `habitualTime`; `null` remove apenas o campo informado. A rota exige `pessoas.gerenciar`, valida a pessoa pelo owner autenticado e mantém todas as leituras/escritas escopadas por tenant.

Na ficha, “Hábitos de pedido” é responsiva (`grid-cols-1`, duas colunas a partir de `sm`), tem rótulo de seção, ações com nomes acessíveis e origens legíveis “Fixado”, “Último pedido” e “Calculado”. Operadores somente leitura não recebem ações de alteração.

## TDD — RED

1. `tests/customerOrderingContext.test.ts` falhou inicialmente com `ERR_MODULE_NOT_FOUND` para `server/customers/orderingContext.js`.
2. `tests/customerOrderingContextAdapter.test.ts` e `tests/customerOrderingContextHttp.test.ts` falharam com módulos de adapter/rota ausentes.
3. `tests/customerOrderingContextClient.test.ts` falhou porque `normalizeCustomerOrderingContext` ainda não era exportado.
4. `tests/customerOrderingContextUi.test.ts` falhou porque a marcação ainda não continha “Hábitos de pedido”.
5. `tests/customerOrderingContextIntegration.test.ts` falhou porque serviço, rota montada e callback da tela ainda não estavam conectados.
6. Na revisão defensiva final, um novo caso de cliente demonstrou que `medianRecurrenceDays.value = null` era convertido indevidamente em zero. O teste falhou com `{ value: 0, source: 'derived' }` antes da correção fail-closed.

Durante o GREEN, dois fixtures foram corrigidos sem relaxar o comportamento: os horários de teste passaram a variar para exercitar a mediana, e o endereço esperado passou a refletir a forma estruturada normalizada com campos opcionais nulos.

## TDD — GREEN

Testes focados finais:

- `customerOrderingContext: ok`
- `customerOrderingContextAdapter: ok`
- `customerOrderingContextHttp: ok`
- `customerOrderingContextClient: ok`
- `customerOrderingContextUi: ok`
- `customerOrderingContextIntegration: ok`

Cobertura exercitada: zero, um e 21 pedidos; corte nos 20 mais recentes; isolamento empresa/pessoa; exclusão de estados não comprometidos; último tipo/endereço/pagamento/pedido; medianas pares e ímpares; itens frequentes por ID com ordenação estável; precedência de override; PATCH parcial, remoção e payload inválido; manager/viewer; mensagens HTTP amigáveis; renderização, origens, ações, responsividade e modo somente leitura.

## Arquivos

Domínio e backend:

- `server/customers/orderingContext.ts` — módulo profundo, cálculos, normalização, precedência e patch allowlisted.
- `server/customers/orderingContextAdapter.ts` — adapter de produção e leitura canônica aninhada.
- `server/customers/orderingContextRouter.ts` — PATCH autenticado e erros amigáveis.
- `server/customers/service.ts` — inclusão do snapshot no detalhe do cliente.
- `server/customers/router.ts` — montagem da subrota focada.

Contrato, cliente e UI:

- `src/types.ts` — tipos explícitos do snapshot, endereço, itens, modificadores, último pedido e overrides.
- `src/services/customerApi.ts` — normalização fail-closed, contrato do detalhe e PATCH.
- `src/components/customers/CustomerDetail.tsx` — atualização local após fixar/remover.
- `src/components/customers/CustomerSummaryTab.tsx` — seção acessível e responsiva.

Testes:

- `tests/customerOrderingContext.test.ts`
- `tests/customerOrderingContextAdapter.test.ts`
- `tests/customerOrderingContextHttp.test.ts`
- `tests/customerOrderingContextClient.test.ts`
- `tests/customerOrderingContextUi.test.ts`
- `tests/customerOrderingContextIntegration.test.ts`

Documentação e produto:

- `CURRENT.md`
- `FIXES_PROGRESS.md`
- `CLAUDE.md`
- `docs/ai/ZeloChat.memory.md`
- `src/data/changelog.ts` — uma entrada em 2026-08-30, dentro do limite de quatro por dia.

## Verificação

- Seis testes focados: GREEN.
- `npm test`: GREEN; todos os arquivos unitários passaram. O probe de banco de `customerRelationshipSchema` permaneceu `SKIP` por ausência de `SUPABASE_DB_URL`/`DATABASE_URL`, como previsto pelo runner.
- `npm run lint`: GREEN.
- `npx tsc --noEmit -p server/tsconfig.json`: GREEN.
- `npm run build`: GREEN; permanece somente o aviso conhecido de chunk principal acima de 600 kB (`611.59 kB`, `173.68 kB` gzip).
- `git diff --check` e `git diff --cached --check`: GREEN; apenas avisos locais de conversão futura LF→CRLF.
- Busca direcionada confirmou ausência de `zelochat_orders` nos módulos do contexto, cliente e UI.
- Nenhum backend, webhook, worker ou serviço externo foi iniciado.

## Revisão

Revisão final realizada nos eixos de padrões do repositório e aderência ao brief. A tarefa proibiu subagentes, portanto os dois eixos foram verificados localmente. Não restou achado bloqueador. O único achado funcional foi o caso `null → 0` na normalização de recorrência, corrigido por novo ciclo RED→GREEN antes do commit.

## Riscos residuais

- Não houve probe contra banco conectado nesta tarefa. O adapter assume `zelochat_customer_relationships.ordering_overrides` existente, conforme o brief afirma que o contrato compartilhado já contém a coluna.
- A UI foi validada por renderização SSR e contrato de classes/ARIA, não por sessão autenticada em navegador publicado.
- O aviso de tamanho do bundle é dívida já registrada em `CURRENT.md` e não foi ampliado para uma refatoração fora de escopo.
- A Task 5 expõe o contexto; o consumo conversacional pela IA e a revalidação do pedido pertencem à Task 6. Nenhum pedido foi criado, copiado ou alterado aqui.

## Review round 1/5 — correções

Commit: `eeeee79` (`fix: endurece hábitos de pedido concorrentes`)

### RED

- Dois `patchOverrides` simultâneos, um para pagamento e outro para horário, foram sincronizados sobre a mesma leitura antiga; o teste observou somente `{ habitualTime: '20:15' }`, perdendo `paymentMethod`.
- A UI ainda ligava `disabled` apenas ao card em gravação; o guardrail encontrou zero ocorrências do bloqueio global esperado nos quatro cards.
- A mediana linear de `23:50` e `00:10` retornou `{ minutes: 720, label: '12:00' }`.
- O último pedido retornou `customer: undefined` e descartou campos não projetados dos snapshots de fulfillment/payment.

### GREEN

- O store expõe somente `patchOrderingOverridesAtomically`; o adapter chama o RPC service-role `patch_zelochat_customer_ordering_overrides(p_empresa_id, p_owner_user_id, p_pessoa_id, p_patch)`. Não há mais read/merge/upsert do JSON no ZeloChat nem lock local. O RPC, pertencente ao stream compartilhado do ZeloPDV, é a dependência explícita para validação tenant-safe e merge atômico com remoção por `null`.
- Todos os cards recebem `saving={saving !== null}`, impedindo um segundo PATCH enquanto qualquer ação está em andamento.
- O horário usa corte determinístico no maior arco vazio e mediana sobre os minutos desembrulhados; `23:50` + `00:10` agora produz `00:00` sem alterar a mediana diurna existente.
- O SELECT inclui `customer`; `lastOrder` preserva esse snapshot e espalha todos os campos originais de fulfillment/payment, mantendo também as projeções normalizadas e `asap` explícito.

### Verificação do round 1

- Seis testes focados do contexto: GREEN.
- `npm run lint`: GREEN.
- `npx tsc --noEmit -p server/tsconfig.json`: GREEN.
- `npm run build`: GREEN, apenas com o aviso conhecido de chunk principal acima de 600 kB.
- `git diff --check` e `git diff --cached --check`: GREEN, apenas avisos LF→CRLF do ambiente.
- A suíte completa não foi repetida por instrução de prioridade; a execução imediatamente anterior desta Task 5 já havia passado integralmente antes do round, e as reproduções alteradas foram reexecutadas nos focados.

Risco de rollout: publicar/aplicar primeiro a migration do RPC no repositório ZeloPDV, dono do schema compartilhado, e somente depois este backend. Sem esse RPC, o PATCH falha de forma segura e não grava preferências.
