# Incidentes e padrões conhecidos

## "Esse horário já passou hoje: 18:00" para quem só perguntou se estava aberto (2026-09-10)

**Sintoma:** cliente escreveu "Boa noite! Ainda está aberto?" às 21:30 e
recebeu "Esse horário já passou hoje: 18:00. Agora são 21:30. O atendimento
funciona das 11:00 às 22:50." — a resposta contradiz a si mesma (21:30 está
dentro de 11:00–22:50) e ninguém tinha mencionado 18:00. Já havia acontecido
igual em 03/09, também com 18:00.

**Causa-raiz (duas, somadas):** `findRecentScheduleContextGuard` varre
`messages.slice(-12)` procurando um horário pedido e valida contra o horário de
funcionamento.
1. Recebia `session.messages` **cru**. Doze mensagens não têm limite de tempo:
   nessa conversa a única outra mensagem era de **25/07, 47 dias antes**.
2. O laço **não filtrava o papel** da mensagem, então leu uma resposta da
   PRÓPRIA LOJA — "Olá tudo bem?? Hoje nosso atendimento começa as 18:00 hs" —
   como se fosse horário pedido pelo cliente. A função irmã logo abaixo
   (`findRecentTodayBlockedOperationalGuard`) já filtrava por `user`; esta
   esquecia.

Confirmado no banco: o texto de entrada era exatamente "Boa noite!
Ainda está
aberto?", e `collectRequestedTimeMinutes` não extrai nada dele — o 18:00 só
podia vir do histórico.

**Fix:** os guards passam a receber `messagesSinceConversationBreak(session.messages)`,
igual ao histórico que vai para o modelo, e o laço só considera mensagem do
cliente — `server/ai.ts:1578`, `server/ai.ts:3742`.

**Padrão que se repete:** é o terceiro defeito da mesma família em dois dias —
contexto antigo ressurgindo como se fosse do turno atual (resposta repetida em
loop, "Que bom!" para saudação de 32h antes, e agora este). Ao ler histórico
para decidir qualquer coisa, corte na conversa atual e filtre o papel.

## Ranking da busca do cardápio reescrito, e continuidade de conversa (2026-09-09, quinta rodada)

**Causa-raiz de uma família inteira de sintomas:** o ranking do ZeloMenu
pontuava `45 + tokens_compartilhados * 10`, com nome, descrição, categoria e
opção valendo o mesmo. Um único token em comum já valia 55 pontos. Por isso
"vc pode mandar o cardapio?" casou com "Batata frita com cheddar e bacon" — a
descrição pública diz "vai surpreender **vc** com a cobertura" — e por isso
cada correção no ZeloChat virava uma lista de palavras que nunca fechava.

**Medição antes de mexer.** Bancada com a busca REAL do ZeloMenu sobre o
catálogo REAL de produção (92 produtos publicados) e consultas reais de
clientes: **14/18 antes, 18/18 depois**. Duas hipóteses foram descartadas com
dado, não com opinião:

1. *Stopwords derivadas da frequência do catálogo não funcionam aqui.* Num
   cardápio de 92 itens as palavras mais buscadas SÃO as mais frequentes: com
   corte em 15%, `marmita(23) frango(26) carne(21) arroz(16)` viravam
   "stopword". A primeira reescrita ficou PIOR que o algoritmo antigo (10/16).
2. *O que quebra são palavras funcionais do português.* `do` está em 7 de 92
   produtos ("Marmita **do** dia") — longe de qualquer corte de frequência — e
   casava "Gostaria **do** cardápio" com "Marmita do dia" com nota 1,00.

**Fix (ZeloMenu):** `src/domain/zelomenuCatalogDiscovery.ts` passa a ranquear
por cobertura — a fração do peso da consulta que o produto cobre, cada acerto
valendo conforme o campo (nome 1,0 · categoria 0,7 · grupo/opção 0,6 ·
descrição 0,3), com piso de relevância em 0,45; stopwords linguísticas em
`src/domain/portugueseStopwords.ts` (lista Snowball, a mesma do dicionário
`portuguese` do Postgres, mais abreviações de WhatsApp); typo por trigrama
(≥0,7) e por distância de edição 1 — trigrama sozinho não pega troca de letra
no miolo de palavra curta ("marmyta" x "marmita" dá 0,45). `confidence` agora é
a cobertura 0..1, que é o que o campo sempre prometeu.

**Fix (ZeloChat):** removidas as compensações que só existiam por causa do
ranking fraco — `stripCatalogQueryFraming`, as três listas de palavras e
`isCatalogMenuRequest`. A frase do cliente vai para a busca como foi escrita.

**Dois outros defeitos da mesma rodada:**
- O recibo de checkout do ZeloMenu chega como mensagem do cliente e contém
  "cardápio digital" e "Entrega · o quanto antes", então casava com o pedido de
  cardápio E com `isDeliveryFeeQuestion`: quem tinha acabado de fechar R$ 46,00
  recebia o cartão do cardápio e uma explicação de frete. Agora
  `isZeloMenuOrderReceipt` intercepta antes de qualquer classificação e só
  agradece.
- O histórico ia inteiro para o modelo, então conversa de ontem continuava
  hoje: "Boa" / "Noite" às 20h51, 32 horas depois do último turno, virava "Que
  bom! Se precisar de algo é só avisar". `messagesSinceConversationBreak` corta
  no último silêncio maior que 6 horas, tanto no histórico do modelo quanto no
  gate de follow-up do fluxo canônico. Nada é apagado: o resumo do cliente
  segue no system prompt e as mensagens seguem no banco.

**Loja fechada responde como gente:** uma pergunta de catálogo fora do horário
não é mais respondida com uma lista seca convidando a escolher. `renderCatalogReply`
recebe o prefixo de `buildStoreClosedPrefix` e abre com "Agora estamos fechados,
reabrimos ainda hoje às 18:00. Mas olha o que temos:" — o horário vem do
`nextOpenLabel` que `resolveWeeklyStatus` já calculava para o prompt.

**Regra que fica:** ranking sem medição é chute. A suíte
`zelomenuCatalogDiscovery.relevance.test.ts` congela o conjunto de avaliação —
rode antes de publicar qualquer mudança de relevância.

## Cardápio pedido virava busca de produto, e o próprio botão virava pedido (2026-09-09, quarta rodada)

**Sintoma (dois clientes reais da Bem Servido, 09/09):**
- "Boa noite" + "Gostaria do cardápio por favorn" → cartão do cardápio E, logo
  depois, "Não encontrei uma opção disponível com esse nome".
- "Boa tarde" + "Depois me manda ó cardápio , fazendo favor" → "Não encontrei
  uma opção disponível com esse nome".
- Toque no botão "Pedir por aqui" → "Não consegui conferir o pedido com
  segurança agora; vou chamar um atendente para ajudar" (22:32:40, evento em
  `zelochat_escalation_events`, `repeated_ai_failure`).

**Causa-raiz A:** `isCatalogMenuRequest` decidia comparando cada palavra da
mensagem contra uma lista fechada de "enquadramento". Português natural não
cabe numa lista: um typo (`favorn`) ou palavras comuns (`depois`, `fazendo`,
`ó`) escapam, a mensagem deixa de ser reconhecida como pedido de cardápio e o
resto vira query de produto. Corrigir alargando a lista só adia o próximo caso.

Agora quem decide é o catálogo: se o cliente **nomeou o cardápio** e a busca
**não achou nada**, a resposta é o cardápio — independente de vocabulário. Uma
mensagem que não nomeia o cardápio mantém o "Hoje não temos isso". E o cartão
de entrada, quando já foi enviado no mesmo turno, encerra o turno: nunca mais
é seguido de uma segunda mensagem dizendo que não achou nada.

**Causa-raiz B:** o WhatsApp entregou o toque no botão "Pedir por aqui" como
mensagem de **texto**, sem id de botão, então `tryHandleAiWhatsAppOrderingButton`
nunca viu. O handler de texto leu o rótulo como intenção de pedido (`pedir` é
palavra-chave), buscou "pedir por aqui" no catálogo, deixou o planner montar
um rascunho com o que voltou e estourou na mutação canônica. O cliente tocou
no botão que nós oferecemos e recebeu "vou chamar um atendente".
`isOrderingStartButtonText` casa o rótulo exato (regra de hard button do
CLAUDE.md) antes de qualquer classificação; rótulo e matcher compartilham a
constante `AI_ORDER_START_BUTTON_LABEL` para não divergirem.

**Fix:** `src/domain/aiWhatsAppOrdering.ts` (`mentionsMenu`,
`isOrderingStartButtonText`, `AI_ORDER_START_BUTTON_LABEL`,
`AI_ORDER_START_REPLY`) e `server/aiWhatsAppOrdering.ts` (`answerMenuRequest`
compartilhado pelas duas camadas, ramo do botão antes da classificação).

**Não resolvido:** qual erro exatamente estourou na mutação canônica depois do
planner. Os logs ficam no Dokploy, fora de alcance daqui, e o evento de
escalação só guarda a categoria. O caminho que levava até lá some com o fix do
rótulo, mas a falha subjacente pode existir para pedidos legítimos.

## IA dizia "Estamos atendendo" com a loja fechada, e narrava a própria busca (2026-09-09, terceira rodada)

**Sintoma:** no simulador, "vc pode mandar o cardapio?" respondia "Olá!
Estamos atendendo..." mesmo com a loja fechada, enquanto "estao atendendo?"
respondia corretamente "Agora a loja está fechada, mas reabrimos às 18:00".
Separadamente, toda resposta de catálogo abria com "Encontrei:" — a IA
relatando o próprio ato de procurar em vez de responder ao cliente.

**Causa-raiz A:** o ramo de pedido de cardápio adicionado na rodada anterior
não checava `entry.storeOpen`, ao contrário do ramo de saudação logo acima
dele. `buildOrderingEntryPayload` abre com "Estamos atendendo" — afirmação
falsa com a loja fechada.

Corrigir só a gate abria um segundo buraco: com a loja fechada a mensagem
voltava a cair na busca de produto, e `buildCatalogSearchQuery` devolvia a
frase crua quando a limpeza esvaziava a query (`stripCatalogQueryFraming(x)
|| x`) — exatamente a colisão de token que aquele ramo existe para impedir.
Agora um pedido de cardápio nunca chega à busca: com a loja aberta responde o
cardápio, fechada devolve o turno para o assistente genérico, que sabe o
horário de reabertura. E a query vazia deixou de virar fallback para a frase
crua — um "quero" sozinho é conversa a continuar, não busca a rodar.

**Causa-raiz B (copy):** `renderCatalogReply` falava do processo interno:
"Encontrei:", "Não encontrei uma opção disponível com esse nome", "Quer
filtrar por tipo ou faixa de preço?". Quem atende no balcão responde "tem sim"
ou "hoje não" — e "filtrar" não é palavra que o cliente usou.

**Fix:** `server/aiWhatsAppOrdering.ts` (gate de loja fechada + guarda de query
vazia) e `src/domain/aiWhatsAppOrdering.ts` (`buildCatalogSearchQuery` sem
fallback para a frase crua; textos "Tem sim:", "Hoje não temos isso.", "Tem
mais de uma parecida.", "Prefere ver por tipo ou por faixa de preço?"). O
texto continua terminando em "Qual você quer?" porque `isOrderingFollowUp`
usa exatamente essa pergunta para manter o fluxo de pedido.

**Em aberto:** com a loja fechada, uma pergunta de catálogo ("tem caldos hj?")
ainda responde a lista. É comportamento pré-existente, não regressão; mudar
isso suprimiria resposta de cardápio fora do horário para todos os clientes e
precisa de decisão de produto.

## IA respondia com produto errado: a frase do cliente ia crua para a busca (2026-09-09, segunda rodada)

**Sintoma:** no simulador, "vc pode mandar o cardapio?" respondia
"Encontrei: Batata frita com cheddar e bacon por R$ 49,90"; "vc pode mandar o
cardapio do macarrao?" respondia "Encontrei mais de uma opção parecida. Qual
delas você quer?" sem listar nada.

**Causa-raiz:** o ZeloChat mandava a frase inteira do cliente como busca de
produto. O matcher do ZeloMenu pontua nome, DESCRIÇÃO, categoria, grupo e
opção, com fallback por sobreposição de tokens — então uma única palavra de
preenchimento basta. O produto 1403 tem na descrição pública "essa porção vai
surpreender **vc** com a cobertura": `vc` era o único token que a frase
compartilhava com qualquer produto do catálogo. Colisão determinística, não
alucinação do modelo.

Três defeitos somados:
1. Palavras de enquadramento (`vc`, `pode`, `mandar`, `cardapio`, `quero`,
   `um`) iam para a busca.
2. Pedir o cardápio caía numa busca de produto em vez de responder com o
   cardápio.
3. `renderCatalogReply` respondia ambiguidade com uma pergunta que **não
   listava nenhuma opção**, e o guard `total > 12` contava candidatos em vez
   de produtos distintos — 25 candidatos de 5 pratos viravam recusa.
4. `isOrderingFollowUp` entregava ao fluxo canônico **qualquer** mensagem
   posterior a uma pergunta, então "Entregar na creche do bela vista" e "Vou
   pagar por pix" eram respondidos com listas de pratos.

**Fix:** `stripCatalogQueryFraming` + `isCatalogMenuRequest` +
`isOrderingFollowUpAnswer` em `src/domain/aiWhatsAppOrdering.ts`; ramo de
pedido de cardápio e gate de follow-up em `server/aiWhatsAppOrdering.ts`;
`renderCatalogReply` lista os produtos distintos em vez do beco sem saída.

**Como foi verificado:** bancada temporária importando o matcher REAL do
ZeloMenu (`src/domain/zelomenuCatalogDiscovery.ts` do repo vizinho) sobre o
catálogo REAL de produção da Bem Servido (92 produtos publicados), dirigindo o
handler real em dry-run. A bancada reproduziu os dois prints byte a byte antes
da correção — é isso que a torna confiável. **Lição: a primeira rodada de
correção deste dia foi declarada resolvida sem rodar os prompts reais; ela
corrigia só o loop de repetição, não a resposta errada.**

## IA repetia a mesma resposta e respondia por cima do operador (2026-09-09)

**Sintoma:** na Bem Servido a IA respondeu três mensagens completamente
diferentes ("Penne, molho branco, bacon, calabresa, mussarela, parmesão",
"Entregar na creche do bela vista", "Vou pagar por pix") com o mesmo texto
palavra por palavra, e em outra conversa respondeu 13 s depois de a dona já
estar digitando pelo WhatsApp dela. 13 repetições idênticas em 10 conversas
entre 01/09 e 09/09 (~12% de todas as respostas automáticas do período).

**Causa-raiz A (repetição):** `findPriorOrderingQuery` escolhia como busca do
catálogo a mensagem anterior mais recente que casava com as palavras-chave de
`classifyOrderingTurn`, descartando o texto atual do cliente. Nenhuma das
mensagens acima contém palavra-chave, então a busca rodou na "Vc pode me
mandar o cardápio" de dois turnos antes e devolveu sempre a mesma lista. Como
essa lista termina em "Qual você quer?", `isOrderingFollowUp` continuava
verdadeiro e o turno seguinte reentrava no mesmo ramo: ponto fixo.

**Causa-raiz B (IA por cima do operador):** `record_zelochat_native_outbound_takeover`
lança `CONVERSATION_SESSION_NOT_FOUND` quando ainda não existe linha em
`zelochat_sessions` — exatamente o caso em que o operador INICIA a conversa
pelo celular. A exceção caía no replay worker (backoff 5/10/20/40 s, dead
letter em 8 tentativas), e durante toda a janela a conversa seguia em
`mode='ai'`. Na thread do iFood o takeover entrou 100 s atrasado, 0,8 s depois
de a IA já ter respondido. 31 eventos caíram nisso em nove dias, vários sem
nunca aplicar o takeover.

**Fix:** `buildCatalogSearchQuery` usa o texto atual do cliente como busca
(a pergunta anterior só volta a valer para respostas curtas de opção) e
`repeatsLastAssistantReply` impede reenviar a mesma resposta canônica,
devolvendo o turno para o assistente genérico —
`src/domain/aiWhatsAppOrdering.ts:152`, `server/aiWhatsAppOrdering.ts:959`.
O processador de `fromMe` cria a sessão e grava o takeover no mesmo passo em
vez de deixar para o replay — `server/fromMeProcessor.ts:104`.

**Fator agravante fora do nosso controle:** o provedor entregou os webhooks
dessa instância com 45–60 s de atraso constante (inbound e outbound
igualmente), o que alarga a janela em que a IA pode responder antes de o envio
humano chegar. A ordem entre eventos é preservada, então o fix acima elimina o
atraso que era nosso.

## Verificação do deploy: conexão sem contexto e import com query ignorado (2026-09-04)

**Sintoma:** o job de produção registrou repetidos timeouts de conexão de 5s no runner; a mensagem genérica não identificava endpoint/fase/cause. Uma revisão local também demonstrou um falso verde: `import("./missing-abcdefgh.js?v=1")` era ignorado quando o entry já continha a versão esperada.

**Causa e fix:** o catch agora mantém a causa original e identifica a fase de request/headers/body; o extrator aceita query/fragmento e continua exigindo origem local, assets presentes e SHA/versão corretos. Leituras continuam limitadas a 5s, polling a 12min e somente GET. Testes reproduziram a falta de diagnóstico e o falso verde antes da correção. A CI ganhou smoke HTTP dos artefatos reais, com rede externa bloqueada e retorno de startup antes de workers/webhooks.

**Estado publicado:** `0d67676` foi confirmado pelo job após nova execução (20 assets/1.567.508 bytes). O build do frontend também exigiu remover no Dokploy o literal `PUBLIC_APP_VERSION=${SOURCE_COMMIT}`; a validação estrita não foi afrouxada. A causa dos timeouts daquele runner permanece sem confirmação. O novo patch de CI ainda exige publicação e verificação no seu próprio SHA.

## Publicação e transporte WS — contenção preventiva (2026-09-04)

Verificador pósdeploy agora impede tratar CI verde como prova de frontend/backend
publicados: `/build-info.json` e `/api/version` devem indicar o SHA40 esperado;
HTML e assets referenciados (incluindo AppShell lazy) precisam estar presentes,
com versão curta embutida. Leituras de5s, deadline total12min, sem credenciais ou
efeitos no negócio. Só push main executa esse gate após build/testes.

Revisão defensiva de WS adicionou contenção de erro/callback de envio, entrada
máxima64KiB e fila de saída1MiB incluindo a próxima mensagem. Testes usam objetos
locais/eventos de transporte; nenhuma reprodução de frames malformados foi feita.
Não houve demonstração de outage novo; são proteções de disponibilidade.

## Carregamento de módulos travava testes AI (2026-09-04, ambiente local)

Durante validação, quatro arquivos ficaram90s sem iniciar casos. Perfil apontou resolução de extensões tsx/OpenAI, com loader misto CJS/ESM. Usar node --import tsx/esm reduziu a suíte121 arquivos de348,546s com quatro timeouts para45,656s toda verde. Não foi incidente de produção comprovado. Runner/runtime atualizados e smoke Linux sem rede validado; demais evidências no relatório de auditoria.

## CRM: identificação falha por assinatura da RPC (2026-09-04, correção local)

**Sintoma:** logs publicados registram PGRST202 na identificação do cliente; a mensagem é preservada, mas o vínculo CRM não é enriquecido.

**Causa-raiz:** `server/customers/repository.ts` enviava cinco argumentos a `ensure_customer_from_whatsapp(uuid,text,text)` e esperava pessoa_id, enquanto a função retorna pessoaId.

**Fix local:** adaptador alinhado aos três parâmetros/JSON canônicos e status invalid→incomplete, com regressão que impede vínculo em conflito. Definição remota conferida via CLI pela coordenação; sem DDL — `server/customers/repository.ts`, `tests/customerIdentityAdapter.test.ts`.

**Recovery pendente:** publicar backend com o patch e observar cessação do erro/vínculos novos. Não reprocessar histórico em massa ou alterar a função PDV para acomodar a chamada incorreta. Relatório: `docs/audits/2026-09-04-zelochat.md`.

## XXXI. Worker de envio estourava o egress do Supabase (corrigido em 2026-09-01)

**Sintoma:** o projeto ZeloPDV no Supabase saiu da cota Free por egress (~250 MB/dia, 95% PostgREST) com apenas cinco clientes e algumas centenas de mensagens por dia. O salto começou em 26-27/08.

**Causa-raiz:** `OutboundWorker.start()` fazia poll fixo a cada 1 s e cada tick disparava duas RPCs (`release_zelochat_expired_leases` e `claim_zelochat_outbound_job`), ~126 requests/min (~180k/dia) para uma fila quase sempre vazia. A RPC de claim já executa `release_zelochat_expired_leases()` internamente, então metade das chamadas era redundante.

**Fix:** polling adaptativo em `server/outbound/worker.ts` (1 s enquanto há jobs ou logo após um wake, 15 s com fila vazia; `OUTBOUND_WORKER_IDLE_INTERVAL_MS`), `releaseExpired()` do store Supabase virou no-op, e todo caminho que enfileira job neste processo chama `wakeOutboundWorker()` (`server/outbound/wake.ts`) para o claim sair na hora — envios humanos continuam aguardando o terminal em `CONVERSATION_SEND_WAIT_MS` sem latência extra. Teste: `tests/outboundWorkerPolling.test.ts`.

**Como verificar:** Supabase → Organization → Usage → filtro ZeloPDV → "Egress per day": PostgREST deve cair para dezenas de MB/dia. Se ainda houver ~1 request/s, existe outro processo (máquina de dev com `npm run dev:server`, réplica antiga) apontando para o banco de produção.

---

## XXIX. Configurações mostrava pedido escrito como indisponível (corrigido em 2026-08-31)

**Sintoma:** mesmo com o backend e a integração privada do ZeloMenu configurados, a seção “Pedidos pelo WhatsApp com IA” mostrava “Status indisponível no momento”.

**Causa-raiz:** o frontend consultava `GET /api/ai-ordering-status`, mas a rota não existia no backend e retornava 404.

**Fix:** o backend agora autentica a empresa e responde somente o booleano de disponibilidade derivado da configuração do cliente interno, sem expor URL ou chave — `server/router.ts:1662`, `tests/aiWhatsAppOrderingStatusRoute.test.ts:1`.

---

## XXX. Simulador de atendimento divergia do WhatsApp (corrigido em 2026-08-31)

**Sintoma:** a simulação da Bem Servido improvisava opções, tratava arroz e feijão como escolha exclusiva, repetia acompanhamentos, contradizia a disponibilidade e mostrava `[IA chamaria as ferramentas: dispatch_trigger]` ao pedir atendimento humano.

**Causa-raiz:** `/api/ai/simulate` ignorava o roteador canônico de pedidos e enviava todo turno de restaurante diretamente ao prompt genérico, sem uma fronteira de dry-run para o catálogo e para o handoff.

**Fix:** o simulador agora monta uma sessão efêmera e chama `tryHandleAiWhatsAppOrdering` com `dryRun`, cliente/planner injetáveis para testes, preview determinístico de pedido e texto de handoff; mutações, dispatcher, persistência e escalação real continuam bloqueados — `server/aiSimulator.ts:62`, `server/aiWhatsAppOrdering.ts:319`, `tests/aiSimulatorOrdering.test.ts:1`.

**Recovery / rollout:** publicação concluída em 2026-09-01 (`/api/version=516899316987`) após os gates de build; executar a conversa controlada e manter a IA da Bem Servido desligada até confirmar entrada, catálogo completo, pedido escrito e handoff no ambiente publicado.

---

## XXVIII. IA de restaurante improvisava o cardápio e interrompia o pedido (corrigido em 2026-08-31)

**Sintoma:** no teste da Bem Servido, a IA não ofereceu o ZeloMenu nem pedido escrito, omitiu misturas e acompanhamentos, perguntou “arroz ou feijão?” embora ambos fossem opcionais e parou após a conexão entregar três mensagens atrasadas em lote.

**Causa-raiz:** o handler canônico de pedidos estava implementado, mas não era invocado por `server/ai.ts`; o modelo genérico recebia um catálogo achatado e improvisava. Além disso, a conexão ficou sem entregar eventos por cerca de três minutos e o lote posterior foi corretamente interrompido pelo takeover de uma mensagem enviada no WhatsApp da loja.

**Fix:** o turno de restaurante entra primeiro no fluxo canônico, oferece o link ou pedido por escrito, consulta grupos reais com IDs string, cardinalidade e todas as opções, e usa o dispatcher durável com `AiTurnPermit` para respostas, botões e handoff — `server/ai.ts`, `server/aiWhatsAppOrdering.ts`, `server/zeloMenuInternalClient.ts`, `src/domain/aiWhatsAppOrdering.ts`.

**Recovery:** manter a IA da empresa desligada até publicar e validar a integração autenticada; depois testar em conversa controlada o primeiro contato, as sete misturas, duas bases opcionais e os doze acompanhamentos antes de reativar para clientes.

---

## XXVII. Mensagens enviadas pelo WhatsApp da loja não apareciam no ZeloChat (corrigido em 2026-08-31)

**Sintoma:** textos e áudios enviados diretamente no WhatsApp da Bem Servido apareciam para o cliente, mas não entravam no histórico da conversa com Vinicius no ZeloChat.

**Causa-raiz:** a RPC nativa gravava `payload_fingerprint=null` contra um constraint que exige fingerprint em jobs de conversa; para mídia, o parser também ignorava os campos reais `message.base64` e `message.mediaUrl`, impedindo processamento imediato e replay.

**Fix:** a persistência separa payload terminal, fingerprint e conteúdo exibível, enquanto o parser aceita bytes inline ou baixa mídia somente de hosts HTTPS permitidos, com limite de tamanho — `server/fromMe.ts:1`, `server/fromMeProcessor.ts:86`, `supabase/migrations/20260831205926_fix_native_from_me_persistence.sql:1`.

**Recovery concluído (2026-08-31):** os oito eventos autenticados da conversa afetada foram recolocados na fila após o deploy; todos processaram na primeira tentativa, geraram mensagem/job `human_native_whatsapp` com fingerprint de 64 caracteres, os três áudios ficaram estruturados e o controle permaneceu Manual, sem erro ou dead-letter.

---

## XXV. Pareamento por QR reiniciava logo após conectar (corrigido em 2026-08-31)

### Sintoma

Após ler o QR Code, a conta aparecia conectada e voltava para “Aguardando QR Code” poucos segundos depois.

### Causa-raiz

Durante o pareamento, a tela consulta o QR em intervalo curto e cada consulta reenviava a configuração da instância ao provedor; o evento real confirmou `open` e, em seguida, a sessão voltava a `connecting`.

### Fix

// FIX 2026-08-31: a consulta do QR repetia a reconfiguração da instância após o pareamento → `setWebhookForInstance` memoriza cada registro concluído no processo e não repete a atualização — `server/whatsapp.ts:777`, `tests/whatsappWebhookRegistration.test.ts:1`.

// FIX 2026-08-31: o alerta dependia apenas de evento em tempo real ou da tela de Configurações, e timeout podia virar “desconectado” → o app consulta periodicamente o status da empresa e mantém o último estado quando o provedor responde como desconhecido — `src/hooks/useWhatsAppSessions.ts:685`, `src/domain/whatsappConnection.ts:1`, `server/whatsapp.ts:701`.

### Recovery

Publicar o backend e gerar um novo QR Code. O próximo pareamento mantém a configuração inicial e as consultas seguintes não reiniciam a sessão.

---

## XXVI. Resposta automática só aparecia após atualizar a conversa (corrigido em 2026-08-31)

**Sintoma:** o cliente recebia a resposta automática no WhatsApp, mas a bolha não surgia no atendimento até a página ser recarregada.

**Causa-raiz:** a criação atômica da resposta e do job de envio não publicava a nova mensagem; apenas o worker emitia mudanças de lifecycle, que não inserem uma bolha ausente no frontend.

**Fix:** o dispatcher publica a mensagem persistida no instante em que a fila é criada, usando o JID que o operador tem aberto e o ID de mensagem para deduplicar tentativas — `server/conversationOutbound.ts:624`, `server/messageHandler.ts:1355`.

---

## XXIV. Rollback parcial podia reabrir a corrida entre humano e IA (risco cercado em 2026-08-30)

### Sintoma possível

Após um rollback, uma resposta automática poderia voltar a ser enviada depois de atuação humana, ou um eco do servidor poderia ser interpretado como takeover nativo.

### Causa-raiz

Não havia um modo server-side fail-safe, telemetria redigida nem sequência única para pausar IA/worker preservando o ledger durante rollback e rolling deploy.

### Fix

// FIX 2026-08-30: rollout/rollback não distinguiam observação de mutação → shadow agora só classifica e mede, enforce é explícito, worker tem kill switch e o cleanup 067 exige confirmação pós-drain — `server/outbound/rollout.ts:1`, `server/fromMeProcessor.ts:140`, `server/outbound/observability.ts:1`, `docs/runbooks/HUMAN_TAKEOVER_OUTBOUND.md:1`.

### Recovery / rollout

Seguir o runbook: voltar a `shadow`, desligar auto-respostas, parar o worker com o kill switch, preservar ledger/modos humanos e nunca reverter migrations ou reativar IA em massa. A migration 067 não entra no rollout inicial e falha fechado sem confirmação explícita de que as réplicas antigas drenaram.

---

## XXIII. Eco `fromMe` podia ser confundido com atuação humana nativa (risco corrigido em 2026-08-30)

### Sintoma possível

Uma mensagem enviada pelo servidor podia ser duplicada no histórico, enquanto uma resposta enviada pelo celular do operador não pausava a IA e permitia resposta automática posterior.

### Causa-raiz

A decisão dependia de um `Map` local de IDs e persistência fire-and-forget; não havia correlação cross-replica, takeover transacional nem replay durável do raw event.

### Fix

// FIX 2026-08-30: `fromMe` dependia de memória local/fire-and-forget → ID persistente decide eco, fingerprint abre hold e a RPC 066 grava envio nativo + takeover atomicamente — `server/router.ts:523`, `server/fromMeProcessor.ts:1`, `supabase/migrations/066_native_from_me_takeover.sql:1`.

Review R1 fechou duas janelas adicionais: sucesso HTTP agora exige raw event realmente persistido, e o takeover nativo após correlação divergente libera somente o hold `from_me_pending_correlation` do job correspondente, sob os mesmos locks; holds independentes permanecem intactos — `server/router.ts:995`, `supabase/migrations/066_native_from_me_takeover.sql:83`.

Review R2 eliminou a inversão `job→control` nas RPCs de hold/reconciliação: todas as mutações de correlação seguem `gate→control→job`, com lookup inicial sem lock e revalidação tenant-scoped do job após adquirir o mutex canônico — `supabase/migrations/066_native_from_me_takeover.sql:197`.

### Recovery / rollout

Aplicar a migration 066 antes deste backend. Manter `FROM_ME_NATIVE_MODE=shadow` até validar fixtures sanitizadas de mídia e concluir Task 9/rollout; em `enforce`, somente raw event com `auth_status='token_match'` pode executar takeover.

---

## XXII. Resposta automática podia ultrapassar takeover humano (risco corrigido em 2026-08-30)

### Sintoma possível

Uma resposta, confirmação de pedido ou aviso de Pix iniciado pela IA podia chegar depois que operador, WhatsApp nativo, toggle Manual ou escalação já haviam assumido a conversa.

### Causa-raiz

O inbound, debounce, modelos e helpers não carregavam o mesmo epoch durável, e caminhos especiais enviavam mensagens diretamente sem o fence atômico da fila.

### Fix

O `AiTurnPermit` agora acompanha a execução inteira; modelos/helpers falham fechado, jobs AI validam epoch no banco, escalação usa claim condicional atômica, confirmação pending compara epoch/trigger na mesma transação do pedido e validação Pix é cercada antes/depois do modelo — `server/ai.ts:132`, `server/conversationControl.ts:229`, `server/escalation.ts:200`, `supabase/migrations/065_conversation_outbound_claims.sql:740`.

As rotas humanas do ZeloChat também deixam de chamar transporte direto: `/api/send`, CRM, contato/lista/localização/reação/enquete e retry reservam o dispatcher como `human_zelochat` com política `take_over`, ator autenticado e resposta de lifecycle discriminada — `server/router.ts:1523`, `server/customers/router.ts:91`, `tests/manualOutboundRoutes.test.ts:1`.

### Recovery / rollout

Aplicar a migration 065 antes deste backend e manter enforcement desligado até concluir a reconciliação `fromMe` e a migração de transacionais/campanhas/automações; não reintroduzir sends customer-facing diretos em `server/ai.ts` nem nas rotas humanas do operador.

---

## XXI. Retry humano de mídia pre-R2 podia assumir payload sem prova forte (risco auditado em 2026-08-30)

### Sintoma possível

Uma repetição com a mesma idempotency key podia assumir um job humano de mídia ainda em `preparing`, criado antes do fingerprint forte, e materializar bytes diferentes sobre a intenção antiga.

### Causa-raiz

O schema pre-R2 guardava somente metadata fraca de arquivo; o Round 3 permitia ao claim novo preencher `intent_payload_fingerprint=null`, mas nome/MIME/caption não provam quais bytes originaram a intenção humana.

### Fix

O dispatcher novo falha fechado antes de claim/upload e pede uma nova tentativa quando mídia humana não traz fingerprint forte; o RPC de 5 argumentos só pode adotar null-intent para AI, preservando o overload de 4 argumentos exclusivamente para réplicas antigas durante o rollout — `server/conversationOutbound.ts:254`, `supabase/migrations/065_conversation_outbound_claims.sql:517`, `tests/conversationOutbound.test.ts:410`.

### Recovery / rollout

Não editar nem reaproveitar o job legado. O operador deve reenviar a mídia, gerando nova intenção/idempotency key. Não remover o overload de 4 argumentos até todas as réplicas antigas drenarem.

---

## XX. `ocultar_no_pdv` misturava venda manual com publicação online (2026-08-24)

### Sintoma

Um produto podia ser tornado visível no PDV interno e acabar tratado como
publicado/ativo no cardápio digital, apesar de serem canais diferentes.

### Causa-raiz

O resolver de `src/domain/zelomenuPublication.ts`, os cálculos de catálogo e
alguns fallbacks ainda usavam `ocultar_no_pdv` como bloqueio customer-facing.
Isso contrariava o overlay `zelomenu_product_publications`, que já possui
`visivel_online` e `pausado_manualmente` próprios.

### Fix / recovery

O código passou a usar `visivel_online`/`pausado_manualmente` para publicação,
mantendo estoque, categoria e complementos como regras online independentes.
Não fazer backfill automático: a Bem Servido foi deliberadamente mantida sem
qualquer alteração de dados nesta rodada.

---

Knowledge base de causas-raiz já vistas em produção. Use como **primeira parada**
quando algo quebra antes de abrir um ticket pro Whatsmiau, antes de subir um fix,
antes de re-deployar. Mantenha vivo — cada outage novo vira uma entrada aqui.

> Ver também: [[BILLING]] · [[CODE_REVIEW]] · [[FIXES_PROGRESS]]

> Triagem rápida em 5 segundos: olhe o "Sintoma" de cada bloco, encontre o mais
> próximo do que você está vendo, leia a "Diagnose" e siga a "Recovery".

---

## XIX. Sweeper de exclusão podia duplicar trabalho ou apagar a instância fallback (risco auditado em 2026-08-13)

> Não houve deleção real executada durante a validação nem incidente de cliente confirmado. Este bloco registra um failure mode reproduzível no código que roda em produção.

### Sintoma possível

Duas réplicas podiam selecionar a mesma conta vencida; uma reativação podia disputar com a purga; falhas de listagem/remoção de Storage eram tratadas como sucesso; e uma empresa sem instância própria podia chegar ao fallback global de WhatsApp em um fluxo destrutivo.

### Causa-raiz

O worker fazia SELECT direto por `deletion_scheduled_at`, sem claim cercado, usava `deleteInstance()` (que preserva um fallback legado válido para envio), listava no máximo 1.000 objetos por prefixo e continuava até `delete_account` mesmo após falhas externas. A rota de reativação também ficava atrás do paywall e limpava o agendamento mesmo quando a retomada de billing falhava.

### Fix

Claim/finalização atômicos por token no banco compartilhado, com renovação/validação do lease antes de cada efeito externo; reativação adquire um token mutuamente exclusivo antes do Stripe e somente o token exato conclui, enquanto resultado externo ambíguo mantém a conta cercada; deleter usa somente o pointer de instância capturado pelo claim e nunca o fallback; QR/connect checa ambos os fences e compensa criação upstream em CAS perdido; Storage paginado e fail-closed; erros de lookup de assinatura propagados. Cobertura em `tests/accountDeletionReliability.test.ts`.

### Recovery / rollout

1. Aplicar primeiro a migration que cria os pares de token de purge/reativação e os RPCs `claim_due_account_deletions`, `renew_account_deletion_claim`, `finalize_claimed_account_deletion`, `begin_account_deletion_reactivation`, `complete_account_deletion_reactivation` e `abort_account_deletion_reactivation`.
2. Só depois publicar o backend ZeloChat; inverter a ordem faz o tick do sweeper falhar fechado, sem deletar conta, mas gera erro operacional a cada execução.
3. Em falha de cleanup, corrigir o provedor/bucket e aguardar o lease permitir novo claim; nunca chamar `delete_account` manualmente para “destravar”.
4. Um fence de reativação abandonado bloqueia purge por segurança. O titular pode repetir a reativação após 30 minutos; se não voltar, reconciliar manualmente o resultado do Stripe antes de liberar qualquer fence.

---

## XVIII. PDF/documento recebido não aparecia no app (2026-07-31)

### Sintoma
Cliente enviava um anexo pelo WhatsApp, mas a empresa não via o PDF no ZeloChat; o arquivo permanecia visível apenas no WhatsApp.

### Causa-raiz
O texto era extraído após `unwrapMessage`, mas a criação do anexo e a busca de `base64`/`mediaUrl` liam apenas `msg.message.*` direto; payloads `documentWithCaptionMessage` e wrappers equivalentes perdiam o documento. Na tentativa específica da cliente `Téchne Sistemas`, o log bruto registrou nove eventos para o número informado, mas nenhum `documentMessage` — apenas três `imageMessage`, cinco textos e uma reação — então o PDF testado não chegou ao webhook nessa tentativa.

### Fix
Entrada e saída passaram a usar o payload desembrulhado recursivamente; MIME `application/pdf` com parâmetros também é normalizado. O bucket `zelochat-media` foi corrigido de 10 MB para 25 MB via Supabase CLI — `server/messageHandler.ts:751`, `server/messageHandler.ts:2118`, `tests/messageHandlerMedia.test.ts:1`, `supabase/migrations/047_media_bucket_size_limit.sql:1`.

### Recovery
Publicar o build do commit corrigido. Se um novo teste não aparecer no log bruto como `documentMessage`/`documentWithCaptionMessage`, o problema está antes do ZeloChat (entrega/formato do provedor); se aparecer, conferir `processed_at`, `processing_error` e o tipo do anexo persistido.

---

## XVII. Cérebro IA travava após refactor da tela

### Sintoma
Ao abrir Configurações → Cérebro IA em produção, a tela quebrava com `qrSaveState is not defined` ao renderizar as respostas rápidas.

### Causa-raiz
O refactor removeu os bindings locais de estado/ref junto com seções aposentadas, mas manteve usos desses bindings no salvamento das respostas rápidas e no campo de instruções.

### Fix
Os bindings `qrSaveState`, `qrDebounceRef` e `promptRef` foram restaurados em `AIConfigsView`, com guardrail de regressão — `src/components/views/AIConfigsView.tsx:196`, `tests/aiConfigsViewGuardrails.test.ts:1`.

### Recovery
Publicar o build corrigido e recarregar a tela; não é necessário alterar dados ou configurações da empresa.

---

## XVI. IA recusava pedido "pra já" dizendo que o horário já passou

### Sintoma
Cliente pedia pra retirar/receber na hora e a IA respondia algo como "Esse horário já passou hoje: 20:08. Agora são 20:09. O atendimento funciona das 11:00 às 23:00." (Bem Servido). Mensagem sem sentido: 20:08 está dentro do horário e é ~agora.

### Causa-raiz
Pedido imediato recebe `pickupTime ≈ agora`; `isPastSameDaySchedule` (`server/ai.ts`) marcava como passado qualquer horário `<=` o minuto atual (tolerância zero), então 1 min de latência entre o carimbo e a validação virava "já passou". Bug adjacente: o parser de horário (`collectRequestedTimeMinutes`) tratava o "a"/"as" solto como horário, confundindo preço/quantidade/tempo-relativo ("a 5 reais" → 05:00, "daqui a 20 minutos" → 20:00, "as 5 da tarde" → falso 05:00).

### Fix
Tolerância de 15 min (`SAME_DAY_PAST_GRACE_MINUTES`) — só é "passado" quando claramente atrás de agora — e negative lookahead no parser excluindo unidades de preço/quantidade/período. `server/ai.ts:1150`, `server/ai.ts:1203`. Regressão: `tests/aiScheduleEdgeCases.test.ts` (63 casos de comunicação informal BR).

### Recovery
Já corrigido em código. Se reaparecer, checar se `SAME_DAY_PAST_GRACE_MINUTES` cobre a latência real e se o horário veio de preço/quantidade mal interpretado no texto do cliente.

---

## XV. Mover pedido retornava 500/UNKNOWN_ERROR

### Sintoma
O operador arrastava um pedido no Kanban e ele voltava para a coluna anterior com erro 500; o navegador mostrava apenas `UNKNOWN_ERROR`.

### Causa-raiz
Erros retornados pela RPC de transição são objetos PostgREST, mas a rota só reconhecia `Error` nativo e descartava a mensagem real.

### Fix
O normalizador classifica revisão, estoque, permissão e estado inválido; a rota responde com orientação amigável e o toast mostra a causa — `src/domain/orderTransitionError.ts`, `server/router.ts:2040`, `src/AppShell.tsx:880`.

### Recovery
1. Atualizar a tela e tentar novamente.
2. Se aparecer estoque insuficiente, corrigir o estoque do item e repetir.
3. Se aparecer pedido alterado em outra tela, recarregar a lista antes de mover.

---

## XIV. Pedido ZeloMenu aguardando aceite sem impressao e grupo truncado

### Sintoma
Pedido publico do ZeloMenu chegava sem imprimir enquanto aguardava a decisao da loja; quando impresso, o bilhete mostrava apenas o inicio do produto configuravel.

### Causa-raiz
O listener de pedidos nao ficava ativo durante o Atendimento e o formatador da impressora cortava cada item em 32 caracteres; `pending_review` tambem nao tinha uma representacao de aceite na interface.

### Fix
O listener agora fica ativo durante todo o uso do restaurante, `pending_review` imprime na chegada e aparece com acoes explicitas de aceitar/recusar; o bilhete passa a quebrar linhas e preservar os modificadores — `src/AppShell.tsx:271`, `src/hooks/useOrders.ts:192`, `src/components/views/ProductionView.tsx:622`, `src/services/printerService.ts:25`.

### Recovery
1. Confirmar que o Zelo Impressao esta conectado.
2. Criar um pedido publico com massa, molho, proteina e acompanhamentos.
3. Verificar que o bilhete sai antes do aceite e contem todas as escolhas.
4. Aceitar o pedido e confirmar que ele vai para Pendente sem imprimir um segundo bilhete.

---

## XIII. Pedido ZeloMenu sem venda nos relatorios

### Sintoma
O pedido #33BCA323 apareceu no chat, mas nao apareceu nos relatorios nem no caixa.

### Causa-raiz
A transicao direta para delivered nao passava pelo fechamento financeiro do ZeloPDV, deixando zelo_orders.sale_id nulo.

### Fix
Trigger compartilhado cria venda e itens de forma idempotente e escolhe o caixa cujo intervalo contem o horario da entrega; a migration tambem recupera entregas antigas — ../zelopdv/.ai/migrations/canonical_order_sales_2026_07_23.sql:1.

### Recovery
O pedido afetado foi reparado e esta vinculado a venda 13505 no caixa 588; novas entregas passam pelo mesmo boundary automaticamente.

---

## XII. Pedido normal escalado como cliente frustrado

### Sintoma
Uma mensagem normal de pedido pelo cardápio digital era encaminhada para atendimento humano com o motivo "Reclamação ou cliente irritado".

### Causa-raiz
O modelo podia escolher o gatilho nativo amplo de reclamação e o backend executava a escalação sem conferir se a mensagem atual do cliente tinha um sinal explícito de insatisfação.

### Fix
O planejador de ferramentas agora valida os gatilhos nativos contra a última mensagem do cliente; pedidos, saudações e consultas de status não passam pela escalação, enquanto reclamações claras continuam passando — `src/domain/escalationIntent.ts`, `server/ai.ts`, `server/builtinTriggers.ts`.

### Recovery
1. Após o deploy, testar uma confirmação normal do ZeloMenu e uma reclamação explícita (por exemplo, "veio errado").
2. A primeira deve continuar no atendimento automático; a segunda deve abrir a escalação humana.

---

## XI. Pedido confirmado entra na produção mas gerente não é avisado

### Sintoma
- Cliente confirma o pedido fora do horário humano.
- O pedido aparece na produção, mas o gerente não recebe o alerta configurado
  como "Novo pedido".
- No chat, cards antigos de conferência podem dar a impressão de que o pedido
  ainda aguarda confirmação, mesmo após a confirmação.

### Causa-raiz
Gatilhos `notify_manager` eram executados apenas quando o modelo chamava
`dispatch_trigger`; pedidos finalizados pelo caminho determinístico
`confirmPendingOrder` criavam a row em `zelochat_orders`, mas não reavaliavam
gatilhos de evento real como "Novo pedido".

### Fix
Pedidos confirmados agora selecionam gatilhos determinísticos de evento
(`novo pedido` e pedido grande por quantidade) e notificam o gerente depois da
criação do pedido — `src/domain/orderEventTriggers.ts:45`,
`server/ai.ts:121`, `server/ai.ts:692`. Cards de conferência também foram
reescritos como histórico da etapa, não estado atual — `src/domain/chatFeedback.ts:141`.

### Recovery
1. Conferir se o pedido existe em Produção.
2. Se existir e o gerente não recebeu aviso, verificar se há gatilho ativo
   `notify_manager` com texto de novo pedido e se o telefone do gerente está
   preenchido.
3. Após este hotfix, reproduzir com um pedido pequeno e confirmar que o gerente
   recebe o alerta assim que o pedido entra na produção.
4. Para produto não identificado, conferir o card azul de análise; grafias
   "esfirra/esfiha" e "hambúrguer/hamburguinho" agora devem mapear antes de
   escalar.

## X. Bundle renovado no ZeloPDV segue sem acesso no ZeloChat

### Sintoma
- Cliente paga a renovação do bundle via AbacatePay dentro do ZeloPDV.
- No banco, `subscriptions.status='active'`, `plan_tier='bundle'` e
  `current_period_end` fica no futuro, mas o ZeloChat continua mostrando
  paywall / `SUBSCRIPTION_INACTIVE`.

### Causa-raiz
O ZeloChat priorizava `manually_extended_until ?? current_period_end`. Quando a
row compartilhada tinha uma extensão manual antiga já vencida, ela sombreava um
`current_period_end` renovado no futuro e fazia a assinatura parecer expirada.

### Fix
A expiração efetiva agora é sempre o timestamp válido mais longo entre
`current_period_end` e `manually_extended_until` em `server/supabase.ts`,
`server/subscriptionSweeper.ts`, `src/hooks/useSubscription.ts` e
`src/components/billing/BillingCards.tsx`. Regressão coberta em
`tests/subscriptionExpiry.test.ts`.

### Recovery
1. Conferir a row em `public.subscriptions` do cliente.
2. Se `status='active'`, `plan_tier in ('chat','bundle')`,
   `current_period_end > now()` e `manually_extended_until < now()`, aplicar
   hotfix limpando o override vencido:
   `UPDATE subscriptions SET manually_extended_until = NULL WHERE id = ...;`
3. Pedir para o operador recarregar o ZeloChat ou aguardar a próxima leitura da
   assinatura.
4. Confirmar que o bundle continua ativo e que a data exibida no billing card
   bate com o vencimento mais longo.

## IX. Gerar QR Code não recupera após instância apagada no provedor

### Sintoma
- Empresas tentando reconectar o WhatsApp ficam vendo a mensagem para aguardar
  alguns segundos e clicar em "Gerar QR Code" de novo, mas o QR nunca aparece.
- O problema começa depois que a instância da empresa é apagada manualmente no
  painel do provedor.

### Causa-raiz
`empresa_perfil.whatsmiau_instance` continuava apontando para o nome apagado; o
endpoint de QR reutilizava esse nome em vez de criar uma nova instância.

### Fix
Quando o provedor responde 404 ao buscar o QR, `/api/qr` e `/api/qr/refresh`
limpam somente o ponteiro antigo daquela empresa, criam uma nova instância e
tentam buscar o QR novamente no mesmo fluxo — `server/router.ts:1038`,
`server/instanceManager.ts:275`, `server/whatsapp.ts:638`.

### Recovery
1. Clicar em "Gerar QR Code" novamente depois do deploy do hotfix.
2. Se ainda não aparecer em até 60s, rodar `npx tsx scripts/diagnose-webhooks.ts`
   dentro do container do backend para conferir instância upstream e webhook.
3. Não regenerar `webhook_token`; o hotfix preserva esse segredo.

---

## VIII. IA pega pedido quando hoje está bloqueado na agenda

### Sintoma
- Em uma data bloqueada/feriado, a IA responde disponibilidade de produto e avança para Pix/retirada como se fosse pedido para hoje.

### Causa-raiz
As travas determinísticas só bloqueavam datas explícitas ou intenção direta de pedido; fluxos conduzidos por disponibilidade de produto, Pix, retirada, nome e continuações curtas dependiam do modelo respeitar o prompt.

### Fix
A validação pré-OpenAI agora bloqueia intenção operacional de hoje em `blocked_dates` quando não há data futura explícita, e pendências antigas são revalidadas antes da confirmação — `server/ai.ts:952`, `server/ai.ts:959`, `server/ai.ts:584`, `server/ai.ts:3273`.

### Recovery
1. Conferir se a data bloqueada aparece em Calendário → Datas bloqueadas.
2. Testar no Cérebro IA com frases como “tem coxinha?”, “vou mandar o pix e meu filho vai buscar”, “retirada às 10:50” e “só isso”.
3. A resposta esperada deve avisar que a data está bloqueada e oferecer outro dia ou atendente, sem pedir Pix, nome, retirada ou confirmação.

## 🔍 Como diagnosticar quando inbound morre

Outage típico: "outbound funciona (cliente recebe), inbound não chega (operador
não vê mensagem nova)". Antes de qualquer coisa, rode o script de diagnóstico:

```bash
# De dentro do container do backend (mais fácil — env vars já carregadas):
docker exec <backend-container> sh -c 'cd /app && npx tsx scripts/diagnose-webhooks.ts'

# Ou localmente, com as env vars de prod carregadas:
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... WHATSMIAU_API_KEY=... \
  npx tsx scripts/diagnose-webhooks.ts
```

O script imprime 3 sinais por empresa: **(a)** se a public URL responde POST,
**(b)** se o nome da instância no nosso DB bate com o nome upstream no
Whatsmiau, **(c)** se a URL registrada no Whatsmiau bate com a que esperamos.
A combinação aponta direto pra um dos blocos abaixo.

---

## VII. Reconectar WhatsApp fica preso em timeout ao gerar QR

### Sintoma
- Após desconectar manualmente, clicar em "Gerar QR Code" mostra:
  `Aguardando resposta do WhatsApp (timeout of 10000ms exceeded)`.
- A tela de instâncias da Whatsmiau aparece como desconectada, enquanto o card
  de Configurações pode mostrar o último estado conectado por cache visual.
- Mensagens manuais pelo painel falham e mensagens enviadas pelo WhatsApp comum
  não aparecem no ZeloChat enquanto a instância não reconecta.

### Causa-raiz
Confirmado em 2026-06-03: problema no proxy do provedor WhatsApp. O backend do
ZeloChat estava respondendo, mas as chamadas de conexão/QR/envio para a
infraestrutura do provedor não completavam corretamente.

Observação importante: `/api/healthz` **não diagnostica WhatsApp**. Ele só
prova que o backend Express do ZeloChat responde HTTP e deve continuar simples,
sem autenticação, sem banco e sem chamadas ao provedor.

### Fix
Não havia correção estrutural a fazer no ZeloChat para o proxy do provedor. O
ajuste local foi apenas de resiliência/copy: timeout de QR mantém a tela em
tentativa automática e não expõe detalhes técnicos ao operador —
`server/whatsapp.ts:674`, `src/components/views/SettingsView.tsx:188`.

### Recovery
1. Confirmar no dashboard/logs do provedor se há incidente/proxy instável.
2. Se ficar em `connecting` por mais de 60s, rode no container do backend:
   `npx tsx scripts/diagnose-webhooks.ts` para checar instância upstream,
   webhook registrado e reachability pública.
3. Não usar `/api/healthz` como evidência de saúde do WhatsApp; ele pode estar
   verde enquanto o proxy do provedor está fora.
4. Se a instância não existir mais upstream ou estiver com nome divergente,
   seguir o bloco "Whatsmiau renomeou as instâncias upstream".

---

## I. POST `/webhook/:instance` retorna 405

### Sintoma
- Dashboard do Whatsmiau ("Webhook Logs") mostra entrega com **HTTP 405**.
- `docker logs <backend>` mostra **zero** linhas `[WebhookTrace] received`.
- `curl -X POST https://chat.zelopdv.com.br/webhook/foo` retorna HTML com
  `nginx/1.27.5 — 405 Not Allowed`.
- Mensagens manuais saem (outbound OK).

### Causa-raiz
Traefik (proxy edge) só tem regras pra `/api/*` e `/ws/*` apontando pro
container do Express. Tudo que não casa cai na regra catch-all `Host(...)` →
container nginx (frontend SPA), que retorna 405 em POST porque o `location /`
do nginx só serve `try_files` (GET).

### Como confirmar em 30s
```bash
curl -sI -X POST https://chat.zelopdv.com.br/webhook/test
# Procure por: "server: nginx/..." e "HTTP/2 405"
# Se vier nginx, a request NÃO chegou no Express.
```

### Recovery (durável — feito 2026-05-22)

1. **Dokploy DB**: existe uma row em `public.domain` por path-prefix. Adicione
   uma pra `/webhook` espelhando a do `/api`:
   ```sql
   INSERT INTO domain (
     "domainId", host, https, port, path, "createdAt", "applicationId",
     "certificateType", "internalPath", "stripPath", "domainType"
   ) VALUES (
     '<nanoid-21>', 'chat.zelopdv.com.br', true, 3001, '/webhook',
     '<iso-now>', '<backend-applicationId>', 'letsencrypt', '/', false, 'application'
   );
   ```
   `applicationId` do backend hoje: `7OMY4wjXU_ZsvihBZ8uNP` (confira via
   `SELECT "domainId", path, "applicationId" FROM domain WHERE host LIKE '%zelopdv%';`).
2. Dokploy só regenera o YAML do Traefik no próximo deploy, então **suba também
   um override manual imediato** em `/etc/dokploy/traefik/dynamic/zelochat-webhook-route.yml`
   com a regra pronta (já existe no servidor desde 2026-05-22 — verifique se
   ainda está lá). Traefik recarrega arquivos dinâmicos sem restart.
3. Confirme: `curl -X POST https://chat.zelopdv.com.br/webhook/test` deve
   retornar **HTTP 404 com JSON** (Express recebeu — instância não existe),
   nunca mais 405.

### Prevenção
Qualquer rota nova fora de `/api` e `/ws` precisa de uma Domain entry em
Dokploy. Não confie no catch-all do Host.

---

## II. Whatsmiau renomeou as instâncias upstream

### Sintoma
- Outbound OK, inbound silencioso.
- `GET /v2/webhook/find/{nosso_nome}` retorna config correta (URL nossa, token
  certo, enabled=true) — mas mesmo assim **nenhum POST chega**.
- `GET /evolution/instances` lista os mesmos nomes da nossa DB mas **com sufixo
  adicional** (ex: `_d3c6ca80`).
- Algumas instâncias antigas somem completamente da listagem (Donutopia no
  incidente original — retorna 500 em `/v2/webhook/find`).

### Causa-raiz
Whatsmiau (Evolution v2 wrapper) faz migrações internas sem aviso, anexando
sufixos aos nomes de instância. O `/webhook/set` aceita o nome antigo como
alias (e até retorna a config armazenada via `/v2/webhook/find`), mas o
**delivery worker** novo procura webhook só pelo nome novo — encontra nada e
descarta a mensagem silenciosamente. Outbound continua funcionando porque
`/message/sendText/{nome_antigo}` resolve pelo alias.

Já aconteceu uma vez (2026-05-22). Pode repetir.

### Como confirmar em 30s
```typescript
// Dentro do container, em REPL ou tsx:
const r = await axios.get(`${BASE_URL}/evolution/instances`, { headers: { apikey: API_KEY }});
console.log((r.data.data ?? r.data).map(i => i.name ?? i.whatsmiau_instance_id));
// Compare com: SELECT whatsmiau_instance FROM empresa_perfil WHERE whatsmiau_instance IS NOT NULL;
// Se os nomes upstream têm sufixo que a DB não tem → este é o bug.
```

### Recovery

1. Edite `scripts/repair-whatsmiau-instances.ts`, preencha `TARGETS` com
   `{ oldName, newName }` para cada empresa.
2. Dry-run primeiro: `DRY_RUN=1 npx tsx scripts/repair-whatsmiau-instances.ts`.
3. Aplicar: `npx tsx scripts/repair-whatsmiau-instances.ts`.
4. Reiniciar backend (`docker restart <backend>`) pra invalidar o cache do
   `instanceManager` (TTL 60s — restart é instantâneo).
5. `webhook_token` **NÃO PODE** ser regenerado. É o segredo que autentica o
   `?token=...` na URL do webhook. Mantenha estável; o script preserva.

### Prevenção
Não temos. É upstream. O diagnóstico está embutido no `diagnose-webhooks.ts`
(ele compara DB vs `/evolution/instances`).

---

## III. Loop de re-registro de webhook (every 16s)

### Sintoma
- `docker logs <backend>` mostra `[WhatsmiauTrace] register_instance_start` /
  `register_instance_done` em loop infinito pra **uma única instância**, a cada
  ~15-16 segundos.
- Não causa outage por si só — só desperdiça RPC e polui logs.

### Causa-raiz
`POST /api/qr` e `POST /api/qr/refresh` chamam `setWebhookForInstance()` ANTES
de buscar o QR. Se algum frontend está com a tela de QR aberta (operador
desconectado tentando reescanear), ele polla esses endpoints a cada 5-15s →
loop.

### Recovery
Curto prazo: pedir pro operador fechar a tela de QR / reconectar o WhatsApp.

Longo prazo (TODO):
- Mover `setWebhookForInstance()` pra apenas a CRIAÇÃO da instância em
  `instanceManager.createInstance`, não nas chamadas de QR refresh.
- Ou: cachear no `setWebhookForInstance` (ex. throttle 5min por instância)
  pra que polling não vire spam.

---

## IV. Local dev rouba o webhook de prod

### Sintoma
- Backend prod parece estar respondendo (health checks OK), mas inbound não
  chega — apesar da diagnóstico mostrar `Matches expect: NO`.
- A URL registrada no Whatsmiau aponta pra um `*.trycloudflare.com` ou
  `*.localhost.run`.

### Causa-raiz
`server/whatsapp.ts → registerWebhook()` registra a URL pública atual no
startup. Em dev, isso é o tunnel cloudflared do `scripts/tunnel.js`. Se algum
dev rodou `npm run dev:server` apontando o `.env` pra prod, ele sobrescreveu
o webhook de prod.

CLAUDE.md tem a seção "Local dev steals the production webhook" com o fix
recomendado: `WHATSMIAU_DISABLE_WEBHOOK_REGISTER=1` no `.env.local`.

### Recovery
- Curto: redeploy do backend em Dokploy → na inicialização ele chama
  `reRegisterTenantWebhooks()` e restaura a URL correta.
- Médio: garantir que `WHATSMIAU_DISABLE_WEBHOOK_REGISTER=1` está no
  `.env.local` de todo dev.

---

## V. `webhook_token` ausente em alguma empresa

### Sintoma
- `diagnose-webhooks.ts` mostra `Token set: NO` para uma ou mais empresas.
- Pra essas, `reRegisterTenantWebhooks()` no startup **pula** (a query filtra
  `webhook_token IS NOT NULL`).
- Inbound dessa empresa para — webhook fica órfão.

### Causa-raiz
Algum fluxo antigo criou a `empresa_perfil.whatsmiau_instance` sem gerar o
token. Hoje `getOrCreateOwnInstanceForEmpresa` sempre gera, mas instâncias
antigas podem estar sem.

### Recovery
1. Gerar token e gravar:
   ```sql
   UPDATE empresa_perfil
     SET webhook_token = gen_random_uuid()::text
     WHERE id = '<empresa-id>' AND webhook_token IS NULL;
   ```
2. Re-registrar webhook upstream com a nova URL contendo o token:
   ```typescript
   await setWebhookForInstance(instance);
   ```

### Prevenção
Nunca regenere `webhook_token` de uma empresa que já tem um — é o secret do
`?token=` na URL registrada no Whatsmiau, e flipá-lo deixa o webhook órfão até
o próximo `setWebhookForInstance()`.

---

## VI. Dokploy gotcha — appName ↔ service name invertidos

### Não é um bug, é um pé-em-falso recorrente

- Serviço "backend" no Dokploy tem `appName=zelochat-frontend-bl94ow` (sim,
  invertido).
- Serviço "frontend" no Dokploy tem `appName=zelochat-backend-ukztla`.

Ao olhar `/etc/dokploy/traefik/dynamic/*.yml`, **o arquivo `zelochat-frontend-bl94ow.yml`
contém as rotas do Express (porta 3001)** e `zelochat-backend-ukztla.yml` as
rotas do nginx (porta 80). Não tente "consertar" o nome.

---

## Apêndice — comandos de SSH/Docker frequentes

```bash
# Listar containers
docker ps --format '{{.Names}}'

# Logs do backend (lembrar: appName invertido)
docker logs --since=10m <zelochat-frontend-bl94ow.X.YYYY>

# Logs filtrados
docker logs <c> 2>&1 | grep -E 'WebhookTrace|AutoReplyTrace|InboundTrace'

# Conectar no postgres do Dokploy
docker exec -it dokploy-postgres.1.<task-id> psql -U dokploy -d dokploy

# Conferir Traefik dinâmico
cat /etc/dokploy/traefik/dynamic/*.yml

# Restart de um serviço Swarm (não use docker restart; ele cria task nova)
docker service update --force <service-name>
```

Credenciais de SSH e Dokploy estão na auto-memory do agente (`project_dokploy.md`).
