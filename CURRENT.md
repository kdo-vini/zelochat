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
- `server/router.ts:806` / `tests/auditFixGuardrails.test.ts` — drift de webhook auth: docs/teste esperam `WEBHOOK_ALLOW_MISSING_TOKEN_DURING_ROLLOUT`, mas o código atual usa `WEBHOOK_REQUIRE_TOKEN` como strict opt-in e aceita token ausente por padrão para instância conhecida
- `npm run build` — aviso de chunk >500 kB voltou; maior chunk app atual `index-BgmHYe4Y.js` = 569.66 kB / 162.59 kB gzip (ver [[DEV_SETUP]])
- Dependências antigas — `npm audit` limpo após remover `localtunnel`; majors ainda pendentes exigem migração dedicada (`express@5`, `vite@8`, `stripe@22`, `typescript@6`, etc.; ver [[DEV_SETUP]])

## Dívida técnica aceita (conhecido, não prioritário)

Issues identificados, avaliados, e **explicitamente aceitos** por ora. Uma IA não deve re-investigar nem criar urgência em torno deles sem nova evidência.

| Item                                                     | Por que aceito                                                                                                              | Revisar quando                                              |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| P2.25 — foto de perfil expira sem refresh                | Atualiza naturalmente no próximo `CONTACTS_UPSERT`; impacto visual baixo                                                    | Reclamação de cliente ou infra de cache disponível          |
| ~~P1.13 — Whatsmiau continua cobrado após cancelamento~~ | **RESOLVIDO** — `subscriptionSweeper.ts` deleta instância após 7 dias de grace (provider-agnostic: Stripe + AbacatePay/Pix) | —                                                           |
| P1.4 — instance names aparecem em logs                   | Auth boundary é o sufixo de 64 bits, não o nome; logs são internos                                                          | Logs ficarem públicos ou acessíveis externamente            |
| `dailyContext` sem `safeForPrompt`                       | Operador controla o próprio `dailyContext`; risco de prompt injection é auto-infligido                                      | Multitenancy expandir ou campo virar editável por terceiros |

## Próximas fatias recomendadas

Ver [[AI_BACKEND_ROADMAP]] para backlog priorizado. Fatias sugeridas:
1. Áudio (PTT) na IA — envio automático de mensagens de voz
2. Estados vazios — telas sem dados precisam de empty states
3. Polimentos P2/P3 — ver [[FIXES_PROGRESS]]

## Decisões recentes

- Botão "Atualizar agora" agora depende de headers `no-store` no shell SPA e limpa `?appVersion=...` após carregar; assets Vite hashados continuam em cache longo (2026-06-01)
- Comportamento geral da IA documentado no Obsidian: confirmações, observações, pending orders, hard buttons, emojis e estoque agora têm suíte determinística (`tests/aiTurnDecision.test.ts`) antes do prompt (2026-06-01)
- Estoque agora é regra operacional da IA: produto com `controlar_estoque=true` e `estoque_atual<=0` sai do cardápio da IA; pedido acima do estoque é bloqueado antes de abrir pendência (2026-06-01)
- P1.13 fechado: grace period 7 dias para instâncias Whatsmiau após cancelamento de assinatura; provider-agnostic (Stripe + AbacatePay/Pix); auto-criação de instância ao renovar já funciona via `/api/qr` (2026-05-31)
- Convenção de documentação AI-first adicionada ao CLAUDE.md (2026-05-31)
- AbacatePay Pix adicionado ao lado do Stripe (2026-05-21)
- Grace period de 14 dias para deleção de conta (LGPD)
- Figurinhas recebidas renderizadas como imagem
- Banner "nova versão disponível" corrigido para disparar em prod
- Review de warnings/dependências: `localtunnel` removido porque `scripts/tunnel.js` já usa cloudflared; `npm audit --audit-level=low` agora retorna 0 vulnerabilidades; pendências documentadas em [[DEV_SETUP]] (2026-06-01)
