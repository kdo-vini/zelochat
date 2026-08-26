# ZeloChat como CRM conversacional para lanchonetes

**Relatório de viabilidade técnica, financeira e de produto**  
**Data da análise:** 25 de agosto de 2026  
**Escopo:** leitura do repositório, documentação, banco de produção em modo somente leitura, políticas oficiais e análise paralela por agentes Luna.

## 1. Decisão executiva

**Vale evoluir o ZeloChat para CRM, mas não vale transformá-lo em um CRM genérico nem remover seu núcleo operacional.**

A direção mais forte é posicioná-lo como **CRM conversacional vertical para lanchonetes**:

> Cada conversa vira um cliente identificado, cada pedido alimenta o relacionamento e cada relacionamento pode gerar uma recompra mensurável.

O produto já tem boa parte da matéria-prima: atendimento WhatsApp, IA/manual, mensagens, tags, pedidos, ticket médio, histórico, ZeloMenu, produção e entrega. O vazio não é “mais IA”; é uma camada confiável de cliente, consentimento e relacionamento.

A recomendação é:

1. Manter **Atendimento**, **ZeloMenu**, **Produção**, **Agenda** e **Motoboys** como diferenciais verticais.
2. Adicionar **Clientes** como módulo próprio, conectado ao Atendimento.
3. Começar com ficha do cliente, aniversário, consentimento, notas, tags e inteligência de recompra.
4. Validar campanhas de aniversário em operação assistida antes de construir disparos automáticos em escala.
5. Tratar funcionários como outra categoria de relacionamento, nunca como público promocional por padrão.

### Veredito por dimensão

| Dimensão | Veredito | Condição |
|---|---|---|
| Produto | **Forte** | CRM vertical, não genérico |
| Técnica | **Viável** | Criar contato canônico e não usar sessão como pessoa |
| Dados atuais | **Úteis, porém fragmentados** | Normalização, vínculo e consentimento são obrigatórios |
| Financeira | **Plausível, ainda não comprovada** | Piloto precisa medir suporte, conversão e custo de campanha |
| Jurídica/canal | **Viável com controles** | Opt-in, opt-out, finalidade e regras do WhatsApp desde o início |
| Momento | **Bom para validar** | Um pedido real é sinal; ainda não é validação de mercado suficiente |

### Status de execução — 26/08/2026

O plano deixou de ser apenas uma hipótese e já tem uma primeira entrega técnica em branch isolada:

- **Banco:** migrations CRM `048–060` aplicadas no projeto Supabase conectado, com RLS, isolamento por empresa, checkpoints, agregados de leitura, índices FK/search para o CRM, campanhas/automações desativadas por padrão e fila de saída sem jobs ativos.
- **Dados:** Gate B somente leitura em todos os tenants (2.035 sessões, 1 vínculo previsto, 0 conflitos); Gate C controlado em Donutopia (9 sessões, 0 vínculos) e Casa dos Salgados (1.716 sessões, 1 vínculo), sem falhas. Nenhum disparo foi criado.
- **Produto:** `Clientes` está na navegação; `Métricas` foi movido para `Mais`; filtros ficam dentro de um único botão; a tela é mobile-first e mantém layout desktop; a ficha possui resumo, mensagens, pedidos e relacionamento.
- **Segurança:** leitor não vê ações de gestão; mensagens exigem permissão própria; o atalho para Atendimento usa somente UUID de sessão conhecido; funcionários não entram em audiência promocional automaticamente.
- **Verificação:** suíte unitária completa passou; Playwright passou nos viewports 360/390/768/1440 e no fluxo de gerente editar/enviar; lint e TypeScript passaram. O build Vercel local continua limitado por `EPERM` de symlink no Windows, sem alteração do adapter pela feature.
- **Entrega:** implementação integrada nos branches principais do ZeloChat (`99535d3`) e ZeloPDV (`cb1cc24`), incluindo a limpeza da spec temporária, dados de opt-out/relacionamento e hardening de índices. A migration 060 foi aplicada via Supabase MCP; nenhum `db push`, reparo de ledger ou deploy foi executado.
- **Advisors Supabase:** as tabelas CRM estão com RLS e sem grants para `anon`/`authenticated` por desenho server-only; o advisor lista isso como `INFO`, não como exposição. Depois da 060, as novas tabelas CRM não aparecem mais no aviso de FK sem índice. Permanecem avisos de índices ainda não usados (esperados com os dois pilotos), FKs de módulos legados/adjacentes e um índice duplicado pré-existente em sessões; isso não bloqueia o fluxo atual.
- **Builds pós-integração:** ZeloChat `npm run build` passou. ZeloPDV `npm run check` e `npm test` passaram (723 testes, 2 skips); o build compila até a geração do output, mas falha ao criar symlink no adapter Vercel por `EPERM` do Windows, limitação do ambiente local.

O único gate ainda aberto é a validação visual/autenticada no ambiente publicado e, depois dela, a decisão de ampliar o rollout. Como a integração atual não usa a API oficial, campanhas e automações continuam desligadas até existir uma política de opt-in/opt-out e um limite operacional aprovado.

## 2. O que o pedido da cliente realmente revela

A mensagem da imagem pede um cadastro de aniversário para localizar aniversariantes e oferecer benefícios pelo WhatsApp. Esse pedido é um excelente ponto de entrada porque conecta três resultados fáceis de entender pelo lojista:

- conhecer o cliente;
- lembrar de uma ocasião relevante;
- gerar recompra.

Isso valida a **dor**, mas uma única conversa não valida ainda demanda, disposição a pagar nem segurança do canal. A resposta correta é um piloto pequeno com métricas, não construir imediatamente uma central de disparos.

## 3. Evidências do produto atual

O ZeloChat já é mais próximo de um CRM conversacional do que parece:

| Capacidade | Situação |
|---|---|
| Atendimento WhatsApp híbrido IA/manual | Existe e deve continuar sendo o núcleo operacional |
| Nome e telefone do contato | Existem nas sessões, mas a sessão representa uma conversa/JID, não uma pessoa canônica |
| Histórico de mensagens | Existe |
| Tags manuais e automáticas | Existem por empresa e podem ser a primeira base de segmentação |
| Pedidos recentes | Existem em `zelo_orders` e são consultados pela IA |
| Quantidade de pedidos e ticket médio | Já aparecem na lateral do Atendimento |
| Resumo de cliente por IA | Já é gerado e persistido em `customer_profile`, mas não é exibido ao operador |
| Busca e filtros | Existem por nome, telefone, mensagem, status e tag |
| Ações em massa | Limitadas a leitura, arquivamento e exclusão; não há campanha promocional |
| Campanhas, consentimento e opt-out | Não existem como domínio de produto |
| Aniversário | Não existe no código nem no modelo atual |

Há uma oportunidade de baixo custo imediatamente visível: expor o **Resumo automático** já gerado pela IA na ficha do cliente, deixando claro que é uma inferência e não um dado confirmado.

## 4. O que o banco de produção mostra

Snapshot agregado e sem dados pessoais, consultado em 25/08/2026:

| Evidência | Resultado | Leitura |
|---|---:|---|
| Pessoas do tipo cliente | 84 em 9 empresas | Há uma base inicial no ZeloPDV |
| Clientes com algum contato preenchido | 44 | Quase metade não pode ser alcançada diretamente |
| Pessoas do tipo funcionário | 26 em 7 empresas | Úteis para diretório/equipe, não para marketing |
| Funcionários com contato | 11 | A base é esparsa |
| Sessões ZeloChat com telefone | 2.034 | A fonte mais rica de contatos hoje é o próprio WhatsApp |
| Sessões que casam com `pessoas` no mesmo dono e últimos 10 dígitos | 7 | ZeloChat e ZeloPDV estão muito pouco vinculados |
| Vendas totais observadas | 15.454 | Bom potencial de inteligência de recompra |
| Vendas ligadas por `id_cliente` | 708 | Atribuição de vendas a pessoas ainda é baixa |
| Vendas ligadas por `id_pessoa` | 2 | Campo praticamente não utilizado na amostra |
| Telefones duplicados na mesma empresa em `pessoas` | 1 grupo | Já existe risco real de duplicidade |

### Implicações

1. **Não basta “reaproveitar `pessoas`”.** Metade dos registros não tem contato, a tabela mistura clientes e funcionários e o vínculo com as conversas é mínimo.
2. **Não se deve transformar `zelochat_sessions` em cadastro de clientes.** Uma pessoa pode ter múltiplos JIDs/sessões; sessão é identidade de transporte.
3. O melhor ativo atual são as 2.034 conversas, enriquecidas progressivamente com pedidos e dados confirmados.
4. Funcionários podem aparecer numa área de equipe/contatos internos, mas devem ficar excluídos de segmentos de marketing por padrão.
5. A normalização apenas pelos últimos 10 dígitos, usada em pontos atuais, é conveniente para consulta, mas frágil como chave de identidade definitiva.

### Observação sobre assinaturas

A documentação registra dois pagantes e um teste do fundador, enquanto a consulta agregada atual encontrou apenas uma assinatura ativa de chat/bundle e valor mensal zerado no recorte consultado. Isso pode ser diferença de modelagem, cobrança externa ou documentação desatualizada. **Não usar nenhum dos dois números como verdade comercial sem uma reconciliação de billing.**

## 5. Forma de produto recomendada

### Posicionamento

**CRM conversacional para lanchonetes: atendimento, pedidos e recompra no mesmo relacionamento.**

O ZeloChat não deve competir frontalmente com CRMs genéricos em pipeline B2B, objetos customizados, e-mail, omnichannel ou automações complexas. Sua vantagem é fechar o ciclo específico:

```text
Conversa → cliente identificado → pedido no ZeloMenu → operação → histórico → recompra
```

### Três caminhos avaliados

| Caminho | Avaliação |
|---|---|
| Substituir o produto por um CRM genérico | **Não recomendado.** Perde o diferencial vertical e entra num mercado maduro |
| Criar um CRM separado | **Adiar.** Duplica navegação, domínio e aquisição antes de validar valor |
| Adicionar a camada “Clientes e relacionamento” ao ZeloChat | **Recomendado.** Reutiliza ativos e preserva o núcleo atual |

## 6. O que manter, editar, adicionar e não construir agora

### Manter

- **Atendimento** como inbox operacional.
- **Produção, Agenda e Motoboys** como módulos de execução.
- **ZeloMenu** como caminho canônico para o cliente montar o pedido.
- Redirecionamento da IA ao cardápio; não reativar o fluxo antigo em que a IA cria pedidos.
- `zelo_orders` como domínio de pedidos.
- Tags existentes, inicialmente como segmentação básica.

### Editar

- Painel lateral do Atendimento: mostrar ficha resumida, aniversário, notas, consentimento, última compra e resumo automático.
- Busca: incluir dados do contato canônico.
- Dashboard: futuramente exibir aniversariantes próximos, clientes inativos e recompra — somente após os dados serem confiáveis.
- “Cérebro IA”: pode evoluir para **Automações e IA** quando houver jornadas; não é prioridade renomear agora.
- Administração de tags: criar uma tela clara para gerenciar tags, não apenas aplicá-las.

### Adicionar

1. **Clientes** na navegação.
2. Ficha canônica por empresa e telefone normalizado.
3. Dia e mês de aniversário; ano somente quando necessário e informado.
4. Notas internas confirmadas pelo operador.
5. Consentimento por finalidade, fonte e data.
6. Opt-out e supressão obrigatória.
7. Origem do contato: WhatsApp, PDV, ZeloMenu ou manual.
8. Linha do tempo de conversas, pedidos, consentimentos e campanhas.
9. Segmentos simples: aniversariantes, clientes com tag, com pedido e inativos.
10. Campanhas pequenas com prévia, teste, confirmação, fila e auditoria.

### Não construir no MVP

- Pipeline comercial B2B, negócios e oportunidades.
- Omnichannel, e-mail ou SMS.
- Pontos/fidelidade e regras financeiras de cupom.
- Construtor genérico de workflows.
- Lead scoring por IA.
- Exportação completa de contatos e conversas.
- Campanhas produzidas e enviadas autonomamente pela IA.
- Disparo em massa diretamente na seleção de conversas do Atendimento.
- Segundo catálogo ou segundo fluxo de pedidos dentro do CRM.

## 7. Arquitetura de dados proposta

As tabelas compartilhadas do ZeloPDV são de propriedade daquele produto e não devem receber alterações unilaterais no repositório do ZeloChat. Para a primeira versão, a opção mais segura é um agregado próprio de relacionamento:

### `zelochat_contacts`

- `id`
- `empresa_id`
- `display_name`
- `normalized_phone_e164`
- `birth_month`
- `birth_day`
- `birth_year` opcional
- `internal_notes`
- `relationship_type`: cliente, funcionário, fornecedor ou outro
- `source`
- `pessoa_id` opcional, apenas como ponte
- timestamps e auditoria

Regra de unicidade inicialmente pretendida: empresa + telefone normalizado. Casos sem telefone ou compartilhamento familiar exigem decisão de domínio e opção de mesclar/desfazer mesclagem com auditoria.

### `zelochat_contact_identities`

Mapeia as identidades de transporte e sistemas legados ao contato:

- `contact_id`
- tipo de identidade: telefone, JID, `pessoa_id`, identificador do pedido;
- valor normalizado;
- origem e nível de confiança;
- data de confirmação manual, quando houver.

### `zelochat_contact_consents`

Ledger histórico, não apenas um booleano:

- contato e empresa;
- canal;
- finalidade, como promoções ou aniversário;
- estado concedido/revogado;
- origem e evidência;
- data de captura/revogação.

### `zelochat_campaigns` e `zelochat_campaign_recipients`

Devem registrar a campanha e congelar a audiência elegível. Cada destinatário precisa de:

- status;
- chave de idempotência;
- tentativas;
- mensagem/template usado;
- identificador no canal;
- entrega/falha;
- resposta e conversão atribuída quando mensurável;
- motivo de supressão.

### Regras técnicas inegociáveis

- `empresa_id` em todas as tabelas e filtros server-side, além de RLS.
- Seleção de audiência no servidor, paginada; não montar a lista inteira no navegador.
- Fila persistente, limite de velocidade, pausa e retomada.
- Idempotência por campanha e destinatário.
- CRM **fail-soft**: se a ficha estiver indisponível, o Atendimento continua funcionando.
- A IA nunca altera aniversário, consentimento ou opt-out.
- Resumo automático deve ser separado visual e estruturalmente de dados confirmados.
- Normalização telefônica canônica, preferencialmente E.164, com fluxo manual de merge/unmerge.
- Revisar o modelo de permissões para que funcionários autorizados acessem o CRM sem ampliar acesso indevido.

## 8. Campanhas de aniversário e regras do canal

Promoção de aniversário é **mensagem de marketing**. Na WhatsApp Business Platform, o negócio deve:

- ter o número fornecido pelo usuário e opt-in para mensagens posteriores;
- respeitar opt-out;
- usar template aprovado quando iniciar conversa fora da janela de 24 horas;
- manter um caminho claro para atendimento humano;
- proteger os dados e publicar as informações de privacidade aplicáveis.

Fontes oficiais: [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/) e [WhatsApp Business Platform Pricing](https://whatsappbusiness.com/products/platform-pricing/).

A integração atual por QR é adequada ao atendimento vigente, mas campanhas em escala ampliam risco de bloqueio, suporte e reputação. Antes de vender automação promocional, é necessário um gate técnico/comercial:

1. validar formalmente a compatibilidade do provedor com esse uso;
2. criar uma abstração de canal;
3. avaliar a WhatsApp Business Platform oficial para templates e mensagens iniciadas pela empresa;
4. repassar ou limitar consumo de marketing, em vez de prometer disparos ilimitados.

Sob LGPD, telefone, aniversário, histórico e preferências são dados pessoais. Mesmo quando outra hipótese legal for considerada, a análise deve documentar finalidade, necessidade e salvaguardas. Para campanhas via WhatsApp, o opt-in continua sendo exigência prática do canal. Referência: [guia da ANPD sobre legítimo interesse](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_orientativo_hipoteses_legais_tratamento_de_dados_pessoais_legitimo_interesse).

## 9. Viabilidade financeira

### O que é conhecido

- Preços atuais: **R$149/mês** para ZeloChat com ZeloMenu e **R$198/mês** no bundle com ZeloPDV.
- O provedor atual anuncia planos de R$30 por uma instância, R$90 por cinco e R$200 por quinze, equivalente a aproximadamente **R$13,33–R$30 por empresa** quando bem alocado. Fonte: [Whatsmiau](https://whatsmiau.dev/).
- O modelo de texto atual custa US$0,15 por milhão de tokens de entrada e US$0,60 por milhão de saída. Transcrição custa US$0,003/minuto. Fontes: [GPT-4o mini](https://developers.openai.com/api/docs/models/gpt-4o-mini) e [preços da API](https://platform.openai.com/pricing).
- No recorte de 30 dias do banco, o texto registrado custou menos de US$0,03 pelas tarifas atuais; houve 104 transcrições, mas a duração dos áudios não está registrada nessa leitura. O uso atual é pequeno e não representa um cliente de alto volume.

### Leitura correta

O custo de IA **não é hoje o principal risco de margem**. Os riscos maiores são:

- atendimento e onboarding humano;
- instância/canal por empresa;
- infraestrutura e mídia;
- incidentes e suporte;
- custo de mensagens de marketing na plataforma oficial;
- cliente de alto volume sem fair use.

Não há dados suficientes para declarar margem bruta real porque suporte, infraestrutura, cobrança e duração de áudio ainda não estão conciliados por tenant.

### Empacotamento recomendado

1. **Manter R$149 e R$198 durante a validação.** Mudar produto e preço ao mesmo tempo prejudica o aprendizado.
2. Incluir ficha de cliente e inteligência básica no plano atual, reforçando retenção.
3. Só após validar ROI, criar add-on **Campanhas e relacionamento** entre **R$39 e R$59/mês**, sem prometer consumo ilimitado de marketing.
4. Repassar créditos de mensagens oficiais ou usar franquia + excedente transparente.
5. Criar tier superior de volume somente com dados reais de uso e suporte.

### Fórmula de margem a instrumentar

```text
Margem de contribuição por empresa =
receita líquida
- canal/instância
- mensagens de marketing
- IA e transcrição
- infraestrutura variável
- suporte variável
- inadimplência/reembolsos
```

## 10. Roadmap recomendado

### Fase 0 — validação sem motor de disparo

- Entrevistar 5–10 lanchonetes.
- Identificar quem já coleta aniversário e como registra autorização.
- Expor o resumo automático já existente ao operador.
- Criar protótipo navegável de Clientes e Ficha do cliente.
- Executar uma campanha concierge de aniversário apenas com opt-in comprovável.

**Gate:** pelo menos três lojas usam de fato o fluxo, não apenas dizem que usariam.

### Fase 1 — CRM leve

- Contato canônico.
- Vínculo com sessões e `pessoas` sem alterar a propriedade do ZeloPDV.
- Aniversário, notas, fonte e consentimento.
- Ficha integrada ao Atendimento.
- Lista Clientes com busca e filtros.
- Administração de tags.
- Último contato, pedidos, ticket e resumo automático.

**Gate:** identidade sem colisões graves, uso recorrente da ficha e dados de aniversário/consentimento sendo preenchidos.

### Fase 2 — campanha controlada

- Audiência elegível e prévia.
- Mensagem de teste.
- Confirmação explícita.
- Ledger de destinatários.
- Fila, rate limit, idempotência, pausa e status.
- Opt-out e supressão.
- Link rastreável ao ZeloMenu.
- Métrica de respostas, pedidos e margem incremental.

**Gate exploratório:** conversão incremental acima de 3%, margem positiva, opt-out abaixo de 2% e nenhuma suspensão/bloqueio. Esses valores são hipóteses iniciais, não metas definitivas.

### Fase 3 — automações de recompra

- Aniversário agendado.
- Cliente sem comprar há X dias.
- Recência, frequência e valor.
- Templates aprovados e reutilizáveis.
- Histórico de campanhas por cliente.
- Cupons somente depois que atribuição e fraude estiverem resolvidas.

## 11. Experimento recomendado

### Hipótese

“Lanchonetes que veem aniversariantes e enviam uma oferta consentida pelo WhatsApp geram recompra mensurável e pagariam por essa automação.”

### Desenho

- 5–10 lojas, incluindo clientes atuais.
- Uma única campanha por loja.
- Público com opt-in comprovável.
- Operação concierge para evitar construir infraestrutura antes do aprendizado.
- Link individual ou identificável para o ZeloMenu.
- Grupo comparável sem contato, quando possível.

### Medir

- lojas que realmente cadastraram aniversários;
- contatos elegíveis;
- mensagens entregues;
- respostas e pedidos;
- receita e margem incremental;
- opt-outs e bloqueios;
- tempo economizado pelo lojista;
- custo do canal, IA, suporte e operação;
- disposição a pagar pelo add-on.

### Critério de decisão

- **Avançar:** uso recorrente, ROI positivo e baixo risco de canal.
- **Ajustar:** interesse alto, mas coleta de consentimento ou cadastro baixa.
- **Parar campanhas e manter CRM leve:** valor na ficha do cliente, sem ROI promocional ou com risco alto de bloqueio.

## 12. Riscos prioritários

| Risco | Impacto | Mitigação |
|---|---|---|
| Mesclar pessoas erradas por telefone | Alto | E.164, identidades, confiança e merge/unmerge auditável |
| Vazamento entre empresas | Crítico | `empresa_id`, RLS, filtros server-side e testes de isolamento |
| Promover para funcionário | Alto | `relationship_type` e exclusão padrão de marketing |
| Enviar sem consentimento | Crítico | Ledger, prévia de elegibilidade, supressão e opt-out |
| Duplicar disparos | Alto | Fila persistente e idempotência por destinatário |
| Bloqueio da conta WhatsApp | Crítico | Piloto pequeno, validação do provedor e canal oficial para escala |
| Perfil de IA tratado como fato | Médio/alto | Separar inferência de dado confirmado |
| CRM quebrar atendimento crítico | Crítico | Integração fail-soft e rollout por feature flag |
| Atribuição de venda incorreta | Alto | Links/códigos rastreáveis e grupo comparável |
| Margem negativa em alto volume | Alto | Métricas por tenant, fair use, franquia e tier superior |

## 13. Próxima decisão recomendada

Não decidir agora “virar CRM” como uma reescrita do produto. Decidir isto:

> Vamos validar, em 30 dias, se uma ficha de cliente ligada ao atendimento e uma campanha assistida de aniversário geram uso recorrente e recompra mensurável em lanchonetes.

Se o resultado for positivo, o primeiro épico deve ser **Contato canônico + ficha integrada ao Atendimento**, e não “motor de campanhas”. Essa ordem evita transformar uma boa ideia de relacionamento numa ferramenta frágil de disparo.

## 14. Fontes externas consultadas

- [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/)
- [WhatsApp Business Platform Pricing](https://whatsappbusiness.com/products/platform-pricing/)
- [ANPD — guia sobre legítimo interesse](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_orientativo_hipoteses_legais_tratamento_de_dados_pessoais_legitimo_interesse)
- [Whatsmiau — planos e documentação](https://whatsmiau.dev/)
- [OpenAI — GPT-4o mini](https://developers.openai.com/api/docs/models/gpt-4o-mini)
- [OpenAI — preços da API](https://platform.openai.com/pricing)
- [RD Station CRM — planos](https://www.rdstation.com/planos/crm/)
- [RD Station Conversas — planos](https://www.rdstation.com/planos/conversas/)
- [Kommo — comparação de planos](https://www.kommo.com/br/precos/compare-planos/)
