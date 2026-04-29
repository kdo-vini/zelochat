# ZeloChat

WhatsApp-native customer service platform for Brazilian lanchonetes. React + Vite + TypeScript on the frontend, Express + Whatsmiau (Evolution API v2) on the backend, Supabase Postgres, OpenAI for AI replies, Stripe/Asaas billing.

## 📖 Read these before changing anything

This repo has structured documentation that captures context not visible from the code alone. Whether you're a new developer or an AI agent (Claude Code, Cursor, Copilot, ChatGPT), read these in order:

1. **[CLAUDE.md](./CLAUDE.md)** — Project context, architecture, the multi-tenant model, the **Shared database with ZeloPDV** boundary doc (what we MUST NOT touch), and the **Critical functions** index (what cascades when you break it).
2. **[CODE_REVIEW.md](./CODE_REVIEW.md)** — Senior-tier audit (24 P0 / 47 P1 / 38 P2 / 24 P3). Every finding has file:line, repro, customer impact, and proposed fix.
3. **[FIXES_PROGRESS.md](./FIXES_PROGRESS.md)** — Live tracker: which audit findings are SHIPPED, DRAFTED, BLOCKED, or PENDING. Update this whenever you ship a fix.
4. **[BILLING.md](./BILLING.md)** — Stripe/Asaas runbook + cross-product subscription details.
5. **[AGENTS.md](./AGENTS.md)** — Mirror of the above for tools that prefer the AGENTS.md convention.

Inline `🚨 CRITICAL` JSDoc-style blocks in source code mark functions whose breakage has caused — or could cause — a customer-visible outage. Search `grep -rn "🚨 CRITICAL" server/ src/` to find them.

## Commands

```bash
npm run dev          # Frontend only — Vite on port 3000
npm run dev:server   # Backend only — Express on port 3001
npm run dev:all      # Both concurrently
npm run build        # Production build
npm run lint         # TypeScript type-check (tsc --noEmit)
```

⚠️ Before running `npm run dev:server` against the prod-pointed `.env`, set `WHATSMIAU_DISABLE_WEBHOOK_REGISTER=1` in your local `.env` — otherwise the prod webhook URL gets silently overwritten. Full incident details in [CLAUDE.md](./CLAUDE.md) §"Local dev steals the production webhook".
