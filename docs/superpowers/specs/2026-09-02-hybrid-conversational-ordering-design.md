# Pedidos conversacionais híbridos no WhatsApp

**Status:** aprovado em 2026-09-02  
**Repositórios:** ZeloChat e ZeloMenu  
**Cliente de referência:** cardápio real da Bem Servido, convertido em fixture anônima e congelada

## Problema

O ZeloChat já consegue consultar o catálogo canônico, transcrever áudio e criar um rascunho no ZeloMenu, mas essas capacidades ainda não formam uma experiência segura de ponta a ponta. O cliente pode começar um pedido na saudação e ser interrompido, mandar partes do pedido em mensagens ou áudios e perder contexto, ou chegar a uma confirmação que não representa todas as regras do cardápio. Produtos montáveis agravam o problema porque preço, limites e disponibilidade pertencem aos grupos do ZeloMenu, não ao texto inventado pela IA.

O público principal inclui consumidores brasileiros com pouca familiaridade digital. A conversa precisa aceitar linguagem simples, áudios, erros e respostas curtas, sem transformar o WhatsApp em um formulário longo. Ao mesmo tempo, o pedido final deve ser tão estruturado e validado quanto um pedido montado diretamente no ZeloMenu.

## Objetivos

- Exibir o link direto do ZeloMenu no início da conversa e oferecer exatamente um botão: `Pedir por aqui`.
- Aceitar texto e áudio em todas as etapas; botões e listas apenas aceleram escolhas.
- Resolver produtos, variações, grupos, preços, publicação e estoque exclusivamente pelo catálogo canônico do ZeloMenu.
- Coletar em uma única passagem tudo o que o cliente já informou e perguntar somente o próximo dado necessário.
- Tratar produtos simples, variantes e produtos montáveis sem adivinhar escolhas ambíguas.
- Oferecer grupos opcionais uma vez, de forma compacta, e aceitar `sem extras`.
- Confirmar somente um rascunho completo, revalidado e protegido contra repetição e tomada humana.
- Tornar toda a jornada reproduzível offline, inclusive áudio, retries, reinício do processo e payloads interativos.

## Princípios de conversa

1. **Natural primeiro, controles no momento de risco.** A IA conversa em português brasileiro curto e cordial. Botões aparecem em decisões consequentes ou pequenas ambiguidades; listas aparecem apenas quando reduzem esforço de verdade.
2. **Nunca obrigar o controle visual.** O cliente pode digitar ou falar `a segunda`, `quero nhoque`, `sem extras`, `pode fechar` ou qualquer equivalente reconhecível.
3. **Uma pergunta por vez, sem apagar informações adiantadas.** Se o cliente disser em um áudio “massa talharim, frango, molho branco, arroz e bife”, todas as seleções válidas são aplicadas na mesma atualização. A resposta pergunta somente o que continuar faltando.
4. **Ambiguidade explícita.** Coca-Cola regular e zero, tamanhos diferentes ou duas linhas iguais nunca são escolhidos por palpite. A conversa mostra somente as alternativas atualmente vendáveis.
5. **Resumo é contrato.** A confirmação lista quantidade, produto, cada escolha, adicionais pagos, modalidade, endereço/horário, pagamento, observação e total. Mudanças de preço, taxa a confirmar ou indisponibilidade impedem confirmação silenciosa.

## Jornada aprovada

### Entrada

A primeira resposta contém uma saudação curta, o URL visível e clicável do cardápio e um único botão `Pedir por aqui`. Não há botão permanente para atendimento humano, porque ele induz transferência desnecessária. Pedidos explícitos por atendente continuam sendo respeitados por texto ou áudio.

Se a primeira mensagem já contém um pedido — por exemplo, `Oi, quero uma Coca 2 L` — a resposta mantém o link, mas processa o pedido no mesmo turno. Uma saudação nunca tem precedência sobre conteúdo comercial.

Ao tocar `Pedir por aqui`, a IA responde com uma instrução curta: o cliente pode escrever ou mandar áudio com o que deseja. O retry do mesmo evento não gera uma segunda resposta.

### Produto simples ou com variantes

Para `quero uma Coca`, o ZeloChat consulta o ZeloMenu e recebe somente SKUs publicados e disponíveis. Controle de estoque desligado significa que `estoque_atual = 0` não bloqueia o item. Se houver regular/zero e 2 L/600 ml/lata, a resposta oferece essas opções com nome e preço. Até três escolhas exclusivas usam botões; de quatro a dez podem usar lista; acima disso a conversa pede um filtro.

Escolher uma opção grava o ID canônico. A IA não cria uma linha genérica chamada “Coca” nem transforma a escolha em observação livre.

### Produto montável

Depois que o produto-pai é resolvido, o ZeloMenu devolve os requisitos canônicos ainda pendentes em ordem de exibição. Cada requisito contém cardinalidade por seleção e por quantidade total, permissão de repetir opção, limite por opção, modo de preço (`somar` ou `substituir`) e opções atualmente disponíveis.

O ZeloChat aplica todas as escolhas reconhecidas e então segue esta política:

- grupo obrigatório: perguntar individualmente o próximo grupo incompleto;
- grupo obrigatório com uma única opção segura: selecionar automaticamente e mostrar a seleção no próximo resumo;
- grupo opcional: oferecer uma única vez em uma mensagem compacta;
- vários grupos opcionais: podem ser agrupados em uma oferta curta, desde que nomes, limites e adicionais pagos permaneçam claros;
- `sem extras`, `só isso` ou equivalente: marcar os opcionais oferecidos como recusados para não repetir a pergunta;
- seleção acima do limite: explicar o limite e manter somente o estado canônico anterior, sem cortar escolhas silenciosamente;
- adicional pago: mostrar o acréscimo antes da confirmação.

Exemplo Bem Servido: `Monte Sua Massa` começa em R$ 0 no produto-pai, mas o grupo de massa usa preço de substituição. A apresentação correta é `a partir de R$ 22,00`; nunca `R$ 0,00`. Massa e molho são obrigatórios; proteínas, acompanhamentos e adicionais são opcionais conforme os limites do catálogo. `Bife acebolado + R$ 12,00` deve aparecer tanto na oferta quanto no resumo.

### Dados de fechamento

Após os itens, os requisitos seguintes são modalidade (`entrega` ou `retirada`), dados necessários da modalidade, forma de pagamento e qualquer confirmação operacional que o ZeloMenu exigir. Valores conhecidos do contexto do cliente podem ser sugeridos, mas valores históricos nunca são aplicados se o cliente os contradisser.

A ausência de modalidade não vira retirada por padrão. Taxa de entrega desconhecida ou que precise de confirmação permanece visível e bloqueia uma promessa de total fechado.

### Revisão, alteração e cancelamento

Quando não houver requisito bloqueante, o ZeloMenu emite um token de confirmação ligado à revisão atual. O ZeloChat persiste o ponteiro dessa revisão antes de enfileirar a mensagem e envia três botões:

- `Confirmar`
- `Alterar`
- `Cancelar`

`pode`, `fechado`, `certinho`, `show` e `👍` confirmam somente quando existe um resumo pendente. `sim, mas...`, `fechado, só troca...` e cancelamentos parciais são alterações. `Cancelar` encerra o rascunho inteiro; `tira a Coca` altera uma linha.

Dois cliques, um clique junto de `sim` ou retries do provedor produzem no máximo um pedido e uma confirmação ao cliente. Token antigo nunca confirma revisão nova.

## Responsabilidades dos sistemas

### ZeloMenu — autoridade canônica

O ZeloMenu é responsável por:

- busca de catálogo com publicação, pausa e estoque;
- relacionamento produto → grupo → opção;
- montagem parcial persistente com `lineId` estável;
- validação de cardinalidade e opção repetida;
- preço provisório e final, inclusive substituição;
- lista estruturada de requisitos pendentes;
- revalidação transacional e confirmação idempotente;
- consistência entre produto vinculado e componente canônico;
- agregação de estoque de produtos vinculados em todas as linhas e quantidades;
- recusa de mutação quando o permit de IA perdeu a validade.

O ZeloMenu não decide qual pergunta soa natural nem interpreta fala livre.

### ZeloChat — orquestração conversacional

O ZeloChat é responsável por:

- juntar fragmentos ainda não tratados em ordem causal;
- usar a transcrição concluída como conteúdo do áudio;
- extrair intenções e IDs permitidos do resultado canônico;
- enviar um patch canônico por rajada de mensagens;
- escolher a próxima pergunta e o formato text/button/list;
- lembrar quais grupos opcionais já foram oferecidos ou recusados;
- normalizar respostas interativas do provedor;
- gerar texto curto e determinístico em confirmação, erro e recuperação;
- interromper mutações e envios quando houver tomada humana;
- entregar fallback limitado e nunca permanecer em silêncio.

## Máquina de estados

O estado público da jornada é:

```text
idle
  -> resolving_candidates
  -> collecting_requirements
  -> ready_for_review
  -> confirming
  -> confirmed
```

Estados terminais ou laterais: `cancelled`, `handoff` e `needs_customer_adjustment`.

O rascunho canônico pode existir durante `collecting_requirements`; nessa fase ele não possui ação de confirmação. `ready_for_review` exige zero requisito bloqueante, revalidação válida e nenhuma taxa ou preço pendente. O estado conversacional (`última pergunta`, opcionais oferecidos e IDs de mensagens consumidas) é serializado de maneira durável pelo ZeloChat e referencia `orderingId` + `revision`.

## Contrato canônico

Cada linha recebe `lineId` opaco e estável. Um patch substitui explicitamente a seleção declarada para a linha, em vez de concatenar texto. IDs são aceitos somente se pertencerem à hierarquia retornada para aquele produto.

O snapshot devolve, além de carrinho e preço:

```ts
type OrderingRequirement = {
  id: string;
  kind: 'modifier_group' | 'fulfillment_type' | 'delivery_address' |
    'pickup_schedule' | 'payment_method' | 'customer_name' | 'review';
  blocking: boolean;
  lineId?: string;
  groupId?: string;
  label: string;
  minSelections?: number;
  maxSelections?: number;
  minTotalQuantity?: number;
  maxTotalQuantity?: number;
  allowsQuantity?: boolean;
  maxPerOption?: number | null;
  pricingMode?: 'somar' | 'substituir';
  options?: Array<{
    id: string;
    name: string;
    currentPrice: number;
    priceDelta: number;
    available: boolean;
  }>;
};
```

O snapshot também informa `readyForConfirmation`. `confirmationAction` é obrigatoriamente `null` quando esse valor for falso.

## Integridade de produtos vinculados e componentes

Uma opção de grupo aponta para exatamente um produto ou um componente canônico. A função transacional de materialização deve resolver os dois destinos:

- produto vinculado: respeita pausa, publicação aplicável, estoque e `price_override`;
- componente: respeita pausa global, resolve nome e `price_override`, mas não cria débito de estoque de produto;
- grupo obrigatório considera ambos os destinos ao decidir se existe opção disponível;
- pausa concorrente entre resumo e confirmação é detectada dentro da mesma transação.

A prévia em Node e a confirmação SQL devem calcular a mesma disponibilidade e o mesmo preço. Estoque de produto vinculado é somado por `quantidade da linha × quantidade da opção` em todas as linhas antes de validar o saldo.

## Segurança e concorrência

- Todo comando inclui empresa, JID normalizado, message ID e revisão esperada.
- A hierarquia de IDs válidos é validada por linha; um option ID de outro produto nunca é aceito.
- Busca abreviada de pedido é sempre escopada por empresa e conversa.
- A confirmação é idempotente por mensagem e sessão canônica.
- O permit de IA inclui o epoch da conversa. A mutação canônica e a confirmação verificam o epoch na mesma transação que grava o estado.
- A tomada humana entre transcrição/modelo e mutação resulta em zero mutação e zero envio automático.
- Payload interativo é limitado em tamanho, quantidade, caracteres e IDs conhecidos antes de persistir/enviar.

## Durabilidade

O ACK do webhook só ocorre depois de persistir o evento bruto. Eventos de entrada ficam em estados processáveis e são retomados após reinício; não são marcados como concluídos antes do handler terminar. Texto, áudio e interativos seguem a mesma trilha de replay e deduplicação.

Áudio possui estados `pending`, `done` e `failed`. Ausência de chave, arquivo vazio, formato inválido, tamanho acima de 5 MB, timeout e falha do serviço sempre liberam a conversa com uma resposta curta ou transferência controlada. Nenhum caminho aguarda 90 segundos ou fica silencioso.

O limite anti-spam não descarta a quarta interação: ele enfileira, resume ou envia uma orientação determinística com próxima tentativa segura.

## Estratégia de testes

Será criado um runner offline stateful com relógio, IDs, repositório, cliente canônico, transcritor, planejador e dispatcher injetáveis. Qualquer acesso de rede não registrado falha o teste.

Fixtures versionadas cobrem texto, áudio, botão, lista, template, fluxo nativo, wrappers, retry e `fromMe`. A fixture de cardápio contém apenas IDs artificiais (`1001+`, `g001+`, `o001+`), nomes, regras e preços necessários. Nenhum UUID, cliente, pedido, URL privada ou dado operacional da empresa real entra no repositório.

Respostas determinísticas usam comparação exata. Caminhos com modelo verificam schema, IDs, invariantes e efeitos, não prosa variável. Integrações SQL usam as migrations reais em Postgres local.

Os cenários bloqueantes incluem: entrada e retry; pedido já na saudação; texto e áudio equivalentes; fragmentação/reinício; Coca ambígua e estoque; Monte Sua Massa completo e parcial; opcionais; limites; preço de substituição; adicional pago; resumo completo; confirmação coloquial; duplo clique; alteração; cancelamento; token antigo; preço/estoque/taxa alterados; falhas de áudio; tomada humana; replay de evento bruto; todas as formas interativas; quarto turno rápido; isolamento entre clientes; componente canônico e estoque vinculado agregado.

## Observabilidade e privacidade

Métricas registram etapa, resultado, latência, quantidade de requisitos e motivo técnico enumerado. Nunca registram texto, transcrição, telefone, endereço, nome, token ou conteúdo do pedido. A operação acompanha taxa de conclusão, perguntas por pedido, correções, transferências, falhas de áudio, conflitos de revisão, duplicações suprimidas e abandonos por etapa.

## Rollout

1. Executar testes unitários, integração local, cenários offline, typecheck e build nos dois repositórios.
2. Manter a IA da cliente voluntária desligada até todos os gates locais passarem.
3. Aplicar migrations e publicar serviços somente após autorização explícita.
4. Fazer canário com a cliente voluntária e monitorar os primeiros pedidos com possibilidade de desligamento imediato.
5. O único risco que não pode ser eliminado offline é a aparência final de botões/listas no aplicativo oficial; isso é validado no canário, sem alterar as regras do pedido.

## Fora de escopo

- Substituir o ZeloMenu por um catálogo duplicado no ZeloChat.
- Obrigar o cliente a completar um formulário ou cardápio digital.
- Inventar item, preço, taxa, disponibilidade ou escolha ausente.
- Ativar, publicar, aplicar migration em produção ou contatar a cliente sem autorização específica.
