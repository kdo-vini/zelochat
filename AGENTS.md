# ZeloChat

WhatsApp-native customer service platform for Brazilian lanchonetes. All user-facing text, prompts, and seed data are in **Brazilian Portuguese**.

> **Sprint atual / foco do momento:** ler [[CURRENT]] antes de qualquer tarefa.

> **Contexto completo** (arquitetura, banco, API Whatsmiau, funções críticas, deploy): ler **[[CLAUDE]]**. Este arquivo contém apenas o que é específico para agentes Codex. Não duplica o CLAUDE.md — em caso de conflito, CLAUDE.md prevalece.

---

## 📖 Required reading before any non-trivial change

**Read in this order:**

1. **[[CURRENT]]** — sprint atual, o que está em aberto, dívida técnica aceita
2. **[[CODE_REVIEW]]** — auditoria sênior (24 P0 / 47 P1 / 38 P2 / 24 P3)
3. **[[FIXES_PROGRESS]]** — o que foi corrigido, o que está pendente
4. **[[BILLING]]** — runbook Stripe / Asaas
5. **[[INCIDENTS]]** — causas-raiz de outages, recovery steps
6. **[[CLAUDE]]** — regras do projeto, banco compartilhado com ZeloPDV, funções críticas

## Codex memory

Before any deep ZeloChat task, read [[ZeloChat.memory]] first. Keep findings evidence-based and update that memory when the repo's confirmed architecture or risks materially change.

Inline `🚨 CRITICAL` JSDoc-style blocks in the source code mark functions whose breakage has caused — or could cause — a customer-visible outage. Search for that emoji to find them.

---

## Commands

```bash
npm run dev          # Frontend only — Vite on port 3000
npm run dev:server   # Backend only — Express on port 3001
npm run dev:all      # Both concurrently
npm run build        # Production build
npm run lint         # TypeScript type-check (tsc --noEmit)
npm test             # Unit tests (tsx tests/run-unit-tests.ts)
npm run test:e2e     # Playwright e2e tests
```

## Novidades changelog convention

Add to `src/data/changelog.ts` only for meaningful user-facing changes. Max **4 entries/day**.

```ts
{ date: 'YYYY-MM-DD', category: 'big' | 'medium' | 'minor' | 'hotfix', title: 'Título em português', description: '...' }
```

---

## Workflow
- For complex tasks, use subagents for async work and parallelism. Be an orchestrator.
- Never mutate `sessions` state directly — always go through `useWhatsAppSessions` hook.
- Never call AI APIs from React components — always go through `/api/ai/complete`.
- Never expose provider/internal names in customer-facing copy. UI/toasts/API errors consumed by the frontend/Novidades must use friendly Brazilian Portuguese and must not mention `Whatsmiau`, `Stripe`, `OpenAI`, `Supabase`, endpoints, webhooks, upstream, timeouts, or raw technical errors. Keep provider names in logs/runbooks only.
- Never use `/api/healthz` as evidence that WhatsApp/provider/printer integration is healthy, and do not repurpose it. It is only a narrow ZeloChat backend liveness path and must stay simple: no auth, no DB, no provider calls.

## Documentação — convenção AI-first

Toda IA que trabalhar neste repo **deve manter a documentação automaticamente**.

### Após qualquer fix ou feature
- **[[FIXES_PROGRESS]]**: entrada na sprint do dia. Formato: `- ✅ <ID> — <o que era> → <o que foi feito> — \`arquivo:linha\``
- **[[CURRENT]]**: atualizar "Em aberto" se o fix fecha algo listado lá

### Após fix crítico em prod (P0/P1 ou que causou outage visível)
- **[[INCIDENTS]]**: nova entrada com: Sintoma (1 linha), Causa-raiz (1 frase), Fix (1 frase + arquivo:linha)
- Comentário inline na função crítica: `// FIX YYYY-MM-DD: <causa em 1 frase> → <fix em 1 frase>`

### Feature entregue
- Deletar o arquivo de spec da feature (specs são temporários, o código é a verdade)
- Se o comportamento for não-óbvio, documentar em CLAUDE.md ou aqui

### Início de qualquer sessão
1. Ler **[[CURRENT]]** — entender o foco atual
2. Se o foco mudou, atualizar **[[CURRENT]]** antes de começar
3. Para mudanças em funções "Critical functions" no [[CLAUDE]], ler o inline docstring completo antes de tocar

### Regra de ouro
> Documentação que não existe não será lembrada. Se você fez algo não-óbvio, documenta agora — não depois.
