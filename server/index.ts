import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { createServer } from 'http';
import { createWsServer } from './ws.js';
import { startWhatsApp, onIncomingMessage, registerWebhook, getPublicWebhookUrl } from './whatsapp.js';
import { handleIncomingMessage, getSession } from './messageHandler.js';
import { generateAndSendReply } from './ai.js';
import router from './router.js';
import { setBoundEmpresaId, getServiceSupabase, requireActiveZelochatSubscription } from './supabase.js';
import { ensureAiSettingsHydrated, getConfig } from './configStore.js';

// PORT: production platforms (Railway/Render/Fly/Heroku) inject via PORT env var.
// SERVER_PORT is the legacy dev-local setting.
const PORT = parseInt(process.env.PORT || process.env.SERVER_PORT || '3001', 10);

// FRONTEND_URL accepts a comma-separated list of allowed origins so that multiple
// deployed domains (e.g. chat.zelopdv.com.br alongside the legacy domain) can
// share one backend without hitting CORS.
const ALLOWED_ORIGINS = (process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`Origin not allowed by CORS: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
// 100kb global cap protects every endpoint EXCEPT /api/send, which mounts its own
// 6mb parser at the route level for media uploads. Without this skip, the global
// parser consumes/rejects the body before the per-route override can run.
app.use((req, res, next) => {
  if (req.path === '/api/send') return next();
  return express.json({ limit: '100kb' })(req, res, next);
});

/**
 * Global paywall: every /api/* route requires an active ZeloChat subscription
 * unless explicitly exempt below. Pre-existing behavior was to gate only
 * /api/qr and /api/qr/refresh — every other operational endpoint (send, AI,
 * drivers, triggers, sessions, …) ran free for cancelled customers, leaking
 * OpenAI + Whatsmiau quota. See P0.15 in CODE_REVIEW.md.
 *
 * Exemptions are kept minimal:
 *  - /api/healthz: liveness probe
 *  - /api/billing/*: the user must be able to pay (or change plan / open
 *    portal) precisely WHEN their subscription is inactive
 *  - /api/bind-empresa: pre-paywall — establishes empresa context
 *  - /api/status: the Settings page polls this so the operator sees their
 *    WhatsApp connection state on the same screen where the paywall lives
 *
 * Webhook routes (/webhook, /webhook/:instance) are not under /api/, so they
 * naturally skip this middleware. The webhook itself short-circuits inactive
 * empresas inside processWebhookEvent via isEmpresaSubscriptionActive.
 */
const PAYWALL_EXEMPT_EXACT = new Set<string>([
  '/api/healthz',
  '/api/bind-empresa',
  '/api/status',
]);
const PAYWALL_EXEMPT_PREFIXES = ['/api/billing/'];

app.use(async (req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (PAYWALL_EXEMPT_EXACT.has(req.path)) return next();
  if (PAYWALL_EXEMPT_PREFIXES.some((p) => req.path.startsWith(p))) return next();

  try {
    await requireActiveZelochatSubscription(req);
    return next();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'UNKNOWN';
    if (message === 'UNAUTHORIZED') {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }
    if (message === 'EMPRESA_NOT_FOUND') {
      return res.status(404).json({ error: 'EMPRESA_NOT_FOUND' });
    }
    if (message === 'SUBSCRIPTION_INACTIVE') {
      return res.status(402).json({ error: 'SUBSCRIPTION_INACTIVE' });
    }
    console.error('[paywall] gate error:', err);
    return res.status(503).json({ error: 'PAYWALL_GATE_UNAVAILABLE' });
  }
});

app.use(router);

const httpServer = createServer(app);
createWsServer(httpServer);

// --- Wire up incoming messages → store + auto-reply ---
const pendingReplies = new Map<string, ReturnType<typeof setTimeout>>();

onIncomingMessage(async (msg, empresaIdFromWebhook) => {
  // SECURITY: empresaIdFromWebhook MUST come from the per-instance route
  // (`/webhook/:instance` → empresa_perfil.whatsmiau_instance lookup). We do
  // NOT fall back to the singleton — that's how messages from one tenant
  // ended up attributed to another after the legacy `/webhook` route was
  // resolved via `getBoundEmpresaId()`. If we don't know the empresa, drop.
  const empresaId = empresaIdFromWebhook;
  if (!empresaId) {
    console.warn('[AutoReply] dropping incoming message — webhook did not resolve an empresaId');
    return;
  }

  // 1. Normalize and store the message — pass empresaId explicitly so the handler
  // doesn't fall back to the global singleton.
  //
  // P0.14 — handleIncomingMessage now returns boolean. `false` = duplicate
  // webhook delivery (Whatsmiau retried, message already persisted earlier),
  // and we MUST skip the auto-reply scheduling below. Without this skip, a
  // single customer message could fire criar_pedido twice on Whatsmiau retry,
  // bringing back the duplicate-order bug the dedup is supposed to prevent.
  let persisted = false;
  try {
    persisted = await handleIncomingMessage(msg, empresaId);
  } catch (error) {
    console.error('[Server] Failed to persist incoming message:', error);
  }
  if (!persisted) return;

  // 2. Auto-reply if enabled for this session
  const jid = msg.key?.remoteJid;
  if (!jid) return;

  const session = await getSession(jid, empresaId);
  // Defense in depth: AI is gated by BOTH auto_reply AND status. An escalated
  // conversation must never be answered by the AI even if a stale auto_reply=true
  // sneaks in (race condition or data drift). The escalation handler always sets
  // both — this check is the second line of defense.
  const isEscalated = session?.status === 'escalated';

  // Global kill-switch — early gate to skip debounce/timer entirely. Fail-closed:
  // if hydration hasn't happened yet (server just rebooted, frontend never opened),
  // we treat aiEnabled as off until the DB confirms otherwise. ai.ts re-checks as
  // a second line of defense; both must agree before we burn an OpenAI call.
  await ensureAiSettingsHydrated(empresaId);
  const globalAiEnabled = getConfig(empresaId).aiEnabled === true;

  if (session?.autoReply && !isEscalated && globalAiEnabled && process.env.OPENAI_API_KEY) {
    const replyKey = `${empresaId}:${jid}`;
    const existing = pendingReplies.get(replyKey);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      pendingReplies.delete(replyKey);
      try {
        await generateAndSendReply(jid, empresaId);
      } catch (err) {
        console.error('[AutoReply] Error:', err);
      }
    }, 1500);
    pendingReplies.set(replyKey, timer);
  }
});

// --- Start server ---
httpServer.listen(PORT, () => {
  console.log(`[Server] Listening on http://localhost:${PORT}`);
  console.log(`[Server] WebSocket on ws://localhost:${PORT}/ws`);

  // Auto-bind empresa at startup. SAFE only when exactly one empresa exists
  // (single-tenant deploy). With 2+ empresas, the legacy `LIMIT 1` query was
  // non-deterministic and caused mis-attribution of inbound webhook messages
  // (see /webhook 410 in router.ts). In multi-tenant the singleton stays null;
  // outbound broadcasts that previously relied on it become per-empresa scoped
  // via the JWT path (frontend bindEmpresa) instead.
  (async () => {
    try {
      const { count, error: countError } = await getServiceSupabase()
        .from('empresa_perfil')
        .select('id', { count: 'exact', head: true });
      if (countError) throw countError;
      if (count === 1) {
        const { data } = await getServiceSupabase()
          .from('empresa_perfil')
          .select('id')
          .limit(1)
          .maybeSingle();
        if (data?.id) {
          setBoundEmpresaId(data.id);
          console.log(`[Server] Auto-bound empresa (single-tenant): ${data.id}`);
        }

        // Legacy global WhatsApp lifecycle — only safe for single-tenant. In
        // multi-tenant, each empresa manages its own instance via /api/qr, so
        // startWhatsApp (and the broadcasts it triggers) must not run — it would
        // fan out QR codes and connection events to every connected WS client.
        startWhatsApp().catch((err) => {
          console.error('[Server] WhatsApp startup error:', err);
        });

        // Watch for tunnel URL changes — re-register the bootstrap instance webhook
        // when the cloudflared URL rotates (dev) or RAILWAY_PUBLIC_DOMAIN changes.
        let lastKnownUrl = getPublicWebhookUrl();
        setInterval(() => {
          const current = getPublicWebhookUrl();
          if (current !== lastKnownUrl) {
            console.log(`[Server] Tunnel URL changed: ${lastKnownUrl} → ${current}. Re-registering webhook...`);
            lastKnownUrl = current;
            registerWebhook(true).catch((err) => console.error('[Server] Webhook re-register failed:', err));
          }
        }, 10_000);
      } else {
        console.log(`[Server] Multi-tenant detected (${count ?? 0} empresas) — skipping auto-bind. Each request resolves its own empresa via JWT or webhook path.`);
      }
    } catch (err) {
      console.warn('[Server] Auto-bind failed:', err);
    }
  })();
});
