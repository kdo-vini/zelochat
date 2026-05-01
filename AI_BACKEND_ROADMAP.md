# Roadmap Interno - IA, Backend e Proximos Passos

Data: 2026-04-30  
Origem: review tecnico pago sobre riscos atuais e prioridades pos-fechamento dos P0/P1 antigos.

## Status de execucao

- 2026-05-01: iniciada a Sprint 30. O backend passou a hidratar o perfil operacional da loja direto do Supabase antes da IA responder, incluindo dados da empresa, Pix, gerente, instrucoes, entrega, horarios, datas bloqueadas e cardapio real do PDV por `user_id`. O perfil e revalidado a cada 5 minutos e falha fechado se nao conseguir carregar.
- 2026-05-01: iniciada a Sprint 31. As instrucoes livres do dono foram rebaixadas para preferencias de tom/estilo, sanitizadas e limitadas, sem poder sobrescrever regras fixas de pedido, preco, entrega, Pix, horarios, datas bloqueadas ou escalacao humana.
- 2026-05-01: iniciada a Sprint 33. O WebSocket deixou de receber token pela URL e passou a autenticar por handshake inicial no proprio socket, fechando conexoes anonimas antes de qualquer broadcast.
- 2026-05-01: iniciada a Sprint 33. Rotas internas de IA ganharam limites por empresa, tamanho maximo de payload e validacao antes de chamar o modelo.
- 2026-05-01: iniciada a Sprint 34. Backend ganhou endpoint seguro de saude da IA por empresa, com indicadores booleanos e contagens sem expor dados sensiveis.
- 2026-05-01: iniciada a Sprint 32. Criacao de pedido passou a resolver variacoes simples de nomes do cardapio com matching seguro e sem escolha silenciosa quando houver ambiguidade.
- 2026-05-01: iniciada melhoria de mensagens nao-texto. Localizacao, contatos, enquetes, reacoes, figurinhas e tipos desconhecidos agora viram placeholders claros; reacoes e votos nao disparam IA.

## Objetivo

Este documento organiza a nova ordem de prioridades do ZeloChat para os proximos ciclos. Ele deve guiar decisoes de produto e engenharia quando o assunto envolver qualidade da IA, seguranca operacional, controle de custo e escalabilidade.

O diagnostico principal e: o sistema saiu do estagio inicial de risco alto, mas a IA ainda depende demais de contexto vindo do frontend. O proximo ciclo deve priorizar o cerebro operacional do backend, guardrails de IA e seguranca de escala antes de novas telas.

## Resumo executivo

Os P0 antigos e os P1 acionaveis ja foram fechados. O produto esta mais seguro para producao, mas o ponto fraco mudou.

Antes, o risco era: o sistema pode quebrar feio a qualquer momento.

Agora, o risco e: a IA pode responder mal se o backend nao alimentar o modelo com a verdade certa, na hora certa.

Direcao recomendada:

- Menos foco imediato em UI.
- Mais foco em backend como fonte da verdade.
- Mais previsibilidade no prompt da IA.
- Mais validacao em codigo para preco, entrega, pedido e escalacao humana.
- Mais controle de custo e abuso em rotas internas de IA.

## Nova ordem dos P's

### P0 - Backend como fonte da verdade da IA

Implementar um "perfil operacional da loja" carregado no servidor a partir do banco e do cardapio real, sem depender do painel estar aberto.

A IA deve sempre receber, pelo backend:

- Cardapio atual.
- Horarios de funcionamento.
- Dias bloqueados.
- Configuracao de entrega.
- Bairros e taxas.
- Chave Pix.
- Telefone do gerente.
- Regras da loja.
- Avisos do dia.

Se dados vitais nao puderem ser carregados, a IA deve pausar e escalar para humano em vez de inventar.

Referencias atuais:

- `server/configStore.ts:45`
- `server/router.ts:1579`
- `src/AppShell.tsx:441`

Impacto atual: se o servidor reiniciar e nenhum operador abrir o painel antes de um cliente chamar no WhatsApp, a IA pode ficar com cardapio vazio, horarios vazios ou entrega desligada.

### P1 - Prompt da IA em camadas seguras

Reestruturar a montagem do prompt para separar claramente:

1. Regras fixas e inegociaveis do sistema.
2. Dados reais da loja.
3. Cardapio.
4. Entrega, bairros e taxas.
5. Contexto do cliente.
6. Avisos do dia.
7. Preferencias de tom do dono.

As instrucoes livres do dono devem orientar estilo e atendimento, mas nao podem sobrescrever regras de seguranca, confirmacao de pedido, preco, entrega, Pix ou escalacao humana.

Referencia atual:

- `server/ai.ts:792`

Impacto atual: `aiInstructions` entra como texto livre e pode conflitar com regras vitais se o dono configurar algo ambiguo ou errado.

### P1 - Entendimento inteligente de cardapio

Melhorar a correspondencia de produtos para lidar com nomes reais de cliente.

Casos esperados:

- Variacoes com e sem preposicao.
- Abreviacoes comuns.
- Erros de acento.
- Singular e plural.
- Apelidos cadastrados ou derivados.
- Produtos por unidade, cento e meio cento.
- Sugestao da opcao mais proxima antes de desistir.

Referencias atuais:

- `server/ai.ts:1159`
- `server/ai.ts:1200`

Impacto atual: a criacao de pedido compara produto por nome exato. Variacoes como "coxinha frango", "coxinha de frango" e "coxinha c/ frango" podem falhar mesmo sendo o mesmo item.

### P1 - Controle de custo e abuso de IA

Adicionar limites por empresa e por usuario para:

- `/api/ai/complete`
- Geracao de instrucoes.
- Chat interno de gestao.

Tambem limitar:

- Tamanho de mensagens.
- Tamanho de historico enviado ao modelo.
- Frequencia de chamadas por janela de tempo.
- Payload maximo aceito pelas rotas internas.

Referencias atuais:

- `server/router.ts:1422`
- `server/router.ts:1481`

Impacto atual: chamadas autenticadas ainda podem gerar custo descontrolado se houver abuso ou loop em tela.

### P1 - Remover token da URL do WebSocket

Trocar a autenticacao da conexao em tempo real para um handshake mais seguro, sem expor o token como query string.

Referencias atuais:

- `server/ws.ts:40`
- `src/hooks/useWhatsAppSessions.ts:331`

Impacto atual: `?token=...` pode aparecer em logs de proxy, historico, ferramentas de observacao ou mensagens de erro.

### P1 externo - `super_admins` e politicas compartilhadas com ZeloPDV

Nao alterar neste repositorio.

Abrir tarefa no ZeloPDV para:

- Auditar tabela/admins.
- Revisar permissoes compartilhadas.
- Validar politicas que afetem produtos, categorias, subcategorias e planos do PDV.

Motivo: essas areas pertencem ao produto compartilhado com ZeloPDV e nao devem ser modificadas pelo ZeloChat sem coordenacao.

### P2 - Processar multiplas acoes da IA com seguranca

Permitir mais de uma acao quando fizer sentido, mantendo uma ordem segura.

Regra central: escalacao humana deve vencer qualquer continuacao automatica.

Referencia atual:

- `server/ai.ts:1108`

Impacto atual: se o modelo pedir mais de uma acao, o sistema registra aviso e executa apenas a primeira. Casos mistos, como "pedido + reclamacao", podem ficar incompletos.

### P2 - Simulador de atendimento

Criar uma ferramenta para o dono testar conversas antes de publicar instrucoes novas.

Cenarios minimos:

- Pedido simples.
- Pedido com entrega.
- Reclamacao.
- Cliente pedindo humano.
- Produto inexistente.
- Data bloqueada.
- Pix ausente.
- Loja fechada.

O simulador deve mostrar se a IA responderia, escalaria ou bloquearia a acao.

### P2 - Saude da IA por empresa

Criar uma visao interna ou operacional mostrando se a IA esta pronta para atender.

Indicadores minimos:

- Cardapio carregado.
- Horario configurado.
- Entrega configurada.
- Gerente configurado.
- Pix presente.
- Instrucoes livres aprovadas.
- Ultimos erros de IA.
- Ultimos fallbacks para humano.

### P2 - Mensagens nao-texto

Melhorar tratamento de:

- Reacoes.
- Localizacao.
- Contatos.
- Enquetes.
- Midia grande.
- Arquivos nao suportados.

Essas entradas devem virar uma resposta util ou escalacao humana, nao apenas log interno.

### P3 - Performance e polimento

Itens de menor urgencia:

- Dividir bundle grande.
- Revisar duracao e tratamento de audio.
- Ajustar pequenos textos.
- Melhorar estados vazios.
- Adicionar feedbacks visuais pontuais.

## Guardrails obrigatorios

Algumas protecoes devem ser codigo, nao apenas texto no prompt:

- Preco do produto.
- Taxa de entrega.
- Produto inexistente.
- Produto indisponivel.
- Data bloqueada.
- Loja fechada.
- Pedido duplicado.
- Pedido misturado com reclamacao.
- Pedido sem confirmacao explicita.
- Solicitacao de humano.

Toda resposta relacionada a pedido deve passar por validacao antes de ir ao WhatsApp.

Toda configuracao livre do dono deve ser tratada como preferencia, nao como lei absoluta.

## Plano de execucao recomendado

### Sprint 30 - Cerebro da Loja confiavel

Objetivo: backend hidrata dados reais da empresa e cardapio antes de responder qualquer cliente.

Entregaveis:

- Criar objeto unico de "perfil operacional da loja" por empresa.
- Carregar perfil no servidor a partir do banco.
- Remover dependencia do `/api/sync-config` como fonte primaria da IA.
- Definir fallback seguro quando dados vitais nao carregarem.
- Garantir que a IA pause e escale em vez de inventar.

### Sprint 31 - IA mais previsivel

Objetivo: reescrever a montagem do prompt em camadas seguras.

Entregaveis:

- Separar regras inegociaveis, dados reais, contexto e preferencias.
- Rebaixar `aiInstructions` para camada de preferencia.
- Adicionar validacao de qualidade para instrucoes geradas.
- Testar conflitos intencionais, como dono pedindo para ignorar confirmacao de pedido.

### Sprint 32 - Cardapio inteligente

Objetivo: resolver nomes aproximados e variacoes comuns de cliente.

Entregaveis:

- Normalizacao de nomes com acentos, plural e abreviacoes.
- Matching aproximado com sugestao segura.
- Suporte a apelidos.
- Tratamento de unidade, cento e meio cento.
- Mensagens claras quando houver ambiguidade.

### Sprint 33 - Seguranca e custo

Objetivo: reduzir exposicao de token e controlar chamadas internas de IA.

Entregaveis:

- Remover token da query string do WebSocket.
- Implementar handshake mais seguro.
- Adicionar rate limit por empresa/usuario para rotas internas de IA.
- Limitar tamanho de mensagem, historico e payload.
- Criar metricas simples de consumo por empresa.

### Sprint 34 - Ferramentas de confianca

Objetivo: dar visibilidade operacional sobre a qualidade da IA antes de ela atender clientes.

Entregaveis:

- Simulador de atendimento.
- Saude da IA por empresa.
- Alertas para configuracao ruim.
- Registro dos ultimos erros, fallbacks e escaloes para humano.

## Assumptions

- O SaaS ja esta em producao.
- Cada commit deve ser tratado como producao.
- Nao alterar tabelas, politicas ou permissoes compartilhadas com ZeloPDV por este repositorio.
- O foco imediato e qualidade, seguranca e previsibilidade da IA.
- Novas telas so devem vir depois de firmar o backend.
- O objetivo e suportar muitas lanchonetes com comportamento consistente, sem depender de configuracao manual perfeita.

## Relacao com outros documentos

- `CODE_REVIEW.md`: auditoria tecnica detalhada, com achados por severidade.
- `FIXES_PROGRESS.md`: tracker vivo do que foi shipped, drafted ou blocked.
- `BILLING.md`: runbook de cobranca e assinaturas.
- `CLAUDE.md`: contexto do projeto, regras criticas e limites com ZeloPDV.

Este arquivo nao substitui o tracker de correcoes. Ele e o norte de priorizacao para os proximos ciclos de IA/backend.
