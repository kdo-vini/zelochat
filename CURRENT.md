# ZeloChat — Foco atual

> Atualizar a cada sprint/sessão. Leitura rápida para agentes de IA antes de qualquer tarefa.
> Docs detalhados: [[CLAUDE]] · [[FIXES_PROGRESS]] · [[AI_BACKEND_ROADMAP]]

---

## Estado do produto (2026-05-31)

- **2 cliente pagante:** Casa dos Salgados, Agreste Salgados
- **1 founder test:** Donutopia
- **Infra:** Dokploy em VPS, deploy automático no push para `main`
- **Audit:** P0 100% ✅ · P1 94% ✅ · P2 63% · P3 21%

## Em aberto

- `IMAGE_VAULT_BRAINSTORM.md` — feature de vault de imagens: brainstorm feito, **não iniciada**
- P2.1 — `alert()` nativo trocado por toast em `ProfileView.tsx:191` ✅
- Áudio — captura de `durationSeconds` do webhook implementada ✅

## Próximas fatias recomendadas

Ver [[AI_BACKEND_ROADMAP]] para backlog priorizado. Fatias sugeridas:
1. Áudio (PTT) na IA — envio automático de mensagens de voz
2. Estados vazios — telas sem dados precisam de empty states
3. Polimentos P2/P3 — ver [[FIXES_PROGRESS]]

## Decisões recentes

- Convenção de documentação AI-first adicionada ao CLAUDE.md (2026-05-31)
- AbacatePay Pix adicionado ao lado do Stripe (2026-05-21)
- Grace period de 14 dias para deleção de conta (LGPD)
- Figurinhas recebidas renderizadas como imagem
- Banner "nova versão disponível" corrigido para disparar em prod
