# ZeloMenu — Open Questions

Atualizado em 2026-06-23 (sprint ZLM-204 + ZLM-205-local).

> A decision pass de 2026-06-23 fechou as quatro perguntas originais (D-102 a D-105, ver histórico no fim). A sprint que fechou ZLM-204 e a parte local de ZLM-205 abriu os **bloqueios upstream** e as **dúvidas** abaixo, que precisam de decisão sua / ação no repo ZeloPDV.

## ✅ Bloqueios upstream — RESOLVIDOS no rollout de 2026-06-23

O rollout cross-repo (2026-06-23) fechou os bloqueios 1, 2 e 4 abaixo: migration `zelomenu_entitlement_and_slug_2026_06_23.sql` aplicada no Supabase (slug + has_zelo_menu); prices Stripe v2 criados; ZLM-203 (link público) e a materialização one-way de pedidos (T5) entregues. **Restam só operações manuais (não-código):** (a) setar as envs `STRIPE_PRICE_CHAT`/`STRIPE_PRICE_BUNDLE`→v2 no Dokploy; (b) migrar a assinatura do Agreste pro R$147 com aviso prévio (D-104; CS grandfathered); (c) sync bidirecional de pedidos / cutover de fonte única (próxima fase de ZLM-301) — validar no Donutopia antes. Histórico dos bloqueios abaixo.

## 🔴 Bloqueios upstream (precisam de ação no repo ZeloPDV / Stripe / Dokploy)

Nada disso é executável neste repo (regra de tabela compartilhada do `CLAUDE.md`). Listados em ordem de desbloqueio:

1. **Coluna de slug PDV-owned** (desbloqueia `ZLM-203`, D-102) — criar `empresa_perfil.zelomenu_slug` (TEXT, UNIQUE quando não-NULL) no repo ZeloPDV via workflow de tabela compartilhada, depois puxar o schema de volta pro snapshot do ZeloChat. Sem isso, o menu público por slug (`menu.zelopdv.com.br/{slug}`) não pode começar aqui. **Ação:** abrir issue no repo ZeloPDV.
2. **Flag `has_zelo_menu` + price IDs** (desbloqueia rollout de `ZLM-205`, D-104) — no repo ZeloPDV/Stripe: nascer `has_zelo_menu` PDV-owned e os price IDs novos (`STRIPE_PRICE_CHAT`=R$147, novo `STRIPE_PRICE_BUNDLE`=R$197, novo `STRIPE_PRICE_MENU`=R$40). Só depois o ZeloChat vira a copy de pricing (passo 2 não pode preceder o 1, senão tranca cliente válido). O resolver local (`src/domain/zelomenuEntitlements.ts`) já tem o seam pronto: basta passar o valor de `has_zelo_menu` em `useSubscription`. **Ação:** issue no ZeloPDV + criar price IDs no Stripe + setar envs no Dokploy.
3. **Grandfather/migração de clientes** (parte de `ZLM-205`, D-104/D-017) — Casa dos Salgados pinada na condição atual; **Agreste migrada** para R$147 com aviso prévio (operação na subscription PDV-owned + comunicação). **Ação:** sua, de produto/ops, no momento da virada.
4. **Sync cross-surface de pedidos** (`ZLM-202`/`ZLM-301`, Phase 3) — "aceite numa superfície atualiza a outra" e "PDV puro não vê a tela" dependem do motor comum com `pedidos`/`pedido_itens` PDV-owned. O lado ZeloChat já está coberto pelo paywall. **Ação:** Phase 3, integração no repo ZeloPDV.

## 🟡 Dúvidas de produto abertas nesta sprint

1. **Matching de bairro: estrito vs. fuzzy.** O novo carrinho ZeloMenu (`resolveDeliveryFeeForNeighborhood`) casa bairro por match normalizado **exato** (case/acento-insensitive) e, fora disso, marca "a confirmar". A IA legada do WhatsApp (`server/ai.ts: resolveDeliveryFee`) usa **4 estratégias fuzzy** (prefixo, contém, token >3 chars) e retorna `null` quando não casa. Pergunta: o carrinho ZeloMenu deve adotar o mesmo fuzzy para reduzir "a confirmar" falso (ex.: cliente digita "marfrig 1" e casar com "marfrig")? Hoje aceitei a divergência: o cliente do carrinho escolhe pelo `<datalist>` (exato) ou digita (livre → a confirmar); o fuzzy só vale no fluxo IA legado.
2. **Changelog agora ou no GA?** Não adicionei entrada de Novidades para a entrega por bairro / "taxa a confirmar" porque o fluxo de carrinho ZeloMenu ainda está em piloto (não GA para os operadores). Confirmar se quer anunciar antes do GA.
3. **Unificar o fluxo de entrega legado com o novo.** Com `zelochat_pending_orders` marcado como legado (D-094), o caminho IA→pending-order tem semântica de taxa diferente do carrinho ZeloMenu. A migração para o carrinho deve aposentar a divergência; confirmar se isso é só "esperar a migração" ou se vale unificar antes.

---

## Histórico — perguntas originais fechadas (D-102 a D-105)

## ✅ ZLM-203 — menu público por slug — RESOLVIDO (D-102)

- Fonte canônica de `slug -> empresa/publicação`: **shared/PDV-owned**. A coluna nasce **primeiro no repo ZeloPDV** (workflow de tabela compartilhada); o backend ZeloChat serve a rota `menu.zelopdv.com.br/{slug}` e apenas lê o slug.
- Consequência: `ZLM-203` ficou `Blocked` — depende da coluna de slug existir no repo ZeloPDV antes de qualquer código aqui.
- Ainda real (escopo de implementação, não decisão): bootstrap de `public_order`, rota pública de loja por slug e resolução slug→empresa em cima do runtime de token existente.

## ✅ ZLM-205 — billing, planos e entitlements — RESOLVIDO (D-103, D-104)

- Entitlement (`has_zelo_menu`): PDV-owned, nasce no repo PDV. Neste repo, resolver read-only sobre `chat`/`bundle` (D-014) OU `has_pedidos_addon` legado, fail-safe ON, seam único para a flag nova (D-103).
- Rollout: ordem entitlement-antes-de-copy + grandfather; price IDs por env (`chat`=R$147, `bundle`=R$197, novo `menu`=R$40) (D-104).
- Clientes existentes: Casa dos Salgados grandfathered (D-017); Agreste migrada para R$147 com aviso prévio (D-104).

## ✅ Storage de imagem owned — RESOLVIDO (D-105)

- Mantém o bridge `logos` + prefixo `zelomenu-products/{userId}/...` no v1; revisitar bucket dedicado só quando `ZLM-203` abrir imagens para a superfície pública por slug.

## Teste conhecido fora do escopo

- `npm test` continua falhando só em `tests/auditFixGuardrails.test.ts` por drift do nome de rollout do webhook (`WEBHOOK_ALLOW_MISSING_TOKEN_DURING_ROLLOUT` vs `WEBHOOK_REQUIRE_TOKEN`).
