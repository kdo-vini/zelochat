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

  // Global kill-switch — early gate to skip debounce/timer entirely. Fail-closed:
  // if hydration hasn't happened yet (server just rebooted, frontend never opened),
  // we treat aiEnabled as off until the DB confirms otherwise. ai.ts re-checks as
  // a second line of defense; both must agree before we burn an OpenAI call.
  await ensureAiSettingsHydrated(empresaId);
  const globalAiEnabled = getConfig(empresaId).aiEnabled === true;

  if (session?.autoReply && !isEscalated && globalAiEnabled && process.env.OPENAI_API_KEY) {
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
      } else {
        console.log(`[Server] Multi-tenant detected (${count ?? 0} empresas) — skipping auto-bind. Each request resolves its own empresa via JWT or webhook path.`);
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
