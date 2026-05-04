# Roadmap Interno - IA, Backend e Proximos Passos

Data: 2026-05-04
Origem: limpeza pos-Sprint 45. Este arquivo e o norte vivo de IA/backend; `FIXES_PROGRESS.md` continua sendo o tracker historico de auditoria e sprints.

## Status atual

O bloco original de risco alto foi fechado. Os P0 antigos estao 100% resolvidos, os P1 acionaveis tambem, e restam apenas P1 deferred ligados a escala multi-replica.

Entregas que antes estavam como "proximos passos" e ja foram feitas:

- Backend como fonte da verdade da IA: perfil operacional carregado direto do Supabase, com cardapio real, Pix, gerente, entrega, horarios e datas bloqueadas.
- Prompt da IA em camadas seguras: instrucoes livres do dono viraram preferencia de tom, sem poder sobrescrever regras criticas.
- Cardapio inteligente: matching seguro para variacoes simples de nomes de produto, com fallback quando houver ambiguidade.
- Controle de custo e abuso: rotas internas de IA tem limite por empresa/usuario, tamanho maximo de payload e validacao antes de chamar o modelo.
- WebSocket sem token na URL: autenticacao por handshake inicial no socket.
- Saude da IA por empresa: endpoint e painel com sinais de prontidao operacional.
- Simulador de atendimento: ferramenta para testar respostas da IA sem tocar no WhatsApp nem no banco de producao.
- Metricas internas de consumo de IA: agregadas por empresa/dia/fonte/modelo, sem prompt, telefone, JID ou conteudo de cliente, visiveis no admin interno do ZeloPDV.
- Cardapio com unidade brasileira: backend entende apelidos declarados nas instrucoes da empresa e converte "cento" e "meio cento" com seguranca quando o produto e por unidade.
- Mensagens nao-texto: localizacao, contatos, enquetes, reacoes, figurinhas e tipos desconhecidos aparecem com placeholders claros.
- Imagens recebidas: fotos de lanche/preparo e comprovantes Pix entram como contexto visual da IA; Pix e confirmado como recebido, sem validacao bancaria.
- Atendimento manual assistido por IA: no modo Manual, o operador pode melhorar um rascunho ou gerar uma sugestao de resposta; a IA apenas preenche o campo, sem envio automatico.
- Mensagens enviadas: o painel pode apagar para todos mensagens com ID real do WhatsApp via Whatsmiau; edicao nao aparece porque nao ha endpoint real documentado.

## Ultima entrega

### Metricas internas de IA + cardapio por unidade (entregue em 2026-05-04)

Esta fatia move visibilidade de limites/custos para o painel administrativo interno, nao para o operador da loja.

Implementacao entregue:

- Nova tabela agregada `zelochat_ai_usage_daily`, por empresa/dia/fonte/modelo, sem armazenar prompt, resposta, telefone, JID ou identificador de mensagem.
- Gravacao fire-and-forget em chamadas de IA do atendimento automatico, follow-ups, respostas manuais, geracao de instrucoes, gestor por conversa, simulador, parser de gatilhos e transcricao.
- Leitura restrita a super admins no Supabase; operadores nao recebem painel nem policy de leitura direta.
- Admin dashboard do ZeloPDV mostra consumo por empresa, juntando PDV e ZeloChat na central de gastos de IA.
- `criar_pedido` passa a usar `eh_item_por_unidade`, apelidos declarados nas instrucoes da empresa e normalizacao deterministica para "cento" = 100 e "meio cento" = 50.
- Se o produto ou a unidade/quantidade nao ficam seguros, a conversa escala para humano em vez de inventar ou perguntar em loop.

### P1 - Processar multiplas acoes da IA com seguranca (entregue em 2026-05-04)

Permitir que a IA execute mais de uma acao quando fizer sentido, mantendo uma ordem segura.

Regra central: escalacao humana vence qualquer continuacao automatica. Se uma conversa precisar de humano, nenhuma resposta automatica posterior deve passar por cima disso.

Casos que devem guiar a implementacao:

- Pedido + reclamacao na mesma mensagem.
- Pedido + solicitacao explicita de humano.
- Consulta de pedido + pedido novo.
- Produto inexistente + tentativa de criar pedido.
- Cliente mistura alteracao de pedido com confirmacao.

Resultado esperado: a IA nao deve silenciar a segunda intencao importante, mas tambem nao deve criar pedidos, limpar pendencias ou enviar resposta automatica quando a conversa foi escalada.

Implementacao entregue:

- `escalate_human` continua terminal e vence qualquer outra ferramenta emitida pela IA.
- `criar_pedido` continua terminal, mas agora pode receber antes acoes informativas seguras, como `consultar_pedido` e `notify_manager`, sem executar nada depois da criacao do pedido pendente.
- Depois de acoes informativas, o backend revalida `auto_reply`/status antes de criar pedido ou enviar nova resposta, para respeitar uma escalacao feita no meio do fluxo.
- Se existe pedido pendente e o cliente mistura confirmacao/alteracao com pedido de humano, reclamacao ou irritacao, a pendencia e preservada e a conversa escala para humano.

## Proxima prioridade

Usar o bloco "Backlog ativo" abaixo como proxima fila. A proxima fatia recomendada e revisar duracao/tratamento de audio e pequenos estados vazios da interface.

## Backlog ativo

- Revisar duracao/tratamento de audio e pequenos estados vazios da interface.
- Continuar performance/polimento P3 somente depois de manter estes docs atuais.

## Deferred ate escala multi-replica

Nao fazer enquanto o deploy continuar single-node Railway:

- P1.16: `recordAiFailure` em memoria.
- P1.17: estado operacional/cache entre replicas.
- P1.43: `getAllSessions` e agrupamento em memoria em escala acima de alguns milhares de conversas.

Quando houver plano real de duas ou mais replicas, mover estes itens para Redis/DB/consultas paginadas antes de escalar horizontalmente.

## Fora deste repo

`super_admins`, politicas compartilhadas e schema de tabelas ZeloPDV-owned continuam fora do ZeloChat.

Abrir tarefa no repo ZeloPDV para:

- Auditar tabela/admins.
- Revisar permissoes compartilhadas.
- Validar politicas que afetem produtos, categorias, subcategorias e planos do PDV.

## Guardrails permanentes

Algumas protecoes devem continuar em codigo, nao apenas no prompt:

- Preco do produto.
- Taxa de entrega.
- Produto inexistente ou indisponivel.
- Data bloqueada.
- Loja fechada.
- Pedido duplicado.
- Pedido misturado com reclamacao.
- Pedido sem confirmacao explicita.
- Imagem ambigua sem dados minimos de pedido.
- Comprovante Pix recebido sem validacao bancaria.
- Solicitacao de humano.
- Edicao de mensagem sem suporte real da API.

Toda resposta relacionada a pedido deve passar por validacao antes de ir ao WhatsApp. Toda configuracao livre do dono deve ser tratada como preferencia, nao como lei absoluta.

## Relacao com outros documentos

- `CODE_REVIEW.md`: auditoria tecnica original, preservada como fonte historica.
- `FIXES_PROGRESS.md`: tracker de sprints, status e verificacoes.
- `BILLING.md`: runbook de cobranca e assinaturas.
- `CLAUDE.md` / `AGENTS.md`: contexto critico do projeto, limites com ZeloPDV e funcoes sensiveis.
