# Incidentes e padrões conhecidos

Knowledge base de causas-raiz já vistas em produção. Use como **primeira parada**
quando algo quebra antes de abrir um ticket pro Whatsmiau, antes de subir um fix,
antes de re-deployar. Mantenha vivo — cada outage novo vira uma entrada aqui.

> Ver também: [[BILLING]] · [[CODE_REVIEW]] · [[FIXES_PROGRESS]]

> Triagem rápida em 5 segundos: olhe o "Sintoma" de cada bloco, encontre o mais
> próximo do que você está vendo, leia a "Diagnose" e siga a "Recovery".

---

## XIX. Sweeper de exclusão podia duplicar trabalho ou apagar a instância fallback (risco auditado em 2026-08-13)

> Não houve deleção real executada durante a validação nem incidente de cliente confirmado. Este bloco registra um failure mode reproduzível no código que roda em produção.

### Sintoma possível

Duas réplicas podiam selecionar a mesma conta vencida; uma reativação podia disputar com a purga; falhas de listagem/remoção de Storage eram tratadas como sucesso; e uma empresa sem instância própria podia chegar ao fallback global de WhatsApp em um fluxo destrutivo.

### Causa-raiz

O worker fazia SELECT direto por `deletion_scheduled_at`, sem claim cercado, usava `deleteInstance()` (que preserva um fallback legado válido para envio), listava no máximo 1.000 objetos por prefixo e continuava até `delete_account` mesmo após falhas externas. A rota de reativação também ficava atrás do paywall e limpava o agendamento mesmo quando a retomada de billing falhava.

### Fix

Claim/finalização atômicos por token no banco compartilhado, com renovação/validação do lease antes de cada efeito externo; reativação adquire um token mutuamente exclusivo antes do Stripe e somente o token exato conclui, enquanto resultado externo ambíguo mantém a conta cercada; deleter usa somente o pointer de instância capturado pelo claim e nunca o fallback; QR/connect checa ambos os fences e compensa criação upstream em CAS perdido; Storage paginado e fail-closed; erros de lookup de assinatura propagados. Cobertura em `tests/accountDeletionReliability.test.ts`.

### Recovery / rollout

1. Aplicar primeiro a migration que cria os pares de token de purge/reativação e os RPCs `claim_due_account_deletions`, `renew_account_deletion_claim`, `finalize_claimed_account_deletion`, `begin_account_deletion_reactivation`, `complete_account_deletion_reactivation` e `abort_account_deletion_reactivation`.
2. Só depois publicar o backend ZeloChat; inverter a ordem faz o tick do sweeper falhar fechado, sem deletar conta, mas gera erro operacional a cada execução.
3. Em falha de cleanup, corrigir o provedor/bucket e aguardar o lease permitir novo claim; nunca chamar `delete_account` manualmente para “destravar”.
4. Um fence de reativação abandonado bloqueia purge por segurança. O titular pode repetir a reativação após 30 minutos; se não voltar, reconciliar manualmente o resultado do Stripe antes de liberar qualquer fence.

---

## XVIII. PDF/documento recebido não aparecia no app (2026-07-31)

### Sintoma
Cliente enviava um anexo pelo WhatsApp, mas a empresa não via o PDF no ZeloChat; o arquivo permanecia visível apenas no WhatsApp.

### Causa-raiz
O texto era extraído após `unwrapMessage`, mas a criação do anexo e a busca de `base64`/`mediaUrl` liam apenas `msg.message.*` direto; payloads `documentWithCaptionMessage` e wrappers equivalentes perdiam o documento. Na tentativa específica da cliente `Téchne Sistemas`, o log bruto registrou nove eventos para o número informado, mas nenhum `documentMessage` — apenas três `imageMessage`, cinco textos e uma reação — então o PDF testado não chegou ao webhook nessa tentativa.

### Fix
Entrada e saída passaram a usar o payload desembrulhado recursivamente; MIME `application/pdf` com parâmetros também é normalizado. O bucket `zelochat-media` foi corrigido de 10 MB para 25 MB via Supabase CLI — `server/messageHandler.ts:751`, `server/messageHandler.ts:2118`, `tests/messageHandlerMedia.test.ts:1`, `supabase/migrations/047_media_bucket_size_limit.sql:1`.

### Recovery
Publicar o build do commit corrigido. Se um novo teste não aparecer no log bruto como `documentMessage`/`documentWithCaptionMessage`, o problema está antes do ZeloChat (entrega/formato do provedor); se aparecer, conferir `processed_at`, `processing_error` e o tipo do anexo persistido.

---

## XVII. Cérebro IA travava após refactor da tela

### Sintoma
Ao abrir Configurações → Cérebro IA em produção, a tela quebrava com `qrSaveState is not defined` ao renderizar as respostas rápidas.

### Causa-raiz
O refactor removeu os bindings locais de estado/ref junto com seções aposentadas, mas manteve usos desses bindings no salvamento das respostas rápidas e no campo de instruções.

### Fix
Os bindings `qrSaveState`, `qrDebounceRef` e `promptRef` foram restaurados em `AIConfigsView`, com guardrail de regressão — `src/components/views/AIConfigsView.tsx:196`, `tests/aiConfigsViewGuardrails.test.ts:1`.

### Recovery
Publicar o build corrigido e recarregar a tela; não é necessário alterar dados ou configurações da empresa.

---

## XVI. IA recusava pedido "pra já" dizendo que o horário já passou

### Sintoma
Cliente pedia pra retirar/receber na hora e a IA respondia algo como "Esse horário já passou hoje: 20:08. Agora são 20:09. O atendimento funciona das 11:00 às 23:00." (Bem Servido). Mensagem sem sentido: 20:08 está dentro do horário e é ~agora.

### Causa-raiz
Pedido imediato recebe `pickupTime ≈ agora`; `isPastSameDaySchedule` (`server/ai.ts`) marcava como passado qualquer horário `<=` o minuto atual (tolerância zero), então 1 min de latência entre o carimbo e a validação virava "já passou". Bug adjacente: o parser de horário (`collectRequestedTimeMinutes`) tratava o "a"/"as" solto como horário, confundindo preço/quantidade/tempo-relativo ("a 5 reais" → 05:00, "daqui a 20 minutos" → 20:00, "as 5 da tarde" → falso 05:00).

### Fix
Tolerância de 15 min (`SAME_DAY_PAST_GRACE_MINUTES`) — só é "passado" quando claramente atrás de agora — e negative lookahead no parser excluindo unidades de preço/quantidade/período. `server/ai.ts:1150`, `server/ai.ts:1203`. Regressão: `tests/aiScheduleEdgeCases.test.ts` (63 casos de comunicação informal BR).

### Recovery
Já corrigido em código. Se reaparecer, checar se `SAME_DAY_PAST_GRACE_MINUTES` cobre a latência real e se o horário veio de preço/quantidade mal interpretado no texto do cliente.

---

## XV. Mover pedido retornava 500/UNKNOWN_ERROR

### Sintoma
O operador arrastava um pedido no Kanban e ele voltava para a coluna anterior com erro 500; o navegador mostrava apenas `UNKNOWN_ERROR`.

### Causa-raiz
Erros retornados pela RPC de transição são objetos PostgREST, mas a rota só reconhecia `Error` nativo e descartava a mensagem real.

### Fix
O normalizador classifica revisão, estoque, permissão e estado inválido; a rota responde com orientação amigável e o toast mostra a causa — `src/domain/orderTransitionError.ts`, `server/router.ts:2040`, `src/AppShell.tsx:880`.

### Recovery
1. Atualizar a tela e tentar novamente.
2. Se aparecer estoque insuficiente, corrigir o estoque do item e repetir.
3. Se aparecer pedido alterado em outra tela, recarregar a lista antes de mover.

---

## XIV. Pedido ZeloMenu aguardando aceite sem impressao e grupo truncado

### Sintoma
Pedido publico do ZeloMenu chegava sem imprimir enquanto aguardava a decisao da loja; quando impresso, o bilhete mostrava apenas o inicio do produto configuravel.

### Causa-raiz
O listener de pedidos nao ficava ativo durante o Atendimento e o formatador da impressora cortava cada item em 32 caracteres; `pending_review` tambem nao tinha uma representacao de aceite na interface.

### Fix
O listener agora fica ativo durante todo o uso do restaurante, `pending_review` imprime na chegada e aparece com acoes explicitas de aceitar/recusar; o bilhete passa a quebrar linhas e preservar os modificadores — `src/AppShell.tsx:271`, `src/hooks/useOrders.ts:192`, `src/components/views/ProductionView.tsx:622`, `src/services/printerService.ts:25`.

### Recovery
1. Confirmar que o Zelo Impressao esta conectado.
2. Criar um pedido publico com massa, molho, proteina e acompanhamentos.
3. Verificar que o bilhete sai antes do aceite e contem todas as escolhas.
4. Aceitar o pedido e confirmar que ele vai para Pendente sem imprimir um segundo bilhete.

---

## XIII. Pedido ZeloMenu sem venda nos relatorios

### Sintoma
O pedido #33BCA323 apareceu no chat, mas nao apareceu nos relatorios nem no caixa.

### Causa-raiz
A transicao direta para delivered nao passava pelo fechamento financeiro do ZeloPDV, deixando zelo_orders.sale_id nulo.

### Fix
Trigger compartilhado cria venda e itens de forma idempotente e escolhe o caixa cujo intervalo contem o horario da entrega; a migration tambem recupera entregas antigas — ../zelopdv/.ai/migrations/canonical_order_sales_2026_07_23.sql:1.

### Recovery
O pedido afetado foi reparado e esta vinculado a venda 13505 no caixa 588; novas entregas passam pelo mesmo boundary automaticamente.

---

## XII. Pedido normal escalado como cliente frustrado

### Sintoma
Uma mensagem normal de pedido pelo cardápio digital era encaminhada para atendimento humano com o motivo "Reclamação ou cliente irritado".

### Causa-raiz
O modelo podia escolher o gatilho nativo amplo de reclamação e o backend executava a escalação sem conferir se a mensagem atual do cliente tinha um sinal explícito de insatisfação.

### Fix
O planejador de ferramentas agora valida os gatilhos nativos contra a última mensagem do cliente; pedidos, saudações e consultas de status não passam pela escalação, enquanto reclamações claras continuam passando — `src/domain/escalationIntent.ts`, `server/ai.ts`, `server/builtinTriggers.ts`.

### Recovery
1. Após o deploy, testar uma confirmação normal do ZeloMenu e uma reclamação explícita (por exemplo, "veio errado").
2. A primeira deve continuar no atendimento automático; a segunda deve abrir a escalação humana.

---

## XI. Pedido confirmado entra na produção mas gerente não é avisado

### Sintoma
- Cliente confirma o pedido fora do horário humano.
- O pedido aparece na produção, mas o gerente não recebe o alerta configurado
  como "Novo pedido".
- No chat, cards antigos de conferência podem dar a impressão de que o pedido
  ainda aguarda confirmação, mesmo após a confirmação.

### Causa-raiz
Gatilhos `notify_manager` eram executados apenas quando o modelo chamava
`dispatch_trigger`; pedidos finalizados pelo caminho determinístico
`confirmPendingOrder` criavam a row em `zelochat_orders`, mas não reavaliavam
gatilhos de evento real como "Novo pedido".

### Fix
Pedidos confirmados agora selecionam gatilhos determinísticos de evento
(`novo pedido` e pedido grande por quantidade) e notificam o gerente depois da
criação do pedido — `src/domain/orderEventTriggers.ts:45`,
`server/ai.ts:121`, `server/ai.ts:692`. Cards de conferência também foram
reescritos como histórico da etapa, não estado atual — `src/domain/chatFeedback.ts:141`.

### Recovery
1. Conferir se o pedido existe em Produção.
2. Se existir e o gerente não recebeu aviso, verificar se há gatilho ativo
   `notify_manager` com texto de novo pedido e se o telefone do gerente está
   preenchido.
3. Após este hotfix, reproduzir com um pedido pequeno e confirmar que o gerente
   recebe o alerta assim que o pedido entra na produção.
4. Para produto não identificado, conferir o card azul de análise; grafias
   "esfirra/esfiha" e "hambúrguer/hamburguinho" agora devem mapear antes de
   escalar.

## X. Bundle renovado no ZeloPDV segue sem acesso no ZeloChat

### Sintoma
- Cliente paga a renovação do bundle via AbacatePay dentro do ZeloPDV.
- No banco, `subscriptions.status='active'`, `plan_tier='bundle'` e
  `current_period_end` fica no futuro, mas o ZeloChat continua mostrando
  paywall / `SUBSCRIPTION_INACTIVE`.

### Causa-raiz
O ZeloChat priorizava `manually_extended_until ?? current_period_end`. Quando a
row compartilhada tinha uma extensão manual antiga já vencida, ela sombreava um
`current_period_end` renovado no futuro e fazia a assinatura parecer expirada.

### Fix
A expiração efetiva agora é sempre o timestamp válido mais longo entre
`current_period_end` e `manually_extended_until` em `server/supabase.ts`,
`server/subscriptionSweeper.ts`, `src/hooks/useSubscription.ts` e
`src/components/billing/BillingCards.tsx`. Regressão coberta em
`tests/subscriptionExpiry.test.ts`.

### Recovery
1. Conferir a row em `public.subscriptions` do cliente.
2. Se `status='active'`, `plan_tier in ('chat','bundle')`,
   `current_period_end > now()` e `manually_extended_until < now()`, aplicar
   hotfix limpando o override vencido:
   `UPDATE subscriptions SET manually_extended_until = NULL WHERE id = ...;`
3. Pedir para o operador recarregar o ZeloChat ou aguardar a próxima leitura da
   assinatura.
4. Confirmar que o bundle continua ativo e que a data exibida no billing card
   bate com o vencimento mais longo.

## IX. Gerar QR Code não recupera após instância apagada no provedor

### Sintoma
- Empresas tentando reconectar o WhatsApp ficam vendo a mensagem para aguardar
  alguns segundos e clicar em "Gerar QR Code" de novo, mas o QR nunca aparece.
- O problema começa depois que a instância da empresa é apagada manualmente no
  painel do provedor.

### Causa-raiz
`empresa_perfil.whatsmiau_instance` continuava apontando para o nome apagado; o
endpoint de QR reutilizava esse nome em vez de criar uma nova instância.

### Fix
Quando o provedor responde 404 ao buscar o QR, `/api/qr` e `/api/qr/refresh`
limpam somente o ponteiro antigo daquela empresa, criam uma nova instância e
tentam buscar o QR novamente no mesmo fluxo — `server/router.ts:1038`,
`server/instanceManager.ts:275`, `server/whatsapp.ts:638`.

### Recovery
1. Clicar em "Gerar QR Code" novamente depois do deploy do hotfix.
2. Se ainda não aparecer em até 60s, rodar `npx tsx scripts/diagnose-webhooks.ts`
   dentro do container do backend para conferir instância upstream e webhook.
3. Não regenerar `webhook_token`; o hotfix preserva esse segredo.

---

## VIII. IA pega pedido quando hoje está bloqueado na agenda

### Sintoma
- Em uma data bloqueada/feriado, a IA responde disponibilidade de produto e avança para Pix/retirada como se fosse pedido para hoje.

### Causa-raiz
As travas determinísticas só bloqueavam datas explícitas ou intenção direta de pedido; fluxos conduzidos por disponibilidade de produto, Pix, retirada, nome e continuações curtas dependiam do modelo respeitar o prompt.

### Fix
A validação pré-OpenAI agora bloqueia intenção operacional de hoje em `blocked_dates` quando não há data futura explícita, e pendências antigas são revalidadas antes da confirmação — `server/ai.ts:952`, `server/ai.ts:959`, `server/ai.ts:584`, `server/ai.ts:3273`.

### Recovery
1. Conferir se a data bloqueada aparece em Calendário → Datas bloqueadas.
2. Testar no Cérebro IA com frases como “tem coxinha?”, “vou mandar o pix e meu filho vai buscar”, “retirada às 10:50” e “só isso”.
3. A resposta esperada deve avisar que a data está bloqueada e oferecer outro dia ou atendente, sem pedir Pix, nome, retirada ou confirmação.

## 🔍 Como diagnosticar quando inbound morre

Outage típico: "outbound funciona (cliente recebe), inbound não chega (operador
não vê mensagem nova)". Antes de qualquer coisa, rode o script de diagnóstico:

```bash
# De dentro do container do backend (mais fácil — env vars já carregadas):
docker exec <backend-container> sh -c 'cd /app && npx tsx scripts/diagnose-webhooks.ts'

# Ou localmente, com as env vars de prod carregadas:
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... WHATSMIAU_API_KEY=... \
  npx tsx scripts/diagnose-webhooks.ts
```

O script imprime 3 sinais por empresa: **(a)** se a public URL responde POST,
**(b)** se o nome da instância no nosso DB bate com o nome upstream no
Whatsmiau, **(c)** se a URL registrada no Whatsmiau bate com a que esperamos.
A combinação aponta direto pra um dos blocos abaixo.

---

## VII. Reconectar WhatsApp fica preso em timeout ao gerar QR

### Sintoma
- Após desconectar manualmente, clicar em "Gerar QR Code" mostra:
  `Aguardando resposta do WhatsApp (timeout of 10000ms exceeded)`.
- A tela de instâncias da Whatsmiau aparece como desconectada, enquanto o card
  de Configurações pode mostrar o último estado conectado por cache visual.
- Mensagens manuais pelo painel falham e mensagens enviadas pelo WhatsApp comum
  não aparecem no ZeloChat enquanto a instância não reconecta.

### Causa-raiz
Confirmado em 2026-06-03: problema no proxy do provedor WhatsApp. O backend do
ZeloChat estava respondendo, mas as chamadas de conexão/QR/envio para a
infraestrutura do provedor não completavam corretamente.

Observação importante: `/api/healthz` **não diagnostica WhatsApp**. Ele só
prova que o backend Express do ZeloChat responde HTTP e deve continuar simples,
sem autenticação, sem banco e sem chamadas ao provedor.

### Fix
Não havia correção estrutural a fazer no ZeloChat para o proxy do provedor. O
ajuste local foi apenas de resiliência/copy: timeout de QR mantém a tela em
tentativa automática e não expõe detalhes técnicos ao operador —
`server/whatsapp.ts:674`, `src/components/views/SettingsView.tsx:188`.

### Recovery
1. Confirmar no dashboard/logs do provedor se há incidente/proxy instável.
2. Se ficar em `connecting` por mais de 60s, rode no container do backend:
   `npx tsx scripts/diagnose-webhooks.ts` para checar instância upstream,
   webhook registrado e reachability pública.
3. Não usar `/api/healthz` como evidência de saúde do WhatsApp; ele pode estar
   verde enquanto o proxy do provedor está fora.
4. Se a instância não existir mais upstream ou estiver com nome divergente,
   seguir o bloco "Whatsmiau renomeou as instâncias upstream".

---

## I. POST `/webhook/:instance` retorna 405

### Sintoma
- Dashboard do Whatsmiau ("Webhook Logs") mostra entrega com **HTTP 405**.
- `docker logs <backend>` mostra **zero** linhas `[WebhookTrace] received`.
- `curl -X POST https://chat.zelopdv.com.br/webhook/foo` retorna HTML com
  `nginx/1.27.5 — 405 Not Allowed`.
- Mensagens manuais saem (outbound OK).

### Causa-raiz
Traefik (proxy edge) só tem regras pra `/api/*` e `/ws/*` apontando pro
container do Express. Tudo que não casa cai na regra catch-all `Host(...)` →
container nginx (frontend SPA), que retorna 405 em POST porque o `location /`
do nginx só serve `try_files` (GET).

### Como confirmar em 30s
```bash
curl -sI -X POST https://chat.zelopdv.com.br/webhook/test
# Procure por: "server: nginx/..." e "HTTP/2 405"
# Se vier nginx, a request NÃO chegou no Express.
```

### Recovery (durável — feito 2026-05-22)

1. **Dokploy DB**: existe uma row em `public.domain` por path-prefix. Adicione
   uma pra `/webhook` espelhando a do `/api`:
   ```sql
   INSERT INTO domain (
     "domainId", host, https, port, path, "createdAt", "applicationId",
     "certificateType", "internalPath", "stripPath", "domainType"
   ) VALUES (
     '<nanoid-21>', 'chat.zelopdv.com.br', true, 3001, '/webhook',
     '<iso-now>', '<backend-applicationId>', 'letsencrypt', '/', false, 'application'
   );
   ```
   `applicationId` do backend hoje: `7OMY4wjXU_ZsvihBZ8uNP` (confira via
   `SELECT "domainId", path, "applicationId" FROM domain WHERE host LIKE '%zelopdv%';`).
2. Dokploy só regenera o YAML do Traefik no próximo deploy, então **suba também
   um override manual imediato** em `/etc/dokploy/traefik/dynamic/zelochat-webhook-route.yml`
   com a regra pronta (já existe no servidor desde 2026-05-22 — verifique se
   ainda está lá). Traefik recarrega arquivos dinâmicos sem restart.
3. Confirme: `curl -X POST https://chat.zelopdv.com.br/webhook/test` deve
   retornar **HTTP 404 com JSON** (Express recebeu — instância não existe),
   nunca mais 405.

### Prevenção
Qualquer rota nova fora de `/api` e `/ws` precisa de uma Domain entry em
Dokploy. Não confie no catch-all do Host.

---

## II. Whatsmiau renomeou as instâncias upstream

### Sintoma
- Outbound OK, inbound silencioso.
- `GET /v2/webhook/find/{nosso_nome}` retorna config correta (URL nossa, token
  certo, enabled=true) — mas mesmo assim **nenhum POST chega**.
- `GET /evolution/instances` lista os mesmos nomes da nossa DB mas **com sufixo
  adicional** (ex: `_d3c6ca80`).
- Algumas instâncias antigas somem completamente da listagem (Donutopia no
  incidente original — retorna 500 em `/v2/webhook/find`).

### Causa-raiz
Whatsmiau (Evolution v2 wrapper) faz migrações internas sem aviso, anexando
sufixos aos nomes de instância. O `/webhook/set` aceita o nome antigo como
alias (e até retorna a config armazenada via `/v2/webhook/find`), mas o
**delivery worker** novo procura webhook só pelo nome novo — encontra nada e
descarta a mensagem silenciosamente. Outbound continua funcionando porque
`/message/sendText/{nome_antigo}` resolve pelo alias.

Já aconteceu uma vez (2026-05-22). Pode repetir.

### Como confirmar em 30s
```typescript
// Dentro do container, em REPL ou tsx:
const r = await axios.get(`${BASE_URL}/evolution/instances`, { headers: { apikey: API_KEY }});
console.log((r.data.data ?? r.data).map(i => i.name ?? i.whatsmiau_instance_id));
// Compare com: SELECT whatsmiau_instance FROM empresa_perfil WHERE whatsmiau_instance IS NOT NULL;
// Se os nomes upstream têm sufixo que a DB não tem → este é o bug.
```

### Recovery

1. Edite `scripts/repair-whatsmiau-instances.ts`, preencha `TARGETS` com
   `{ oldName, newName }` para cada empresa.
2. Dry-run primeiro: `DRY_RUN=1 npx tsx scripts/repair-whatsmiau-instances.ts`.
3. Aplicar: `npx tsx scripts/repair-whatsmiau-instances.ts`.
4. Reiniciar backend (`docker restart <backend>`) pra invalidar o cache do
   `instanceManager` (TTL 60s — restart é instantâneo).
5. `webhook_token` **NÃO PODE** ser regenerado. É o segredo que autentica o
   `?token=...` na URL do webhook. Mantenha estável; o script preserva.

### Prevenção
Não temos. É upstream. O diagnóstico está embutido no `diagnose-webhooks.ts`
(ele compara DB vs `/evolution/instances`).

---

## III. Loop de re-registro de webhook (every 16s)

### Sintoma
- `docker logs <backend>` mostra `[WhatsmiauTrace] register_instance_start` /
  `register_instance_done` em loop infinito pra **uma única instância**, a cada
  ~15-16 segundos.
- Não causa outage por si só — só desperdiça RPC e polui logs.

### Causa-raiz
`POST /api/qr` e `POST /api/qr/refresh` chamam `setWebhookForInstance()` ANTES
de buscar o QR. Se algum frontend está com a tela de QR aberta (operador
desconectado tentando reescanear), ele polla esses endpoints a cada 5-15s →
loop.

### Recovery
Curto prazo: pedir pro operador fechar a tela de QR / reconectar o WhatsApp.

Longo prazo (TODO):
- Mover `setWebhookForInstance()` pra apenas a CRIAÇÃO da instância em
  `instanceManager.createInstance`, não nas chamadas de QR refresh.
- Ou: cachear no `setWebhookForInstance` (ex. throttle 5min por instância)
  pra que polling não vire spam.

---

## IV. Local dev rouba o webhook de prod

### Sintoma
- Backend prod parece estar respondendo (health checks OK), mas inbound não
  chega — apesar da diagnóstico mostrar `Matches expect: NO`.
- A URL registrada no Whatsmiau aponta pra um `*.trycloudflare.com` ou
  `*.localhost.run`.

### Causa-raiz
`server/whatsapp.ts → registerWebhook()` registra a URL pública atual no
startup. Em dev, isso é o tunnel cloudflared do `scripts/tunnel.js`. Se algum
dev rodou `npm run dev:server` apontando o `.env` pra prod, ele sobrescreveu
o webhook de prod.

CLAUDE.md tem a seção "Local dev steals the production webhook" com o fix
recomendado: `WHATSMIAU_DISABLE_WEBHOOK_REGISTER=1` no `.env.local`.

### Recovery
- Curto: redeploy do backend em Dokploy → na inicialização ele chama
  `reRegisterTenantWebhooks()` e restaura a URL correta.
- Médio: garantir que `WHATSMIAU_DISABLE_WEBHOOK_REGISTER=1` está no
  `.env.local` de todo dev.

---

## V. `webhook_token` ausente em alguma empresa

### Sintoma
- `diagnose-webhooks.ts` mostra `Token set: NO` para uma ou mais empresas.
- Pra essas, `reRegisterTenantWebhooks()` no startup **pula** (a query filtra
  `webhook_token IS NOT NULL`).
- Inbound dessa empresa para — webhook fica órfão.

### Causa-raiz
Algum fluxo antigo criou a `empresa_perfil.whatsmiau_instance` sem gerar o
token. Hoje `getOrCreateOwnInstanceForEmpresa` sempre gera, mas instâncias
antigas podem estar sem.

### Recovery
1. Gerar token e gravar:
   ```sql
   UPDATE empresa_perfil
     SET webhook_token = gen_random_uuid()::text
     WHERE id = '<empresa-id>' AND webhook_token IS NULL;
   ```
2. Re-registrar webhook upstream com a nova URL contendo o token:
   ```typescript
   await setWebhookForInstance(instance);
   ```

### Prevenção
Nunca regenere `webhook_token` de uma empresa que já tem um — é o secret do
`?token=` na URL registrada no Whatsmiau, e flipá-lo deixa o webhook órfão até
o próximo `setWebhookForInstance()`.

---

## VI. Dokploy gotcha — appName ↔ service name invertidos

### Não é um bug, é um pé-em-falso recorrente

- Serviço "backend" no Dokploy tem `appName=zelochat-frontend-bl94ow` (sim,
  invertido).
- Serviço "frontend" no Dokploy tem `appName=zelochat-backend-ukztla`.

Ao olhar `/etc/dokploy/traefik/dynamic/*.yml`, **o arquivo `zelochat-frontend-bl94ow.yml`
contém as rotas do Express (porta 3001)** e `zelochat-backend-ukztla.yml` as
rotas do nginx (porta 80). Não tente "consertar" o nome.

---

## Apêndice — comandos de SSH/Docker frequentes

```bash
# Listar containers
docker ps --format '{{.Names}}'

# Logs do backend (lembrar: appName invertido)
docker logs --since=10m <zelochat-frontend-bl94ow.X.YYYY>

# Logs filtrados
docker logs <c> 2>&1 | grep -E 'WebhookTrace|AutoReplyTrace|InboundTrace'

# Conectar no postgres do Dokploy
docker exec -it dokploy-postgres.1.<task-id> psql -U dokploy -d dokploy

# Conferir Traefik dinâmico
cat /etc/dokploy/traefik/dynamic/*.yml

# Restart de um serviço Swarm (não use docker restart; ele cria task nova)
docker service update --force <service-name>
```

Credenciais de SSH e Dokploy estão na auto-memory do agente (`project_dokploy.md`).
