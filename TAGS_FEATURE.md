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
| `src/components/views/AIConfigsView.tsx` | ~804 | Após seção de quick responses — adicionar seção de tags |
