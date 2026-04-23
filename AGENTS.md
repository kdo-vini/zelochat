# ZeloChat

WhatsApp-native customer service platform for Brazilian lanchonetes. All user-facing text, prompts, and seed data are in **Brazilian Portuguese**.

## Commands
- Dev (frontend only): `npm run dev` — Vite on port 3000
- Dev (server only): `npm run dev:server` — Baileys/Express on port 3001
- Dev (both): `npm run dev:all`
- Type check: `npm run lint`

## Architecture rules
- Agents (`src/agents/`) are pure functions — no React, no dispatch
- `src/orchestration/` is the only place that combines AI calls + state mutations
- `src/domain/` has zero React or AI dependencies — keep it that way
- `services/geminiService.ts` is legacy — do not modify or expand it
- Never call AI APIs from React components — always go through orchestration
- Never import Baileys/server code from the frontend — use REST API / WebSocket

## State actions
Actions are namespaced strings: `'catalog/addProduct'`, `'chat/upsertSession'`, etc. Check `src/state/rootReducer.ts` for all valid action types before dispatching.

## Environment
- `OPENAI_API_KEY` — required for AI functionality (currently using OpenAI, Gemini integration is in-progress/swappable)
- `SERVER_PORT` — Baileys server port (default 3001)

## Brainstorming
- construir: API de produtos no zelo pdv, para que o pdv possa enviar os produtos para o zeloChat e montar cardápio.
- corrigir: QR code.
- Fazer com que as notificações sejam enviadas através do numero cadastrado, para um número de whatsapp especificado pelo usuário e cadastrado no sistema (tipo telefone do gerente). Colocar sons no app.
- Sair do mock data — ir para um banco de dados usando Supabase ou Firebase. Tudo que é mock no sistema deve virar funcionalidade real.
- Escalonamento de atendimento para humano: quando o usuário pedir explicitamente, quando pedir algo fora do cardápio, ou quando fizer pedidos acima de X itens (configurável — ex: acima de 500 unidades de mini salgadinho).
