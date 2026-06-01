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
- `ai.ts:1778` — bug latente: query usa status `'dispatched'` (inexistente no DB) em vez de `'out_for_delivery'` → pedidos em entrega nunca aparecem no contexto da IA
- `supabase/migrations/014_zelochat_rls_hardening.sql` — ainda marcado `DRAFT`, não aplicado em prod

## Dívida técnica aceita (conhecido, não prioritário)

Issues identificados, avaliados, e **explicitamente aceitos** por ora. Uma IA não deve re-investigar nem criar urgência em torno deles sem nova evidência.

| Item | Por que aceito | Revisar quando |
|---|---|---|
| P2.25 — foto de perfil expira sem refresh | Atualiza naturalmente no próximo `CONTACTS_UPSERT`; impacto visual baixo | Reclamação de cliente ou infra de cache disponível |
| P1.13 — Whatsmiau continua cobrado após cancelamento | Requer `deleteInstance` no webhook de cancelamento do Stripe; baixo volume atual | Churn aumentar ou custo Whatsmiau virar linha relevante |
| P1.4 — instance names aparecem em logs | Auth boundary é o sufixo de 64 bits, não o nome; logs são internos | Logs ficarem públicos ou acessíveis externamente |
| Stock availability não enforced na IA | IA pode sugerir produto sem estoque; dono corrige manualmente; fix requer coordenação com ZeloPDV (schema deles) | Reclamação frequente de pedido de produto esgotado |
| `dailyContext` sem `safeForPrompt` | Operador controla o próprio `dailyContext`; risco de prompt injection é auto-infligido | Multitenancy expandir ou campo virar editável por terceiros |

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
