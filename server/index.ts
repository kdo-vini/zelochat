import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { createServer } from 'http';
import { createWsServer } from './ws.js';
import { startWhatsApp, onIncomingMessage, registerWebhook, getPublicWebhookUrl } from './whatsapp.js';
import { handleIncomingMessage, getSession } from './messageHandler.js';
import { generateAndSendReply } from './ai.js';
import router from './router.js';
import { getBoundEmpresaId, setBoundEmpresaId, getServiceSupabase } from './supabase.js';

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
app.use(router);

const httpServer = createServer(app);
createWsServer(httpServer);

// --- Wire up incoming messages → store + auto-reply ---
const pendingReplies = new Map<string, ReturnType<typeof setTimeout>>();

onIncomingMessage(async (msg, empresaIdFromWebhook) => {
  // empresaIdFromWebhook is the trusted value derived from the apikey token (review fix C3).
  // Fall back to the singleton only if the webhook didn't supply one (legacy path).
  const empresaId = empresaIdFromWebhook ?? getBoundEmpresaId();

  // 1. Normalize and store the message — pass empresaId explicitly so the handler
  // doesn't fall back to the global singleton.
  try {
    await handleIncomingMessage(msg, empresaId);
  } catch (error) {
    console.error('[Server] Failed to persist incoming message:', error);
  }

  // 2. Auto-reply if enabled for this session
  const jid = msg.key?.remoteJid;
  if (!jid) return;
  if (!empresaId) return;

  const session = await getSession(jid, empresaId);
  // Defense in depth: AI is gated by BOTH auto_reply AND status. An escalated
  // conversation must never be answered by the AI even if a stale auto_reply=true
  // sneaks in (race condition or data drift). The escalation handler always sets
  // both — this check is the second line of defense.
  const isEscalated = session?.status === 'escalated';
  if (session?.autoReply && !isEscalated && process.env.OPENAI_API_KEY) {
    // Cancel previous pending reply for this JID to debounce rapid messages
    const existing = pendingReplies.get(jid);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      pendingReplies.delete(jid);
      try {
        await generateAndSendReply(jid, empresaId);
      } catch (err) {
        console.error('[AutoReply] Error:', err);
      }
    }, 1500);
    pendingReplies.set(jid, timer);
  }
});

// --- Start server ---
httpServer.listen(PORT, () => {
  console.log(`[Server] Listening on http://localhost:${PORT}`);
  console.log(`[Server] WebSocket on ws://localhost:${PORT}/ws`);

  // Auto-bind empresa at startup so messages are routed without waiting for frontend login
  (async () => {
    try {
      const { data } = await getServiceSupabase()
        .from('empresa_perfil')
        .select('id')
        .limit(1)
        .maybeSingle();
      if (data?.id) {
        setBoundEmpresaId(data.id);
        console.log(`[Server] Auto-bound empresa: ${data.id}`);
      } else {
        console.warn('[Server] No empresa found — messages will be ignored until frontend logs in.');
      }
    } catch (err) {
      console.warn('[Server] Auto-bind failed:', err);
    }
  })();

  // Start WhatsApp connection
  startWhatsApp().catch((err) => {
    console.error('[Server] WhatsApp startup error:', err);
  });

  // Watch for tunnel URL changes every 10s — auto re-register webhook
  // This makes the system self-healing when cloudflared tunnel restarts with a new URL
  let lastKnownUrl = getPublicWebhookUrl();
  setInterval(() => {
    const current = getPublicWebhookUrl();
    if (current !== lastKnownUrl) {
      console.log(`[Server] Tunnel URL changed: ${lastKnownUrl} → ${current}. Re-registering webhook...`);
      lastKnownUrl = current;
      registerWebhook(true).catch((err) => console.error('[Server] Webhook re-register failed:', err));
    }
  }, 10_000);
});
