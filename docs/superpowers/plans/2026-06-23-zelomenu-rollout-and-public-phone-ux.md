# ZeloMenu Rollout Status + Public Phone UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** consolidar o status real do rollout comercial do ZeloMenu e corrigir a UX do WhatsApp no menu público com máscara, validação e toasts visuais.

**Architecture:** a documentação canônica fica em `ZELOMENU_LINEAR_PLAN.md`, separando claramente entregue, parcial e pendente, inclusive o que pertence ao repo ZeloPDV. A implementação neste repo fica restrita à jornada pública do ZeloMenu (`ZeloMenuStorePage` / `ZeloMenuCartPage`), reaproveitando o `ToastProvider` já existente e sem criar backend novo.

**Tech Stack:** React, TypeScript, react-router-dom, contexto de toast interno, docs Markdown.

---

### Task 1: Consolidar status do rollout no Linear doc

**Files:**
- Modify: `ZELOMENU_LINEAR_PLAN.md`
- Modify: `FIXES_PROGRESS.md`

- [ ] Mapear no plano o que já foi entregue em billing/entitlements/publicação/menu público.
- [ ] Registrar explicitamente o restante:
  - limpeza comercial de Pedidos/Cozinha legado
  - páginas `/assinatura` e `/extensoes` no repo ZeloPDV
  - compra do módulo como addon separado do PDV
  - migração/grandfather operacional
- [ ] Adicionar um to-do consolidado de rollout com ownership por repo.

### Task 2: Corrigir o campo de WhatsApp no menu público

**Files:**
- Modify: `src/pages/ZeloMenuStorePage.tsx`
- Optional create: `src/domain/phoneFormatting.ts`

- [ ] Aplicar sanitização estrita: somente números.
- [ ] Limitar a 11 dígitos locais.
- [ ] Exibir máscara enquanto digita.
- [ ] Continuar enviando para a API apenas os dígitos limpos.

### Task 3: Trocar mensagens inline da jornada pública por toasts

**Files:**
- Modify: `src/pages/ZeloMenuStorePage.tsx`
- Modify: `src/pages/ZeloMenuCartPage.tsx`

- [ ] Substituir mensagens inline de erro/aviso/confirmação da jornada por `useToast()`.
- [ ] Manter mensagens de estado estrutural de página apenas quando fizer sentido (ex.: falha fatal ao carregar página sem payload).
- [ ] Garantir copy em PT-BR e foco mobile.

### Task 4: Validar e documentar

**Files:**
- Modify: `CURRENT.md`
- Modify: `FIXES_PROGRESS.md`
- Modify: `docs/ai/ZeloChat.memory.md` (somente se a arquitetura/risco confirmado mudar)

- [ ] Rodar `npm run lint`.
- [ ] Rodar `npm run build`.
- [ ] Atualizar docs vivos com o que mudou neste repo e o que continua pendente no repo ZeloPDV.
