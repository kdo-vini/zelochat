# Clientes — CRM conversacional nativo do ZeloChat

**Data:** 25 de agosto de 2026  
**Estado:** design aprovado durante a conversa, pendente de plano de implementação  
**Produtos envolvidos:** ZeloChat, ZeloPDV e ZeloMenu  
**Canal inicial:** conexão WhatsApp atual por QR; não depende da API oficial

## 1. Objetivo

Adicionar **Clientes** ao ZeloChat como um CRM conversacional completo e incluído nos planos atuais de chat e bundle. O módulo reúne cadastro, mensagens, pedidos, relacionamento, campanhas e automações, mantendo `pessoas` do ZeloPDV como cadastro mestre.

O produto deve transformar automaticamente contatos do WhatsApp em clientes, consolidar as diferentes fontes da mesma pessoa e permitir que a empresa controle o relacionamento pelo celular ou desktop.

## 2. Decisões de produto

- A feature está incluída no ZeloChat; não existe add-on, crédito de software ou novo paywall.
- O canal de envio inicial é exclusivamente WhatsApp pela integração atual.
- Funcionários não aparecem em Clientes e nunca entram em campanhas.
- Todo contato WhatsApp com identidade não ambígua vira cliente automaticamente, inclusive por backfill; ambiguidades entram na fila de conflitos e ficam fora de envios até resolução.
- Clientes do PDV sem telefone aparecem como **Cadastro incompleto** e não podem receber mensagens.
- A empresa escolhe livremente quem recebe campanha. O sistema não exige um estado prévio de consentimento, mas respeita bloqueios e opt-out.
- O cadastro mestre é `pessoas`, no banco compartilhado e sob ownership do ZeloPDV.
- Ativo/inativo é definido primeiro por compra; conversa é fallback somente quando não existe compra vinculada.
- Jornadas são prontas e editáveis, não existe construtor visual genérico no lançamento.
- Ações destrutivas excluem diretamente após confirmação; saldo fiado em aberto bloqueia a exclusão.
- Permissões reutilizam o RBAC do ZeloPDV e adicionam uma capacidade própria para comunicação.

## 3. Navegação e UX

### 3.1 Desktop

A sidebar mantém a organização atual e recebe os ajustes:

1. **Visão geral** passa a se chamar **Métricas**; o identificador interno `dashboard` pode permanecer.
2. **Clientes** entra imediatamente depois de Atendimento.
3. Ordem principal: Métricas, Atendimento, Clientes, Produção, Motoboys.
4. Agenda, Cérebro IA e Cardápio mantêm suas posições de gestão.

No modo geral, Clientes é permitido junto de Atendimento, Cérebro IA, Configurações, Perfil e Novidades.

### 3.2 Mobile

A barra inferior do modo restaurante contém somente:

1. Atendimento
2. Clientes
3. Produção
4. Mais

**Mais** contém Métricas, Agenda, Motoboys, Cérebro IA, Cardápio, Novidades, Configurações e Perfil, respeitando disponibilidade e permissões.

No modo geral, a barra contém Atendimento, Clientes e Mais. Produção e os demais módulos de restaurante continuam ocultos.

A configuração de navegação deve continuar centralizada. Cada item passa a declarar sua posição no desktop e no mobile; não criar listas divergentes por viewport.

### 3.3 Estrutura interna de Clientes

O módulo tem três áreas locais:

- **Clientes**
- **Campanhas**
- **Automações**

Segmentos não recebem uma quarta área. Eles são filtros salvos e ficam dentro do fluxo de filtros/campanhas.

### 3.4 Lista de clientes

O cabeçalho contém título, quantidade, busca, botão **Filtros** e ação **Novo cliente**. VIP, aniversariantes, ativos, inativos, sem telefone, origem, tags e datas ficam dentro de um único painel.

- Mobile: Filtros abre bottom sheet; a lista ocupa a tela inteira.
- Desktop: Filtros abre popover/painel ancorado; lista e ficha ficam lado a lado.
- O botão exibe `Filtros` sem seleção e `Filtros (N)` quando há filtros ativos.
- Filtros podem ser salvos como segmento com nome único por empresa.

Cada linha mostra apenas nome, telefone ou aviso **Sem WhatsApp**, última atividade, estado comercial e uma informação de valor. Não exibir várias pills permanentes na lista.

### 3.5 Ficha do cliente

No mobile, a ficha abre em tela inteira com botão Voltar. No desktop, abre no painel direito sem perder a lista.

Abas:

- **Resumo:** nome, telefone, aniversário, origem, tags, notas, resumo automático, atividade e indicadores.
- **Mensagens:** histórico consolidado dos JIDs vinculados, paginação e composer completo.
- **Pedidos:** pedidos e vendas vinculados, última compra, frequência, ticket médio e valor total.
- **Relacionamento:** campanhas recebidas, automações, bloqueios, opt-outs e próximas ações.

Campos editáveis são nome, telefones WhatsApp, aniversário, notas internas, tags e estado de bloqueio. CPF, e-mail e endereços não entram no escopo; endereços existentes aparecem apenas nos snapshots de pedidos.

O resumo de IA aparece como **Resumo automático**, visualmente separado de dados confirmados. IA não altera nome, telefone, aniversário, bloqueio ou tags manuais.

### 3.6 Mensagens

Mensagens continuam tendo uma única fonte de verdade em `zelochat_messages`. A aba Mensagens reutiliza a thread e o composer extraídos do Atendimento.

- Não copiar mensagens para tabelas CRM.
- Envio individual usa o mesmo lifecycle persistido `sending → sent|failed` e o mesmo retry atual.
- Abrir uma conversa pelo CRM e pelo Atendimento aponta para a mesma família de sessões.
- Falha no CRM nunca impede o Atendimento de abrir ou enviar.

## 4. Ownership e modelo de dados

### 4.1 ZeloPDV — identidade compartilhada

As mudanças abaixo nascem e são versionadas primeiro no repositório ZeloPDV.

#### Ampliação de `pessoas`

Adicionar:

- `aniversario_dia smallint null`, com check 1–31;
- `aniversario_mes smallint null`, com check 1–12;
- `aniversario_ano smallint null`, com check entre 1900 e 2100 e sempre opcional;
- `updated_at timestamptz not null default now()`.

Dia e mês devem ser ambos nulos ou ambos preenchidos. O ano nunca é necessário para a automação de aniversário.

`contato` permanece como valor original exibível para manter compatibilidade com o PDV.

#### Nova tabela `pessoa_identities`

Campos:

- `id uuid primary key`;
- `id_usuario uuid not null`;
- `pessoa_id uuid not null references pessoas(id) on delete cascade`;
- `kind text not null check (kind in ('phone', 'whatsapp_jid'))`;
- `value_normalized text not null`;
- `value_raw text null`;
- `source text not null check (source in ('pdv', 'whatsapp', 'zelomenu', 'manual'))`;
- `is_primary boolean not null default false`;
- `verified_at timestamptz null`;
- timestamps.

Invariantes:

- unique `(id_usuario, kind, value_normalized)`;
- FK/trigger garante que pessoa e identidade pertencem ao mesmo `id_usuario`;
- no máximo uma identidade `phone` primária por pessoa;
- RLS usa `get_owner_user_id(auth.uid()) = id_usuario`;
- escrita de subusuário exige `pessoas.gerenciar`; service role mantém bypass explícito.

#### Normalização

Uma função SQL canônica normaliza telefone brasileiro:

- remove caracteres não numéricos;
- aceita 10/11 dígitos locais e adiciona DDI 55;
- aceita 12/13 dígitos já iniciados por 55;
- rejeita outros tamanhos para identidade WhatsApp;
- não remove automaticamente o nono dígito.

`buildContactKey` pode continuar como heurística temporária de leitura, mas não cria identidade nem decide merge.

#### RPC `ensure_customer_from_whatsapp`

Operação server-only, executável por `service_role`, com entrada:

- owner/id_usuario;
- telefone bruto;
- JID;
- nome observado;
- origem.

Comportamento transacional:

1. normaliza telefone e JID;
2. adquire lock por owner + telefone;
3. retorna identidade existente quando houver;
4. sem identidade, procura uma única `pessoas.tipo='cliente'` cujo `contato` normalize igual;
5. com uma correspondência, cria identidades e retorna a pessoa;
6. sem correspondência, cria cliente e identidades;
7. com múltiplas correspondências ou correspondência somente em funcionário, retorna `conflict` e não escolhe automaticamente;
8. nome observado preenche apenas nome vazio ou igual ao telefone; nunca sobrescreve nome manual válido.

#### Pedidos canônicos

Adicionar `pessoa_id uuid null references pessoas(id) on delete set null` a `zelo_orders`, com índice por empresa/pessoa/data. RPCs de criação continuam preservando o snapshot `customer`; o novo vínculo é adicional e opcional.

ZeloMenu resolve/cria a pessoa antes de confirmar um pedido com telefone válido. Falha na resolução não bloqueia o pedido: cria o pedido sem `pessoa_id`, registra conflito/erro para reconciliação e mantém o snapshot.

### 4.2 ZeloChat — relacionamento

#### Sessões

Adicionar `pessoa_id uuid null references pessoas(id) on delete cascade` a `zelochat_sessions`, com índice `(empresa_id, pessoa_id, updated_at desc)`.

A família de conversa passa a priorizar `pessoa_id`. A heurística de telefone permanece apenas para sessões ainda não migradas ou em conflito.

#### `zelochat_customer_relationships`

Uma linha por empresa/pessoa:

- `empresa_id`;
- `pessoa_id`;
- `internal_notes` com limite de 4.000 caracteres;
- `ai_summary` com limite de 600 caracteres;
- `whatsapp_blocked_at`;
- `whatsapp_block_reason`;
- `last_manual_contact_at`;
- timestamps e `updated_by`.

Unique `(empresa_id, pessoa_id)`. FK composta/trigger impede vínculo cross-tenant.

O `customer_profile` atual é migrado para `ai_summary` escolhendo o valor não vazio da sessão mais recente. Durante rollout, leitura usa relationship primeiro e sessão como fallback; após estabilização, sessões deixam de ser atualizadas.

#### Tags e conflitos

- `zelochat_person_tags`: relação tenant-safe entre pessoa e `zelochat_tags`.
- `zelochat_person_match_conflicts`: telefone/JID, candidatos, motivo, estado e resolução auditável.

As definições de tag existentes são reutilizadas. Tags de sessão continuam operacionais; aplicação manual na ficha usa tag de pessoa. Auto-tag da IA aplica à pessoa quando `pessoa_id` existe e mantém fallback de sessão durante a migração.

### 4.3 Campanhas, automações e fila

#### `zelochat_segments`

Filtro salvo por empresa com nome, definição JSON validada e timestamps. A definição aceita somente filtros expostos pela API; não aceita SQL ou campos arbitrários.

#### `zelochat_campaigns`

Guarda nome, mensagem, segmento/filtro usado, modo `draft|scheduled|running|paused|completed|cancelled`, horário e métricas agregadas.

#### `zelochat_campaign_recipients`

Congela a audiência no agendamento:

- campaign, empresa, pessoa;
- telefone e nome usados como snapshot;
- status `eligible|suppressed|queued|sending|sent|failed|cancelled`;
- motivo de supressão;
- chave idempotente;
- tentativas, provider message id e timestamps.

Unique campanha + pessoa. Recalcular segmento nunca altera uma campanha já agendada.

#### `zelochat_automation_rules`

Uma regra por empresa e tipo:

- `birthday`;
- `reactivation`;
- `post_purchase`;
- `vip`;
- `abandoned_cart`.

Guarda enabled, mensagem, janela de envio, timezone `America/Sao_Paulo`, limites e configuração validada por tipo.

#### `zelochat_automation_dispatches`

Ledger de execução com pessoa, regra, chave do evento, estado, conteúdo final, motivo de supressão, tentativa e timestamps. Chaves idempotentes:

- aniversário: pessoa + regra + ano;
- reativação: pessoa + regra + ciclo/cooldown;
- pós-compra: pessoa + regra + order id;
- VIP: pessoa + regra + versão do limiar;
- carrinho: cart id + regra.

#### `zelochat_outbound_jobs`

Fila persistente comum a campanha e automação, com concurrency 1 por instância, retry limitado, próxima tentativa, lease e idempotência. Jobs nunca carregam credenciais; o worker resolve a instância pela empresa no envio.

## 5. Regras das jornadas

Todas as automações nascem **desativadas**. O lojista deve revisar mensagem, horário, público e limite antes de ativar.

### Aniversário

- padrão: enviar no dia, às 10:00;
- permite antecedência de 0–7 dias;
- uma vez por pessoa/ano;
- exige dia/mês, telefone válido e ausência de bloqueio/conflito.

### Reativação

- padrão: 30 dias sem pedido entregue;
- configurável entre 7 e 180 dias;
- cooldown padrão de 30 dias;
- não envia com pedido aberto, mensagem promocional enviada nos últimos 7 dias ou contato bloqueado;
- sem pedidos, usa última conversa e identifica o critério como fallback.

O mesmo número configurado para reativação define o filtro visual ativo/inativo da empresa; o padrão é 30 dias.

### Pós-compra

- padrão: 24 horas após pedido entregue;
- uma vez por pedido;
- cancelados/recusados não disparam;
- a mensagem pode pedir avaliação ou incentivar nova compra, sempre aprovada antes da ativação.

### VIP/frequentes

- padrão: 5 pedidos entregues ou R$300 de valor acumulado;
- limiares são editáveis;
- ao atingir, aplica tag VIP e pode enviar uma mensagem;
- dispara uma vez por versão de limiar, sem repetir a cada pedido.

### Carrinho abandonado

- incorpora o fluxo existente em vez de criar um segundo sweeper;
- padrão: 2 horas após abandono, uma única vez por carrinho;
- configurável entre 2 e 24 horas;
- nunca envia para carrinho confirmado, cancelado, arquivado ou bloqueado;
- preserva emissão de link novo porque o token original não é recuperável.

## 6. Campanhas e regras do WhatsApp atual

Campanha manual segue:

1. escolher filtros/segmento;
2. visualizar elegíveis e suprimidos;
3. escrever mensagem e usar variáveis permitidas como primeiro nome;
4. enviar teste ao próprio número;
5. congelar audiência;
6. enviar agora ou agendar;
7. acompanhar fila, falhas, pausa e conclusão.

Guardrails:

- exclui pessoa sem telefone, funcionário, conflito e bloqueio/opt-out;
- a empresa pode selecionar os demais clientes sem estado prévio de autorização;
- concurrency 1 por instância;
- limite padrão de 50 envios/dia, editável até o hard cap de 200/dia;
- no máximo 12 inícios de envio por minuto;
- falha de conexão pausa novos jobs, preserva a fila e mostra texto amigável;
- nenhum texto ao cliente ou operador menciona provedor interno;
- mensagens normalizadas iguais a `PARAR`, `SAIR`, `CANCELAR`, `NÃO QUERO MAIS MENSAGENS`, `PARE DE ENVIAR` ou `REMOVER MEU NÚMERO` bloqueiam automações deterministicamente; desbloqueio manual exige auditoria.

Não existem templates da API oficial, categorias oficiais ou cobrança por mensagem dentro deste desenho.

## 7. APIs e tipos públicos do ZeloChat

### Clientes

- `GET /api/customers`: cursor, busca e filtros server-side.
- `POST /api/customers`: cria `pessoas.tipo='cliente'` e relationship.
- `GET /api/customers/:personId`: ficha consolidada.
- `PATCH /api/customers/:personId`: atualiza somente campos permitidos.
- `DELETE /api/customers/:personId`: confirmação no cliente, permission check e RPC segura.
- `POST /api/customers/:personId/merge`: mescla identidades após prévia e auditoria.
- `GET /api/customers/:personId/messages`: histórico paginado da família.
- `POST /api/customers/:personId/messages`: envio individual pelo lifecycle existente.
- `GET /api/customers/:personId/orders`: pedidos/vendas paginados.
- `GET /api/customers/:personId/timeline`: relacionamento paginado.

### Segmentos e campanhas

- CRUD `/api/customer-segments`.
- CRUD `/api/campaigns` para draft.
- `POST /api/campaigns/:id/preview`.
- `POST /api/campaigns/:id/test`.
- `POST /api/campaigns/:id/schedule`.
- `POST /api/campaigns/:id/pause|resume|cancel`.
- `GET /api/campaigns/:id/recipients` paginado.

### Automações

- `GET /api/customer-automations`.
- `PATCH /api/customer-automations/:kind`.
- `POST /api/customer-automations/:kind/test`.
- `POST /api/customer-automations/:kind/enable|disable`.
- `GET /api/customer-automations/:kind/history` paginado.

Tipos frontend centrais:

- `CustomerSummary`;
- `CustomerDetail`;
- `CustomerFilters`;
- `CustomerActivityState`;
- `CustomerSegment`;
- `Campaign` e `CampaignRecipient`;
- `AutomationKind`, `AutomationRule` e `AutomationDispatch`.

Respostas de erro consumidas pela UI usam mensagens amigáveis em português e um `code` estável para lógica do cliente.

Na exclusão, pessoa, identidades, sessões, mensagens, tags da pessoa, recipients/dispatches e relationship são removidos por cascade na mesma transação. Vendas e pedidos financeiros permanecem com seus snapshots, mas recebem `pessoa_id`/`id_cliente = null`; a confirmação exibe esse comportamento antes da ação.

## 8. Permissões e isolamento

- Toda API resolve `empresa_id` e owner pelo token; nunca aceita tenant do body.
- `pessoas.visualizar`: lista, ficha, mensagens e pedidos.
- `pessoas.gerenciar`: criar, editar, tags, merge e exclusão.
- `clientes.comunicar`: envio individual pelo CRM, campanhas e automações.
- Owners mantêm bypass conforme o padrão do ZeloPDV.
- Backend com service role valida ator e capability antes da consulta/mutação.
- Novas tabelas têm `empresa_id` ou `id_usuario`, RLS, grants mínimos e testes cross-tenant.

## 9. Backfill e rollout

1. Aplicar migration PDV-owned e RPCs sem alterar dados existentes.
2. Publicar consumidores compatíveis com `pessoa_id` nulo.
3. Rodar backfill paginado e retomável por empresa:
   - criar identidades para `pessoas.contato` válido;
   - processar famílias de sessões;
   - vincular correspondências únicas;
   - criar pessoa para contatos sem correspondência;
   - registrar conflitos sem escolher;
   - vincular pedidos por pessoa/telefone somente em correspondência única.
4. Expor relatório de totais: vinculados, criados, incompletos e conflitos.
5. Ativar Clientes por feature flag interna para tenants piloto.
6. Validar identidade, permissões e mensagens antes de habilitar campanhas.
7. Habilitar campanhas manuais.
8. Habilitar automações, todas inicialmente desligadas por empresa.
9. Remover fallbacks de `customer_profile`/telefone somente após telemetria confirmar migração completa.

O backfill é idempotente e nunca envia mensagens.

## 10. Falhas e comportamento seguro

- CRM indisponível: Atendimento continua funcionando por sessão/JID.
- Resolução de pessoa falha no webhook: mensagem é persistida e conflito/retry é registrado; nenhuma mensagem é perdida.
- Pedido sem pessoa: pedido continua com snapshot e entra na reconciliação.
- WhatsApp desconectado: campanha/automação pausa, não marca enviado e não perde fila.
- Retry sem provider message id usa chave idempotente e claim persistente; nunca duplica intencionalmente.
- Pessoa em conflito não recebe automações nem campanha até resolução.
- Exclusão com saldo fiado retorna mensagem orientando quitar ou ajustar o saldo.
- Erros internos ficam em logs; UI e toasts não expõem nomes de provedores, endpoints ou payload bruto.

## 11. Métricas de produto e operação

Medir por empresa, sem conteúdo de mensagem:

- clientes totais, com/sem telefone e conflitos;
- uso da ficha e filtros;
- campanhas criadas, enviadas, pausadas e falhas;
- automações ativadas por tipo;
- jobs enviados/falhos/suprimidos;
- respostas e pedidos após campanha por janela de atribuição;
- opt-outs/bloqueios;
- tamanho e idade da fila;
- custo de IA/transcrição já existente, sem misturar com volume do canal.

## 12. Critérios de aceite

- Clientes aparece na posição correta em desktop e mobile, e Métricas fica em Mais no mobile.
- Lista e ficha funcionam a 360px, 390px, 768px e desktop sem overflow ou ação inacessível.
- Contato novo do WhatsApp cria/vincula uma pessoa exatamente uma vez sob concorrência.
- Funcionário nunca é convertido nem recebe campanha automaticamente.
- Clientes sem telefone aparecem, mas são suprimidos em todo envio.
- A mesma pessoa reúne todos os JIDs, mensagens, pedidos e vendas vinculados.
- Editar dados confirmados não é revertido pelo nome do WhatsApp ou IA.
- Filtros ficam recolhidos e podem ser salvos como segmento.
- Mensagem enviada pelo CRM aparece no Atendimento com o mesmo lifecycle.
- Campanha congela a audiência, é pausável e não duplica destinatário.
- Cada jornada respeita idempotência, janela, cooldown, bloqueio e limite.
- Exclusão apaga pessoa e relacionamento quando saldo fiado é zero; com saldo, falha sem perda parcial.
- Owner e papéis autorizados passam; papéis sem capability e outro tenant são negados no servidor e no banco.
- Clientes continua acessível nos planos chat e bundle sem novo entitlement.

## 13. Fora do escopo

- WhatsApp Business Platform oficial, templates oficiais e cobrança por conversa.
- Email, SMS ou outros canais.
- Funcionários dentro do CRM de clientes.
- Pipeline B2B, negócios e oportunidades.
- CPF, e-mail e edição de endereços.
- Pontos de fidelidade e motor de cupons.
- Construtor livre de workflows.
- IA escolhendo público, regra ou envio sem configuração humana.
- Alterar o fluxo canônico do ZeloMenu ou permitir que a IA crie pedidos.
