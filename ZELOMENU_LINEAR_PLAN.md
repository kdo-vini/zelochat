# ZeloMenu / ZeloChat — Plano de Produto e Arquitetura

Data: 2026-06-22  
Status: planejamento executivo e técnico  
Formato: backlog por fases, estilo Linear  

## Governança do Projeto

Este plano é o tracker canônico de ZeloMenu/ZeloChat/ZeloPDV. Nenhuma task deste projeto é considerada entregue se a documentação não foi atualizada junto.

### Definition of Done por Ticket

Para marcar qualquer ticket como `Done`, a entrega precisa cumprir:

1. Código, configuração, copy ou decisão implementada.
2. Validação registrada no próprio ticket: teste automatizado, teste manual, comando executado ou motivo explícito para não testar.
3. Status do ticket atualizado neste arquivo.
4. Se o comportamento do ZeloChat mudou, atualizar `CURRENT.md` e, quando aplicável, `FIXES_PROGRESS.md`, `INCIDENTS.md` ou `docs/ai/ZeloChat.memory.md`.
5. Se o comportamento do ZeloPDV mudou, atualizar `docs/CURRENT.md` no repo ZeloPDV e, quando aplicável, a documentação operacional do módulo afetado.
6. Se uma decisão nova foi tomada, adicionar uma nova entrada `D-XXX` no registro de decisões ou atualizar a decisão existente, preservando o histórico quando a decisão foi refinada.
7. Se um ticket altera pricing, plano, acesso ou entitlement, atualizar também o mapa comercial/plano afetado antes de considerar entregue.

### Regra de PM

Documento desatualizado é trabalho incompleto. O PM ou agente responsável deve rejeitar qualquer entrega que muda comportamento sem atualizar este plano e os docs vivos dos repos afetados.

## Norte

O Zelo passa a ser pensado como um sistema operacional comercial para lanchonetes pequenas.

- Marca guarda-chuva: **Zelo**
- Domínio principal por agora: **zelopdv.com.br**
- Produtos/módulos públicos: **ZeloPDV**, **ZeloChat**, **ZeloMenu**
- Não existe produto público "Core"
- ZeloMenu não é app operacional do dia a dia: é camada de cardápio, publicação, carrinho e confirmação
- Operação diária acontece nas superfícies contratadas: ZeloChat, ZeloPDV e a tela comum de Pedidos

## Decisões Fechadas

- ZeloPDV continua **R$59**.
- ZeloMenu para clientes ZeloPDV custa **+R$40**, total **R$99**.
- ZeloChat sobe para **R$147** e passa a incluir ZeloMenu obrigatoriamente.
- Bundle ZeloPDV + ZeloChat + ZeloMenu custa **R$197**.
- Casa dos Salgados é exceção comercial individual: piloto por alguns meses antes do aumento.
- ZeloChat é "IA de atendimento com cardápio online".
- ZeloMenu para ZeloChat é "pedido sem bagunça no WhatsApp".
- ZeloMenu para ZeloPDV é "cardápio online integrado ao seu PDV".
- Pedidos/Cozinha deixa de ser addon comercial e vira motor interno de pedidos da plataforma.
- A UI de Pedidos aparece conforme plano/módulo contratado; ZeloPDV puro R$59 não ganha pedidos/cozinha automaticamente.
- Estado do pedido é único e compartilhado entre ZeloChat e ZeloPDV quando ambos existem.
- ZeloChat conversa. ZeloMenu estrutura. ZeloPDV opera.

## Domínios

- Site principal: `zelopdv.com.br`
- Painel ZeloChat: `chat.zelopdv.com.br`
- ZeloMenu público: `menu.zelopdv.com.br/{slug}`
- Configuração do ZeloMenu fica dentro dos apps autenticados existentes, não em `menu.zelopdv.com.br/admin`
- Futuro: domínio/subdomínio próprio do cliente como recurso posterior

## Módulos Internos

Usar linguagem de módulos profundos: cada módulo tem uma Interface pequena, Implementation forte e Adapters concretos.

- **Catalog**: fonte comum de produtos, categorias, disponibilidade e publicação.
- **Menu Publication**: decide o que aparece online e como aparece.
- **Cart Session**: sessão de carrinho por contexto.
- **Ordering**: motor interno de pedidos, estados, aceite, produção, sincronização e impressão.
- **Entitlements**: decide acesso a PDV, Chat, Menu, Mesas, Acessos e superfícies operacionais.
- **Access**: resolve ator, empresa, dono, subusuário e permissões.
- **Notification Events**: eventos de pedido que podem gerar WhatsApp, alerta interno e impressão.
- **Admin Impersonate**: suporte interno central, completo no MVP, auditado.

## Contextos do ZeloMenu

Implementar primeiro `whatsapp_order`, mas modelar desde o começo:

- `whatsapp_order`: iniciado no ZeloChat, com carrinho pré-montado ou menu vazio.
- `public_order`: iniciado por link público da loja.
- `table_order`: iniciado por QR de mesa/comanda.

## Regras de Produto

- Produto base vem do catálogo comum.
- ZeloMenu controla publicação: visível, nome público, descrição, foto, ordem, disponibilidade, adicionais e variações.
- Preço base sempre vem do produto. ZeloMenu v1 não tem override de preço.
- Adicionais/variações são modelo compartilhado, vinculado ao produto, consumido primeiro pelo ZeloMenu.
- Adicionais/variações podem impactar preço.
- Pedido confirmado salva snapshot humano e estrutura computável.
- Fotos são opcionais.
- Estoque só é considerado se o produto controla estoque.
- Produto com controle de estoque ativo e estoque insuficiente bloqueia confirmação.
- Estoque baixa no aceite da loja, não na confirmação do cliente.
- Produtos sem controle de estoque usam disponibilidade/publicação manual.

## Regras de Carrinho e Confirmação

- IA pode montar pré-carrinho quando houver intenção clara.
- Se a intenção estiver vaga, IA manda ZeloMenu cedo.
- Cliente pode editar, remover e adicionar itens no ZeloMenu.
- Confirmação final do pedido sempre acontece no ZeloMenu.
- Uma conversa tem um carrinho ativo por vez.
- Link de carrinho não expira por tempo fixo; tudo é revalidado na confirmação.
- Carrinho/sessão fica salvo no servidor; link carrega apenas identificador seguro.
- Observação livre é permitida, mas sempre força conferência manual.
- Confirmação automática existe como toggle, mas vem desligada por padrão.
- Mesmo com confirmação automática ligada, guardrails podem forçar conferência.

## Regras de Pagamento

- ZeloMenu v1 não processa pagamento online.
- Cliente declara a forma de pagamento.
- Se a loja exige Pix antecipado, ZeloMenu informa claramente antes da confirmação.
- Pedido pode ser confirmado, mas fica bloqueado/aguardando pagamento ou comprovante.
- Comprovante é enviado pelo WhatsApp, não pelo ZeloMenu.
- ZeloChat orienta, recebe e vincula/libera manualmente no MVP.

Copy pública base:

> Esta loja prepara pedidos somente após o pagamento via Pix e o envio do comprovante.

## Agenda, Entrega e Tempo

- Agenda/disponibilidade é fonte única compartilhada já existente no banco.
- ZeloMenu usa essa configuração; não cria agenda paralela.
- V1 representa horário/disponibilidade, não capacidade produtiva.
- Horário escolhido no ZeloMenu é solicitação até o pedido ser aceito.
- Retirada/entrega usam fonte compartilhada, com UI própria de revisão no ZeloMenu.
- Bairros comuns podem ser populados.
- Cliente pode digitar bairro/rua.
- Taxa de entrega v1 é tabela simples por bairro.
- Bairro fora da lista fica com taxa "a confirmar".
- Taxa "a confirmar" permite confirmar pedido, mas força conferência humana.
- Tempo estimado padrão da loja: **50 min**, ajustável manualmente.
- Tempo estimado v1 é único por loja.

## Estados do Pedido

Estados internos iniciais:

- `cart_open`
- `confirmed_waiting_review`
- `confirmed_waiting_payment`
- `needs_customer_adjustment`
- `accepted_for_production`
- `preparing`
- `ready`
- `out_for_delivery`
- `delivered`
- `cancelled`

Estados públicos simplificados:

- pedido recebido
- aguardando confirmação da loja
- aguardando pagamento/comprovante
- confirmado
- em preparo
- pronto/saindo
- concluído/cancelado

## Notificações e Status

- ZeloMenu confirma visualmente.
- ZeloChat envia mensagem automática conforme o estado real do pedido.
- Notificações WhatsApp são configuráveis por evento.
- Defaults essenciais ligados: pedido aceito, recusado/ajuste, pronto para retirada, saiu para entrega.
- Status simples fica disponível no link do ZeloMenu.
- WhatsApp continua sendo o canal principal.
- Segurança do status depende do contexto:
  - WhatsApp: link tokenizado vinculado à conversa.
  - Mesa/QR: sessão temporária vinculada à mesa/comanda.
  - Link público: telefone/código ou token do pedido.

## Impressão

- Impressão automática acontece ao aceitar pedido, quando a empresa tiver Zelo Impressão configurado.
- Pedido recebido/aguardando aceite não imprime por padrão.
- Falha de impressão precisa gerar alerta operacional.
- Reimpressão manual precisa existir.
- V1 imprime o pedido inteiro em uma impressão.
- Arquitetura deve permitir divisão futura por setor/categoria.

## Operação e Apps

- ZeloMenu não precisa ficar aberto no dia a dia.
- Cliente configura publicação/cardápio eventualmente.
- Pedido cai na tela comum de Pedidos.
- Cliente só ZeloPDV + ZeloMenu opera Pedidos no ZeloPDV.
- Cliente só ZeloChat + ZeloMenu opera Pedidos no ZeloChat.
- Cliente bundle pode operar/ver nos dois, sempre sincronizado.
- Sem permissão de PDV, não abre PDV.
- Sem permissão de Chat, não abre Chat.
- Conta única no backend, experiência separada por app por enquanto.
- Novos módulos devem nascer compatíveis com um shell Zelo futuro, sem exigir esse shell agora.

## Registro Completo de Decisões da Entrevista

Este bloco registra as perguntas/respostas tomadas na sessão de planejamento. Quando uma decisão foi refinada depois, a versão final aparece como "Decisão"; a observação explica o ajuste.

### Estratégia, Marca e Domínios

#### D-001 — Categoria que o Zelo quer dominar

Pergunta: qual categoria o Zelo quer dominar nos próximos 3 anos?  
Resposta: sistema operacional comercial para lanchonetes pequenas.  
Decisão: Zelo não deve ser pensado só como PDV barato nem só como IA de WhatsApp; Zelo é uma plataforma operacional modular para lanchonetes.

#### D-002 — Marca guarda-chuva

Pergunta: a marca guarda-chuva deve ser Zelo ou ZeloPDV?  
Resposta: Zelo.  
Decisão: a marca estratégica é Zelo, com subnomes modulares: ZeloPDV, ZeloChat e ZeloMenu.

#### D-003 — Domínio principal

Pergunta: mudar domínio principal agora?  
Resposta: não.  
Decisão: manter `zelopdv.com.br` como domínio principal por agora, por força comercial e SEO.

#### D-004 — "8Core"

Pergunta: usar "8Core" como conceito/produto?  
Resposta: não; foi typo.  
Decisão: não existe produto público "Core"; se houver plataforma interna, ela não vira marca vendida.

#### D-005 — Nome do módulo de cardápio

Pergunta: como chamar o módulo de cardápio/pedido estruturado?  
Resposta: ZeloMenu.  
Decisão: o módulo público se chama ZeloMenu.

#### D-006 — Domínio público do ZeloMenu

Pergunta: `pedir`, `menu` ou `cardapio`?  
Resposta: `menu`.  
Decisão: ZeloMenu público usa `menu.zelopdv.com.br/{slug}`.

#### D-007 — Painel ZeloChat

Pergunta: migrar `chat.zelopdv.com.br`?  
Resposta: manter.  
Decisão: painel do ZeloChat continua em `chat.zelopdv.com.br`.

#### D-008 — Admin do ZeloMenu

Pergunta: ZeloMenu Admin deve viver em `menu.zelopdv.com.br/admin`?  
Resposta: não.  
Decisão: `menu.zelopdv.com.br` é superfície pública; configuração fica dentro dos apps autenticados existentes.

#### D-009 — URL pública da loja

Pergunta: loja deve ter slug público?  
Resposta: sim.  
Decisão: v1 usa `menu.zelopdv.com.br/{slug-da-loja}`; domínio próprio do cliente fica para o futuro.

### Produto e Pricing

#### D-010 — ZeloMenu como feature ou produto

Pergunta: ZeloMenu é só feature obrigatória do ZeloChat ou produto/módulo próprio?  
Resposta: módulo próprio, mas obrigatório dentro do ZeloChat.  
Decisão: ZeloMenu nasce como módulo vendável para ZeloPDV e como capacidade obrigatória do ZeloChat novo.

#### D-011 — Standalone inicial do ZeloMenu

Pergunta: ZeloMenu standalone significa independente de PDV/Chat ou módulo para clientes ZeloPDV?  
Resposta: módulo para clientes ZeloPDV.  
Decisão: v1 do ZeloMenu é comercialmente standalone como addon do ZeloPDV, não produto independente real sem base operacional.

#### D-012 — ZeloPDV preço

Pergunta: ZeloPDV muda de preço?  
Resposta: não.  
Decisão: ZeloPDV continua R$59.

#### D-013 — ZeloMenu preço para ZeloPDV

Pergunta: quanto custa ZeloMenu para clientes ZeloPDV?  
Resposta: R$40.  
Decisão: ZeloPDV + ZeloMenu fica R$99.

#### D-014 — ZeloChat preço

Pergunta: ZeloChat sobe com ZeloMenu obrigatório?  
Resposta: sim.  
Decisão: ZeloChat novo custa R$147 e inclui ZeloMenu obrigatoriamente.

#### D-015 — Bundle principal

Pergunta: preço do pacote ZeloPDV + ZeloChat + ZeloMenu?  
Resposta: R$197.  
Decisão: bundle custa R$197.

#### D-016 — Escopo do bundle R$197

Pergunta: bundle inclui quais capacidades?  
Resposta: ZeloPDV + ZeloChat + ZeloMenu completo.  
Decisão: bundle inclui integração entre PDV, Chat e Menu; Mesas e Acessos continuam separados. Pedidos deixa de ser addon comercial e vira motor interno.

#### D-017 — Casa dos Salgados

Pergunta: clientes atuais do ZeloChat migram como?  
Resposta: Casa dos Salgados é exceção individual.  
Decisão: CS testa por alguns meses em condição atual; depois haverá conversa para migração ao novo preço. Observação operacional refinada em 2026-06-22: a loja usa pouco o fluxo atual de pedidos do ZeloChat porque o motor existente ainda falha em entendimento/conversão; isso reforça que o ZeloMenu + novo Ordering não é polish sobre um fluxo consolidado, e sim substituição do motor fraco atual.

#### D-018 — Posicionamento do ZeloChat

Pergunta: como vender o ZeloChat novo?  
Resposta: IA de atendimento com cardápio online.  
Decisão: não vender só como "IA"; vender como atendimento com IA + cardápio online que organiza pedidos.

#### D-019 — Posicionamento do ZeloMenu por contexto

Pergunta: promessa pública principal do ZeloMenu?  
Resposta: depende do contexto.  
Decisão: para ZeloChat, "pedido sem bagunça no WhatsApp"; para ZeloPDV, "cardápio online integrado ao seu PDV".

#### D-020 — Primeiro público pós-piloto

Pergunta: quem vender depois da Casa dos Salgados?  
Resposta: clientes atuais ZeloPDV.  
Decisão: primeiro lote comercial pós-CS é a base ZeloPDV, com addon ZeloMenu por R$40.

### Prioridade e Fases

#### D-021 — Primeiro caso de uso do ZeloMenu

Pergunta: WhatsApp, link público ou QR mesa primeiro?  
Resposta: WhatsApp/ZeloChat.  
Decisão: MVP resolve a dor da Casa dos Salgados: pedido via WhatsApp estruturado pelo ZeloMenu.

#### D-022 — Casos de uso futuros

Pergunta: outros contextos entram depois?  
Resposta: sim.  
Decisão: médio prazo inclui link público e QR de mesa/comanda.

#### D-023 — Repo/entrega prioritária

Pergunta: começar por ZeloChat ou ZeloPDV?  
Resposta: ZeloChat é prioridade.  
Decisão: execução visível começa no ZeloChat porque o motor de atendimento/pedido muda ali.

#### D-024 — Relação com ZeloPDV no MVP

Pergunta: integração real PDV já no MVP ou modelo preparado?  
Resposta: operacional primeiro no ZeloChat, preparado para sincronizar com ZeloPDV.  
Decisão: MVP da Casa dos Salgados resolve no ZeloChat, sem repetir um beco sem saída incompatível com PDV.

#### D-025 — Escopo por fases

Pergunta: separar piloto 3 dias e MVP 3-4 semanas?  
Resposta: não; escopar tudo e trackear por phases em arquivo MD.  
Decisão: este arquivo é o tracker por fases, com backlog estilo Linear.

### Arquitetura, Apps e Conta

#### D-026 — Fonte de verdade do pedido

Pergunta: ZeloChat, ZeloPDV ou nova camada?  
Resposta: pedido confirmado deve cair no modelo operacional do ZeloPDV sempre que possível.  
Decisão: ZeloChat conversa, ZeloMenu estrutura, ZeloPDV opera; no MVP pode haver etapa compatível no ZeloChat, mas o destino arquitetural é pedido operacional comum.

#### D-027 — ZeloChat sem PDV visível

Pergunta: ZeloChat + ZeloMenu exige PDV?  
Resposta: não na UI; sim em infraestrutura comum.  
Decisão: cliente pode comprar ZeloChat sem acesso ao app ZeloPDV, mas usa modelo operacional comum por baixo.

#### D-028 — Guard de acesso ao PDV

Pergunta: cliente Chat-only pode acessar PDV?  
Resposta: não.  
Decisão: infraestrutura comum não concede acesso comercial; entitlements precisam bloquear app/superfícies não contratadas.

#### D-029 — Shell Zelo único

Pergunta: criar shell único agora?  
Resposta: não agora.  
Decisão: manter apps separados por enquanto; novos módulos nascem compatíveis com shell Zelo futuro.

#### D-030 — Conta única

Pergunta: login separado ou conta Zelo única?  
Resposta: conta única no backend, UI separada.  
Decisão: identidade/empresa/entitlements são comuns; experiências podem continuar separadas.

#### D-031 — ZeloMenu como app operacional

Pergunta: lojista precisa deixar ZeloMenu aberto?  
Resposta: não.  
Decisão: ZeloMenu é configuração/publicação + experiência pública do cliente; operação diária ocorre em ZeloChat/ZeloPDV/Pedidos.

#### D-032 — Tela comum de Pedidos

Pergunta: pedidos do ZeloMenu caem onde?  
Resposta: na tela comum de Pedidos.  
Decisão: Pedidos é superfície operacional comum do motor interno, não tela pertencente ao ZeloMenu.

#### D-033 — ZeloPDV + ZeloMenu operação

Pergunta: para cliente ZeloPDV + ZeloMenu, onde aparece Pedidos?  
Resposta: no menu lateral do ZeloPDV como parte da contratação do ZeloMenu.  
Decisão: o cliente não abre app extra; opera pedidos online dentro do ZeloPDV.

#### D-034 — ZeloChat + ZeloMenu operação

Pergunta: para cliente ZeloChat + ZeloMenu, onde aparece Pedidos?  
Resposta: no ZeloChat.  
Decisão: cliente Chat-only opera pedidos no ZeloChat e não acessa ZeloPDV.

#### D-035 — Bundle e sincronização

Pergunta: quando empresa tem bundle, PDV e Chat ficam sincronizados?  
Resposta: sim, o tempo todo.  
Decisão: estado do pedido é único; aceitar no Chat reflete no PDV e vice-versa.

### Pedidos/Cozinha e Motor Operacional

#### D-036 — ZeloMenu sem ZeloChat

Pergunta: ZeloMenu para ZeloPDV precisa funcionar sem Chat?  
Resposta: sim, com pedido simplificado/operacional.  
Decisão: ZeloMenu sem Chat aceita pedidos, mas sem IA/conversa automatizada.

#### D-037 — Destino operacional do link público

Pergunta: link público precisa de módulo Pedidos?  
Resposta: sim, precisa de destino operacional.  
Decisão: link público cai no motor/tela comum de Pedidos; link de mesa cai em comanda.

#### D-038 — Pedidos/Cozinha como addon

Pergunta: remover Pedidos/Cozinha como addon comercial?  
Resposta: sim.  
Decisão: Pedidos/Cozinha deixa de ser vendido separado e vira motor interno usado por ZeloMenu, ZeloChat, Mesas e PDV quando aplicável.

#### D-039 — ZeloPDV puro e Pedidos

Pergunta: PDV R$59 ganha tela de pedidos/cozinha?  
Resposta: não.  
Decisão: motor interno não libera UI; ZeloPDV puro segue simples.

#### D-040 — Interface operacional compartilhada

Pergunta: uma tela por produto ou uma tela comum?  
Resposta: tela comum.  
Decisão: a mesma superfície operacional de Pedidos aparece no app contratado, guiada por entitlements.

### Catálogo, Publicação e Produto

#### D-041 — Fonte do catálogo

Pergunta: catálogo do PDV, catálogo próprio do Menu ou camada comum?  
Resposta: catálogo comum com UIs diferentes.  
Decisão: Catalog vira módulo interno comum; PDV/Chat/Menu são portas diferentes para editar/publicar.

#### D-042 — Publicação do ZeloMenu

Pergunta: Menu só usa produtos do PDV diretamente?  
Resposta: não; usa camada de publicação.  
Decisão: produto base é comum; ZeloMenu decide visibilidade, apresentação e publicação online.

#### D-043 — Preço

Pergunta: preço vem do PDV ou pode ter override no Menu?  
Resposta: sempre do produto.  
Decisão: ZeloMenu v1 não tem override de preço; empresa escolhe o que fica visível.

#### D-044 — Revenda/preço especial

Pergunta: como lidar com revenda/preço diferente?  
Resposta: removendo/organizando produto na frente principal.  
Decisão: v1 não cria preço por canal; casos de revenda devem ser modelados no catálogo/produto.

#### D-045 — Fotos

Pergunta: fotos obrigatórias?  
Resposta: opcionais.  
Decisão: produto pode ser publicado com ou sem foto.

#### D-046 — Configuração do cardápio

Pergunta: cliente ou equipe Zelo configura?  
Resposta: cliente self-service.  
Decisão: cliente configura o próprio ZeloMenu; equipe Zelo usa impersonate para suporte.

#### D-047 — Sync de edição entre PDV/Chat/Menu

Pergunta: cardápio editável em PDV e Chat fica sincronizado?  
Resposta: sim.  
Decisão: produto base é único; o que muda é a UI e a camada de publicação.

### Adicionais, Variações e Snapshot

#### D-048 — Adicionais/variações no MVP

Pergunta: entram no MVP?  
Resposta: sim, com modelo mais completo.  
Decisão: ZeloMenu v1 suporta estrutura de adicionais/variações, não apenas observação livre.

#### D-049 — Preço em adicionais/variações

Pergunta: adicionais podem alterar preço?  
Resposta: sim.  
Decisão: modelo e carrinho suportam preço adicional desde o início.

#### D-050 — Onde vivem adicionais/variações

Pergunta: PDV, Menu ou compartilhado?  
Resposta: modelo compartilhado.  
Decisão: opções/adicionais ficam vinculados ao produto comum e são consumidos primeiro pelo ZeloMenu.

#### D-051 — Como salvar no pedido

Pergunta: texto, estrutura ou ambos?  
Resposta: ambos.  
Decisão: pedido salva snapshot textual para humanos e estrutura computável para auditoria/relatório/integração.

#### D-052 — Observações livres

Pergunta: permitir observação livre?  
Resposta: sim, mas força conferência.  
Decisão: qualquer observação livre força conferência manual mesmo com confirmação automática ligada.

### Estoque e Disponibilidade

#### D-053 — Estoque no ZeloMenu

Pergunta: estoque entra no v1?  
Resposta: só quando produto controla estoque no PDV/catálogo.  
Decisão: ZeloMenu não inventa estoque; respeita controle existente.

#### D-054 — Produto sem controle de estoque

Pergunta: como tratar produto sem estoque controlado?  
Resposta: disponibilidade manual.  
Decisão: produto sem controle de estoque ignora estoque e pode ser pausado/publicado manualmente.

#### D-055 — Produto com estoque controlado e sem estoque

Pergunta: bloquear ou forçar conferência?  
Resposta: bloquear.  
Decisão: estoque insuficiente em produto controlado impede confirmação no ZeloMenu.

#### D-056 — Momento de baixa de estoque

Pergunta: baixa na confirmação ou aceite?  
Resposta: aceite.  
Decisão: estoque só reduz quando a loja aceita o pedido.

### Carrinho, Link e IA

#### D-057 — Papel da IA no carrinho

Pergunta: cliente monta tudo ou IA pré-monta?  
Resposta: ambos.  
Decisão: IA pode montar pré-carrinho; cliente revisa/edita/confirma no ZeloMenu.

#### D-058 — Momento de mandar ZeloMenu

Pergunta: perguntar tudo no chat ou mandar cedo?  
Resposta: híbrido.  
Decisão: IA monta pré-carrinho quando intenção é clara; se vago, manda ZeloMenu cedo.

#### D-059 — Confirmação final

Pergunta: IA pode finalizar pedido complexo sozinha?  
Resposta: não.  
Decisão: pedido só vale após confirmação estruturada no ZeloMenu.

#### D-060 — Modos/contextos

Pergunta: modelar contextos desde v1?  
Resposta: sim.  
Decisão: arquitetura nasce com `whatsapp_order`, `public_order` e `table_order`, implementando primeiro `whatsapp_order`.

#### D-061 — Expiração de link

Pergunta: link expira por tempo fixo?  
Resposta: não.  
Decisão: link não expira fixamente; preço, horário, disponibilidade e regras revalidam na confirmação.

#### D-062 — Armazenamento do carrinho

Pergunta: carrinho no link ou servidor?  
Resposta: servidor.  
Decisão: link carrega identificador seguro; sessão/carrinho fica no banco.

#### D-063 — Carrinhos por conversa

Pergunta: múltiplos carrinhos abertos por conversa?  
Resposta: não no MVP.  
Decisão: uma conversa tem um carrinho ativo por vez; novo carrinho só após confirmar/cancelar/arquivar o anterior.

#### D-064 — Recuperação de carrinho abandonado

Pergunta: recuperar carrinho abandonado?  
Resposta: sim, simples.  
Decisão: ZeloChat envia uma recuperação após 2 horas, no máximo uma vez.

### Confirmação, Aceite e Estados

#### D-065 — Confirmar pedidos automaticamente

Pergunta: precisa toggle igual iFood?  
Resposta: sim.  
Decisão: loja tem toggle "Confirmar pedidos automaticamente".

#### D-066 — Default do toggle

Pergunta: automático ligado ou desligado por padrão?  
Resposta: desligado.  
Decisão: novos clientes começam com conferência manual por segurança.

#### D-067 — Guardrails do automático

Pergunta: automático sempre respeitado?  
Resposta: não.  
Decisão: observação livre, taxa a confirmar, Pix pendente, estoque, horário/regra inválida ou risco operacional forçam conferência.

#### D-068 — Quem aprova no ZeloChat v1

Pergunta: quem pode aceitar pedido?  
Resposta: qualquer atendente logado no ZeloChat.  
Decisão: v1 é simples; registrar quem aceitou e quando.

#### D-069 — Pedido e conversa

Pergunta: estado de conversa e pedido são o mesmo?  
Resposta: não.  
Decisão: conversa tem modo IA/manual; pedido tem estado operacional próprio.

#### D-070 — Roteamento pós-confirmação

Pergunta: conversa volta para IA ou humano?  
Resposta: depende do estado.  
Decisão: estado do pedido decide se IA comunica, aguarda Pix, chama humano ou envia ajuste.

#### D-071 — Mensagens automáticas por status

Pergunta: ZeloChat deve mandar mensagem após confirmação?  
Resposta: sim, conforme status.  
Decisão: mensagem automática reflete o estado real: aguardando aceite, aguardando Pix, produção, ajuste etc.

### Pagamento, Pix e Comprovante

#### D-072 — Pagamento online

Pergunta: processar pagamento no ZeloMenu v1?  
Resposta: não.  
Decisão: v1 usa pagamento declarativo; sem gateway/checkout online.

#### D-073 — Pix antecipado

Pergunta: se loja exige Pix, bloquear como?  
Resposta: pedido confirma, mas fica aguardando pagamento/comprovante.  
Decisão: ZeloMenu informa antes; ZeloChat conduz comprovante pelo WhatsApp.

#### D-074 — Canal do comprovante

Pergunta: comprovante pelo ZeloMenu ou WhatsApp?  
Resposta: WhatsApp.  
Decisão: ZeloMenu é cardápio/carrinho/confirmação; comprovante continua no ZeloChat.

### Agenda, Horário, Retirada e Entrega

#### D-075 — Dados coletados no contexto WhatsApp

Pergunta: ZeloMenu coleta quais dados?  
Resposta: carrinho + data/horário + retirada/entrega.  
Decisão: pagamento/comprovante ficam no Chat; para mesa/comanda, esses campos não se aplicam.

#### D-076 — Agendamento no WhatsApp

Pergunta: ZeloMenu v1 suporta agendamento?  
Resposta: sim.  
Decisão: contexto `whatsapp_order` suporta data e horário.

#### D-077 — Fonte da agenda

Pergunta: horários vêm de config do Menu ou do Chat?  
Resposta: fonte única compartilhada já existente no banco.  
Decisão: ZeloMenu expõe/consome a mesma agenda/disponibilidade usada pelo ZeloChat.

#### D-078 — Capacidade produtiva

Pergunta: agenda representa capacidade completa?  
Resposta: não.  
Decisão: v1 é horário/disponibilidade, sem limite por slot/produto.

#### D-079 — Horário como promessa

Pergunta: horário escolhido é compromisso da loja?  
Resposta: só após aceite/automático.  
Decisão: antes do aceite, horário é solicitação.

#### D-080 — Retirada/entrega

Pergunta: usar config existente ou própria?  
Resposta: fonte compartilhada com UI própria de revisão.  
Decisão: ZeloMenu usa regras de retirada/entrega existentes, permitindo revisão/apresentação própria.

#### D-081 — Bairros e endereço

Pergunta: bairro só pré-cadastrado?  
Resposta: popular comuns, mas permitir digitar bairro/rua.  
Decisão: cliente pode usar bairro listado ou endereço livre.

#### D-082 — Taxa de entrega

Pergunta: calcular taxa como?  
Resposta: tabela por bairro com fallback a confirmar.  
Decisão: bairro listado soma taxa; bairro fora da lista fica "a confirmar".

#### D-083 — Taxa a confirmar

Pergunta: taxa a confirmar bloqueia pedido?  
Resposta: não.  
Decisão: permite confirmar, mas força conferência humana.

#### D-084 — Tempo estimado

Pergunta: mostrar tempo estimado de preparo?  
Resposta: sim, default 50 min.  
Decisão: empresa ajusta manualmente um tempo único por loja.

### Status, Notificações e Segurança do Link

#### D-085 — Notificações por evento

Pergunta: mudanças operacionais notificam WhatsApp?  
Resposta: configurável por evento.  
Decisão: defaults essenciais ligados; loja pode ajustar.

#### D-086 — Status no ZeloMenu

Pergunta: cliente acompanha status pelo link?  
Resposta: sim, simples.  
Decisão: ZeloMenu mostra estados públicos principais; WhatsApp continua canal principal.

#### D-087 — Segurança do status

Pergunta: exigir login/código sempre?  
Resposta: depende do contexto.  
Decisão: WhatsApp usa token vinculado à conversa; mesa usa sessão temporária; link público pode usar telefone/código/token.

### Impressão

#### D-088 — Impressão automática

Pergunta: imprimir ao confirmar ou aceitar?  
Resposta: ao aceitar.  
Decisão: pedido aceito imprime automaticamente via Zelo Impressão quando configurado.

#### D-089 — App Zelo Impressão

Pergunta: usar integração existente?  
Resposta: sim.  
Decisão: usar app de impressão já existente que escuta o SaaS via porta/local.

#### D-090 — Modelo de impressão

Pergunta: imprimir por setor/categoria ou único?  
Resposta: único no MVP, preparado para setor.  
Decisão: v1 imprime pedido inteiro; arquitetura permite divisão futura.

### Acessos, Admin e Suporte

#### D-091 — Acessos como módulo compartilhado

Pergunta: gestão de acessos precisa entrar na arquitetura?  
Resposta: sim, mas não travar MVP.  
Decisão: Acessos deve evoluir para módulo compartilhado, com guard server-side para ações sensíveis.

#### D-092 — Impersonate

Pergunta: equipe Zelo pode acessar conta de clientes?  
Resposta: sim, completo.  
Decisão: admin interno central terá impersonate completo no MVP, com auditoria mínima e banner visual.

#### D-093 — Onde vive impersonate

Pergunta: Chat, PDV ou admin interno?  
Resposta: admin interno central.  
Decisão: impersonate é recurso do admin interno, não do app operacional.

#### D-094 — Corte para pedido canônico sem dual-write

Pergunta: depois do mapeamento real dos schemas, como migrar sem quebrar a Casa dos Salgados?  
Resposta: usar adapter faseado e evitar duas fontes operacionais ativas ao mesmo tempo.  
Decisão: `zelochat_pending_orders` continua apenas como etapa pré-confirmação/legado WhatsApp; `zelochat_orders` permanece como write-path temporário do piloto no ZeloChat enquanto o adapter novo não estiver pronto; o destino canônico é PDV-owned, com `pedidos`/`pedido_itens` para `whatsapp_order` e `public_order`, e `comandas`/`comanda_itens` para `table_order`. Não haverá dual-write contínuo entre `zelochat_orders` e `pedidos`; a troca deve acontecer por adapter + backfill controlado. No modelo do PDV, `table_order` continua mapeando para a origem operacional já existente `comanda`, não para uma string nova `mesa`.

#### D-095 — Ordering como aggregate único com materialização operacional no aceite

Pergunta: como manter estados pré-aceite (`confirmed_waiting_review`, `confirmed_waiting_payment`, ajuste) sem forçar o schema atual do PDV a representar fases que ele ainda não modela bem?  
Resposta: manter identidade canônica única de pedido no módulo `Ordering` e só materializar no motor operacional no aceite.  
Decisão: o `Ordering` terá um `ordering_id` único do carrinho até a conclusão. Antes do aceite, o estado vive em storage ZeloChat-owned do próprio módulo `Ordering`; no aceite, esse aggregate se vincula a exatamente um destino operacional PDV-owned: `pedidos`/`pedido_itens` para `whatsapp_order` e `public_order`, `comandas`/`comanda_itens` para `table_order`. O motor operacional vira a fonte de verdade da execução/cozinha/fechamento; o aggregate `Ordering` continua sendo a fonte canônica do lifecycle cross-surface e do vínculo entre chat, menu e operação.

#### D-096 — Origem operacional canônica por contexto

Pergunta: como distinguir no PDV pedido vindo do WhatsApp, do link público e da mesa sem misturar semânticas?  
Resposta: mapear cada contexto para uma origem operacional explícita.  
Decisão: `whatsapp_order` materializa em `pedidos.origem='zelochat'`; `public_order` materializa em nova origem PDV `pedidos.origem='zelomenu'`; `table_order` continua com fonte comercial em `comandas`, e seus tickets de cozinha permanecem `pedidos.origem='comanda'`. Não haverá origem nova `mesa` em `pedidos`.

#### D-097 — Produto base comum + camada de publicação separada

Pergunta: nome público, descrição, foto, ordem e visibilidade do ZeloMenu devem virar colunas diretas de `produtos`?  
Resposta: não; isso mistura catálogo operacional comum com apresentação/canal.  
Decisão: `produtos`, `categorias` e `subcategorias` continuam sendo o catálogo base comum e PDV-owned. ZeloMenu usa uma camada de publicação separada, também PDV-owned no destino final, para controlar nome público, descrição, foto, ordem, visibilidade e disponibilidade manual sem poluir o produto base nem criar fork do catálogo.

#### D-098 — Adicionais/variações como modifiers do produto base, sem preço duplicado por canal

Pergunta: adicionais/variações devem ser produtos independentes ou uma cópia de preço dentro do ZeloMenu?  
Resposta: não; o preço base continua no produto comum e os modifiers somam delta.  
Decisão: adicionais/variações são modelados como grupos de seleção e opções ligados ao produto base comum. O preço do item publicado parte de `produtos.preco`; cada opção pode acrescentar delta positivo/zero/negativo. O ZeloMenu não terá preço-base duplicado por canal no v1.

#### D-099 — Entitlement do ZeloMenu separado do legado `has_pedidos_addon`

Pergunta: o novo ZeloMenu deve reutilizar a flag comercial antiga de Pedidos/Cozinha?  
Resposta: não; a semântica de produto mudou e a flag antiga não cobre publicação/menu público.  
Decisão: o entitlement comercial do ZeloMenu deve nascer separado no domínio compartilhado de assinatura, no repo ZeloPDV (`has_zelo_menu` ou equivalente). `has_pedidos_addon` vira sinal legado/grandfathered para clientes antigos e não deve ser usado como nome canônico do novo módulo. Durante a transição, guards podem calcular acesso efetivo combinando entitlement novo + legado, mas o contrato novo não será modelado em cima de `has_pedidos_addon`.

#### D-100 — Surface operacional por capability, não por app liberado

Pergunta: como expor Pedidos/Cozinha sem liberar o app errado para o cliente errado?  
Resposta: separar capability operacional de acesso à superfície do app.  
Decisão: a operação usa capabilities distintas: `ordering_review`, `kitchen_queue`, `menu_publication`, `pdv_core`, `chat_app`, `mesas`, `acessos`. O mesmo motor interno pode alimentar mais de um app, mas o acesso comercial continua por superfície contratada: cliente Chat-only opera no ZeloChat; cliente PDV+ZeloMenu opera no ZeloPDV; bundle opera nos dois; cliente legacy de Pedidos/Cozinha mantém apenas a capability operacional correspondente, sem automaticamente ganhar ZeloMenu nem ZeloChat.

#### D-101 — Sessão de carrinho MVP em tabelas ZeloChat-owned com token hash e link antigo read-only

Pergunta: qual storage mínimo fecha `ZLM-101` sem misturar o motor novo com `zelochat_pending_orders`?  
Resposta: uma sessão canônica própria + histórico de tokens, ambos ZeloChat-owned.  
Decisão: o MVP de carrinho nasce em `zelomenu_cart_sessions` + `zelomenu_cart_tokens`, separados do legado `zelochat_pending_orders`. A sessão guarda `ordering_id`, `context`, `source_ref`, snapshots de cliente/carrinho/fulfillment/preço/pagamento e `revision`; o token público é salvo só como hash. Link antigo continua legível para revalidação (`tokenStatus='stale'`), mas não pode mutar o carrinho; apenas o token atual edita. Isso preserva o invariável "um carrinho ativo por conversa" e evita expor token bruto no banco.

#### D-102 — Slug público do ZeloMenu nasce shared/PDV-owned, não ZeloChat-owned

Pergunta: a fonte canônica de `slug -> empresa/publicação` para `menu.zelopdv.com.br/{slug}` nasce neste repo (ZeloChat-owned), no repo ZeloPDV ou em camada compartilhada? (resolve `ZELOMENU_OPEN_QUESTIONS` ZLM-203)  
Resposta: shared/PDV-owned desde o início.  
Decisão: o slug é uma **identidade pública de loja em nível de empresa**, não um conceito do ZeloChat. Por coerência com D-097 (camada de publicação tem destino final PDV-owned) e com a regra de ownership de `subscriptions`/`empresa_perfil` no `CLAUDE.md`, o slug nasce **PDV-owned** (coluna shared em `empresa_perfil`, ex.: `zelomenu_slug TEXT UNIQUE quando não-NULL`, ou tabela de mapeamento compartilhada), criado **primeiro no repo ZeloPDV** seguindo o workflow de tabela compartilhada (issue no repo PDV → migration lá → pull do schema de volta para o snapshot do ZeloChat). O backend do ZeloChat **serve** a rota pública `menu.zelopdv.com.br/{slug}` (o runtime público de carrinho já vive aqui via `/public-api/zelomenu/...`), mas **lê** o slug da coluna PDV-owned; não cria coluna própria nem fork. Consequência aceita: `ZLM-203` ganha dependência upstream dura no repo ZeloPDV e não pode começar neste repo enquanto a coluna do slug não existir lá. Trade-off explicitamente escolhido em vez do atalho "ZeloChat-owned agora, migra depois" do padrão D-101, priorizando ownership correto de longo prazo sobre velocidade do piloto.

#### D-103 — Resolução de entitlement do ZeloMenu no código local enquanto `has_zelo_menu` não existe no PDV

Pergunta: como o código local (ZeloChat) decide acesso ao ZeloMenu/publicação antes do PDV publicar a flag `has_zelo_menu`? (resolve a parte "não existe camada real de capabilities/entitlements no código local" de `ZELOMENU_OPEN_QUESTIONS` ZLM-205)  
Resposta: resolver read-only local sobre sinais existentes, com seam único para a flag nova.  
Decisão: reafirma D-099/D-100 — `has_zelo_menu` é **ZeloPDV-owned**, nasce no repo PDV junto de `subscriptions`; o ZeloChat nunca faz DDL disso. O que é executável **agora neste repo, sem migration**, é um resolver read-only de capability que computa acesso efetivo ao ZeloMenu a partir de: assinatura `chat`/`bundle` ativa (ZeloMenu incluído obrigatoriamente por D-014) **OU** `has_pedidos_addon` legado/grandfathered. O resolver é **fail-safe para ON** em `chat`/`bundle` (flipar copy de pricing nunca pode trancar quem já tem direito) e expõe **um único seam** para passar a ler `has_zelo_menu` assim que o PDV publicar a coluna. Capabilities seguem o vocabulário de D-100 (`menu_publication`, `ordering_review`, etc.), separadas de acesso à superfície do app.

#### D-104 — Sequência do rollout de pricing e tratamento de clientes existentes

Pergunta: em que ordem virar pricing/entitlement sem trancar ninguém, e o que acontece com clientes pagantes atuais? (resolve a parte de rollout de `ZELOMENU_OPEN_QUESTIONS` ZLM-205)  
Resposta: ordem entitlement-antes-de-copy + grandfather só a Casa dos Salgados, migrando a Agreste.  
Decisão: a ordem obrigatória é (1) PDV/Stripe nascem `has_zelo_menu` + novos price IDs (`STRIPE_PRICE_CHAT` para R$147, novo `STRIPE_PRICE_BUNDLE` R$197, novo `STRIPE_PRICE_MENU` R$40 addon do PDV); (2) ZeloChat lê o entitlement e só então vira a copy de preço; (3) grandfather aplicado. A ordem importa porque o resolver de D-103 precisa estar lendo o direito antes da copy mudar, senão a virada tranca cliente válido. Como `server/billing.ts` já injeta price IDs por env (sem valor hardcoded), a mudança de R$97→R$147 é troca de price ID no Stripe + nova env, não constante de código. **Tratamento de clientes existentes:** Casa dos Salgados permanece pinada na condição atual (D-017, exceção de piloto); **Agreste Salgados é migrada** para o novo R$147 com aviso prévio — exige plano de migração da subscription (operação PDV-owned, pois `subscriptions` é do webhook do PDV) + comunicação ao cliente antes da virada. Novos checkouts já usam os preços novos.

#### D-105 — Storage de imagem do ZeloMenu mantém bridge no bucket `logos`

Pergunta: o bridge atual (bucket compartilhado `logos` + prefixo `zelomenu-products/{userId}/...`) usado no fechamento de ZLM-201 vira solução definitiva ou migra para bucket dedicado? (resolve "Storage de imagem owned" de `ZELOMENU_OPEN_QUESTIONS`)  
Resposta: manter o bridge por ora.  
Decisão: manter o bucket `logos` com prefixo owned `zelomenu-products/{userId}/` como solução do v1 — funciona, o cleanup já está fiado (troca/remoção de foto, exclusão de produto, purge de conta) e o path é escopado por usuário. Revisitar um bucket dedicado (ex.: `zelomenu-media`) só quando `ZLM-203` abrir as imagens para a superfície pública por slug / volume maior justificar isolamento de políticas.

## Contradições Resolvidas

- ZeloMenu começou sendo discutido como feature obrigatória do ZeloChat, mas foi refinado para módulo próprio: addon do ZeloPDV e obrigatório dentro do ZeloChat.
- O destino operacional começou como "Chat primeiro", mas foi refinado: MVP opera no ZeloChat, porém o estado de pedido deve ser compatível com o motor comum e sincronizar com ZeloPDV no bundle.
- "Pedidos/Cozinha" começou como possível addon necessário para ZeloMenu, mas foi decidido que deixa de ser addon comercial e vira motor interno.
- ZeloMenu poderia parecer app próprio, mas foi decidido que não é app operacional diário; operação acontece em Pedidos dentro do app contratado.
- Agenda/entrega pareciam configuração nova do Menu, mas foi decidido usar fonte compartilhada já existente no banco, com UI própria de revisão.

## Backlog por Fases

Legenda:

- `Todo`: não iniciado
- `Doing`: em execução
- `Blocked`: depende de decisão externa
- `Done`: concluído

### Phase 0 — Contrato, Escopo e Preparação

#### ZLM-001 — Consolidar decisão de produto e pricing

Status: Todo  
Type: Discuss  
Depends on: nenhum  
Owner: CEO/Produto  

Escopo:
- Fixar matriz R$59 / R$99 / R$147 / R$197.
- Definir copy comercial dos planos.
- Definir tratamento Casa dos Salgados.
- Decidir como remover Pedidos/Cozinha da grade comercial sem quebrar clientes existentes.

Aceite:
- Pricing documentado.
- Billing/plan tiers mapeados.
- Texto comercial base aprovado.

#### ZLM-002 — Mapear schema atual ZeloChat/ZeloPDV para pedido canônico

Status: Done  
Type: Research  
Depends on: ZLM-001  
Owner: Engenharia  

Escopo:
- Ler `zelochat_orders`, `zelochat_pending_orders`, `pedidos`, `pedido_itens`, `comandas`, `mesas`.
- Identificar quais campos suportam `whatsapp_order`, `public_order`, `table_order`.
- Definir se v1 usa `zelochat_orders` com compatibilidade ou nova tabela de sessões/pedidos no ZeloChat.

Aceite:
- Documento curto com fonte de verdade do pedido no MVP e destino futuro.
- Lista de migrations necessárias, separando ZeloChat-owned e ZeloPDV-owned.

Resultado:

- **Mapeamento atual — ZeloChat**
  - `zelochat_pending_orders` é a etapa pré-confirmação do WhatsApp: uma row por `empresa_id + remote_jid`, TTL curto, campos de retirada/entrega/Pix/observação, sem token público, sem contexto de mesa e sem IDs estruturados de catálogo/adicionais. Base atual: `supabase/migrations/000_zelochat_schema.sql`, `server/ai.ts`, `server/router.ts`.
  - `confirmPendingOrder` faz o fluxo crítico atual: lê a pendência, revalida agenda/estoque/Pix, grava em `zelochat_orders`, limpa a pendência, notifica gerente, responde o cliente e emite `order_created`. Base atual: `server/ai.ts`.
  - `zelochat_orders` é o pedido confirmado do ZeloChat hoje, mas ainda é um modelo de transição: itens em `jsonb` com `{ product, quantity }`, `source` apenas `whatsapp|manual`, status `pending|preparing|ready|out_for_delivery|delivered`, sem `cancelled`, sem `accepted_by`, sem `accepted_at`, sem itemização de cozinha, sem IDs de produto e sem adicionais/variações estruturados. Base atual: `supabase/migrations/000_zelochat_schema.sql`, `src/types.ts`, `src/hooks/useOrders.ts`.
  - Sessão e conversa não são pedido. `zelochat_sessions`/`zelochat_messages` guardam contexto de atendimento, `tool_calls`, feedback cards e confirmações persistidas, mas não são fonte de verdade do estado operacional do pedido. Base atual: `supabase/migrations/000_zelochat_schema.sql`, `server/messageHandler.ts`, `src/domain/chatFeedback.ts`, `src/hooks/useWhatsAppSessions.ts`.
  - UI operacional atual do ZeloChat lê `zelochat_orders` via `useOrders`; `ProductionView`, `KanbanView` e `CalendarView` operam nesse modelo. Pedido manual no chat também grava em `zelochat_orders` com `source='manual'`. Base atual: `src/hooks/useOrders.ts`, `src/components/views/ProductionView.tsx`, `src/components/views/KanbanView.tsx`, `src/AppShell.tsx`, `src/components/views/ChatView.tsx`.
  - Impressão hoje dispara no `order_created` do ZeloChat, isto é, na criação do pedido, não no aceite da loja. Base atual: `src/AppShell.tsx`, `src/hooks/useOrders.ts`.

- **Mapeamento atual — ZeloPDV**
  - `pedidos` é a fila operacional do PDV. O modelo observado no código suporta `numero_pedido`, `status` (`aberto|pronto|fechado`), `nome_cliente`, `observacoes`, `origem`, `id_comanda`, `id_venda`, `id_operador`, `criado_em` e `fechado_em`. Base atual: `src/routes/app/pedidos/+page.svelte`, `src/routes/app/pedidos/novo/+page.svelte`, `src/routes/app/pedidos/[id]/editar/+page.svelte`, `src/routes/app/pedidos/cozinha/+page.svelte`.
  - `pedido_itens` é o snapshot operacional por item: `id_pedido`, `id_produto`, `nome`, `preco_unitario`, `quantidade`, `subtotal`, `enviado_cozinha`, `status_cozinha`. Base atual: `src/routes/app/pedidos/novo/+page.svelte`, `src/routes/app/pedidos/[id]/editar/+page.svelte`, `src/routes/app/pedidos/cozinha/+page.svelte`, `docs/data/SCHEMA_RLS.md`.
  - A tela `/app/pedidos` hoje é intencionalmente um painel de caixa para `origem='balcao'`; não mostra `comanda` e ainda não recebe `zelochat`. A tela `/app/pedidos/cozinha` já é mais próxima de um motor comum: mostra `aberto|pronto`, lê `origem`, aceita `id_comanda` e já renderiza label para `zelochat`, embora ainda não exista producer real dessa origem. Base atual: `src/routes/app/pedidos/+page.svelte`, `src/routes/app/pedidos/cozinha/+page.svelte`.
  - `mesas` e `comandas` são o domínio de `table_order`. `mesas` guarda cadastro/status da mesa; `comandas` é a sessão aberta da mesa; `comanda_itens` é o consumo; fechar comanda converte para `vendas`/`vendas_itens`. Quando a mesa manda item para cozinha, o PDV cria `pedidos` derivados com `origem='comanda'`, mas a fonte comercial continua sendo a comanda. Base atual: `docs/modules/MESAS.md`, `docs/projects/PROJETO_MESAS.md`, `src/routes/app/mesas/+page.svelte`, `src/routes/app/mesas/[id]/+page.svelte`.
  - Catálogo/produtos/categorias continuam shared e PDV-owned. `produtos.id` é `integer`; `pedido_itens` e `comanda_itens` já trabalham com snapshot operacional em cima desse catálogo. Base atual: `CLAUDE.md` do ZeloChat, `docs/projects/PROJETO_MESAS.md`.
  - Guards/entitlements atuais são legados e precisam ser respeitados na migração: `subscriptions.plan_tier` ainda é `pdv|chat|bundle`; PDV expõe Pedidos/Mesas só quando o plano permite e o add-on correspondente está ativo (`has_pedidos_addon`, `has_mesas_addon`), além das permissões de subusuário (`pedidos.acessar`, `pedidos.cozinha`, `mesas.acessar`). Chat-only não pode ganhar acesso ao app PDV. Base atual: `src/lib/guards.js`, `src/lib/components/GestaoSidebar.svelte`, `src/lib/server/accessControl.js`, `src/lib/pricing.js`.

- **Ownership confirmado**
  - ZeloChat-owned: `zelochat_orders`, `zelochat_pending_orders`, `zelochat_sessions`, `zelochat_messages`, `zelochat_drivers` e futuras tabelas de sessão/carrinho do ZeloMenu.
  - ZeloPDV-owned: `pedidos`, `pedido_itens`, `mesas`, `comandas`, `comanda_itens`, `subscriptions`, `produtos`, `categorias`, `subcategorias`, `access_*` e o schema base de `empresa_perfil`.

- **Decisão de fonte de verdade**
  - `whatsapp_order`
    - piloto atual / Casa dos Salgados: `zelochat_pending_orders` -> `zelochat_orders`
    - destino canônico: `pedidos` + `pedido_itens`
  - `public_order`
    - não cabe em conversa nem em `zelochat_pending_orders`
    - destino canônico desde o início: sessão de carrinho ZeloChat-owned + `pedidos` + `pedido_itens`
  - `table_order`
    - fonte de verdade: `comandas` + `comanda_itens`
    - `pedidos` derivados de mesa continuam sendo tickets operacionais de cozinha, não a sessão comercial principal

- **Escolha do MVP**
  - O MVP não deve expandir `zelochat_orders` para virar modelo final da plataforma.
  - O MVP também não deve dual-escrever em `zelochat_orders` e `pedidos`.
  - A escolha é uma **combinação temporária com adapter**:
    - manter o write-path atual da Casa dos Salgados em `zelochat_orders` apenas como compatibilidade mínima até o adapter novo existir
    - criar o módulo `Ordering` já com interface neutra
    - implementar primeiro um adapter legado ZeloChat
    - migrar depois para adapter PDV-owned quando `pedidos`/`pedido_itens` suportarem `whatsapp_order` e `public_order`

- **Por que `zelochat_orders` não pode ser o pedido canônico final**
  - não carrega `product_id`
  - não carrega adicionais/variações estruturados
  - não carrega itemização de cozinha
  - não separa `confirmed_waiting_review`, `confirmed_waiting_payment`, `accepted_for_production` e `cancelled`
  - não registra aceite/operador
  - não cobre `public_order` nem `table_order`
  - imprime cedo demais hoje (na criação, não no aceite)
  - usa `pickup_date` como `text`, enquanto `zelochat_pending_orders` já usa `date`

- **Por que `pedidos` ainda não pode receber o fluxo novo sem mudança no repo PDV**
  - `/app/pedidos` hoje filtra `origem='balcao'`
  - `pedidos` não guarda telefone do cliente, modo entrega/retirada, endereço, taxa, status de Pix/comprovante, token público nem requested/accepted lifecycle do ZeloMenu
  - `pedido_itens` ainda não guarda snapshot estruturado de adicionais/variações
  - `table_order` já tem fonte própria melhor (`comandas`)

- **Migrations necessárias — repo ZeloChat**
  - criar tabelas ZeloChat-owned de sessão de carrinho/token do ZeloMenu (`whatsapp_order` e `public_order` não podem depender de conversa nem de `zelochat_pending_orders`)
  - criar vínculo explícito entre contexto de origem (JID, token público) e `canonical_order_id`
  - manter `zelochat_pending_orders` como legado do WhatsApp até o adapter novo substituir `confirmPendingOrder`
  - evitar nova expansão semântica em `zelochat_orders`; se houver compatibilidade, que seja só de transição

- **Migrations necessárias — repo ZeloPDV**
  - evoluir `pedidos` para aceitar origens operacionais novas sem quebrar `balcao` e `comanda`
  - adicionar no domínio de pedidos os campos operacionais ausentes para `whatsapp_order`/`public_order` (telefone, modo entrega/retirada, endereço, taxa, pagamento declarado, status de pagamento/comprovante, horário solicitado, aceite)
  - evoluir `pedido_itens` para snapshot estruturado de adicionais/variações quando o ZeloMenu entrar
  - ajustar `/app/pedidos`, `/app/pedidos/cozinha`, relatórios e guards para a nova origem sem liberar PDV para cliente chat-only

- **Riscos e mitigação**
  - sincronização: dual-write entre `zelochat_orders` e `pedidos` criaria divergência operacional -> mitigação: adapter com single-write e backfill controlado
  - billing/entitlements: pricing e flags atuais ainda são `R$59/R$97/R$147` + `has_pedidos_addon`; o plano novo exige revisão coordenada de `subscriptions`, checkout e guards -> mitigação: atacar em `ZLM-005` e `ZLM-205` antes de liberar UI nova
  - RLS/tenancy: ZeloChat usa `empresa_id`, PDV usa `id_usuario/get_owner_user_id(auth.uid())` -> mitigação: qualquer adapter server-side precisa resolver `ownerUserId` a partir de `empresaId`; não empurrar essa tradução para o cliente
  - impressão: ZeloChat imprime no `order_created`, mas o produto quer imprimir no aceite -> mitigação: mover disparo de impressão para o estado de aceite no módulo `Ordering`
  - Casa dos Salgados: o fluxo atual depende tecnicamente de `confirmPendingOrder` e da UI de produção baseada em `zelochat_orders`, mas a adoção prática é baixa porque o motor atual não atende bem -> mitigação: não investir em aprofundar esse modelo; manter só a compatibilidade mínima até a migração por empresa
  - mesa/comanda: tratar `table_order` como `pedidos` faria o PDV perder o domínio correto da mesa -> mitigação: `comandas` continua canônica; `pedidos` de mesa seguem derivados para cozinha

- **Próximo ticket recomendado**
  - `ZLM-003 — Definir Interface do módulo Ordering`
  - Objetivo imediato: formalizar estados canônicos (`cart_open`, `confirmed_waiting_review`, `confirmed_waiting_payment`, `accepted_for_production`, etc.) e os adapters `zelochat_legacy`, `pdv_delivery` e `pdv_table`

#### ZLM-003 — Definir Interface do módulo Ordering

Status: Done  
Type: Discuss  
Depends on: ZLM-002  
Owner: Engenharia  

Escopo:
- Desenhar Interface pequena para criar carrinho, revalidar, confirmar, aceitar, recusar, mudar status e emitir eventos.
- Definir Adapters iniciais para ZeloChat e futuro ZeloPDV.
- Definir invariantes: estado único, aceite único, revalidação, estoque no aceite.

Aceite:
- Interface proposta.
- Estados e transições aprovados.
- Test cases de domínio listados antes da UI.

Resultado:

- **Problema que a interface precisa resolver**
  - O módulo `Ordering` precisa atender três callers diferentes com a mesma linguagem de domínio: IA/WhatsApp (`server/ai.ts`), UI pública do ZeloMenu e superfícies operacionais futuras do ZeloChat/ZeloPDV.
  - Ele precisa separar claramente conversa de pedido, sustentar estados pré-aceite, revalidar estoque/horário na borda certa e só criar efeito operacional real quando a loja aceitar o pedido.
  - Ele também precisa permitir migração faseada da Casa dos Salgados sem dual-write contínuo entre `zelochat_orders` e `pedidos`.

- **Alternativas consideradas**
  - **A. Interface larga por CRUD/fase**
    - `openCart`, `updateCart`, `revalidateCart`, `confirmCart`, `acceptOrder`, `rejectOrder`, `requestAdjustment`, `advanceStatus`, `emitEvents`, `getSnapshot`.
    - Vantagem: explícita para quem chama.
    - Problema: shallow demais; cada caller precisa aprender muitas entradas e invariantes espalhados.
  - **B. Interface de comando sobre aggregate único**
    - `apply(command)` + `getSnapshot(ref)`, com `ordering_id` único do carrinho ao pedido aceito.
    - Vantagem: interface pequena, invariantes centralizados, adapters escondidos por trás do módulo.
    - Risco: exige disciplina forte nos tipos de comando.
  - **C. Dois módulos externos (`Carting` + `OperationalOrders`)**
    - Um módulo para carrinho/confirmação, outro para aceite/produção.
    - Vantagem: separa bem pré-aceite de operação.
    - Problema: expõe a divisão interna para todos os callers e cria risco de regras duplicadas no handoff entre módulos.

- **Interface escolhida**
  - Escolha: **Alternativa B**, com interface externa mínima e um aggregate único.
  - Assinatura proposta:

```ts
type OrderingContext = 'whatsapp_order' | 'public_order' | 'table_order';

type OrderingCommand =
  | { type: 'open_cart'; context: OrderingContext; sourceRef: SourceRef; actor: ActorRef; payload: OpenCartPayload }
  | { type: 'change_cart'; orderingId: string; actor: ActorRef; patch: CartPatch }
  | { type: 'revalidate_cart'; orderingId: string; reason: 'customer_opened' | 'before_confirm' | 'before_accept' }
  | { type: 'confirm_cart'; orderingId: string; actor: ActorRef; idempotencyKey: string }
  | { type: 'review_order'; orderingId: string; actor: ActorRef; decision: 'accept' | 'request_adjustment' | 'reject'; note?: string }
  | { type: 'transition_order'; orderingId: string; actor: ActorRef; transition: OrderTransition };

type OrderingResult = {
  snapshot: OrderingSnapshot;
  events: OrderingDomainEvent[];
};

interface OrderingModule {
  apply(command: OrderingCommand): Promise<OrderingResult>;
  getSnapshot(ref: OrderingLookup): Promise<OrderingSnapshot | null>;
}
```

- **Por que essa interface foi escolhida**
  - Mantém o seam externo pequeno: dois métodos apenas.
  - Garante uma identidade única (`ordering_id`) desde o carrinho até o vínculo operacional.
  - Esconde do caller a troca de adapter (`zelochat_legacy`, `pdv_delivery`, `pdv_table`).
  - Permite testes profundos do lifecycle sem precisar conhecer tabela, rota ou UI.

- **Snapshot mínimo exigido**
  - `ordering_id`
  - `context`: `whatsapp_order | public_order | table_order`
  - `state`
  - `cart_snapshot`
  - `fulfillment`: retirada/entrega/mesa
  - `pricing_snapshot`: subtotal, taxa, total, flags de taxa a confirmar
  - `customer_snapshot`: nome, telefone, endereço quando aplicável
  - `payment_snapshot`: método declarado, necessidade de Pix, comprovante validado quando houver
  - `source_ref`: JID, token público ou `comanda_id`
  - `operational_ref`: nulo até o aceite; depois aponta para `pedido` ou `comanda`
  - `revision`
  - `accepted_by`, `accepted_at`, `rejected_at`, `fulfilled_at` quando aplicável

- **Estados canônicos aprovados**
  - `cart_open`
  - `confirmed_waiting_review`
  - `confirmed_waiting_payment`
  - `needs_customer_adjustment`
  - `accepted`
  - `preparing`
  - `ready`
  - `out_for_delivery`
  - `fulfilled`
  - `cancelled`

- **Transições aprovadas**
  - `open_cart` cria `cart_open`
  - `change_cart` mantém `cart_open` ou reabre `needs_customer_adjustment -> cart_open`
  - `confirm_cart`
    - `cart_open -> confirmed_waiting_review`
    - `cart_open -> confirmed_waiting_payment` quando Pix/comprovante ainda for pré-condição operacional
  - `review_order`
    - `confirmed_waiting_review -> accepted`
    - `confirmed_waiting_review -> needs_customer_adjustment`
    - `confirmed_waiting_review -> cancelled`
    - `confirmed_waiting_payment -> accepted` somente se comprovante/regra já estiver validado
    - `confirmed_waiting_payment -> cancelled`
  - `transition_order`
    - `confirmed_waiting_payment -> confirmed_waiting_review` quando o comprovante ficar validado, mas ainda exigir conferência humana
    - `accepted -> preparing`
    - `accepted|preparing -> ready`
    - `ready -> out_for_delivery` apenas para entrega
    - `ready -> fulfilled` para retirada/mesa
    - `out_for_delivery -> fulfilled`
    - `accepted|preparing|ready -> cancelled` apenas por regra operacional explícita

- **Projeção por contexto**
  - `whatsapp_order`
    - aggregate nasce a partir do JID/conversa
    - no aceite, materializa em `pedidos`/`pedido_itens`
    - `pedidos.origem='zelochat'`
  - `public_order`
    - aggregate nasce a partir do token/link público
    - no aceite, materializa em `pedidos`/`pedido_itens`
    - `pedidos.origem='zelomenu'` no repo PDV
  - `table_order`
    - aggregate nasce vinculado a `comanda`
    - fonte comercial continua em `comandas`/`comanda_itens`
    - tickets de cozinha seguem `pedidos.origem='comanda'`

- **Adapters iniciais fechados**
  - `zelochat_legacy`
    - papel: compatibilidade de transição da Casa dos Salgados
    - lê o fluxo atual de `zelochat_pending_orders`/`zelochat_orders`
    - não vira arquitetura final
  - `pdv_delivery`
    - papel: materializar `whatsapp_order` e `public_order` aceitos em `pedidos`/`pedido_itens`
    - responsabilidade: bind de `ordering_id -> pedido_id`
  - `pdv_table`
    - papel: materializar `table_order` aceito em `comandas`/`comanda_itens` e, quando necessário, nos tickets de cozinha derivados

- **Invariantes obrigatórios**
  - Conversa não é pedido; mensagem não é fonte de verdade de lifecycle.
  - Existe no máximo um aggregate ativo por `source_ref` relevante (JID, token público ou comanda) por contexto.
  - `confirm_cart` é idempotente por `idempotencyKey`.
  - `review_order(decision='accept')` é single-shot: um pedido aceito não pode materializar dois destinos operacionais.
  - Estoque, preço, disponibilidade e agenda revalidam em `confirm_cart` e novamente em `review_order(decision='accept')`.
  - Baixa de estoque e impressão automática acontecem no `accept`, não no `confirm`.
  - `operational_ref` nasce nulo e, após preenchido, não troca de destino.
  - Não existe dual-write contínuo entre `zelochat_orders` e `pedidos`.

- **Eventos de domínio exigidos**
  - `cart_opened`
  - `cart_changed`
  - `cart_revalidated`
  - `cart_confirmed`
  - `order_needs_adjustment`
  - `order_accepted`
  - `order_rejected`
  - `order_status_changed`
  - `operational_target_bound`
  - `order_fulfilled`
  - Observação: WebSocket, impressão, alertas internos e mensagens do WhatsApp consomem esses eventos; não ficam embutidos como side effects opacos do aggregate.

- **Internal seams esperados na implementação**
  - `OrderingRepository` — persiste aggregate/snapshot/event log ZeloChat-owned
  - `CatalogSnapshotPolicy` — resolve snapshot de produto/adicionais
  - `AvailabilityPolicy` — agenda, retirada/entrega, taxa a confirmar
  - `StockPolicy` — revalidação e baixa no aceite
  - `OperationalAdapter` — `zelochat_legacy`, `pdv_delivery`, `pdv_table`
  - `OrderingOutbox` — publica eventos para chat, impressão, alertas e sincronização

- **Migrations separadas por repo a partir desta interface**
  - **Repo ZeloChat**
    - criar tabelas ZeloChat-owned do aggregate `Ordering` (carrinho + pedido + event log/outbox + vínculo por `source_ref`)
    - manter `zelochat_pending_orders` apenas como compat legado até o cutover do WhatsApp
    - adaptar `confirmPendingOrder` para deixar de ser o centro do lifecycle quando o `Ordering` novo entrar
  - **Repo ZeloPDV**
    - aceitar `pedidos.origem='zelomenu'`
    - preparar writer/read model de `pedidos` para origem online sem continuar preso a `origem='balcao'`
    - revisar campos operacionais necessários para delivery/link público no pedido operacional
    - manter `table_order` ancorado em `comandas`

- **Riscos específicos fechados nesta etapa**
  - Criar `pedidos` antes do aceite contaminaria a fila operacional com pedido ainda não aprovado -> mitigação: materialização só no `accept`
  - Tentar representar `public_order` como `zelochat_order` esconderia a diferença entre link público e WhatsApp -> mitigação: `context` explícito + origem operacional distinta `zelomenu`
  - Deixar impressão no evento antigo `order_created` manteria o bug de imprimir cedo demais -> mitigação: consumir `order_accepted`
  - Chat-only ganhar acesso ao PDV por compartilhar motor -> mitigação: `Ordering` compartilha dados e adapters, não entitlement de superfície

- **Test cases de domínio obrigatórios antes de UI**
  - abrir carrinho em `whatsapp_order` cria `ordering_id` único por JID
  - `confirm_cart` repetido com a mesma `idempotencyKey` não duplica aggregate nem evento
  - `review_order(decision='accept')` repetido não cria dois `pedido_id`
  - `needs_customer_adjustment -> change_cart -> confirm_cart` preserva histórico e incrementa `revision`
  - estoque muda entre confirmação e aceite -> `accept` falha com revalidação, sem baixa parcial
  - `public_order` aceito materializa `pedidos.origem='zelomenu'`
  - `whatsapp_order` aceito materializa `pedidos.origem='zelochat'`
  - `table_order` aceito não cria fonte comercial em `pedidos`; ancora em `comanda`
  - impressão e alerta de gerente disparam em `order_accepted`, não em `cart_confirmed`
  - cancelar antes do aceite não cria destino operacional
  - atualização operacional (`ready`, `out_for_delivery`, `fulfilled`) projeta de volta no snapshot compartilhado

- **Próximo ticket recomendado**
  - `ZLM-004 — Definir Interface do módulo Catalog/Menu Publication`
  - Motivo: o `Ordering` agora já sabe onde está o seam; o próximo bloqueio é definir o snapshot de produto/adicionais/publicação que entra em `cart_snapshot`.

#### ZLM-004 — Definir Interface do módulo Catalog/Menu Publication

Status: Done  
Type: Discuss  
Depends on: ZLM-002  
Owner: Engenharia/Produto  

Escopo:
- Produto base comum.
- Publicação no ZeloMenu.
- Fotos opcionais.
- Adicionais/variações com preço.
- Disponibilidade manual e estoque controlado.

Aceite:
- Modelo de publicação definido.
- Modelo de adicionais/variações definido.
- Regras de preço/estoque documentadas.

Resultado:

- **Problema que a interface precisa resolver**
  - O sistema já tem catálogo base compartilhado (`produtos`, `categorias`, `subcategorias`), mas ainda não tem uma camada de publicação vendável para ZeloMenu.
  - O módulo precisa atender três callers diferentes:
    - superfícies autenticadas de configuração no ZeloChat/ZeloPDV
    - UI pública do ZeloMenu
    - módulo `Ordering`, que precisa consumir um `cart_snapshot` estável e revalidável
  - Ele precisa separar “produto operacional comum” de “produto publicado no canal”, sem duplicar preço base nem quebrar estoque.

- **Mapeamento atual confirmado**
  - `produtos` hoje carrega apenas catálogo base operacional observado no código: `id`, `nome`, `preco`, `id_categoria`, `id_subcategoria`, `eh_item_por_unidade`, `ocultar_no_pdv`, `controlar_estoque`, `estoque_atual`. Base atual: `src/hooks/useCatalog.ts`, `server/configStore.ts`, `/home/vinicius/code/zelopdv/src/routes/gestao/produtos/+page.svelte`.
  - O runtime do ZeloChat hoje enxerga esse produto base e o achata em `{ name, price, available, unitBased, stockControlled, stockQuantity }`; não há descrição, foto, modifier groups, slug, ordem pública nem distinção entre “visível no PDV” e “publicado no ZeloMenu”. Base atual: `server/configStore.ts`, `src/AppShell.tsx`.
  - A tela de catálogo do ZeloChat explicitamente empurra “complementos, variações e imagens” para o ZeloPDV; isso confirma que esses conceitos ainda não têm seam próprio aqui. Base atual: `src/components/views/CatalogView.tsx`.
  - O ZeloPDV já possui uma ferramenta pública de cardápio visual (`/ferramentas/cardapio`), mas ela é um gerador/apresentação manual e não o motor de catálogo publicado do ZeloMenu. Base atual: `/home/vinicius/code/zelopdv/src/routes/ferramentas/cardapio/+page.svelte`.

- **Alternativas consideradas**
  - **A. Expandir `produtos` com todos os campos de publicação**
    - Colocar descrição, foto, nome público, visibilidade, ordem e modifiers diretamente no produto base.
    - Vantagem: menos joins aparentes.
    - Problema: mistura operação comum com apresentação/canal; vaza semântica do ZeloMenu para PDV e Chat.
  - **B. Overlay de publicação sobre o catálogo base**
    - Manter `produtos` como núcleo comum e criar uma camada de publicação que referencia o produto base e o enriquece com apresentação e modifiers vendáveis.
    - Vantagem: separa bem produto comum de publicação online; `Ordering` lê snapshot estável sem mexer no catálogo operacional.
    - Risco: exige resolver bem o vínculo entre base product, publication item e modifier groups.
  - **C. Documento JSON único de menu por loja**
    - Materializar o cardápio inteiro em um documento versionado e editar sempre o documento completo.
    - Vantagem: leitura pública simples.
    - Problema: perde locality para edição granular, aumenta risco de drift em preço/estoque e complica integração com `Ordering`.

- **Interface escolhida**
  - Escolha: **Alternativa B**, com produto base comum + publication overlay.
  - O seam externo do módulo também fica pequeno:

```ts
type CatalogPublicationCommand =
  | { type: 'publish_product'; catalogId: string; productId: number; actor: ActorRef; patch?: PublishPatch }
  | { type: 'unpublish_product'; catalogId: string; productId: number; actor: ActorRef }
  | { type: 'set_product_content'; catalogId: string; productId: number; actor: ActorRef; content: ProductContentPatch }
  | { type: 'set_product_media'; catalogId: string; productId: number; actor: ActorRef; media: ProductMediaPatch }
  | { type: 'set_product_availability'; catalogId: string; productId: number; actor: ActorRef; availability: ManualAvailabilityPatch }
  | { type: 'replace_modifier_groups'; catalogId: string; productId: number; actor: ActorRef; groups: ModifierGroupDraft[] }
  | { type: 'reorder_catalog'; catalogId: string; actor: ActorRef; sections: SectionOrderPatch[] }
  | { type: 'revalidate_catalog'; catalogId: string; reason: 'base_catalog_changed' | 'stock_changed' | 'before_public_render' | 'before_confirm' };

type CatalogPublicationResult = {
  snapshot: CatalogPublicationSnapshot;
  events: CatalogPublicationEvent[];
};

interface CatalogPublicationModule {
  apply(command: CatalogPublicationCommand): Promise<CatalogPublicationResult>;
  getSnapshot(ref: CatalogPublicationLookup): Promise<CatalogPublicationSnapshot | null>;
}
```

- **Por que essa interface foi escolhida**
  - Deixa a interface pequena para callers e concentra a complexidade em um módulo profundo.
  - Mantém a separação entre base catalog e publication sem obrigar UI/Ordering a saber como cada parte é persistida.
  - Permite que o `Ordering` consuma snapshots prontos de item vendável, em vez de montar preço/estoque/modifiers no call site.

- **Modelo lógico fechado**
  - **Base catalog comum**
    - `categoria`
    - `subcategoria`
    - `produto_base`
      - `product_id`
      - `nome`
      - `preco_base`
      - `unit_based`
      - `stock_policy`
      - `category_ref`
  - **Publication overlay**
    - `catalog_publication`
      - `catalog_id`
      - `store_ref`
      - `revision`
      - `status`
    - `published_product`
      - `product_id`
      - `public_name?`
      - `description?`
      - `image_asset?`
      - `sort_order`
      - `manual_visibility`
      - `manual_availability`
  - **Sellable structure**
    - `modifier_group`
      - `group_id`
      - `product_id`
      - `label`
      - `selection_mode: single | multiple`
      - `required`
      - `min_select`
      - `max_select`
      - `sort_order`
    - `modifier_option`
      - `option_id`
      - `group_id`
      - `label`
      - `price_delta`
      - `sort_order`
      - `manual_availability`
      - `linked_product_id?` apenas quando o negócio realmente quiser atrelar a opção a um item do catálogo comum no futuro

- **Snapshot mínimo exigido**
  - `catalog_id`
  - `store_ref`
  - `revision`
  - `sections[]`
  - `published_products[]`, onde cada item traz:
    - `product_id`
    - `public_name`
    - `base_name`
    - `description`
    - `image`
    - `base_price`
    - `effective_sellability`
    - `unit_based`
    - `category_ref`
    - `modifier_groups[]`
  - `effective_sellability` precisa distinguir pelo menos:
    - `active`
    - `hidden`
    - `paused`
    - `out_of_stock`
    - `unpublished`

- **Regras de preço aprovadas**
  - O preço base do item publicado vem de `produtos.preco`.
  - O ZeloMenu v1 não terá override de preço base por canal.
  - O preço final vendido é:
    - `preco_final = preco_base + soma(price_delta das opções selecionadas)`
  - O `Ordering` deve sempre salvar no snapshot do item:
    - `product_id`
    - `base_price_at_confirm`
    - `selected_options[]`
    - `delta_total`
    - `final_unit_price`
  - Mudança em `produtos.preco` afeta renderização pública futura e revalidação de carrinhos ainda não confirmados.

- **Regras de estoque/disponibilidade aprovadas**
  - Estoque continua vindo exclusivamente do produto base comum.
  - Produto com `controlar_estoque=false` ignora estoque e depende apenas de publicação/disponibilidade manual.
  - Produto com `controlar_estoque=true` e `estoque_atual<=0` fica `out_of_stock` mesmo que esteja publicado.
  - Publicação manual pode pausar um item mesmo com estoque disponível.
  - `effective_sellability` é a interseção de:
    - produto publicado
    - não oculto manualmente
    - disponibilidade manual ativa
    - estoque suficiente quando houver controle
  - Modifier option também pode ficar indisponível manualmente sem despublicar o produto inteiro.

- **Regras de modelagem de modifiers aprovadas**
  - Adicionais/variações não são texto solto nem parsing do chat; são estrutura explícita do catálogo vendável.
  - Grupo pode ser obrigatório ou opcional.
  - Grupo pode ser de seleção única ou múltipla.
  - Opção carrega `label` e `price_delta`; não duplica o preço base do produto.
  - No v1, `modifier_option` não precisa virar produto completo do PDV para existir.
  - O snapshot do pedido precisa salvar tanto a estrutura computável quanto a legenda humana do item montado.

- **O que fica fora do produto base**
  - nome público
  - descrição pública
  - foto/imagem
  - ordem no menu
  - status de publicação online
  - disponibilidade manual do canal
  - groups/options de venda do ZeloMenu

- **Callers esperados**
  - configuração autenticada no ZeloChat
  - configuração autenticada no ZeloPDV
  - leitura pública do ZeloMenu
  - módulo `Ordering`, que consome o snapshot e revalida antes de confirmar/aceitar

- **Internal seams esperados na implementação**
  - `BaseCatalogAdapter` — lê/escreve produto/categoria/subcategoria comum
  - `PublicationAdapter` — persiste overlay de publicação
  - `SellabilityPolicy` — resolve visibilidade efetiva com estoque e pausa manual
  - `ModifierPricingPolicy` — calcula deltas e valida seleção
  - `CatalogSnapshotBuilder` — gera o snapshot estável usado por ZeloMenu e `Ordering`

- **Migrations separadas por repo**
  - **Repo ZeloPDV**
    - criar camada de publicação do menu referenciando `produtos`
    - criar grupos/opções de modifiers ligados ao produto base
    - preparar eventual `store_ref/slug` público do menu
    - manter `produtos` como núcleo comum; evitar duplicar preço base em tabela de publicação
  - **Repo ZeloChat**
    - nenhuma migration obrigatória desta fatia para o catálogo em si
    - o repo ZeloChat passa a consumir o snapshot/publication seam; schema novo de publicação não deve nascer aqui

- **Riscos e mitigação**
  - colocar publicação direto em `produtos` misturaria operação e canal -> mitigação: overlay separado
  - duplicar preço base no ZeloMenu geraria drift comercial -> mitigação: preço base único no produto comum
  - tratar adicional como produto completo desde já contaminaria PDV, estoque e relatórios -> mitigação: modifier groups próprios no v1
  - usar `ocultar_no_pdv` como sinônimo de “fora do ZeloMenu” misturaria dois canais -> mitigação: publicação online tem visibilidade própria
  - chat-only usa catálogo comum por baixo, mas não pode ganhar UI do PDV -> mitigação: resolver em `ZLM-005` com guards e navegação
  - imagens públicas exigem cuidado com ownership e remoção -> mitigação: storage/publication ownership fica no repo PDV e não em gambiarra no chat

- **Test cases de domínio obrigatórios antes de UI**
  - publicar produto base cria item vendável sem alterar `produtos.preco`
  - atualizar `produtos.preco` muda o snapshot público e invalida carrinho ainda não confirmado
  - produto com estoque controlado zerado fica `out_of_stock` mesmo publicado
  - produto sem controle de estoque publicado continua `active` quando estoque lógico não se aplica
  - pausar manualmente produto com estoque disponível muda para `paused`
  - grupo obrigatório impede confirmação sem opção selecionada
  - grupo single-choice rejeita duas opções simultâneas
  - grupo multi-choice respeita `max_select`
  - preço final do item com modifiers é calculado por `preco_base + delta_total`
  - despublicar produto remove o item do snapshot público sem apagar o produto base
  - alterar descrição/foto não muda `product_id` nem base catalog
  - `Ordering` recebe snapshot estável com `product_id`, `group_id` e `option_id` para auditoria/revalidação

- **Próximo ticket recomendado**
  - `ZLM-005 — Definir entitlements e navegação`
  - Motivo: com `Ordering` e `Catalog/Menu Publication` definidos, o próximo risco de arquitetura é liberar a superfície errada para o cliente errado ou acoplar UI nova sem guard claro.

#### ZLM-005 — Definir entitlements e navegação

Status: Done  
Type: Discuss  
Depends on: ZLM-001  
Owner: Engenharia/Produto  

Escopo:
- Quem vê ZeloMenu config.
- Quem vê tela comum de Pedidos.
- Quem acessa ZeloPDV, ZeloChat, Mesas, Acessos.
- Como bundle sincroniza superfícies.

Aceite:
- Matriz de entitlement por plano.
- Lista de guards frontend/backend.

Resultado:

- **Problema que esta etapa resolve**
  - O estado do pedido e o catálogo já foram desenhados para serem compartilhados, mas isso não pode vazar acesso comercial entre apps.
  - O risco central é claro: cliente `chat` usar infraestrutura comum e, por acidente, ganhar o app ZeloPDV; ou cliente PDV legado ganhar ZeloMenu por herdar um addon antigo semânticamente diferente.
  - Esta etapa fecha o contrato de superfície, capability e rollout de guard.

- **Princípio aprovado**
  - Identidade/empresa/assinatura são compartilhadas.
  - Motor de pedido e catálogo podem ser compartilhados.
  - **UI contratada não é compartilhada automaticamente.**
  - Entitlement comercial decide qual app e qual capability ficam visíveis.

- **Capabilities canônicas**
  - `chat_app`
    - acesso ao app autenticado do ZeloChat
  - `pdv_core`
    - acesso ao app autenticado do ZeloPDV
  - `menu_publication`
    - configurar publicação, menu público, modifiers e disponibilidade do ZeloMenu
  - `public_menu_runtime`
    - link/menu público publicado para cliente final
  - `ordering_review`
    - revisar/aceitar/recusar/acompanhar pedidos online no app contratado
  - `kitchen_queue`
    - fila operacional de preparo/cozinha
  - `mesas`
    - módulo Mesas/comandas
  - `acessos`
    - subusuários/cargos/permissões

- **Matriz de entitlement por contrato novo**
  - **ZeloPDV R$59**
    - `pdv_core`: sim
    - `chat_app`: não
    - `menu_publication`: não
    - `public_menu_runtime`: não
    - `ordering_review`: não
    - `kitchen_queue`: não
    - `mesas`: só com addon separado
    - `acessos`: só com addon separado
  - **ZeloPDV + ZeloMenu R$99**
    - `pdv_core`: sim
    - `chat_app`: não
    - `menu_publication`: sim, dentro do ZeloPDV
    - `public_menu_runtime`: sim
    - `ordering_review`: sim, dentro do ZeloPDV
    - `kitchen_queue`: sim, dentro do ZeloPDV
    - `mesas`: só com addon separado
    - `acessos`: só com addon separado
  - **ZeloChat R$147**
    - `pdv_core`: não
    - `chat_app`: sim
    - `menu_publication`: sim, dentro do ZeloChat
    - `public_menu_runtime`: sim
    - `ordering_review`: sim, dentro do ZeloChat
    - `kitchen_queue`: sim, dentro do ZeloChat/visões operacionais do chat
    - `mesas`: não
    - `acessos`: não no MVP
  - **Bundle ZeloPDV + ZeloChat + ZeloMenu R$197**
    - `pdv_core`: sim
    - `chat_app`: sim
    - `menu_publication`: sim
    - `public_menu_runtime`: sim
    - `ordering_review`: sim nos dois apps
    - `kitchen_queue`: sim nos dois apps, conforme superfície fizer sentido
    - `mesas`: só com addon separado
    - `acessos`: só com addon separado

- **Tratamento legado aprovado**
  - `has_pedidos_addon` continua valendo apenas como entitlement legado/grandfathered.
  - Cliente legado com Pedidos/Cozinha antigo mantém:
    - `ordering_review` no ZeloPDV
    - `kitchen_queue` no ZeloPDV
  - Cliente legado **não** ganha automaticamente:
    - `menu_publication`
    - `public_menu_runtime`
    - `chat_app`
  - Cliente legado de Mesas continua separado; Mesas não implica ZeloChat.

- **Relação entre Mesas e Pedidos/Cozinha**
  - `table_order` continua canônico em `comandas`.
  - Mesas pode precisar da capability `kitchen_queue` para tickets derivados.
  - Isso **não** obriga a liberar `ordering_review` de pedidos online nem ZeloMenu.
  - Regra aprovada:
    - `mesas` sozinho pode justificar `kitchen_queue` quando a operação de mesa usar cozinha
    - `ordering_review` de pedidos online continua reservado a ZeloMenu, Chat ou legado Pedidos/Cozinha

- **Navegação aprovada — ZeloChat**
  - `chat_app` é permitido apenas para `chat` e `bundle`.
  - Com `menu_publication`, o ZeloChat expõe:
    - Atendimento
    - Pedidos / Produção / Agenda / Motoboys
    - Cardápio / ZeloMenu
    - Cérebro IA
    - Configurações / Perfil
  - Cliente `pdv` sem `chat_app` nunca usa o app ZeloChat, mesmo que a empresa exista na tabela compartilhada.
  - O modo `general` do ZeloChat continua sendo variação de produto/comportamento, não entitlement comercial.

- **Navegação aprovada — ZeloPDV**
  - `pdv_core` é permitido apenas para `pdv` e `bundle`.
  - `menu_publication` adiciona navegação/configuração do ZeloMenu dentro do ZeloPDV.
  - `ordering_review` no ZeloPDV libera a superfície operacional de pedidos online.
  - `kitchen_queue` no ZeloPDV libera a superfície de cozinha.
  - `mesas` e `acessos` continuam módulos separados.
  - Cliente `chat` nunca deve ver ou abrir `/app`, `/app/pedidos`, `/app/pedidos/cozinha`, `/gestao/*`.

- **Decisão de rollout de assinatura**
  - `subscriptions.plan_tier` continua `pdv | chat | bundle`.
  - A nova capacidade comercial do ZeloMenu não deve depender semanticamente de `has_pedidos_addon`.
  - `ZLM-205` fica responsável pelo rollout da tabela compartilhada e dos preços novos:
    - atualizar preço `chat` de R$97 -> R$147
    - atualizar `bundle` de R$147 -> R$197
    - introduzir entitlement explícito de ZeloMenu no domínio compartilhado
    - preservar exceções temporárias como Casa dos Salgados

- **Guards aprovados — repo ZeloChat**
  - **Frontend**
    - `useSubscription().isActive` continua sendo o gate base do app ZeloChat
    - `hasPdvOnly` continua apenas como gatilho de upsell para bundle, nunca como acesso parcial ao app
    - novas views de ZeloMenu/Ordering no chat exigem `chat_app` ativo; não dependem de PDV
  - **Backend**
    - middleware global `requireActiveZelochatSubscription` continua exigindo `plan_tier in ('chat','bundle')`
    - futuros endpoints autenticados de `menu_publication` e `ordering_review` no ZeloChat exigem esse mesmo gate
    - endpoints públicos do ZeloMenu não usam JWT de app nem esse paywall; usam token/link assinado do próprio contexto público
    - infraestrutura comum nunca deve consultar “tem PDV?” para decidir acesso ao app ZeloChat

- **Guards aprovados — repo ZeloPDV**
  - **Frontend**
    - `ensureActiveSubscription()` continua bloqueando `plan_tier='chat'` nas rotas do PDV
    - `hasMesasAddon()` e `hasAcessosAddon()` continuam válidos
    - `hasPedidosAddon()` deve ser tratado como helper legado/grandfathered
    - novos helpers necessários no rollout:
      - `hasZeloMenuAccess()`
      - `hasOrderingReviewAccess()`
      - `hasKitchenQueueAccess()`
  - **Backend / server-side**
    - `hasZeloPdvAccess()` e `ensureActiveSubscription()` continuam como guard de app
    - rotas de ZeloMenu config exigem `pdv_core && menu_publication`
    - rotas de pedidos online no PDV exigem `pdv_core && ordering_review`
    - rotas de cozinha exigem `pdv_core && kitchen_queue`
    - rotas de access control continuam exigindo `acessos`

- **Permissões de subusuário aprovadas**
  - No ZeloPDV, continuar usando `pedidos.acessar`, `pedidos.cozinha`, `mesas.acessar`, `produtos.visualizar` etc. enquanto `Acessos` não virar módulo compartilhado de verdade.
  - No MVP Chat-only, não criar falsa paridade de RBAC com o PDV antes do módulo compartilhado existir.
  - Quando `Acessos` evoluir para compartilhado, o alvo é permissionar:
    - `ordering.review`
    - `ordering.kitchen`
    - `menu.publish`
    - `menu.pause_item`
    - `ordering.reprint`

- **Riscos e mitigação**
  - Reusar `has_pedidos_addon` como nome canônico do ZeloMenu confundiria billing, UI e migração -> mitigação: flag nova em `ZLM-205`
  - Cliente `chat` ganhar o PDV por compartilhar `pedidos` -> mitigação: guard de app separado do motor
  - Cliente legado de Pedidos/Cozinha perder acesso no rollout -> mitigação: helper legado explícito e grandfathering
  - Mesas parar de funcionar por depender de cozinha -> mitigação: capability `kitchen_queue` separada de `ordering_review`
  - Tentar unificar RBAC entre apps cedo demais criaria metade de uma arquitetura de acessos -> mitigação: no MVP, ZeloPDV mantém RBAC fino; ZeloChat não simula isso até o módulo compartilhado existir
  - pricing atual no código ainda diverge da estratégia nova -> mitigação: rollout concentrado em `ZLM-205`, não em hacks parciais de view

- **Test cases de domínio/guard obrigatórios antes de UI nova**
  - `plan_tier='chat'` nunca acessa rotas do ZeloPDV
  - `plan_tier='pdv'` sem ZeloMenu não vê config/menu público nem pedidos online novos
  - `pdv + ZeloMenu` acessa config/menu público e pedidos/cozinha no PDV, mas não o app ZeloChat
  - `chat` acessa ZeloChat + menu + ordering, mas não `/app` do PDV
  - `bundle` acessa ambos os apps, com o mesmo estado operacional de pedido
  - `has_pedidos_addon=true` legado libera apenas surface legado de pedidos/cozinha, não publicação ZeloMenu
  - `mesas` com cozinha ativa não exige `ordering_review` de delivery/balcão
  - endpoint público do ZeloMenu funciona com token assinado sem assinatura do cliente final
  - endpoint autenticado de menu no ZeloChat rejeita `pdv` sem `chat`
  - endpoint autenticado de menu no ZeloPDV rejeita `chat` sem `pdv_core`

- **Próximo ticket recomendado**
  - `ZLM-101 — Criar sessões de carrinho do ZeloMenu`
  - Dependência paralela de rollout: `ZLM-205 — Billing e planos novos`
  - Motivo: os seams de pedido, catálogo e entitlement já estão fechados; o próximo ganho real do MVP é criar a sessão de carrinho server-side sem esperar toda a migração comercial.

### Phase 1 — Piloto Casa dos Salgados no ZeloChat

#### ZLM-101 — Criar sessões de carrinho do ZeloMenu

Status: Done  
Type: Prototype  
Depends on: ZLM-003, ZLM-004  
Owner: Engenharia  

Escopo:
- Sessão de carrinho server-side.
- Contexto inicial `whatsapp_order`.
- Link tokenizado.
- Um carrinho ativo por conversa.
- Revalidação na confirmação.

Aceite:
- IA consegue criar link com carrinho pré-montado.
- Cliente consegue abrir e editar.
- Link antigo revalida antes de confirmar.

Resultado parcial (2026-06-22):
- Backend base entregue no repo ZeloChat:
  - migration `041_zelomenu_cart_sessions.sql` cria `zelomenu_cart_sessions` + `zelomenu_cart_tokens` com RLS e índice único de carrinho ativo por `empresa_id + context + source_ref`
  - `server/zelomenuCartSessions.ts` implementa abertura de carrinho `whatsapp_order`, rotação de token, leitura pública, edição pública e revalidação contra catálogo/config atuais
  - `server/router.ts` expõe:
    - `POST /api/zelomenu/cart-sessions/whatsapp`
    - `GET /public-api/zelomenu/cart/:token`
    - `PATCH /public-api/zelomenu/cart/:token`
- Regras já fechadas nesse slice:
  - token público salvo apenas como hash
  - link antigo fica somente leitura (`stale`) e orientado para refresh, sem poder editar
  - preço/taxa Pix/taxa de entrega/estoque/disponibilidade vêm do estado atual do catálogo compartilhado, não do payload do cliente
  - `zelochat_pending_orders` permanece intacto; Casa dos Salgados não migra neste passo
- Fechamento do ticket (2026-06-22):
  - `server/ai.ts` agora tenta abrir `openWhatsAppCartSession()` ao fim de `criar_pedido`, gera o link absoluto do carrinho novo e envia o handoff ao cliente em vez do resumo legado
  - o fluxo legado de `zelochat_pending_orders` + botões continua como fallback explícito se a abertura da sessão nova falhar, para rollout seguro do piloto
- Rollout Supabase (2026-06-23):
  - estruturas `zelomenu_cart_sessions` e `zelomenu_cart_tokens` criadas no Supabase real em `zelomenu_cart_sessions_tables_2026_06_23`
  - verificação via service role confirmou as duas tabelas acessíveis com `count=0`
  - policies/grants finais aplicados em `zelomenu_cart_sessions_policies_grants_2026_06_23`
  - verificação pós-rollout confirmou RLS ligado, quatro policies por tabela, `anon` sem grants e `authenticated`/`service_role` limitados a `SELECT/INSERT/UPDATE/DELETE`

#### ZLM-102 — Criar UI pública inicial do ZeloMenu

Status: Done  
Type: Prototype  
Depends on: ZLM-101  
Owner: Frontend  

Escopo:
- Rota pública inicial compatível com `menu.zelopdv.com.br/{slug}`.
- Lista de produtos publicados.
- Carrinho editável.
- Data/horário e retirada/entrega para contexto WhatsApp.
- Avisos de Pix/comprovante quando configurado.

Aceite:
- Cliente final monta ou revisa pedido sem WhatsApp.
- Campos variam por contexto.
- Textos em PT-BR e sem jargão técnico.

Resultado (2026-06-22):
- Rota pública entregue em `/menu/carrinho/:token`, consumindo `GET/PATCH /public-api/zelomenu/cart/:token`
- Tela já cobre:
  - catálogo visível por categoria/subcategoria
  - carrinho editável com incremento/decremento
  - retirada/entrega com bairro/endereço quando aplicável
  - data/horário, nome, forma de pagamento e observações
  - aviso de Pix quando a loja exige conferência de comprovante
  - banner de revalidação e tratamento de link `stale`
- O fluxo ainda não confirma pedido; isso continua no próximo ticket `ZLM-103`

#### ZLM-103 — Confirmação do ZeloMenu volta para ZeloChat

Status: Done  
Type: Prototype  
Depends on: ZLM-101, ZLM-102  
Owner: Engenharia  

Escopo:
- Confirmar carrinho.
- Criar pedido em estado `confirmed_waiting_review` ou `confirmed_waiting_payment`.
- Adicionar evento/mensagem no chat.
- ZeloChat envia resposta conforme estado.

Aceite:
- Pedido confirmado aparece no Chat.
- Chat não mostra estado falso de pendência quando pedido já existe.
- Cliente recebe próximo passo correto no WhatsApp.

Resultado (2026-06-22):
- `POST /public-api/zelomenu/cart/:token/confirm` confirma apenas token atual, revalida antes de mudar estado e bloqueia edição posterior do carrinho.
- A sessão muda para `confirmed_waiting_review` ou `confirmed_waiting_payment`, conforme Pix/comprovante, sem criar row em `zelochat_orders` nem inventar produção antes do aceite humano.
- A confirmação envia mensagem ao cliente pelo WhatsApp e persiste o mesmo rastro no chat; o card do ZeloChat diferencia "pedido recebido pelo cardápio" de "pedido confirmado em produção".
- A UI pública mostra estado confirmado, instrui o próximo passo e desativa alterações depois da confirmação.

#### ZLM-104 — Aceite manual no ZeloChat

Status: Done  
Type: Prototype  
Depends on: ZLM-103  
Owner: Frontend/Backend  

Escopo:
- Qualquer atendente logado no ZeloChat pode aceitar no v1.
- Registrar quem aceitou e quando.
- Aceite muda estado único do pedido.
- Falhas de estoque/revalidação no aceite bloqueiam e pedem ajuste.

Aceite:
- Pedido só entra em produção após aceite.
- Ação fica auditável.
- Estado muda em tempo real na UI.

Resultado (2026-06-22):
- O ZeloChat ganhou revisão autenticada do pedido do cardápio por conversa e ação explícita de aceite no próprio Chat.
- O aceite revalida novamente antes de materializar produção, bloqueia Pix pendente e inconsistências de estoque/agenda e grava `acceptedAt`/`acceptedBy*`/`productionOrderId` no metadata da sessão.
- Só depois do aceite humano o sistema cria a row real em `zelochat_orders`, envia a confirmação final ao cliente e arquiva a sessão aceita para liberar o próximo pedido da conversa.

#### ZLM-105 — Recuperação simples de carrinho abandonado

Status: Done  
Type: Prototype  
Depends on: ZLM-101  
Owner: Engenharia  

Escopo:
- Uma mensagem automática após 2h.
- Sem insistência.
- Se cliente responder, conversa segue normalmente.

Aceite:
- Carrinho abandonado gera no máximo uma recuperação.
- Recuperação não dispara para carrinho confirmado/cancelado.

Resultado (2026-06-22):
- Novo sweeper `server/abandonedCartSweeper.ts` roda 3min após o boot e a cada 15min; busca sessões `whatsapp_order` em `cart_open`, não arquivadas, paradas entre 2h e 24h (`updated_at`) e ainda sem recuperação, e envia UMA mensagem de lembrete com um link público fresco.
- A unicidade ("no máximo uma recuperação") é garantida por claim race-safe que grava `metadata.recoveryNudgeSentAt` somente enquanto o carrinho continua `cart_open`/não arquivado/não nudado; um segundo tick ou um confirm concorrente nunca produzem nudge duplicado.
- A elegibilidade vive no predicado puro `isCartEligibleForAbandonedRecovery` (`src/domain/zelomenuCart.ts`): só `cart_open`, nunca confirmado/aguardando pagamento/aceito/recusado/cancelado/arquivado, dentro da janela [2h, 24h]. O teto de 24h evita lembrete velho/spam.
- O nudge respeita o gate global da IA (`isAiGloballyEnabledNow`): não envia com a IA desligada (kill-switch) nem fora da janela agendada — a checagem acontece antes do claim, então um carrinho abandonado em horário humano ainda é recuperável quando a automação volta.
- Como o token público não é recuperável do banco (só o hash é salvo), o tail de emissão de token foi extraído para `issueFreshCartToken` e reusado na abertura do carrinho e na recuperação; o link novo entra na mensagem e fica registrado como mensagem do assistente no chat.
- Sem migration: usa a coluna `metadata` (JSONB) já existente em `zelomenu_cart_sessions` — nada de schema compartilhado tocado.
- Validação: `tests/zelomenuAbandonedCart.test.ts` cobre o predicado puro (estado, janela, flag, arquivado, data inválida) e o builder PT-BR sem jargão; `npm run lint` e `npm run build` passaram; `npm test` segue falhando só no drift conhecido de `tests/auditFixGuardrails.test.ts`.

#### ZLM-106 — Impressão no aceite via Zelo Impressão

Status: Done  
Type: Prototype  
Depends on: ZLM-104  
Owner: Engenharia  

Escopo:
- Ao aceitar pedido, enviar impressão se configurado.
- Imprimir pedido inteiro.
- Mostrar falha de impressão.
- Permitir reimpressão manual.

Aceite:
- Pedido aceito imprime quando integração está ativa.
- Falha não fica silenciosa.

Resultado (2026-06-22):
- **Impressão é client-side**: o navegador fala com o app desktop Zelo Impressão em `http://127.0.0.1:17321` (`src/services/zeloImpressaoClient.ts`/`printerService.ts`/`usePrinter.ts`). O servidor não alcança a impressora do operador, então o disparo vive no frontend.
- **Timing já correto no aceite**: como ZLM-104 cria a row em `zelochat_orders` somente no aceite humano, o INSERT realtime (`useOrders`) dispara `autoPrintOrder` — ou seja, imprime no aceite, não na confirmação do cliente. A preocupação "imprime cedo demais" do ZLM-002 era do fluxo legado `confirmPendingOrder`; o motor novo não a tem.
- **"Se configurado"**: `autoPrintOrder` agora só dispara quando `printer.connected` (integração ativa). Antes, todo pedido em máquina sem Zelo Impressão gerava um toast de erro de impressão; agora não há ruído para quem não usa impressora. O toast do pedido manual reflete se foi enviado à impressão.
- **Falha não silenciosa**: auto-impressão com a integração ativa que falhar continua mostrando toast de erro; a reimpressão manual mostra sucesso/falha explícito.
- **Reimpressão manual**: novo botão "Imprimir pedido" no drawer de detalhe da Produção (`ProductionView`), com estado de envio e feedback. `AppShell.reprintOrder` sempre tenta imprimir (ação explícita do operador) e reporta o resultado; um aviso aparece quando a integração não está conectada.
- **Pedido inteiro / setor**: V1 imprime o pedido inteiro via `buildOrderText` (uma impressão). A divisão por setor/categoria (D-090) fica para depois; a arquitetura client-side já permite trocar o builder sem mexer no disparo.
- Validação: `npm run lint` e `npm run build` passaram; `npm test` segue só com o drift conhecido de `tests/auditFixGuardrails.test.ts`. Sem teste automatizado novo — fiação de UI + gate sobre o caminho de impressão client-side, que depende do app desktop e não tem harness existente.

### Phase 2 — Produto Comercial ZeloMenu para Base ZeloPDV

#### ZLM-201 — Publicação self-service do ZeloMenu

Status: Done
Type: Prototype  
Depends on: ZLM-004, ZLM-005  
Owner: Frontend/Produto  

Escopo:
- Tela de publicação/configuração.
- Produto visível/invisível.
- Nome público, descrição, foto opcional, ordem.
- Pausar item manualmente.
- Configurar adicionais/variações.

Aceite:
- Cliente configura sozinho o básico.
- Equipe Zelo não precisa cadastrar tudo manualmente.

Resultado parcial (2026-06-23):
- Entrega segura no repo ZeloChat: a tela `Cardápio` ganhou um painel de prontidão de "Publicação no ZeloMenu", mostrando contadores de produtos prontos para o link, inativos, sem estoque e sem categoria, além de uma lista acionável para editar os itens que precisam de atenção.
- A regra atual é derivada do runtime existente do carrinho público: produto oculto fica inativo, produto com estoque controlado zerado não publica, e produto sem categoria precisa de organização porque o catálogo público é servido por hierarquia de categorias.
- A lógica vive em domínio puro (`src/domain/zelomenuPublication.ts`) com cobertura em `tests/zelomenuPublication.test.ts`, evitando espalhar regra de publicação dentro do React.
- O slice também adicionou `PRODUCT.md` e `.impeccable/live/config.json` como contexto de design para futuras mudanças de UI.
- Validação: `node --import tsx tests/zelomenuPublication.test.ts`, `node --import tsx tests/zelomenuAbandonedCart.test.ts` e `npm run lint` passaram.

Resultado parcial 2 (2026-06-23):
- O ZeloChat agora consome a camada real `zelomenu_product_publications` já aplicada no Supabase: `useCatalog` carrega/grava publicações por produto sem alterar `produtos`, `categorias` ou `subcategorias`.
- A UI de `Cardápio` permite configurar publicar/despublicar, pausar temporariamente, nome público, descrição pública, foto por link e ordem pública por produto.
- O backend público passa a resolver o catálogo com o overlay de publicação: só item publicado, não pausado e ainda válido pelo produto base fica disponível no link; nome/descrição/foto/ordem vêm da publicação e o preço base continua em `produtos.preco`.
- A UI pública do carrinho exibe descrição e foto quando a publicação tiver esses dados.
- A transformação produto base + publicação vive em domínio puro (`resolveZeloMenuPublicationCatalogProduct`) e é coberta por `tests/zelomenuPublication.test.ts`.
- Validação: `npm run lint`, `npm run build`, `node --import tsx tests/zelomenuPublication.test.ts` e `node --import tsx tests/zelomenuCart.test.ts` passaram. `npm test` rodou e segue somente com o drift conhecido de `tests/auditFixGuardrails.test.ts` ("webhook has explicit rollout bypass name").

Resultado final (2026-06-23):
- Modifiers/adicionais/variações entraram no runtime autenticado e público: o operador configura grupos/opções no `Cardápio`, o catálogo público expõe essas escolhas e o carrinho revalida obrigatoriedade/preço antes da confirmação e do aceite.
- A foto do produto deixou de depender só de URL manual: a publicação agora aceita upload de imagem própria, grava a URL owned no campo `foto_url` da camada de publicação e mantém preview/remoção no modal do `Cardápio`.
- O cleanup operacional do asset owned foi fechado neste repo: troca/remoção de foto apaga o objeto antigo em best-effort, exclusão do produto limpa a foto vinculada e o purge de conta remove o prefixo `zelomenu-products/{userId}` do bucket `logos`.
- Este repo continua sem alterar `produtos`/`categorias`/`subcategorias`; toda a entrega permanece na camada PDV-owned de publicação definida em `ZLM-004`.
- Validação adicional: `node --import tsx tests/zelomenuModifiers.test.ts`, `node --import tsx tests/zelomenuPublicationImages.test.ts`, `npm run lint` e `npm run build` passaram.
- Rollout Supabase (2026-06-23): migration PDV-owned `zelomenu_publication_schema_2026_06_23` aplicada no Supabase real. Verificado: `zelomenu_product_publications`, `zelomenu_modifier_groups` e `zelomenu_modifier_options` existem com RLS ligado, policies por owner, grants mínimos para `authenticated`/`service_role` e nenhum grant para `anon`.

#### ZLM-202 — Tela comum de Pedidos liberada por ZeloMenu

Status: Todo — lado ZeloChat satisfeito; núcleo (sync cross-surface) depende de ZLM-301 (Phase 3)  
Type: Prototype  
Depends on: ZLM-003, ZLM-005, ZLM-104  
Owner: Engenharia/Frontend  

Escopo:
- Motor de pedidos interno.
- Tela operacional comum.
- Cliente ZeloPDV + ZeloMenu vê a tela no ZeloPDV.
- Cliente ZeloChat + ZeloMenu vê no ZeloChat.
- Bundle sincroniza os dois.

Aceite:
- Um aceite em uma superfície atualiza a outra.
- Não existe aceite duplicado.
- ZeloPDV puro R$59 não vê a tela sem módulo que libere.

Nota (2026-06-23):
- **Lado ZeloChat já está coberto**: por D-014, todo cliente `chat`/`bundle` ativo inclui ZeloMenu, então o paywall existente (`useSubscription().isActive` = `chat`/`bundle` ativo) já é o gate de "vê Pedidos/Produção/Cardápio no ZeloChat". O resolver de capability de ZLM-205 expõe isso explicitamente (`menu_publication`/`ordering_review`) em `useSubscription().capabilities` como seam, mas no app ZeloChat hoje seria no-op (todo ativo já tem direito), então não foi adicionada trava redundante na navegação para não criar risco sem mudança de comportamento.
- **O que falta é Phase 3**: "um aceite em uma superfície atualiza a outra" e "ZeloPDV puro não vê a tela" são o motor cross-surface e o guard PDV-owned — dependem de ZLM-301 (sync real com `pedidos`/`pedido_itens` no repo ZeloPDV) e dos helpers PDV (`hasZeloMenuAccess`/`hasOrderingReviewAccess`). Não é fechável só neste repo.

#### ZLM-203 — Link público `menu.zelopdv.com.br/{slug}`

Status: Done  
Type: Prototype  
Depends on: ZLM-102, ZLM-201, coluna de slug PDV-owned no repo ZeloPDV (D-102)  
Owner: Engenharia/Infra  

Resultado (2026-06-23):
- Coluna `empresa_perfil.zelomenu_slug` (PDV-owned, única quando não-nula) criada no repo ZeloPDV (`zelomenu_entitlement_and_slug_2026_06_23.sql`) e aplicada no Supabase — desbloqueou esta task.
- Slug domínio puro node-free (`src/domain/zelomenuSlug.ts`): normalização, validação, reservados, URL. Coberto por `tests/zelomenuSlug.test.ts`.
- Backend ZeloChat serve a loja pública por slug: `GET /public-api/zelomenu/store/:slug` (negócio + catálogo via o mesmo overlay de publicação) e `POST /public-api/zelomenu/store/:slug/cart` (bootstrap de sessão `public_order` → token). Resolução slug→empresa lê a coluna PDV-owned; reusa `loadAiSettingsFromDb` + `filterVisibleCatalog`.
- Frontend: rota pública `/menu/:slug` (`ZeloMenuStorePage`) com catálogo + carrinho + modifiers + nome/telefone → cria a sessão e redireciona pro carrinho público existente (`/menu/carrinho/:token`) que cuida de retirada/entrega/pagamento/confirmação. Telefone editável no carrinho para `public_order`.
- `public_order` confirma direto na tela de Pedidos (D-037): `confirmPublicCartSession` materializa `zelochat_orders`, baixa estoque, notifica o gerente e avisa o cliente no WhatsApp dele (sem thread de chat).
- Operador self-service (D-046): `GET/PUT /api/zelomenu/slug` + card "Link público do cardápio" em Configurações (`PublicLinkCard`).
- Validação: `npm run lint`, `npm run build`, `tests/zelomenuSlug.test.ts`, `tests/zelomenuCart.test.ts` passaram. URL pública base configurável por `ZELOMENU_PUBLIC_BASE_URL` (default = app base) para apontar pro subdomínio `menu.` quando o DNS existir.

Decisões aplicáveis (2026-06-23):
- D-102: o slug nasce **PDV-owned/shared**, não ZeloChat-owned. Bloqueio explícito: a coluna de slug (`empresa_perfil.zelomenu_slug` ou mapeamento shared) precisa **primeiro** ser criada no repo ZeloPDV via workflow de tabela compartilhada antes de qualquer código aqui. O backend ZeloChat serve a rota e **lê** o slug; não cria coluna própria.
- Runtime existente reaproveitado: o público hoje é 100% por token (`/public-api/zelomenu/cart/:token`). Falta `public_order` bootstrap, rota pública de loja por slug e resolução slug→empresa.

Escopo:
- Slug público por loja.
- Cardápio público.
- Pedido público com telefone/código ou token.
- Status simples no link.

Aceite:
- Loja pode compartilhar URL pública.
- Cliente final consegue pedir sem conversa prévia no WhatsApp.

#### ZLM-204 — Entrega por bairro

Status: Done  
Type: Prototype  
Depends on: ZLM-102  
Owner: Produto/Engenharia  

Escopo:
- Bairros comuns pré-populados.
- Taxa por bairro.
- Bairro/rua livre.
- Taxa a confirmar.

Aceite:
- Bairro listado soma taxa.
- Bairro fora da lista permite confirmar e força conferência.

Resultado (2026-06-23):
- A tabela por bairro (`empresa_perfil.delivery_config` → `{ enabled, neighborhoods:[{name,fee}] }`) já existia; a lacuna real era o caso "bairro fora da lista", que estourava `INVALID_DELIVERY_NEIGHBORHOOD` e travava a confirmação — contradizendo D-081/D-082/D-083.
- Agora a regra é domínio puro e compartilhada: `resolveDeliveryFeeForNeighborhood()` em `src/domain/zelomenuCart.ts` devolve `{ fee, toConfirm }`. Bairro listado soma a taxa (match case/acento-insensitive); bairro livre fora da lista — ou entrega sem bairro definido — devolve `fee 0 + toConfirm`, sem bloquear. O backend (`server/zelomenuCartSessions.ts: resolveDeliveryFee`) só estoura `DELIVERY_DISABLED` quando a loja não habilitou entrega.
- O snapshot de fulfillment ganhou `deliveryFeeToConfirm`; a taxa "a confirmar" é propagada para a mensagem do cliente (`buildCartSummaryLines`), para o card de revisão do operador no Chat (`ChatView`), e para a notificação do gerente no aceite — fechando "força conferência humana".
- A UI pública (`ZeloMenuCartPage`) trocou o `<select>` de bairro por `<input list>` + `<datalist>`: o cliente escolhe um bairro cadastrado (com a taxa) ou digita o seu; quando fora da tabela, o resumo mostra "Entrega: a confirmar" e um aviso. A estimativa do front espelha a mesma função pura (sem importar `zelomenuCart`, que puxa `node:crypto`).
- Validação: `node --import tsx tests/zelomenuCart.test.ts` (inclui 5 casos novos de bairro/taxa a confirmar), `npm run lint` e `npm run build` passaram.

#### ZLM-205 — Billing e planos novos

Status: Done (rollout 2026-06-23 completo; envs Dokploy aplicadas; Agreste deixou de ser cliente)  
Type: Research  
Depends on: ZLM-001, ZLM-005  
Owner: Produto/Engenharia  

Resultado final (2026-06-23):
- Schema PDV-owned aplicado: `subscriptions.has_zelo_menu` + view `user_entitlements` (migration `zelomenu_entitlement_and_slug_2026_06_23.sql`). Backfill exato: chat/bundle ativos → `has_zelo_menu=true` (CS+Agreste), pdv → false. Verificado no Supabase.
- Stripe LIVE: criados `zelo_chat_monthly_v2` (R$147 `price_1TlbH2LUJWyE4PkYSqFSXXVY`), `zelo_bundle_monthly_v2` (R$197 `price_1TlbH2LUJWyE4PkYlS4IxMhs`), `zelo_addon_menu_monthly_v1` (R$40 `price_1TlbH4LUJWyE4PkYX0kdJhAw`) — só catálogo, nenhuma assinatura existente alterada.
- ZeloPDV `pricing.js`: chat 147 / bundle 197 / addon `menu` 40, billing-safe (price IDs v1 legados mantidos no reverse-lookup → assinantes atuais não quebram). Guards `hasZeloMenuAccess`/`hasOrderingReviewAccess`/`hasKitchenQueueAccess`. Webhook grava `has_zelo_menu`. Admin dashboard com toggle ZeloMenu. Testes `pricing.acessos.test.js` (10) cobrindo legacy-mapping + pdv+menu=99.
- ZeloChat: resolver de capability (`zelomenuEntitlements.ts`, seam `has_zelo_menu`), copy `PRICING` 97→147 / 147→197.
- **Falta (operação, não código):** setar no Dokploy do backend ZeloChat `STRIPE_PRICE_CHAT`/`STRIPE_PRICE_BUNDLE` → IDs v2 (liga o aumento p/ novos checkouts ZeloChat); migrar a assinatura do Agreste pro v2 com aviso prévio (D-104); CS grandfathered (D-017).

Resultado parcial (2026-06-23) — parte LOCAL entregue (D-103):
- `src/domain/zelomenuEntitlements.ts`: resolver read-only de capability, domínio puro, fonte única no repo ZeloChat. Computa `chat_app`/`pdv_core`/`menu_publication`/`public_menu_runtime`/`ordering_review`/`kitchen_queue`/`mesas`/`acessos` a partir de `plan_tier` + ativo, fiel à matriz de ZLM-005.
- Fail-safe ON em chat/bundle (D-014): mesmo com `has_zelo_menu=false`, chat/bundle mantêm ZeloMenu. Legado `has_pedidos_addon` libera só `ordering_review`/`kitchen_queue` (D-099), nunca publicação. Mesas com cozinha libera `kitchen_queue` sem `ordering_review` (D-100).
- Seam ÚNICO para o futuro `has_zelo_menu`: o parâmetro `hasZeloMenuFlag`. Hoje passado como `undefined` em `src/hooks/useSubscription.ts` (capabilities expostas ao app); quando o ZeloPDV publicar a coluna, basta adicioná-la ao SELECT do hook e passar o valor — sem reescrever a regra.
- Cobertura: `tests/zelomenuEntitlements.test.ts` cobre a matriz de ZLM-005 + o seam. `npm run lint`/`npm run build` passaram.

BLOQUEADO no repo ZeloPDV (não executável aqui) — ordem obrigatória de D-104:
1. (PDV/Stripe) nascer `has_zelo_menu` PDV-owned + novos price IDs: `STRIPE_PRICE_CHAT`=R$147, novo `STRIPE_PRICE_BUNDLE`=R$197, novo `STRIPE_PRICE_MENU`=R$40 (addon do PDV). Como `server/billing.ts` já injeta price IDs por env, é troca de price ID + env, não constante de código.
2. (ZeloChat) ler o entitlement e só então virar a copy de pricing (`PRICING` no front + paywall). Passo 2 não pode vir antes do 1 — viraria copy sem o direito ser lido, trancando cliente válido.
3. (Produto/Ops) grandfather: Casa dos Salgados pinada na condição atual (D-017); **Agreste migrada** para R$147 com aviso prévio (operação na subscription PDV-owned + comms).
- Pendência de produto/PDV: remover Pedidos/Cozinha como addon vendido e mapear `plan_tier`/addons sem quebrar `subscriptions`.

Decisões aplicáveis (2026-06-23):
- D-103: `has_zelo_menu` é PDV-owned (nasce no repo PDV). Executável **agora neste repo, sem DDL**: resolver read-only de capability lendo assinatura `chat`/`bundle` (ZeloMenu incluído por D-014) OU `has_pedidos_addon` legado, fail-safe para ON, com seam único para a flag nova.
- D-104: ordem obrigatória = (1) PDV/Stripe nascem flag + price IDs; (2) ZeloChat lê entitlement e só então vira a copy; (3) grandfather. `server/billing.ts` já usa price IDs por env, então R$97→R$147 é troca de price ID + nova env, não constante de código.
- D-104: tratamento de existentes = Casa dos Salgados grandfathered (D-017); **Agreste migrada** para R$147 com aviso prévio (operação na subscription PDV-owned + comms).

Escopo:
- Atualizar preços no ZeloChat e ZeloPDV.
- Criar/ajustar price IDs (`STRIPE_PRICE_CHAT`=R$147, `STRIPE_PRICE_BUNDLE`=R$197, novo `STRIPE_PRICE_MENU`=R$40).
- Mapear plan_tier/addons sem quebrar `subscriptions`.
- Remover Pedidos/Cozinha como addon vendido.
- Preservar Casa dos Salgados como exceção temporária; migrar Agreste.

Aceite:
- Checkout e paywall mostram preços corretos.
- Entitlements batem com planos.
- Clientes antigos não quebram.

### Phase 3 — Integração Profunda com ZeloPDV

#### ZLM-301 — Sincronização real com pedidos do ZeloPDV

Status: Doing — bidirecional (opção a, duas tabelas sincronizadas) implementado e gated por empresa; pendente apply do trigger + validação E2E no Donutopia antes de ligar pra CS  
Type: Prototype  
Depends on: ZLM-202  
Owner: Engenharia  

Escopo:
- Pedido do ZeloMenu/Chat compatível com `pedidos`/`pedido_itens`.
- Origem `zelochat`, `zelomenu`, `mesa`.
- Cozinha/produção entende origem.
- Estado único entre superfícies.

Aceite:
- Pedido aceito no Chat aparece no PDV quando há bundle.
- Pedido aceito no PDV atualiza Chat.
- Não há duas fontes de verdade.

Resultado parcial (2026-06-23) — materialização ONE-WAY segura:
- Investigado o modelo real do PDV (via PostgREST OpenAPI + leitura do fluxo "balcão"): `pedidos` é ticket de cozinha — `numero_pedido` pela RPC race-safe `proximo_numero_pedido`, `id_venda`/`id_comanda` NULLABLE (venda nasce só no pagamento), `zelochat_order_id` já existe pra vincular, status `aberto`→`pronto`→`fechado`.
- `materializeOrderToPedidosBestEffort` (`server/zelomenuCartSessions.ts`) cria o ticket em `pedidos`/`pedido_itens` espelhando exatamente o balcão (status `aberto`, itens `enviado_cozinha`/`status_cozinha='aguardando'`, **sem tocar `vendas`/financeiro**), vinculando via `zelochat_order_id`. D-096: whatsapp→origem `zelochat`, public→`zelomenu`.
- **Gate `pdv_core`**: só roda para empresa com PDV (pdv/bundle). Cliente chat-only (Casa dos Salgados, Agreste) NUNCA dispara — segue 100% em `zelochat_orders`, zero regressão. Best-effort: falha não derruba o pedido.
- Chamado no aceite do WhatsApp (`acceptWhatsAppCartReviewSession`) e na confirmação `public_order`.
- **Falta (próxima fase):** sync bidirecional de status e fonte única (cutover: ZeloChat passar a LER `pedidos`, dropar `zelochat_orders`) com backfill — D-094 mantém `zelochat_orders` como write-path do piloto até lá. Validar com Donutopia antes de qualquer cutover.
- Validação: `npm run lint`, `npm run build`, suíte zelomenu passaram. Materialização ainda não exercida em prod (nenhum cliente bundle operando pedidos hoje além do teste).

#### ZLM-302 — Estoque integrado quando produto controla estoque

Status: Todo  
Type: Prototype  
Depends on: ZLM-301  
Owner: Engenharia  

Escopo:
- Produto com controle de estoque bloqueia confirmação se insuficiente.
- Estoque baixa no aceite.
- Produto sem controle de estoque ignora estoque.

Aceite:
- Revalidação ocorre na confirmação e no aceite.
- Estoque insuficiente não entra em produção.

#### ZLM-303 — Admin interno com impersonate completo auditado

Status: Todo  
Type: Prototype  
Depends on: ZLM-005  
Owner: Engenharia/Admin  

Escopo:
- Impersonate no admin interno central.
- Acesso completo no MVP para superadmins.
- Banner visual de suporte.
- Log de entrada e ações principais.
- Billing fora de ações acidentais.

Aceite:
- Equipe Zelo consegue acessar conta de clientes.
- Auditoria mínima existe.
- Recurso não mora dentro do ZeloChat.

#### ZLM-304 — Endurecer Access para superfície compartilhada

Status: Todo  
Type: Research  
Depends on: ZLM-005, ZLM-303  
Owner: Engenharia  

Escopo:
- Resolver ator/dono/empresa no servidor.
- Definir permissões de aceitar pedido, configurar menu, pausar item, reimprimir.
- Não depender só de bloqueio client-side.

Aceite:
- Novas ações sensíveis passam por guard server-side.
- Modelo fica compatível com Acessos do ZeloPDV.

### Phase 4 — Mesa/Comanda e Expansão

#### ZLM-401 — Contexto `table_order`

Status: Todo  
Type: Prototype  
Depends on: ZLM-301  
Owner: Engenharia  

Escopo:
- QR de mesa.
- Sessão temporária até a comanda fechar.
- Cliente escolhe itens e envia para comanda.
- Não precisa informar data/horário/retirada.

Aceite:
- Pedido cai na comanda correta.
- Produção é alertada.
- Sessão expira ao fechar comanda.

#### ZLM-402 — Status e notificações por mesa/comanda

Status: Todo  
Type: Prototype  
Depends on: ZLM-401  
Owner: Produto/Engenharia  

Escopo:
- Status simples do pedido da mesa.
- Alertas internos para produção.
- Evitar WhatsApp quando o contexto é mesa.

Aceite:
- Cliente entende que pedido foi enviado.
- Time operacional recebe o pedido.

#### ZLM-403 — Impressão por setor/categoria

Status: Todo  
Type: Prototype  
Depends on: ZLM-106, ZLM-301  
Owner: Engenharia  

Escopo:
- Separar impressão por cozinha, bebida, balcão ou categoria.
- Configuração por loja.
- Reimpressão por setor.

Aceite:
- Pedido pode gerar múltiplas impressões quando configurado.
- V1 de impressão única continua funcionando.

## Riscos de Efeito Borboleta

- Duplicar pedido entre `zelochat_orders` e `pedidos` cria divergência operacional.
- Fazer ZeloMenu como app operacional obrigatório aumenta carga do lojista.
- Cobrar ZeloMenu sem destino operacional de pedidos reduz valor percebido.
- Manter Pedidos/Cozinha como addon separado conflita com ZeloMenu.
- Permitir Chat-only usar infraestrutura de pedidos sem entitlements fortes pode liberar PDV indevidamente.
- Observação livre sem conferência manual gera pedido errado.
- Pix/comprovante dentro do ZeloMenu aumenta escopo e confunde o papel do Menu.
- Estoque baixando antes do aceite prende estoque em pedido que pode ser recusado.
- Link público sem revalidação aceita preço/horário/produto obsoleto.
- Impersonate completo sem auditoria vira risco interno sério.

## Próximo Passo Obrigatório

Executar ZLM-002 antes de implementar a primeira migration.

Motivo: o banco é compartilhado com ZeloPDV. O ZeloChat pode criar suas próprias tabelas, mas não deve alterar schema de tabelas ZeloPDV-owned a partir deste repo.
