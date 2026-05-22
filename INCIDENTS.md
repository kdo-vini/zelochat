# Incidentes e padrões conhecidos

Knowledge base de causas-raiz já vistas em produção. Use como **primeira parada**
quando algo quebra antes de abrir um ticket pro Whatsmiau, antes de subir um fix,
antes de re-deployar. Mantenha vivo — cada outage novo vira uma entrada aqui.

> Triagem rápida em 5 segundos: olhe o "Sintoma" de cada bloco, encontre o mais
> próximo do que você está vendo, leia a "Diagnose" e siga a "Recovery".

---

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
