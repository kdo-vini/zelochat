# Feature: Sistema de Tags de Sessão

> Arquivo de tracking para retomar em caso de interrupção. Atualizar o status de cada item conforme avança.

## Contexto

Classificar contatos por perfil (cliente final, revendedor, supermercado, conveniência) para personalizar o atendimento. Tags são **aplicadas manualmente** pelo operador. Cada tag tem instruções de IA próprias que são injetadas no prompt quando a sessão tem aquela tag.

---

## Checklist de implementação

### Banco de dados
- [x] `supabase/migrations/031_zelochat_tags.sql` — tabela `zelochat_tags` ✅
- [x] `supabase/migrations/032_zelochat_session_tags.sql` — tabela `zelochat_session_tags` ✅
- [x] Aplicar migrations via Supabase MCP (`apply_migration`) ✅ — projeto `xnnjyrblpvsqrtsshawa`

### Backend
- [x] `server/tags.ts` — CRUD completo (listTags, createTag, updateTag, deleteTag, getSessionTagsFull, applyTagToSession, removeTagFromSession, getAllSessionTagsForEmpresa, getTagsForSessions) ✅
- [x] `server/router.ts` — 8 novos endpoints:
  - GET /api/sessions/tags-map (antes do `:jid` catch-all para evitar conflito)
  - GET /api/tags
  - POST /api/tags
  - PUT /api/tags/:id
  - DELETE /api/tags/:id
  - POST /api/sessions/:sessionId/tags/:tagId
  - DELETE /api/sessions/:sessionId/tags/:tagId
  - GET /api/sessions/:sessionId/tags
- [x] `server/ai.ts` — `buildTagsBlock()` + `buildSystemInstruction()` aceita `sessionTags[]` ✅
- [x] `server/ai.ts` — `handleReplyForSession()` busca `getSessionTagsFull()` em paralelo ✅

### Frontend — tipos e serviços
- [x] `src/types.ts` — interface `Tag`, campo `tags?: Tag[]` em `ChatSession` ✅
- [x] `src/services/waApi.ts` — listTags, createTag, updateTag, deleteTag, applyTagToSession, removeTagFromSession, getSessionTagsMap ✅
- [x] `src/hooks/useTags.ts` — `useTags()` e `useSessionTags()` ✅

### Frontend — UI
- [x] `src/components/views/AIConfigsView.tsx` — seção "Tags de atendimento" com CRUD inline (criar, editar, excluir) ✅
- [x] `src/components/views/ChatView.tsx` ✅:
  - Bolinhas coloridas no card da sessão na lista lateral
  - Seção "Tags" no painel "Perfil do cliente" com dropdown checklist para aplicar/remover
  - `sessionTagsMap` carregado em batch via `GET /api/sessions/tags-map` no mount

### Pendente de verificação manual (node_modules não instalado localmente)
- [ ] `npm run lint` — verificar type check quando ambiente estiver configurado
- [ ] Criar tag "Revendedor" com instrução customizada e testar AI
- [ ] Verificar badges na lista lateral
- [ ] Verificar cascade ao excluir tag

### Curto prazo — implementados
- [x] **Bug crítico: tags não persistem após F5** — `handleApplyTag` usava `fetch` relativo sem `apiUrl`; substituído por `applyTagToSession`/`removeTagFromSession` de `waApi.ts` que usam `apiFetch(apiUrl(...))` ✅
- [x] **Erro amigável nome duplicado** — POST /api/tags captura `pg.code === '23505'` e retorna 400 ✅
- [x] **Tag no payload WebSocket** — broadcast `session_tags_updated` após apply/remove; `useWhatsAppSessions` repassa via `lastTagsUpdate`; ChatView atualiza `sessionTagsMap` em tempo real ✅
- [x] **Filtro por tag na lista de sessões** — chips de tag abaixo dos filtros de status; `tagFilter` state + `filteredSessions` filtra por tag ativa ✅
- [x] **Cap de caracteres nas instruções da tag** — textarea com `maxLength={1000}` e contador `{n}/1000` visível ✅

---

## Schema

### `zelochat_tags`
```sql
id uuid PK, empresa_id uuid FK, name text, color text DEFAULT '#6366f1',
ai_instructions text nullable, created_at timestamptz
UNIQUE(empresa_id, name)
RLS: empresa_id = empresa_perfil.id WHERE user_id = auth.uid()
```

### `zelochat_session_tags`
```sql
session_id uuid FK → zelochat_sessions, tag_id uuid FK → zelochat_tags,
empresa_id uuid (desnormalizado para RLS), applied_at timestamptz
PK(session_id, tag_id)
RLS: empresa_id = empresa_perfil.id WHERE user_id = auth.uid()
```

---

## Padrões de código a seguir

- Backend DB: `server/triggers.ts` (padrão getServiceSupabase + mapRow + typed interface)
- Endpoint auth: `requireEmpresaId(req)` (ver router.ts linha 1583)
- Injeção no AI: `buildOwnerStylePreferences()` (server/ai.ts linha 1937) — adicionar bloco logo após
- Hook pattern: `useProdutos.ts` ou `useDrivers.ts` para referência
- UI cards: padrão de `quickResponses` em `AIConfigsView.tsx` (linhas 750-803)
- Badge no card: ao lado de `s.alerts` e `s.unreadCount` (ChatView.tsx linha 1541-1550)
- Tags no painel lateral: após bloco de alerts (ChatView.tsx linha 2254-2262)

---

## Arquivos críticos e suas linhas-chave

| Arquivo | Linha | Contexto |
|---|---|---|
| `server/ai.ts` | 1950 | `buildSystemInstruction()` — adicionar parâmetro `sessionTags` |
| `server/ai.ts` | 1964 | Após `ownerStylePreferences` — injetar bloco de tags |
| `server/ai.ts` | 2939-2952 | `handleReplyForSession()` — buscar tags e passar para `buildSystemInstruction` |
| `server/router.ts` | ~1641 | Após rotas de triggers — adicionar rotas de tags |
| `src/types.ts` | 26 | Após `pinned?: boolean` — adicionar `tags?: Tag[]` em `ChatSession` |
| `src/components/views/ChatView.tsx` | 1541 | Badge no card da sessão |
| `src/components/views/ChatView.tsx` | 2262 | Após alerts no painel lateral — adicionar seção de tags |

---

## Edge cases conhecidos

### Comportamento atual — funciona mas tem limitação visível

**`sessionTagsMap` carregado apenas no mount**
O `GET /api/sessions/tags-map` é chamado uma vez quando o ChatView monta. Se outro operador (ou outra aba) aplicar uma tag, as bolinhas coloridas na lista lateral não atualizam até recarregar. O painel lateral (onde você aplica tags) atualiza o estado local imediatamente para o operador que fez a ação — o problema é visibilidade em tempo real para outros.
- Mitigação futura: incluir tags no payload do WebSocket de atualização de sessão.

**Tags aplicadas não persistem no estado global de sessões**
O `sessionTagsMap` vive só no ChatView. Se o usuário navegar para outra tela e voltar, o map é reconstruído do zero (novo fetch). Para sessões com muitas tags, isso é invisível; para um sistema com centenas de sessões, pode gerar 1 request extra por navegação.
- Mitigação futura: mover `sessionTagsMap` para o hook `useWhatsAppSessions` ou para o estado global em `App.tsx`.

**Muitas tags com instruções longas empurram o prompt**
`buildTagsBlock` concatena as instruções de todas as tags ativas sem limite. Uma sessão com 5 tags cada uma com 2000 chars injeta 10k chars no prompt, somando ao `ai_instructions` global (já limitado a 50k). Não quebra hoje (contexto do modelo aguenta), mas pode empurrar mensagens antigas para fora da janela.
- Mitigação futura: cap por tag (ex: 1000 chars) e cap total do bloco de tags (ex: 4000 chars), com truncamento avisado no CRUD.

**Instruções conflitantes entre tags**
Duas tags na mesma sessão podem ter instruções contraditórias (ex: "Lead" diz "não dar preço ainda" e "Combo" diz "mencione os planos"). O AI recebe os dois blocos em sequência — geralmente segue o último, mas não é determinístico.
- Mitigação futura: ordenar tags por prioridade (drag-and-drop no CRUD) e documentar que a última instrução da lista tende a ter mais peso.

**Unicidade de nome por empresa (DB garante, UI não)**
O banco tem `UNIQUE(empresa_id, name)`. Se o operador tentar criar uma tag com nome duplicado, o endpoint retorna 500 genérico em vez de uma mensagem amigável. Não quebra nada, mas experiência ruim.
- Fix simples: capturar `error.code === '23505'` no `router.ts` e retornar `400 { error: 'Já existe uma tag com esse nome.' }`.

**Cascade funciona no DB, mas o `sessionTagsMap` não limpa**
Se o operador excluir uma tag enquanto outra janela está aberta com sessões que têm aquela tag, as bolinhas coloridas continuam aparecendo até recarregar (o estado em memória não é invalidado). Não causa erro, só aparência.

---

## Possibilidades futuras (produto)

### Curto prazo — pequeno esforço, alto valor

**Filtro por tag na lista de sessões**
Adicionar chips de tag abaixo dos filtros `all / unread / active / escalated`. Clicar em uma tag filtra `filteredSessions` para mostrar só sessões com aquela tag. Já existe a estrutura — só precisa do estado de filtro e ajuste no `useMemo` de `filteredSessions` no ChatView.

**Mensagem de erro amigável no POST /api/tags com nome duplicado**
Ver edge case acima. 1 linha de código no router.

**Tag no payload WebSocket**
Quando uma tag é aplicada/removida, emitir um evento `session_tags_updated` via `broadcast()` no router. O ChatView ouve e atualiza o `sessionTagsMap` em tempo real. Permite uso com múltiplos operadores.

**Cap de caracteres nas instruções da tag**
No CRUD do AIConfigsView, mostrar contador de chars na textarea das instruções (ex: `230/1000`). Previne instrução que rivaliza com o prompt inteiro.

### Médio prazo — esforço médio, abre novos fluxos

**Filtro + agrupamento no Kanban**
Tags disponíveis como filtro nos cards do kanban de produção. Permite, por exemplo, ver só pedidos de "Revendedores" no kanban.

**Respostas rápidas por tag**
Tags com uma lista própria de `/atalhos`. Quando o operador abre um chat com tag "Revendedor", os atalhos disponíveis incluem os globais + os da tag. Útil para tabela de atacado, scripts de qualificação, etc.

**Exportar contatos por tag para CSV**
Botão no CRUD de tags: "Exportar sessões com esta tag". Gera CSV com nome, telefone, última mensagem, data. Permite alimentar CRM externo ou campanha de reengajamento.

**Histórico de aplicação de tag**
Coluna `applied_by` (user_id) e `applied_at` em `zelochat_session_tags`. Mostra no painel lateral quem tagueou e quando. Útil para times com vários operadores.

### Longo prazo — estratégico

**Tag por condição (semi-automático)**
Diferente de AI auto-tagging (que o usuário não quis), seria uma regra simples baseada em campo: "se cidade = Natal → aplicar tag Agreste" ou "se primeira mensagem contém 'revendedor' → sugerir tag Lead para o operador confirmar". O operador ainda confirma — a IA só sugere.

**Tag como gatilho de automação**
Aplicar uma tag aciona uma ação: enviar template de boas-vindas, notificar um membro da equipe via WhatsApp, criar registro em CRM externo via webhook. Abre o caminho para automações sem código.

**Dashboard por tag**
Na tela de Visão Geral: quantos contatos por tag, taxa de conversão de "Lead" para "ZeloPDV"/"ZeloChat", tempo médio de resposta por perfil. Requer apenas queries no DB que já tem os dados.
