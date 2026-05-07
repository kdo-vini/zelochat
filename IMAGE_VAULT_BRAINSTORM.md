# Image Vault — Brainstorm de Produto

> Documento de discussão. **Não é plano de implementação.** Não foi tomada decisão de quando construir.
> Data: 2026-05-06.

## O que motivou

Hoje a IA do ZeloChat só responde em texto. O dono da lanchonete continua mandando manualmente o JPG do cardápio 30–80 vezes por dia — é a ação mais repetida do dono no WhatsApp e a IA não cobre. Sem isso, a promessa de "IA atende sozinha" fica visivelmente quebrada.

A ideia inicial: um **vault de imagens** que (1) a IA pode ler/entender e (2) a IA pode enviar sozinha pro cliente quando fizer sentido — com um toggle do dono ativando o envio automático.

## O que já existe na infraestrutura (achado durante o brainstorm)

Metade do trabalho já está pronto:

- **Visão já funciona**: `gpt-4o-mini` já recebe imagens do cliente como `image_url` em `server/ai.ts:2169`. O mesmo caminho carrega imagens do dono.
- **Envio de mídia já existe**: `sendMediaMessage` em `server/whatsapp.ts:406` manda imagens via Whatsmiau, com roteamento por empresa.
- **Bucket de storage já existe**: `zelochat-media` é público, escopado por empresa, com slug aleatório de 16 hex (P0.5 fix).
- **Padrão de tools já existe**: `criar_pedido`, `consultar_pedido`, `dispatch_trigger` em `server/ai.ts:2485`. Adicionar `enviar_imagem` é encaixe natural — e como não muta estado, foge do trap de duplicate orders.
- **Convenção de toggles**: `ai_enabled`, `ai_instructions`, `ai_can_reengage_pending` em `empresa_perfil`. `ai_can_send_images` segue o mesmo padrão.

Conclusão: a engenharia "crua" do envio é trivial. O problema **não é técnico**.

## Decisões tomadas durante o brainstorm

### Escopo do MVP — só envio
- ✅ **Envio**: dono sobe imagens, IA manda quando faz sentido.
- ❌ Vision-extract de cardápio impresso → `produtos`. Esbarra em schema compartilhado com ZeloPDV. Fica pra fase 2.
- ❌ Foto por produto vinculada a `produtos.id`. Fase 2.
- ✅ **Botão "🪄 Sugerir descrição"** no upload — uma chamada de visão preenche um rascunho da descrição que o dono edita antes de salvar.

### Sem confirmação manual do cliente
A primeira proposta era um modo "Posso te mandar o cardápio? [Sim] [Não]" pra eliminar misfire. **Descartado** — fricção mata a magia. Cliente acabou de pedir cardápio, ter que dar mais um tap pra receber é regressão de UX comparado ao próprio WhatsMenu (manual, mas em um passo só).

A IA envia direto, com a inteligência morando nas regras por imagem.

### Campo "Quando enviar?" como primitivo
Cada imagem tem **dois campos estruturados**, não um textarea livre:

```
QUANDO ENVIAR?
"Quando o cliente pedir o cardápio, lista de produtos,
ou perguntar 'o que vocês têm'."

QUANDO NÃO ENVIAR?
"Não enviar se o cliente já estiver fazendo pedido,
ou se ele pediu algo específico."
```

**Por quê separado**: regras negativas são o maior lever contra falso-positivo, e quase ninguém usa em prompt design. Donos pensam assim naturalmente ("não pode mandar quando ele já tá pedindo") — só precisam de campo pra colocar.

### Prioridade por imagem
Inteiro `prioridade` resolve conflito quando múltiplas imagens dão match. AI avalia em ordem, pega o primeiro hit. Previsível e debugável — sem "AI escolhe magicamente" que é onde misfire mora.

### Confidence floor
A IA pode mandar imagem **OU** responder em texto **OU** não mandar nada. Sem isso, ela se sente pressionada a achar a melhor das ruins → falso-positivo. Pior do que envio perfeito é envio errado; melhor que envio errado é não enviar.

### Test box no editor — feature-killer
Dentro do editor de cada imagem, um input pequeno:

```
TESTE: digite uma mensagem de exemplo
[ "oi, tem cardápio?" ]   [ Testar ]

→ Resultado: enviaria essa imagem ✓
→ Por quê: corresponde à regra "quando o cliente pedir o cardápio"
```

Custa meio dia. Vale provavelmente +10% de acurácia em produção porque o dono se auto-corrige antes de cliente real misfirear. Também vira ferramenta de suporte.

### Caso multi-imagem ("manda o cardápio e a promoção")
Decisão: IA manda a de maior prioridade + menciona no caption "também tenho a promo da semana, te mando?" Encoda rate-limit suave sem voltar pro confirm-tap global.

## A taxonomia de misfire (não é uma coisa só)

Discussão classificou os modos de falha:

1. **Imagem errada, intenção certa** — pediu cardápio, IA mandou flyer da promo.
2. **Imagem certa, momento errado** — cliente em checkout, IA repete cardápio.
3. **Falso positivo** — "olhei o cardápio, vou querer X" → IA reenvia.
4. **Falso negativo** — pediu lista, IA respondeu só em texto.
5. **Meio-certo** — pediu cardápio vegetariano, IA mandou cardápio normal. Pior que dizer "não temos" porque cliente acha que foi atendido.
6. **Conteúdo desatualizado** — imagem é match certo, preços tão velhos.
7. **Qualidade da imagem** — foto borrada, escura. Dono fez merda, ZeloChat leva o estrago.

Os três primeiros são problema de **IA**. Os três últimos são problema de **sistema**. Cliente culpa a IA pelos seis.

## Tier A só funciona com número, não com sentimento

A diretriz Tier A (memória `project_tier_a_mandate`) é vazia sem threshold quantitativo pré-acordado. Barra recomendada pra v1:

| Métrica | Limite |
|---|---|
| Imagem errada dado trigger correto | < 1% |
| Falso positivo (mandou quando não devia) | < 2% |
| Resultado ruim visível ao cliente (override do dono ou reação negativa em 10min) | < 3% |

**Sem comprometimento numérico antes de começar, "good enough" creep entrega 7% e vira screenshot no Instagram.**

## Timeline real ≠ timeline de engenharia

Estimativa inicial: 2–3 dias de código.
Estimativa pra Tier A: **3–4 semanas**.

A diferença não é engenharia, é qualidade. O que toma tempo:

| Fase | Dias |
|---|---|
| Editor estruturado (positivos + negativos + prioridade + test box) | 2 |
| Prompt + few-shot por imagem | 2 |
| Shadow mode (logar "IA mandaria X" sem enviar) | 2 |
| Eval set: ~150 mensagens reais de produção, rotuladas | 2 |
| Shadow runs em produção, iteração de prompt | 10–14 |
| Rollout 50% A/B, medir CSAT | 7 |
| Lançamento total | só com threshold batendo 7 dias |

A estrutura editor + test box compensa parte do shadow mode (eval upstream em vez de em prod), mas não desaparece.

## Sinais sem o consent tap

Sem o "Sim/Não" como ground truth, o sinal de qualidade vem de:

1. **Override do dono** — botão `[✓ certa] [✗ errada → trocar]` em cada envio na visão do operador. Tap único = correção pro cliente + dado de treinamento.
2. **Reação negativa do cliente** — próxima mensagem com "não era isso", "não pedi", reversão de sentimento.
3. **Logs do test box** — dono testando regras já é dado.
4. **Auditor semanal** — "Sua imagem 'Cardápio' foi enviada 47x essa semana, em 3 conversas você teve que assumir. Quer revisar?"

## A descoberta estratégica

O campo "Quando enviar?" feito direito **não é uma feature do image vault** — é o protótipo de um primitivo bem maior:

> **Edição de regras de comportamento da IA por donos não-técnicos**, com gatilhos positivos + negativos + test box + confidence floor.

Hoje vive só no vault. Amanhã pode reger:
- Triggers (já existe `zelochat_triggers` — mesma pattern, 10x melhor UX)
- Auto-quotes ("quando perguntarem preço, mande X")
- Regras de escalação ("quando cliente reclamar, chamar gerente")
- Promos contextuais ("quando pedir depois das 22h, ofereça desconto")

Mesma infra de eval, mesma UX, mesmo test box, ações diferentes. **Isso é moat.** WhatsMenu copia "IA manda imagens" em um trimestre. Não copia esse primitivo sem reescrever o substrato de IA deles.

Image vault vira a cunha que justifica investimento no editor.

## Implicações estratégicas

- **Posiciona o produto**: deixa de ser "WhatsApp inbox + auto-resposta" e vira "IA atendente que faz o trabalho braçal do dono". Demo se vende sozinho — "tem cardápio?" → imagem em 4s.
- **Move ativação pra dia 1**: dono sobe cardápio no onboarding e já sente valor antes de o primeiro cliente mandar mensagem.
- **Switching cost cresce não-linearmente**: vault + ai_instructions + triggers + delivery_config = cérebro de IA personalizado. 6 meses depois, sair pra concorrente custa rebuild de tudo.
- **Justifica os R$97**: dono que ia churn ("a IA não vale o preço se eu ainda mando o cardápio sozinho") fica.
- **Abre tier Pro depois** (R$147+): mais imagens, vision-extraction, geração de cardápio com IA, vídeo.
- **Expande TAM**: mesmo primitivo serve barbearia (tabela de preços), salão (look book), mercadinho (catálogo), pet shop. Lanchonete é a praia, não o teto.

## O que o vault desbloqueia (jogo de longo prazo)

Vault é primitivo, não feature. Uma vez que existe:

- **Promo auto-rotativa por dia da semana** — "promo segunda", "promo terça". Marketing automático, esforço zero do dono depois do upload.
- **Foto do lanche em preparo no order update** — "seu lanche tá saindo agora" + foto real. Nenhum competidor BR faz isso.
- **IA gera o cardápio em PNG** a partir do catálogo do ZeloPDV. Mata a fricção de "preciso contratar designer". Cross-sell pra PDV.
- **Busca visual de produto** — cliente: "manda foto de algo doce" → IA escolhe do vault. UX nova no commerce de WhatsApp.
- **Stories/Status automático** — promo do dia postada sozinha. Loop de aquisição novo, mesmo primitivo.

## Riscos sérios (não genéricos)

- **Misfire é screenshot-able.** Pizzaria mandando promo de açaí pra quem pediu pizza vira post no Instagram. Em food-service BR, a barra é cruel — half-right answer machuca mais que silêncio.
- **Conteúdo velho é mina de tempo.** Dono sobe cardápio em março, sobe preços em maio, IA continua quotando março até o cliente bater na loja e ver R$32 onde devia ser R$25. Lembrete "essa imagem tem 90 dias, ainda tá certa?" não é v2 — é launch-blocker.
- **Spam perceptível.** Imagem + texto + imagem em 30s = chato. Cooldown estrutural: mesma imagem 1x por sessão por X minutos. Sem confirm-tap filtrando, isso é mais importante, não menos.
- **2G/3G no interior.** Nem todo cliente carrega imagem rápido. Texto fallback importa.
- **Ceiling de roadmap.** Se Tier A é real, *toda* feature de IA tem cauda de 3–4 semanas. Talvez 4–6 features grandes/ano seja o teto, não 12–20 médias. Muda como se compete em velocidade vs WhatsMenu.

## Decisões deferidas (parking lot)

- Vision-extract menu → `produtos` (coordenar via repo do ZeloPDV antes).
- Foto por produto vinculada a `produtos.id` (precisa tabela ZeloChat-owned de junção).
- Suporte a PDF (WhatsApp renderiza como tile, UX pior — só se cliente pedir).
- Analytics ("IA mandou seu cardápio pra 47 clientes essa semana").
- Geração de cardápio em PNG a partir do catálogo PDV.
- Status automation.
- Vídeo no vault.

## Em quais condições NÃO construir

Esse documento não é um "vamos fazer". A decisão real é:

- **Construir** se: existe janela de 3–4 semanas focadas, comprometimento numérico de Tier A, e disposição de fazer Sugerir-descrição world-class (porque é load-bearing — dono médio mantém a sugestão verbatim).
- **Não construir** (ainda) se: a janela é 1 semana, o time está dividido em outras prioridades, ou se Tier A é negociável "só dessa vez". Image vault meia-bomba destrói a promessa Tier A em escala maior do que o feature ganha.

A versão de 2–3 dias **existe** e funciona — só não bate Tier A. Construir e *não* atingir a barra é pior que adiar.

## Resumo executivo (uma página)

- O vault é a primeira feature em que a IA *substitui* a ação mais frequente do dia do dono. Reframa o produto.
- Já temos infra (vision-in, send-out, storage, tool dispatch). Engenharia é trivial.
- Qualidade não é. Tier A pede 3–4 semanas de trabalho real (eval set, shadow mode, iteração de prompt, A/B).
- Sem confirm-tap. Decisão fica nas regras por imagem (positivos + negativos + prioridade + test box + confidence floor).
- O campo "Quando enviar?" feito direito é o protótipo de um primitivo maior — edição de regras de IA por dono não-técnico. **Esse é o moat real.**
- Métricas pré-acordadas: <1% imagem errada, <2% falso positivo, <3% resultado ruim visível ao cliente. Sem isso, "good enough" creep entrega 7%.
- Promo rotativa, foto de preparo, geração de cardápio, status automation, busca visual — tudo desbloqueia depois do vault. Roadmap de 12 meses.
- Ship só se tem janela e comprometimento Tier A. Caso contrário, parking lot consciente.
