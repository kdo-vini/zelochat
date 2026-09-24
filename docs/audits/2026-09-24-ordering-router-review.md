# Revisão do fluxo de respostas — 24/09/2026

## Integração para publicação

Integrada a main `dc6672c`, preservando hold humano de 120s e resolução de prato
nomeado. Corrigida a precedência do roteador sobre o atalho legado de cardápio.
Build e ambos os type-checks passaram. A suíte de 143 arquivos teve duas falhas:
colisão de merge no atalho e fixture de compra antiga em customerReadApi; ambas
foram corrigidas e os dois arquivos passaram em nova execução isolada. Os outros
141 arquivos passaram na execução completa. A integração PostgreSQL é validada
separadamente na CI. A correção de tipagem de canonicalOrders veio da main.

Base: sete commits de `main...fix/ordering-intent-router`, até `89d8778`.
Correções desta revisão estão locais, sem merge, push ou deploy.

## Padrões

Dois achados corrigidos: exemplos literais do gabarito estavam no prompt,
contrariando CLAUDE.md; o documento ainda atribuía ao catálogo toda decisão de
entrada. Exemplos removidos e regra antiga explicitada como fallback.

## Produto e comportamento

| Problema reproduzido | Correção |
| --- | --- |
| Saudação recebia cartão apesar de intenção de conversa | Saudações passam pelo roteador |
| “Obrigado”/“não quero” após uma lista escapavam da classificação | Respostas curtas passam pelo roteador com histórico |
| Ponteiro de pedido encerrado desativava roteamento | Consulta estado canônico uma vez; pedido editável e confirmação mantêm seus caminhos |
| “Quero saber o preço” podia consultar planner de compra | Intenção de dúvida prevalece sobre palavras-chave |
| Pergunta sobre composição recebia “Tem sim” sem evidência | Apresenta preços/opções disponíveis e explicita ausência de composição completa |
| Pedido sem itens caía na IA sem ferramenta de pedido | Pergunta o que o cliente gostaria de pedir |
| Três pratos buscados juntos retornavam zero candidatos | Complementa busca com cada item, até três consultas simultâneas |
| Falha do modelo contava como resposta genérica correta na avaliação | `fallback_unknown` bloqueia o gate; falsos pedidos e cartões são contados |

### Evidência com autoridade real

Executado o matcher do checkout irmão `zelomenu/src/domain/zelomenuCatalogDiscovery.ts`
com o catálogo versionado de `zelomenuCatalogDiscovery.relevance.test.ts`, que
reproduz produtos da Bem Servido. Sem banco ou mensagens de produção:

- `caldo verde, lasanha, escondidinho`: antes `[]`; depois Caldo verde,
  Lasanha 500 g e Escondidinho de carne seca 500 ml.
- `lasanha, penne`: antes só Lasanha 500 g; depois inclui Monte sua massa.

Asserção comparou os IDs recuperados à união das buscas individuais. Isso valida
a recuperação de candidatos nesses cenários; não prova extração do modelo nem
 montagem/confirmação de um pedido real. O teto de 12 candidatos e a ambiguidade
por item continuam levando a esclarecimento, sem escolher alternativas sozinho.

## Avaliação e publicação

Validação local final: `npm test` executou 143 arquivos, com 142 aprovados e
única falha em `tests/customerReadApi.test.ts`; uma integração PostgreSQL fica
excluída pelo runner. `npm run build` passou. `npm run lint` e `npm run lint:server`
reportaram somente os três erros de propriedade em `src/domain/canonicalOrders.ts`
(linhas 102 e 121). Esse arquivo e o teste que falha não diferem da `main`.
Regressões de handler, busca, perguntas, avaliação, botões e confirmação passaram.

O conjunto histórico de 75 casos foi usado no ajuste do prompt. Os 100% citados
anteriormente não são evidência independente e não validam esta versão.
Foi adicionado `challenge-v1.jsonl`: 26 casos sintéticos, seis com histórico,
com expectativas fixadas antes da execução. Depois de usar seus resultados para
ajustar o prompt, esse conjunto também passa a ser regressão, não holdout.

A chave foi disponibilizada posteriormente. Execução do prompt final passou em
duas rodadas consecutivas de cada conjunto. Para reproduzir:

```powershell
npx tsx scripts/evalOrderingRouter.ts
npx tsx scripts/evalOrderingRouter.ts tests/fixtures/ordering-router-eval/challenge-v1.jsonl
```

O gate mede decisões, não a qualidade de cada resposta. Dúvidas sem dados de
composição continuam exigindo conferência da loja. A nova busca pode acrescentar
até dez consultas individuais (concorrência três), além da composta; a latência
histórica de 0,75 s mede só o roteador e não representa o fluxo completo revisado.
Falha do roteador retoma o legado; falhas posteriores de catálogo/pedido ainda
podem usar os caminhos existentes de recuperação e transferência.

Nenhuma mensagem foi enviada a cliente, nenhum pedido real foi criado e nenhuma
configuração de produção foi alterada. O gate do prompt final está aprovado nos conjuntos de regressão. A latência
do fluxo completo (catálogo, planner e envio) ainda precisa ser medida.


### Execução real e correções posteriores

A primeira rodada teve dois timeouts e classificou uma oferta comercial como
pergunta de produto. Uma revisão intermediária passou uma vez e falhou na
repetição dessa oferta. No challenge, uma compra com pergunta de pagamento era
classificada como dúvida; o gate antigo não via isso porque ambas iam ao catálogo.
O gate agora bloqueia também confusão entre `pedido` e `duvida_cardapio`.

O prompt final explicita a prioridade de ofertas comerciais sem solicitação e
preserva intenção de compra em mensagens mistas, sem copiar frases do gabarito.
Nenhum rótulo foi alterado. Os conjuntos foram usados para ajustar o prompt e
são regressão; não representam taxa de acerto de produção.

| Conjunto / rodada final | Decisões | Falhas | Compra/dúvida | p50 | p95 | Máximo |
| --- | --- | --- | --- | --- | --- | --- |
| Referência / 1 | 75/75 | 0 | 0 | 772 ms | 1.255 ms | 1.556 ms |
| Referência / 2 | 75/75 | 0 | 0 | 764 ms | 1.138 ms | 1.389 ms |
| Challenge / 1 | 26/26 | 0 | 0 | 752 ms | 1.041 ms | 1.233 ms |
| Challenge / 2 | 26/26 | 0 | 0 | 737 ms | 1.008 ms | 1.258 ms |

Quatro gates PASS. Divergências entre `conversa`, `outro` e `atendente` podem
permanecer na referência; são agrupadas no mesmo caminho genérico. Testes de
`orderingTurnRouter` e `evalOrderingRouter` passaram novamente após o ajuste.
A latência acima é da chamada do roteador; não inclui catálogo/planner/envio.
A chave foi movida de `.env.example` versionado para `.env` ignorado pelo Git,
sem impressão do valor. Não houve commit, merge, push ou deploy.
