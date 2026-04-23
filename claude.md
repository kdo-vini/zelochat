# ZeloChat – AI-Powered WhatsApp CRM for Small Food Businesses

## Project Overview

ZeloChat is a WhatsApp-native customer service platform built for Brazilian lanchonetes (snack shops). It uses AI agents to automatically handle customer inquiries, take orders, and manage daily operations — all through a WhatsApp-style dashboard the business owner uses to monitor and control everything.

**Primary language**: Portuguese (BR). All user-facing strings, prompts, seed data, and UI copy are in Brazilian Portuguese.

## Tech Stack

| Layer            | Technology                          |
|------------------|-------------------------------------|
| Frontend         | React 19 + TypeScript               |
| Build tool       | Vite 6                              |
| Styling          | Tailwind CSS v4 (`@tailwindcss/vite` plugin) |
| State management | `useReducer` + React Context (`src/state/`) |
| AI               | Google Gemini SDK (`@google/genai`)  |
| WhatsApp         | Baileys (`@whiskeysockets/baileys`) via Express server |
| Real-time        | WebSocket (`ws`) for server → frontend push |
| Animations       | Motion (Framer Motion v12)          |
| Drag & Drop      | `@hello-pangea/dnd`                 |
| Icons            | Lucide React                        |
| Dates            | date-fns                            |

## Architecture

### Directory Structure

```
src/                             # React frontend
├── agents/                      # AI agent definitions (one subfolder per agent)
│   ├── client/                  # Customer-facing WhatsApp agent
│   │   ├── agent.ts             # Calls Gemini with client prompt
│   │   ├── context.ts           # Builds ClientContext from ZeloState
│   │   ├── prompt.ts            # System instruction builder
│   │   └── types.ts             # ClientContext interface
│   ├── manager/                 # General management agent (blocks dates, toggles products)
│   │   ├── agent.ts             # Calls Gemini, returns JSON { reply, actions[] }
│   │   └── types.ts             # ManagerAgentResponse, action payload types
│   ├── owner/                   # Daily context agent (parses operational notes into directives)
│   │   └── agent.ts             # Calls Gemini, returns string[] directives
│   └── shared/
│       └── gemini.ts            # Shared GoogleGenAI instance + model constant
│
├── constants/
│   ├── seedData.ts              # INITIAL_STATE: full ZeloState with demo data
│   └── statusLabels.ts          # Order status label mapping
│
├── domain/                      # Pure business logic (no React, no AI)
│   ├── alerts/                  # Alert tag parser (<ALERT>id</ALERT>)
│   ├── calendar/                # Date blocking logic
│   ├── catalog/                 # Product helpers
│   └── orders/                  # Order processing logic
│
├── hooks/
│   └── useWhatsApp.ts           # WebSocket hook: connects to Baileys server, dispatches incoming msgs
│
├── orchestration/               # Use-case orchestrators (bridge agents ↔ state)
│   ├── customerChat.ts          # replyAsClient(): user msg → AI → dispatch response
│   ├── ownerCommands.ts         # processDailyNote(): owner input → directives → state
│   ├── managerActions.ts        # sendManagerMessage(): manager chat → actions → state
│   └── ordersOrchestrator.ts
│
├── services/
│   └── geminiService.ts         # LEGACY – original monolith service (being replaced by agents/)
│
├── state/                       # React state management
│   ├── StoreContext.tsx          # StoreProvider + useStore + convenience hooks
│   ├── rootReducer.ts           # Combines all slice reducers
│   └── slices/                  # Domain-specific reducers
│       ├── catalogSlice.ts
│       ├── calendarSlice.ts
│       ├── chatSlice.ts         # Includes chat/upsertSession for incoming WhatsApp msgs
│       ├── configSlice.ts
│       ├── ordersSlice.ts
│       └── profileSlice.ts
│
├── types/                       # Shared TypeScript interfaces
│   ├── state.ts                 # ZeloState (root state shape)
│   ├── chat.ts                  # ChatMessage, ChatSession
│   ├── orders.ts                # Order, OrderItem
│   ├── catalog.ts               # Product, QuickResponse
│   ├── calendar.ts              # BlockedDate, BusinessInfo
│   └── alerts.ts                # AlertTrigger
│
├── App.tsx                      # Main React component (entire UI — large monolith)
├── main.tsx                     # React entry point
└── index.css                    # Global styles / Tailwind entry

server/                          # Node.js Baileys WhatsApp server (Express + WebSocket)
├── index.ts                     # Express bootstrap, wires Baileys → message handler → auto-reply
├── whatsapp.ts                  # Baileys connection lifecycle (QR, auth, reconnect)
├── messageHandler.ts            # Incoming message normalizer + in-memory session store
├── ai.ts                        # Server-side Gemini calls for auto-reply
├── router.ts                    # REST API: /api/qr, /api/status, /api/send, /api/sessions, etc.
├── ws.ts                        # WebSocket broadcast helper
└── tsconfig.json                # Node.js-specific TypeScript config
```

### Key Patterns

1. **Agent pattern**: Each AI agent lives in `src/agents/<name>/` with its own `agent.ts` (Gemini call), `context.ts` (state → context builder), `prompt.ts` (system instruction), and `types.ts`. Agents are **pure functions** — they don't dispatch or touch React state.

2. **Orchestration layer**: `src/orchestration/` files are the glue between agents and React state. They receive `dispatch`, call agents, and dispatch the results. This is the only place that combines AI calls + state mutations.

3. **State slices**: Follow a `useReducer` + slice pattern. Each slice in `src/state/slices/` handles one domain. The `rootReducer` composes them all. Actions are namespaced: `'catalog/addProduct'`, `'chat/addMessage'`, `'config/addDailyContext'`, etc.

4. **Domain logic**: `src/domain/` contains pure business logic with zero dependencies on React or Gemini. Keep it that way.

5. **Shared Gemini client**: `src/agents/shared/gemini.ts` exports a singleton `ai` instance and `GEMINI_MODEL` constant. All agents import from here.

6. **Server ↔ Frontend bridge**: The Baileys server (`server/`) pushes incoming WhatsApp messages to the React frontend via WebSocket. The frontend dispatches `chat/upsertSession` to create or update sessions. Outbound messages go through `POST /api/send`.

### AI Agents Summary

| Agent    | Purpose                          | Input                  | Output                        |
|----------|----------------------------------|------------------------|-------------------------------|
| Client   | Answer WhatsApp customers        | ClientContext + history | Free-text reply (may include `<ALERT>` tags) |
| Manager  | Structural config via chat       | Manager history        | JSON `{ reply, actions[] }`   |
| Owner    | Parse daily operational notes    | Raw text from owner    | `string[]` directives         |

### Server REST API

| Method | Endpoint                      | Purpose                              |
|--------|-------------------------------|--------------------------------------|
| GET    | `/api/status`                 | WhatsApp connection status           |
| GET    | `/api/qr`                    | QR code as base64 data URI           |
| GET    | `/api/sessions`              | All active WhatsApp sessions         |
| GET    | `/api/sessions/:jid`         | Single session with messages         |
| POST   | `/api/send`                  | Send message to WhatsApp contact     |
| POST   | `/api/ai/reply`              | Generate AI reply and send via WA    |
| POST   | `/api/sessions/:jid/auto-reply` | Toggle auto-reply for a session   |

### WebSocket Events (server → frontend)

| Event Type     | Data                                      |
|---------------|-------------------------------------------|
| `qr`          | Base64 QR code data URI                   |
| `connection`  | `'connected'` / `'disconnected'` / `'connecting'` |
| `message`     | `{ sessionId, customerName, customerPhone, message }` |
| `message_sent`| `{ sessionId, message }` (outbound confirmation) |

## Development Guidelines

### Do

- Write all user-facing text in **Brazilian Portuguese**
- Keep agents stateless — orchestrators handle dispatch
- Put pure logic in `src/domain/`, not in agents or components
- Use existing action types from `rootReducer.ts` when dispatching
- Use `date-fns` for any date manipulation
- Follow the existing naming convention: `camelCase` for files, `PascalCase` for components/types

### Don't

- Don't call Gemini directly from React components — go through orchestration
- Don't put React imports (`useEffect`, `dispatch`, etc.) inside `agents/` or `domain/`
- Don't modify `services/geminiService.ts` — it's legacy and being phased out
- Don't hardcode API keys — use `process.env.GEMINI_API_KEY` via Vite's `define` config
- Don't import Baileys or server code from the frontend — use the REST API / WebSocket

### Environment Variables

```bash
GEMINI_API_KEY=       # Required for AI functionality
APP_URL=              # Deployment URL (not used locally)
SERVER_PORT=3001      # Baileys server port (default 3001)
```

Copy `.env.example` to `.env` and fill in your key.

### Commands

```bash
npm install           # Install dependencies
npm run dev           # Start Vite dev server on port 3000
npm run dev:server    # Start Baileys server on port 3001 (with watch mode)
npm run dev:all       # Start both Vite + Baileys server
npm run build         # Production build
npm run lint          # TypeScript type-check (tsc --noEmit)
```

### Brainstorming
construir: API de produtos no zelo pdv, para que o pdv possa enviar os produtos para o zeloChat e montar cardápio.
corrigir: QR code.
Fazer com que as notificações sejam enviadas através do numero cadastrado, para um número de whatsapp especificado pelo usuário e cadastrado no sistema (tipo telefone do gerente). colocar sons no app.

Sair do mock data - ir para um banco de dados, usando Supabase ou Firebase.
Tudo que é mock no sistema deve virar funcionalidade real.
novas funcionalidades: escalonamento de atendimento para humano caso no contexto da conversa o usuario peça explicitamente. E se o cliente pedir algo que não está no cardápio, se o cliente fizer pedidos acima de x itens.. escalonamento deve ser configuravel no sistema (ex: acima de 5 centos de mini salgadinho (500 unidades).)