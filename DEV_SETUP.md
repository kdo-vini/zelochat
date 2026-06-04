# DEV_SETUP.md — ZeloChat

Guia de configuração do ambiente Linux de desenvolvimento para o projeto ZeloChat.

---

## Stack do Projeto

| Camada | Tecnologia |
|---|---|
| Frontend | React 19 + Vite 6 + TypeScript |
| Backend | Express + TypeScript (`server/`) via `tsx` |
| CSS | Tailwind CSS **4** (plugin Vite nativo — sem `tailwind.config.js`) |
| Banco / Auth | Supabase (cloud) |
| Pagamentos | Stripe |
| IA | OpenAI |
| Email | Resend |
| WhatsApp | WhatsMiau API |
| Testes E2E | Playwright |
| Deploy | Dokploy/Fly/Render — Docker (`node:20-alpine`) |
| Package manager | npm |

**Arquitetura:** monorepo simples com frontend React e backend Express no mesmo repositório. Em dev, rodam em processos separados (portas 3000 e 3001).

---

## Requisitos do Sistema

- **Node.js**: `20.x` (definido em `.nvmrc` e no `FROM node:20-alpine` do Dockerfile)
- **npm**: `10.x` (incluído com Node 20)
- **NVM**: para gerenciar versões Node

---

## Configuração Inicial (uma vez por máquina)

### 1. Pacotes de sistema (se ainda não instalados)

```bash
sudo apt-get install -y git build-essential
```

### 2. Ativar Node 20 via NVM

```bash
source ~/.bashrc   # carrega NVM
nvm use 20         # ou apenas abra um terminal novo
node --version     # deve mostrar v20.x.x
```

### 3. Instalar dependências

```bash
cd /home/vinicius/code/zelochat
npm install
```

### 4. Playwright browsers (para E2E)

```bash
npx playwright install chromium
sudo npx playwright install-deps chromium   # system libs
```

---

## Variáveis de Ambiente

### Frontend (`.env.local` — lido pelo Vite)

| Variável | Descrição |
|---|---|
| `VITE_SUPABASE_URL` | URL pública do Supabase |
| `VITE_SUPABASE_ANON_KEY` | Anon key pública |

### Backend (`.env` — lido por `dotenv/config` no `server/index.ts`)

> **ATENÇÃO:** O arquivo `.env.local` existe mas o servidor Express lê `.env`.
> Crie um `.env` na raiz com as variáveis abaixo.

| Variável | Obrigatória | Descrição |
|---|---|---|
| `SUPABASE_URL` | Sim | URL do projeto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Sim | Service role key (backend) |
| `OPENAI_API_KEY` | Sim | API key da OpenAI |
| `STRIPE_SECRET_KEY` | Sim | Secret key do Stripe |
| `STRIPE_WEBHOOK_SECRET` | Sim | Secret para verificar webhooks |
| `STRIPE_BILLING_PORTAL_CONFIGURATION_ID` | Sim | ID do portal de billing |
| `STRIPE_PRICE_PDV` | Sim | Price ID do plano |
| `RESEND_API_KEY` | Sim | API key do Resend |
| `EMAIL_FROM` | Sim | Email remetente |
| `WHATSMIAU_API_KEY` | Sim | API key WhatsMiau |
| `WHATSMIAU_BASE_URL` | Sim | URL base da API WhatsApp |
| `WHATSMIAU_INSTANCE` | Sim | ID da instância WhatsApp |
| `ZELOCHAT_INTERNAL_API_KEY` | Sim | Key interna para autenticação entre serviços |
| `FRONTEND_URL` | Sim | URL do frontend (CORS) — `http://localhost:3000` em dev |
| `PUBLIC_APP_URL` | Sim | URL pública do app |
| `SERVER_PORT` | Não | Porta do backend (default: `3001`) |
| `WEBHOOK_PUBLIC_URL` | Não | URL pública para webhook (gerada pelo cloudflared em dev) |
| `TECHNE_EMPRESA_ID` | Não | ID da empresa Techne (integração interna) |
| `TECHNE_INTERNAL_API_KEY` | Não | Key da integração Techne |
| `CRON_SECRET` | Não | Secret para validar chamadas de cron |

---

## Comandos de Desenvolvimento

### Rodar tudo junto (recomendado)
```bash
npm run dev:all
# Inicia: cloudflared (webhook) + backend Express + frontend Vite
```

### Serviços separados
```bash
npm run dev          # Frontend apenas (porta 3000)
npm run dev:server   # Backend apenas (porta 3001, com hot-reload via tsx)
npm run dev:tunnel   # Túnel cloudflared para webhook WhatsApp
```

### Build de produção
```bash
npm run build        # Build do frontend (Vite → dist/)
```

### TypeScript check
```bash
npm run lint         # tsc --noEmit — verifica tipos sem compilar
```

### Testes
```bash
npm run test:unit    # Testes unitários
npm run test:e2e     # Playwright E2E
npm run test:e2e:ui  # Playwright com UI interativa
```

---

## Estado do Ambiente (após setup)

| Item | Status | Detalhe |
|---|---|---|
| Node.js | OK | v20.20.2 via NVM |
| npm | OK | v10.8.2 |
| node_modules | OK | 211 pacotes |
| TypeScript check | OK | `tsc --noEmit` sem erros |
| Build frontend | OK | `✓ built in 3.88s` |
| `.nvmrc` | OK | Criado com `20` |
| `.env` (servidor) | PENDENTE | Criar com vars do backend |
| Playwright system deps | PENDENTE | `sudo npx playwright install-deps chromium` |

---

## Vulnerabilidades npm

Review em 2026-06-01:

- `npm audit --audit-level=low`: **0 vulnerabilidades**.
- O audit anterior acusava 2 HIGH via `localtunnel -> axios@0.21.4`. `localtunnel` era dependência de dev não usada: `scripts/tunnel.js` já usa `cloudflared`. O pacote foi removido em 2026-06-01.
- `npm audit --omit=dev --audit-level=low`: **0 vulnerabilidades** antes e depois da remoção.

---

## Dependências desatualizadas

Levantamento em 2026-06-01 via `npm outdated --long`.

Atualizações patch/minor dentro do range atual, candidatas para uma rodada curta com regressão:

| Pacote | Atual | Wanted/Latest |
|---|---:|---:|
| `@supabase/supabase-js` | 2.106.1 | 2.106.2 |
| `date-fns` | 4.2.1 | 4.4.0 |
| `openai` | 6.38.0 | 6.40.0 |
| `react` / `react-dom` | 19.2.6 | 19.2.7 |
| `react-router-dom` | 7.15.1 | 7.16.0 |
| `tsx` | 4.22.3 | 4.22.4 |
| `vite` | 6.4.2 | 6.4.3 |
| `ws` | 8.20.1 | 8.21.0 |

Majors pendentes. Não atualizar em massa sem tarefa dedicada:

| Pacote | Atual | Latest | Nota |
|---|---:|---:|---|
| `express` / `@types/express` | 4.22.2 / 4.17.25 | 5.2.1 / 5.0.6 | Migração de middleware/typing e rotas. |
| `vite` / `@vitejs/plugin-react` | 6.4.2 / 5.2.0 | 8.0.16 / 6.0.2 | Validar build Docker/nginx e plugins Tailwind. |
| `stripe` | 17.7.0 | 22.2.0 | Billing crítico; revisar contrato SDK e runbook. |
| `pino` | 9.14.0 | 10.3.1 | Validar serializadores/redaction/log shape. |
| `typescript` | 5.8.3 | 6.0.3 | Pode exigir ajustes de tipos. |
| `lucide-react` | 0.546.0 | 1.17.0 | Risco baixo, mas validar nomes de ícones/imports. |
| `@types/node` | 22.19.19 | 25.9.1 | Projeto roda Node 20; manter types 22 até mudar runtime. |

---

## Aviso de Build

```
(!) Some chunks are larger than 500 kB after minification.
```

Review em 2026-06-01: `npm run build` passa, mas o aviso voltou.

- Maior chunk app: `dist/assets/index-BgmHYe4Y.js` com **569.66 kB** (**162.59 kB gzip**).
- Maior vendor chunk: `supabase-vendor` com **210.50 kB** (**54.55 kB gzip**).
- `vite.config.ts` já separa React, motion, Supabase, lucide e dnd via `manualChunks`; o excesso atual está no código da aplicação.
- Não é risco de segurança nem bloqueia deploy, mas desfaz o estado "sem aviso de chunk grande" registrado na Sprint 42. Próximo passo pragmático: investigar code-split adicional no shell/chat ou orçamento explícito de chunk.

---

## Warnings de teste conhecidos

Review em 2026-06-01: `npm test` roda a suíte inteira e falha em **1 guardrail estático**:

```text
tests/auditFixGuardrails.test.ts
FAIL webhook has explicit rollout bypass name
```

Diagnóstico: `tests/auditFixGuardrails.test.ts` e docs de Sprint 58 esperam o env `WEBHOOK_ALLOW_MISSING_TOKEN_DURING_ROLLOUT`, mas `server/router.ts` hoje usa `WEBHOOK_REQUIRE_TOKEN` como strict opt-in e aceita token ausente para instância conhecida quando esse env não está ativo. Isso toca `/webhook/:instance`, uma função crítica; não corrigir silenciosamente sem decidir se a postura correta é:

- restaurar fail-closed por padrão com bypass explícito; ou
- atualizar docs/testes para assumir strict opt-in por `WEBHOOK_REQUIRE_TOKEN`.

---

## Estrutura do Projeto

```
zelochat/
├── src/                    # Frontend React
│   ├── components/         # Componentes UI
│   ├── pages/              # Páginas (react-router-dom)
│   └── lib/                # Utilitários e clientes
├── server/                 # Backend Express + TypeScript
│   ├── index.ts            # Entry point (porta 3001)
│   ├── router.ts           # Rotas HTTP
│   ├── whatsapp.ts         # Integração WhatsMiau
│   ├── ai.ts               # Integração OpenAI
│   ├── billing.ts          # Stripe
│   └── supabase.ts         # Cliente Supabase admin
├── supabase/
│   └── migrations/         # SQL migrations do Supabase
├── tests/                  # Testes unitários (tsx)
├── e2e/                    # Testes Playwright
├── scripts/
│   └── tunnel.js           # cloudflared para dev webhook
├── Dockerfile              # Backend (node:20-alpine)
├── Dockerfile.frontend     # Frontend (nginx)
├── .nvmrc                  # Node version: 20
├── .env.local              # Vars do Vite (SUPABASE públicas)
└── .env                    # Vars do servidor — CRIAR LOCALMENTE
```

---

## Diferenças em relação ao zelopdv

| Aspecto | zelopdv | zelochat |
|---|---|---|
| Framework | SvelteKit 5 | React 19 |
| Tailwind | v3 (config JS) | **v4** (plugin Vite nativo) |
| Backend | Supabase cloud only | Express próprio (`server/`) |
| Linguagem | JavaScript | **TypeScript** |
| Deploy | Vercel | Dokploy / Docker |
| WhatsApp | via zelochat API | direto (WhatsMiau) |

---

## Melhorias Futuras

- [ ] Criar `.env.example` com todas as variáveis do servidor (sem valores)
- [ ] Mover `VITE_SUPABASE_*` do `.env.local` para `.env` (unificar arquivos de env)
- [ ] Adicionar `engines: { node: "20.x" }` ao `package.json`
- [ ] Planejar migração dos majors pendentes (`express@5`, `vite@8`, `stripe@22`, `typescript@6`) em tarefas separadas
- [ ] Investigar code-split adicional para remover o aviso de chunk >500 kB
- [ ] Considerar `tsx watch` com `--env-file=.env` quando Node 20.6+ for garantido (elimina `dotenv`)

---

*Atualizado em: 2026-06-01 | Node: v20.20.2 | npm: v10.8.2 | NVM: v0.40.3*
