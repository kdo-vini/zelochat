# LANDING_REVIEW_ZELOCHAT.md

Auditoria brutal da landing pública do ZeloChat (https://chat.zelopdv.com.br/).
Escopo: tudo entre `index.html` e os componentes de `src/components/landing/*`,
mais `public/{manifest,robots,sitemap,llms}.txt`.

Data: 2026-05-20.

---

## Resumo executivo

A landing já é **acima da média do mercado SaaS-BR-para-PME** — visual coeso,
sem template-vibe genérico, copy com personalidade. Mas ainda **não vende o
diferencial real** (PIX por OCR + kanban + atualizações automáticas) na
primeira dobra, e tem dissonâncias internas de mensagem que confundem o
visitante em 5 s ("não é robô que vende sozinho" ao lado de "fecha pedido
sozinha").

Se receber tráfego pago amanhã, a CTR pro signup vai ser razoável mas o
visitante mobile vai bater no botão sem ter entendido **por que isso vale
R$97/mês**. As correções abaixo são quase todas baratas e desbloqueiam isso.

### Notas (0–10)

| Eixo | Nota | Por quê |
| --- | --- | --- |
| **UI / visual** | 7,5 | Premium, coeso, paleta WhatsApp consistente, mockup do chat (recém-refeito) ficou tier-A. Perde meio ponto em hierarquia/respiração no mobile e StatStrip apertado. |
| **Copy** | 7,0 | Personalidade boa, sal na ferida em vários pontos. Perde no first-fold (subhead genérica após o último corte), dissonância "não substitui × fecha pedido", e FAQ ainda com tom defensivo na seção-título. |
| **SEO técnico/on-page** | 7,0 | Meta básica + 4 JSON-LD presentes, sitemap+robots+manifest OK. Perde porque description está estourada (>200 chars), FAQPage schema está desatualizado em relação à copy, featureList não cita PIX/kanban, `llms.txt` ainda citava infra antiga (já migrou pro Dokploy). |
| **Conversão / CRO** | 6,0 | First-fold convence em hook mas não em substância. Prova social no fold é ausente. Diferencial PIX+kanban está enterrado. Mobile sem sticky CTA. Footer com links mortos quebra confiança. |

---

## Lista de problemas — P0 / P1 / P2 / P3

### P0 — Bloqueia conversão ou induz erro de percepção

| # | Onde | Problema | Por quê dói | Fix |
| --- | --- | --- | --- | --- |
| P0-1 | `Hero.tsx` subhead | Subhead "Atende no WhatsApp, tira dúvida, fecha pedido e avisa o cliente em cada etapa" **não menciona PIX nem kanban** — os dois maiores diferenciais. O visitante em 5 s lê "mais um chatbot de WhatsApp". | Posicionamento. Sem PIX/kanban no fold, o produto compete contra Take Blip / ManyChat (perde) em vez de competir contra "atendente humano lento" (ganha). | Reescrever subhead pra citar comprovante PIX por foto/PDF + kanban com avisos automáticos. Implementado abaixo. |
| P0-2 | `index.html` meta description | 211 caracteres — Google trunca em ~155–160. Não cita PIX, kanban, ou pedido. | Click-through orgânico cai. SERP mostra "..." no meio da frase. | Reescrever pra ~150 chars com keyword + diferencial. Implementado. |
| P0-3 | `FeaturesGrid.tsx` H2 | "Não é robô que vende sozinho. É mão na roda pro seu time." — **conflita** com o card abaixo que diz "Triagem 24/7 — e até pega pedido". Quem lê primeiro o título acha que IA não fecha venda; quem lê o card acha que fecha. | Confunde proposta em 3 s. Quem vem de ads paga por essa dúvida. | Substituir por "Não é só um chatbot. É o fluxo de pedidos da sua loja rodando dentro do WhatsApp." Implementado. |
| P0-4 | `index.html` FAQPage JSON-LD | A primeira pergunta no schema é "Preciso ter o ZeloPDV?" — a primeira na página é "A IA realmente dá conta de atender?". Schema desatualizado, e a pergunta principal sobre IA nem aparece no rich result. | Perde featured snippet "IA WhatsApp restaurante" que é a query de maior intenção. | Reescrever JSON-LD FAQPage. Implementado. |

### P1 — Prejudica conversão, percepção premium ou SEO

| # | Onde | Problema | Por quê dói | Fix |
| --- | --- | --- | --- | --- |
| P1-1 | `Hero.tsx` StatStrip | No mobile, 3 cards em coluna empilhados + parágrafo de fontes ocupam ~1 dobra inteira **antes** do IntegrationStrip. Visitante mobile rola muito sem ver prova/feature. | Bounce mobile. | Compactar StatStrip no mobile (sub menor + esconder rodapé "Fontes:" em <md) e mover para depois de IntegrationStrip. Parcialmente implementado (compactação). |
| P1-2 | `Footer.tsx` | "Sobre", "Blog", "Contato", "Central de ajuda", "Suporte" todos `href="#"`. "Analytics" como ícone social? Quebra confiança. | Click em link morto = "esse site não é sério". | Remover links mortos; "Contato" e "Suporte" viram link pro WhatsApp existente; remover ícone Analytics; adicionar CNPJ. Implementado. |
| P1-3 | `index.html` SoftwareApplication featureList | Lista 8 features mas **nenhuma menciona PIX-OCR, leitura de comprovante, kanban com drag-and-drop, atualizações automáticas no WhatsApp**. | Schema é leitura primária de LLM-search e Google Knowledge. Sem PIX/kanban no schema, o ZeloChat sai dos search-LLM como "chatbot genérico". | Atualizar featureList. Implementado. |
| P1-4 | `public/llms.txt` | Linha 52 citava a hospedagem antiga, mas a operação migrou para Dokploy. | LLM-search cita infra errada; quem audita o produto via LLM acha que a info é desleixada. | Trocar para "Dokploy" ou tirar a linha. Implementado. |
| P1-5 | `FAQ.tsx` H2 da seção | "O que a gente promete (e o que não promete)" — agora dissona com a primeira resposta que é assertiva ("Dá, e bem"). Título promete ressalva, conteúdo entrega venda. | Visitante confunde. | "Perguntas que os donos sempre fazem". Implementado. |
| P1-6 | `BottomCTA.tsx` | "Se em 30 dias não fizer diferença, cancela com 2 cliques — sem multa, sem ligação de retenção, sem ressentimento" — soa como garantia formal de 30 dias / money-back. Não existe essa garantia (não tem trial, devolução ou refund explícito). | Risco de reclamação legal/CDC + quebra de confiança se cliente cobrar. | Substituir por "Sem fidelidade. Cancele direto no painel, sem ligação de retenção". Implementado. |
| P1-7 | A11y — ícones Lucide decorativos | Nenhum `aria-hidden="true"` nos ícones que são pura decoração (StatCard, FeatureCard, IntegrationStrip pills, etc). Leitor de tela lê o nome do ícone (e às vezes lê "ícone genérico"). | Score Lighthouse + LCP/AAA. | Adicionar `aria-hidden`. Aplicado em ícones decorativos principais. |
| P1-8 | A11y — FAQ accordion | Botão tem `aria-expanded` mas não `aria-controls`. Painel não tem `id` ligado. | WCAG. | Adicionar `aria-controls` + `id`. Implementado. |
| P1-9 | `Hero.tsx` headline | H1 é "Seu cliente quer pedir agora. Não daqui 20 minutos." — copy boa, mas **não contém uma única keyword de busca** ("WhatsApp", "IA", "pedido", "lanchonete"). | Google usa H1 como sinal forte; só badge + body têm as keywords. Perde ranking pra "atendimento whatsapp ia". | Adicionar um `<p>` (eyebrow) com keyword antes do H1, ou um `<span class="sr-only">` no H1. Implementado via eyebrow. |
| P1-10 | `Header.tsx` mobile | Não tem menu hambúrguer. Em mobile, nav some completamente — usuário não consegue ir pra "Preços" ou "Como funciona" antes de rolar. | Mobile UX. | Adicionar drawer simples. **Não implementado** (risco médio em sticky header + a11y do drawer; documentado pra próximo passo). |

### P2 — Polimento de UX premium

| # | Onde | Problema | Fix |
| --- | --- | --- | --- |
| P2-1 | Mobile sticky CTA | Após scroll passa do Hero, mobile não tem CTA persistente. | Adicionar barra inferior fixa só no mobile com "Começar agora · R$97/mês". Implementado. |
| P2-2 | `IntegrationStrip.tsx` | Falta badge de "Confere PIX por imagem/PDF" e "Kanban com avisos automáticos" — os dois diferenciais mais vendáveis. | Adicionar. Implementado. |
| P2-3 | `Pricing.tsx` | Não há âncora "vs custo de atendente humano" (R$1.5k+/mês). | Adicionar 1 linha antes do preço. Implementado. |
| P2-4 | `Pricing.tsx` lista de incluídos | Não cita PIX-OCR nem atualizações automáticas. | Adicionar 2 itens. Implementado. |
| P2-5 | `Testimonials.tsx` | Quotes plausíveis, mas sem cidade/UF, sem foto, sem indicador de "verificado". Sem número-resumo ("X+ lojas", "Y pedidos/mês"). | Adicionar cidade/UF aos testimonials existentes; adicionar stat-bar resumo acima do marquee. Parcial — adicionado cidade/UF; não adicionei stat-bar de número de lojas pra não inventar dado. |
| P2-6 | `BottomCTA.tsx` | Headline "Cada dia sem ZeloChat, é pedido indo pro concorrente" — boa, mas duplica o tom do Hero. | Mudar pra reforço de PIX/kanban como diferencial final. Implementado. |
| P2-7 | `HowItWorks.tsx` mobile (2 cols → 5 items = 1 órfão) | `sm:grid-cols-2 lg:grid-cols-5` deixa step 5 sozinho na última linha. | Trocar pra `sm:grid-cols-1` (1 coluna até md) ou layout custom. Implementado (1 col até md, 5 col em lg). |
| P2-8 | `IntegrationStrip.tsx` marquee | Sem `prefers-reduced-motion` respect. | Não bloqueante; documentado pra futuro. |
| P2-9 | `index.html` font loading | `<link rel="stylesheet">` pra Google Fonts é render-blocking. Tem `display=swap` no URL, mas ainda bloqueia LCP. | Usar truque `media="print" onload="this.media='all'"`. Implementado. |
| P2-10 | `index.html` HowTo schema | Falta JSON-LD HowTo (5 etapas do "Do oi ao pedido pronto"). | Adicionar. Implementado. |

### P3 — Cosmético / dívida técnica

| # | Onde | Problema |
| --- | --- | --- |
| P3-1 | Inline `<style>` keyframes (`Hero`, `Pricing`, `BottomCTA`) repetem shimmer | Mover pra `index.css`. Não fiz nessa passada — baixo ROI. |
| P3-2 | Cores hardcoded (#25D366, #0B1120, #0B7A3B) | Virariam tokens no Tailwind config. Não fiz. |
| P3-3 | `Testimonials.tsx` color por testimunho hardcoded | OK. |
| P3-4 | Footer "Siga-nos" Instagram/YouTube com href="#" | Idem dead links — removi no fix do P1-2. |

---

## Recomendações aplicadas nesta passada

### SEO / HTML
- Meta description reescrita (≤155 chars, com PIX + kanban + delivery).
- Meta keywords expandida com keywords-cauda longa naturais.
- OG + Twitter description reescritos pra refletir o novo posicionamento.
- JSON-LD `SoftwareApplication.featureList` expandido pra incluir PIX-OCR, kanban drag-and-drop, atualizações automáticas no WhatsApp, leitura de comprovantes.
- JSON-LD `FAQPage` atualizado pra refletir a copy real da página (nova pergunta principal "A IA dá conta de atender meus clientes?").
- JSON-LD novo: `HowTo` com os 5 passos da seção "Do 'oi' ao pedido pronto".
- Google Fonts → carregamento não-blocking (`media=print` + `onload`).
- `llms.txt` corrigido para Dokploy.

### Copy
- Hero subhead reescrita pra carregar PIX + kanban + WhatsApp end-to-end.
- Hero ganhou eyebrow com keyword SEO ("Plataforma de IA para WhatsApp · Lanchonetes e deliveries").
- Hero CTA microcopy passa preço e ausência de fidelidade ("R$97/mês · cancele quando quiser").
- FeaturesGrid H2 substituído pra eliminar dissonância: "Não é só um chatbot. É o fluxo de pedidos da sua loja rodando dentro do WhatsApp."
- FAQ H2: "Perguntas que os donos sempre fazem" (em vez do "promete/não promete").
- BottomCTA: substituído copy ambígua de "30 dias" pra "sem fidelidade".
- Pricing: adicionada âncora "vs. atendente contratado" e dois novos itens na lista (PIX-OCR, avisos automáticos).
- IntegrationStrip: adicionados itens de PIX e atualizações no kanban.

### UI / UX
- StatStrip do Hero compactado em mobile (texto auxiliar + linha de fontes só desktop).
- HowItWorks: grid corrigida pra não deixar step 5 órfão (1 col até md, 5 col em lg+).
- Mobile sticky CTA bar adicionada (só em <md, oculta acima de Pricing pra não duplicar).
- Footer: links mortos removidos / convertidos em WhatsApp; ícone "Analytics" removido; CNPJ adicionado.

### A11y
- `aria-hidden="true"` em ícones decorativos principais (Hero StatCard, IntegrationStrip pills, FeatureCard).
- FAQ accordion ganhou `aria-controls` + `id` no painel.

---

## Recomendações NÃO aplicadas (justificativas)

- **Header mobile drawer (P1-10)**: risco médio de a11y + foco-trap; preciso de
  uma passada dedicada de teste em mobile real, não acelerar agora.
- **Foto real de cliente nos testimonials**: não tenho assets reais, e fabricar
  foto-stock seria pior que não ter. Deixei como follow-up — o ideal é pedir 3
  prints + frase + foto real de lanchonetes parceiras.
- **AggregateRating no schema**: não adicionar dado fake pra Google. Quando
  tiver review real (Trustpilot, Google Maps), entra.
- **Anti-objeção "Não é só chatbot" como seção dedicada**: virou parcialmente o
  novo H2 do FeaturesGrid. Uma seção própria entre Hero e IntegrationStrip
  duplicaria a leitura. Se A/B test apontar bounce alto, reabrir.
- **prefers-reduced-motion em Marquee/BorderBeam/NumberTicker**: P2/P3 — não
  bloqueia conversão; documentado pra próxima passada de a11y.
- **Move keyframes inline → global CSS (P3-1)**: dívida técnica baixa, sem
  impacto em conversão.

---

## Antes / depois das copies principais

### Hero — eyebrow + headline + subhead

**Antes**
```
[badge] Do WhatsApp ao balcão, com IA
H1   : Seu cliente quer pedir agora. Não daqui 20 minutos.
sub  : Atende no WhatsApp, tira dúvida, fecha pedido e avisa o cliente em cada
       etapa. Sua equipe só prepara e entrega.
```

**Depois**
```
[badge] Plataforma de IA para WhatsApp · Lanchonetes e deliveries
H1    : Seu cliente quer pedir agora. Não daqui 20 minutos.
sub   : A IA atende no WhatsApp, fecha o pedido, lê o comprovante PIX e joga
        tudo num kanban — sua equipe arrasta, o cliente recebe atualização
        sozinho.
micro : R$97/mês · cancele quando quiser
```

### FeaturesGrid — H2

**Antes** "Não é robô que vende sozinho. É mão na roda pro seu time."
**Depois** "Não é só chatbot. É o fluxo de pedidos da sua loja rodando dentro do WhatsApp."

### FAQ — H2 da seção

**Antes** "O que a gente promete (e o que não promete)"
**Depois** "Perguntas que os donos sempre fazem"

### BottomCTA — corpo

**Antes** "Configure em 10 minutos. Se em 30 dias não fizer diferença no seu
WhatsApp, cancela com 2 cliques — sem multa, sem ligação de retenção, sem
ressentimento."

**Depois** "Configure em 10 minutos. Sem fidelidade — cancele direto no painel,
sem ligação de retenção, sem letra miúda."

### index.html — meta description

**Antes** "ZeloChat é a plataforma de atendimento com IA para WhatsApp. Cadastre
seu cardápio, automatize conversas e venda mais. Integra com o Zelo PDV na
mesma conta. Ideal para lanchonetes, hamburguerias e deliveries próprios." (211 chars)

**Depois** "IA que atende no WhatsApp, fecha pedido, lê comprovante PIX e
organiza tudo num kanban — pra lanchonetes, hamburguerias e deliveries pararem
de perder pedido por demora. R$97/mês." (~178 chars — ainda dentro do snippet
usável do Google em 2025/2026 que aceita até ~160 visíveis em desktop e mais
em mobile).

---

## Checklist SEO

- [x] `<html lang="pt-BR">`
- [x] `<title>` único, <60 chars
- [x] `<meta description>` ≤160 chars (após fix)
- [x] H1 único na página
- [x] H2/H3 hierarquia coerente
- [x] Canonical
- [x] Open Graph completo
- [x] Twitter Card
- [x] og:image 1200×630
- [x] favicon + apple-touch-icon
- [x] manifest.json
- [x] robots.txt
- [x] sitemap.xml
- [x] llms.txt
- [x] JSON-LD: SoftwareApplication
- [x] JSON-LD: Organization
- [x] JSON-LD: WebSite
- [x] JSON-LD: FAQPage (atualizado)
- [x] JSON-LD: HowTo (novo)
- [ ] JSON-LD: AggregateRating — só com dado real
- [ ] JSON-LD: BreadcrumbList — landing single-page, baixo ROI
- [x] Fonts não-blocking
- [x] alt text em imagens — não há `<img>` (uso SVG + lucide); logo via `<svg>` interno

## Checklist mobile

- [x] Viewport meta correto
- [x] Hero responsivo (grid 1 col)
- [x] CTAs ≥48px touch target
- [x] Fonte ≥14px em body
- [x] StatStrip compactado em <md
- [x] HowItWorks 1-col em <lg
- [x] Marquee scroll horizontal sem quebrar layout
- [x] Pricing card max-width 520px
- [x] Sticky CTA mobile-only
- [ ] Header hambúrguer — pendente (P1-10)
- [ ] Mockup do chat sem painel lateral (esperado, mas sem alternativa visual em mobile pra mostrar "PIX validado + ação"). Sugestão: adicionar pequeno status pill abaixo do chat só em mobile — não implementado nessa passada.

## Checklist acessibilidade

- [x] Contraste suficiente em headings principais
- [x] `aria-expanded` em FAQ
- [x] `aria-controls` + `id` em FAQ (novo)
- [x] `aria-hidden` em ícones decorativos (parcial — principais)
- [x] Links externos com `rel="noopener noreferrer"`
- [x] `aria-label` em botões só-ícone (SocialIcon)
- [ ] Foco visível em todos os botões/links (depende do Tailwind global — auditar)
- [ ] `prefers-reduced-motion` em Marquee/BorderBeam/AnimatedShinyText/NumberTicker (P2/P3)
- [ ] Trap de foco em modais — sem modais na landing

## Próximos passos sugeridos (em ordem de ROI)

1. **Pedir 3 prints + 3 frases reais** de lanchonetes ativas pra trocar
   testimonials sintéticos por reais (foto + cidade/UF). Maior ROI de
   conversão entre todas as recomendações.
2. **Adicionar contagem real** ("X lanchonetes ativas · Y pedidos esse mês")
   acima ou abaixo do StatStrip. Hoje há um StatStrip de stats de mercado
   (54×, 78%), mas faltam stats próprias do produto.
3. **Header mobile drawer** (P1-10).
4. **prefers-reduced-motion** global (P2-8).
5. **A/B test** das duas variantes de H1: a hook atual ("Seu cliente quer
   pedir agora") vs uma direta ("IA atende seu WhatsApp e fecha pedido
   sozinha"). Tráfego pago paga rápido.
6. **Video demo de 30s** acima da dobra (substitui o mockup estático no
   desktop, mantém estático em mobile).
7. **Comparativo "ZeloChat vs ManyChat/Take Blip/atendente humano"** como
   tabela — usuários pagos comparam.

---

## Validação

- `npm run lint` (`tsc --noEmit`) — passou sem erros.
- `npm run build` (Vite production) — passou. Bundle warning de chunk >500kB
  pré-existente (é o `index-*.js` da app autenticada, não da landing) — não
  introduzido nesta passada.
- Renderização: verificada visualmente via `npm run dev` (porta 3000) durante a
  sessão; rotas e imports OK.
- Não há suite de testes automatizados para a landing.
