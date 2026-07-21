# Landing — narrativa ZeloChat + ZeloMenu (cirúrgica) + preço 149/198

**Data:** 2026-07-21
**Escopo:** copy da landing pública + SEO/meta + preço. Sem mudança estrutural de seções.

## Problema

A landing inteira ainda vende o motor antigo: "a IA fecha o pedido sozinha",
"IA pega o pedido", "monta o pedido e fecha", "Pedidos direto pelo chat". Isso
contradiz o sistema real desde o cutover ZLM-310 / D-106: a IA **não monta
pedido** — o cliente pede no ZeloMenu (cardápio online, incluso no plano) e a IA
orienta, manda o link, acompanha status, confere PIX e dá suporte pós-venda.

Além disso o preço está inconsistente: `pricing.ts` = R$147, mas `Hero`,
`BottomCTA` e `MobileStickyCTA` têm "R$97" hard-coded; `index.html` e `llms.txt`
também dizem R$97; `llms.txt` diz bundle R$127.

## Decisões (aprovadas)

1. **Profundidade:** cirúrgica — trocar só a copy falsa e encaixar o ZeloMenu;
   manter estrutura de seções.
2. **Visual do Hero (ChatPreview) e mini-visuais dos cards:** refazer para mostrar
   a IA mandando o link do cardápio + pedido caindo no painel. Mantém o beat de
   PIX validado.
3. **Ângulo iFood:** incluir "cardápio próprio, sua venda, sem comissão de
   aplicativo".
4. **PIX:** a IA ainda lê comprovante PIX no WhatsApp — manter esse recurso.
5. **Preço:** ir para **R$149 (chat, ZeloMenu incluso) / R$198 (bundle com ZeloPDV)**
   agora. Fonte única = `src/data/pricing.ts`. Hero/BottomCTA/MobileStickyCTA
   passam a LER de `pricing.ts` em vez de hard-code.

## Espinha narrativa

ZeloChat atende no WhatsApp na hora e **leva o cliente pro seu cardápio online
(ZeloMenu, incluso)**. O pedido nasce no cardápio e cai no painel/kanban. A IA
acompanha status, confere PIX e avisa o cliente. Cardápio próprio → venda 100%
da loja, sem comissão de marketplace.

## Arquivos a mudar

- `src/data/pricing.ts` — chat 149, bundle 198 + atualizar comentário.
- `src/components/landing/Hero.tsx` — subtítulo (tira "fecha o pedido"); preço via `PRICING`.
- `src/components/landing/ChatPreview.tsx` — visual refeito (link do cardápio + painel).
- `src/components/landing/HowItWorks.tsx` — passo 2 vira "responde e manda o link"; passo "cliente monta no cardápio".
- `src/components/landing/FeaturesGrid.tsx` — card 1 + `ChatFlowVisual` refeitos; ângulo canal próprio.
- `src/components/landing/IntegrationStrip.tsx` — "Pedidos direto pelo chat" → "Cardápio online próprio (ZeloMenu incluso)".
- `src/components/landing/FAQ.tsx` — Q1 reescrita; +2 FAQs (cardápio incluso? / integra iFood?).
- `src/components/landing/Pricing.tsx` — lista INCLUDED reescrita.
- `src/components/landing/BottomCTA.tsx` — copy + preço via `PRICING`.
- `src/components/landing/MobileStickyCTA.tsx` — preço via `PRICING`.
- `src/components/landing/Footer.tsx` — descrição.
- `src/components/landing/Testimonials.tsx` — toque leve nos depoimentos que afirmam a IA montando pedido no chat.
- `index.html` — title/meta/OG/Twitter/JSON-LD (SoftwareApplication offer price, featureList, FAQPage Q1, HowTo passo 2) → narrativa + 149.
- `public/llms.txt` — descrição do produto + preço 149 + bundle 198.

## Fora de escopo (flag para o Vinicius, não mexo nesta leva)

- **Stripe:** criar os prices 149/198 e apontar `STRIPE_PRICE_CHAT`/`STRIPE_PRICE_BUNDLE`
  no Dokploy no MESMO deploy. Sem isso, o site mostra 149 e o checkout cobra outro valor.
- `server/onboardingEmailTemplates.ts` — e-mails de onboarding dizem R$97 e "a IA pega o pedido" (customer-facing, mesma dívida). Sugerir corrigir depois.
- `CLAUDE.md` §Billing e docs internos — dizem R$97; drift interno.
- Changelog: **não** entra (convenção: ajuste de copy de landing não vira novidade).

## Validação

- `npm run lint` (tsc --noEmit) limpo.
- `npm run build` passa.
- Grep final: nenhum "R$97", "fecha o pedido", "pega o pedido", "Pedidos direto pelo chat" na superfície da landing.
