import 'dotenv/config';
import ws from 'ws';
// Polyfill WebSocket for Node.js < 22 before Supabase client initializes
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (typeof (globalThis as any).WebSocket === 'undefined') {
  (globalThis as any).WebSocket = ws;
}
import cors from 'cors';
import express from 'express';
import { createServer } from 'http';
import { createWsServer } from './ws.js';
import { startWhatsApp, onIncomingMessage, registerWebhook, getPublicWebhookUrl, setWebhookForInstance } from './whatsapp.js';
import {
  handleIncomingMessage,
  getSession,
  onAudioTranscriptionSettled,
  shouldRearmAfterAudioTranscription,
} from './messageHandler.js';
import { generateAndSendReply } from './ai.js';
import router from './router.js';
import { pushRouter, sendPushToEmpresa } from './push.js';
import { setBoundEmpresaId, getServiceSupabase, requireActiveZelochatSubscription } from './supabase.js';
import { ensureAiSettingsHydrated, isAiGloballyEnabledNow } from './configStore.js';
import { startSubscriptionSweepLoop } from './subscriptionSweeper.js';
import { startPendingOrderSweeper } from './pendingOrderSweeper.js';
import { startAccountDeletionSweepLoop } from './accountDeletionSweeper.js';
import { startAbandonedCartRecoverySweeper } from './abandonedCartSweeper.js';
import { startOnboardingFollowupLoop } from './onboardingFollowup.js';
import { startWebhookEventsSweeper } from './webhookEventsSweeper.js';
import { scheduleReply } from './replyDebouncer.js';
import { slowRequestLogger } from './observability.js';
import { redactJid } from './redact.js';
import { startOutboundWorker } from './outbound/worker.js';

// PORT: production platforms (Dokploy/Render/Fly/Heroku) inject via PORT env var.
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

// Public ZeloMenu endpoints (cart link + store by slug) must work in production,
// where the reverse proxy only forwards /api/* to this backend (the nginx
// frontend serves everything else as the SPA, so /public-api/* never reaches
// here). We expose them under /api/public/* — which IS routed — by rewriting to
// the canonical /public-api/* handlers. After the rewrite req.path no longer
// starts with /api/, so the paywall below naturally skips them (they are public,
// token/slug-gated). Must run before the body parser + paywall so req.path is
// consistent everywhere downstream.
app.use((req, _res, next) => {
  if (req.url.startsWith('/api/public/')) {
    req.url = `/public-api/${req.url.slice('/api/public/'.length)}`;
  }
  next();
});

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    // P1.5 — antes throw new Error(`Origin not allowed by CORS: ${origin}`)
    // virava resposta 500 com a allowed-origin no error string. Atacante
    // descobria FRONTEND_URL via origin proibido. Agora cb(null, false)
    // gera 403/no-CORS limpo sem vazar a allowlist.
    return cb(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-ZeloChat-Internal-Key'],
}));
// 100kb global cap protects every endpoint EXCEPT:
// - /api/send (6mb for operator media uploads)
// - /api/ai/complete (512kb for chat history payloads)
// - /webhook/* (Whatsmiau media arrives as base64 JSON; messageHandler enforces
//   the real decoded-media cap before persistence)
// - /api/webhooks/abacatepay (raw body required for HMAC-SHA256 verification;
//   must be parsed BEFORE the global json() middleware so the Buffer is preserved)
// Without these skips, the global parser consumes/rejects the body before the
// per-route override can run.
app.use('/api/webhooks/abacatepay', express.raw({ type: '*/*' }));
app.use((req, res, next) => {
  if (req.path === '/api/send' || req.path === '/api/ai/complete') return next();
  if (req.path === '/webhook' || req.path.startsWith('/webhook/')) {
    return express.json({ limit: '40mb' })(req, res, next);
  }
  if (req.path === '/api/webhooks/abacatepay') return next(); // already parsed above
  return express.json({ limit: '100kb' })(req, res, next);
});

app.use(slowRequestLogger);

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
  // Build-version probe usado pelo banner "atualização disponível". Precisa
  // responder mesmo pra empresas com assinatura inativa — caso contrário o
  // operador na aba aberta não recebe o aviso de redeploy.
  '/api/version',
  '/api/bind-empresa',
  '/api/status',
  // Onboarding welcome roda ANTES do usuário ter qualquer assinatura — não tem
  // trial no ZeloChat, então quem termina o setup pode estar sem subscription
  // ativa. Sem essa exceção, o paywall 402 trava o disparo do email + WA Day 0.
  '/api/onboarding/welcome',
  // A conta pode estar sem assinatura ativa durante o grace period. A rota
  // continua autenticada e libera somente o cancelamento da deleção pendente.
  '/api/account/reactivate',
  // Cron interno autenticado por CRON_SECRET, não usa JWT de empresa.
  '/api/cron/onboarding-followup',
]);
// /api/public/* are the public ZeloMenu endpoints (cart link + store by slug),
// rewritten to /public-api/* above. They are token/slug-gated, not subscription-
// gated, so they must skip the paywall. Belt-and-suspenders with the rewrite:
// even if req.path still reads /api/public/* here, this keeps them open.
const PAYWALL_EXEMPT_PREFIXES = ['/api/billing/', '/api/webhooks/', '/api/public/'];

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
      return res.status(401).json({ error: 'Sua sessão expirou. Entre novamente para continuar.', code: 'UNAUTHORIZED' });
    }
    if (message === 'EMPRESA_NOT_FOUND') {
      return res.status(404).json({ error: 'Não encontramos sua empresa. Confira o acesso e tente novamente.', code: 'EMPRESA_NOT_FOUND' });
    }
    if (message === 'SUBSCRIPTION_INACTIVE') {
      return res.status(402).json({ error: 'Ative seu plano para continuar usando o ZeloChat.', code: 'SUBSCRIPTION_INACTIVE' });
    }
    console.error('[paywall] gate error:', err);
    return res.status(503).json({ error: 'PAYWALL_GATE_UNAVAILABLE' });
  }
});

app.use(router);
app.use(pushRouter);

const httpServer = createServer(app);
createWsServer(httpServer);

async function reRegisterTenantWebhooks(): Promise<void> {
  try {
    const { data: instances } = await getServiceSupabase()
      .from('empresa_perfil')
      .select('whatsmiau_instance')
      .not('whatsmiau_instance', 'is', null)
      .not('webhook_token', 'is', null);
    if (!instances || instances.length === 0) return;

    console.log(`[Server] Re-registering webhooks for ${instances.length} tenant instance(s)...`);
    await Promise.allSettled(
      instances.map((row: { whatsmiau_instance: string }) =>
        setWebhookForInstance(row.whatsmiau_instance).catch((err) =>
          console.error(`[Server] Webhook re-register failed for ${row.whatsmiau_instance}:`, err),
        ),
      ),
    );
    console.log('[Server] Webhook re-registration sweep complete.');
  } catch (err) {
    console.warn('[Server] Webhook re-registration sweep failed:', err);
  }
}

// --- Wire up incoming messages → store + auto-reply ---
// Per-conversation debounce + 3-stage cadence (read → typing → reply) lives in
// replyDebouncer.ts. Timer state moved out of this file in 2026-05.

/**
 * Per-contact AI reply rate limiter — in-memory sliding window.
 *
 * Key: `${empresaId}:${remoteJid}`
 * Value: { count, windowStart } where windowStart is Date.now() in ms.
 *
 * Cap: MAX_AI_REPLIES_PER_WINDOW replies per RATE_LIMIT_WINDOW_MS per contact.
 *
 * SINGLE-REPLICA CONCERN: this state is in-memory only. If the process is
 * horizontally scaled across multiple replicas, each replica keeps its
 * own counter and the effective cap becomes N × MAX_AI_REPLIES_PER_WINDOW.
 * Acceptable for the current single-node deployment; if we ever go multi-replica,
 * migrate to a Redis sorted-set or Supabase row with row-level locking.
 */
interface RateLimitEntry { count: number; windowStart: number; }
const autoReplyRateLimits = new Map<string, RateLimitEntry>();
const MAX_AI_REPLIES_PER_WINDOW = 3;
const RATE_LIMIT_WINDOW_MS = 60_000; // 60 seconds

function checkAutoReplyRateLimit(empresaId: string, jid: string): boolean {
  const key = `${empresaId}:${jid}`;
  const now = Date.now();
  const entry = autoReplyRateLimits.get(key);

  if (!entry || now > entry.windowStart + RATE_LIMIT_WINDOW_MS) {
    // No entry yet, or window expired — start fresh
    autoReplyRateLimits.set(key, { count: 1, windowStart: now });
    return true; // within limit
  }

  if (entry.count < MAX_AI_REPLIES_PER_WINDOW) {
    entry.count += 1;
    return true; // within limit
  }

  // Cap hit — log and reject
  console.warn(`[auto_reply] rate-limit hit for empresa=${empresaId} jid=${jid} (${MAX_AI_REPLIES_PER_WINDOW}/${RATE_LIMIT_WINDOW_MS / 1000}s)`);
  return false;
}

async function scheduleAutoReplyIfAllowed(params: {
  empresaId: string;
  jid: string;
  messageId?: string;
  reason: 'inbound' | 'audio_transcription_settled';
}): Promise<void> {
  const { empresaId, jid, messageId } = params;
  console.log(`[AutoReplyTrace] evaluate empresa=${empresaId} jid=${redactJid(jid)} reason=${params.reason} messageId=${messageId ?? '<none>'}`);
  const session = await getSession(jid, empresaId);
  if (!session) {
    console.warn(`[AutoReplyTrace] skip empresa=${empresaId} jid=${redactJid(jid)} reason=session_not_found`);
    return;
  }
  if (!session.autoReply) {
    console.log(`[AutoReplyTrace] skip empresa=${empresaId} jid=${redactJid(jid)} reason=session_auto_reply_off status=${session.status}`);
    return;
  }
  if (session.status === 'escalated') {
    console.log(`[AutoReplyTrace] skip empresa=${empresaId} jid=${redactJid(jid)} reason=session_escalated`);
    return;
  }

  await ensureAiSettingsHydrated(empresaId);
  if (!isAiGloballyEnabledNow(empresaId)) {
    console.log(`[AutoReplyTrace] skip empresa=${empresaId} jid=${redactJid(jid)} reason=global_ai_disabled`);
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error(`[AutoReplyTrace] skip empresa=${empresaId} jid=${redactJid(jid)} reason=openai_key_missing`);
    return;
  }

  console.log(`[AutoReplyTrace] scheduled empresa=${empresaId} jid=${redactJid(jid)} messageId=${messageId ?? '<none>'}`);
  scheduleReply({
    empresaId,
    jid,
    messageId,
    fire: async () => {
      console.log(`[AutoReplyTrace] fire empresa=${empresaId} jid=${redactJid(jid)} messageId=${messageId ?? '<none>'}`);
      const freshSession = await getSession(jid, empresaId);
      if (!freshSession) {
        console.warn(`[AutoReplyTrace] fire_skip empresa=${empresaId} jid=${redactJid(jid)} reason=session_not_found`);
        return;
      }
      if (!freshSession.autoReply) {
        console.log(`[AutoReplyTrace] fire_skip empresa=${empresaId} jid=${redactJid(jid)} reason=session_auto_reply_off status=${freshSession.status}`);
        return;
      }
      if (freshSession.status === 'escalated') {
        console.log(`[AutoReplyTrace] fire_skip empresa=${empresaId} jid=${redactJid(jid)} reason=session_escalated`);
        return;
      }
      if (!isAiGloballyEnabledNow(empresaId)) {
        console.log(`[AutoReplyTrace] fire_skip empresa=${empresaId} jid=${redactJid(jid)} reason=global_ai_disabled`);
        return;
      }

      if (!checkAutoReplyRateLimit(empresaId, jid)) return;

      try {
        const result = await generateAndSendReply(jid, empresaId);
        console.log(`[AutoReplyTrace] fire_done empresa=${empresaId} jid=${redactJid(jid)} result=${result ? 'reply_or_action' : 'no_reply'}`);
      } catch (err) {
        console.error(`[AutoReplyTrace] fire_error empresa=${empresaId} jid=${redactJid(jid)}:`, err);
      }
    },
  });
}

onAudioTranscriptionSettled(async ({ empresaId, jid, messageId }) => {
  try {
    const shouldRearm = await shouldRearmAfterAudioTranscription(empresaId, jid, messageId);
    if (!shouldRearm) return;
    await scheduleAutoReplyIfAllowed({
      empresaId,
      jid,
      messageId,
      reason: 'audio_transcription_settled',
    });
  } catch (err) {
    console.error('[AutoReply] audio transcription re-arm failed:', err);
  }
});

onIncomingMessage(async (msg, empresaIdFromWebhook) => {
  // SECURITY: empresaIdFromWebhook MUST come from the per-instance route
  // (`/webhook/:instance` → empresa_perfil.whatsmiau_instance lookup). We do
  // NOT fall back to the singleton — that's how messages from one tenant
  // ended up attributed to another after the legacy `/webhook` route was
  // resolved via `getBoundEmpresaId()`. If we don't know the empresa, drop.
  const empresaId = empresaIdFromWebhook;
  if (!empresaId) {
    console.warn('[InboundTrace] dropping incoming message — webhook did not resolve an empresaId');
    return;
  }
  console.log(`[InboundTrace] received empresa=${empresaId} jid=${redactJid(msg?.key?.remoteJid)} messageId=${msg?.key?.id ?? '<missing>'}`);

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
    console.error(`[InboundTrace] persist_error empresa=${empresaId} jid=${redactJid(msg?.key?.remoteJid)} messageId=${msg?.key?.id ?? '<missing>'}:`, error);
  }
  if (!persisted) {
    console.log(`[InboundTrace] persisted=false empresa=${empresaId} jid=${redactJid(msg?.key?.remoteJid)} messageId=${msg?.key?.id ?? '<missing>'}`);
    return;
  }
  console.log(`[InboundTrace] persisted=true empresa=${empresaId} jid=${redactJid(msg?.key?.remoteJid)} messageId=${msg?.key?.id ?? '<missing>'}`);

  // Fire-and-forget Web Push. The SW shows the notification only when no
  // ZeloChat tab is focused (handled inside the SW's push handler), so we
  // always trigger here and let the client decide. Errors never propagate.
  void (async () => {
    try {
      const pushJid = msg.key?.remoteJid;
      if (!pushJid) return;
      const session = await getSession(pushJid, empresaId);
      if (!session) return;
      await sendPushToEmpresa(empresaId, {
        title: session.customerName || 'Nova mensagem',
        body: session.lastMessage || 'Nova mensagem no WhatsApp',
        sessionId: pushJid,
        url: '/',
      });
    } catch (err) {
      console.warn('[push] inbound dispatch failed', err);
    }
  })();

  // 2. Auto-reply if enabled for this session
  const jid = msg.key?.remoteJid;
  if (!jid) {
    console.warn(`[InboundTrace] skip_auto_reply empresa=${empresaId} reason=no_jid_after_persist`);
    return;
  }

  await scheduleAutoReplyIfAllowed({
    empresaId,
    jid,
    messageId: msg.key?.id,
    reason: 'inbound',
  });
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
        // when the cloudflared URL rotates (dev) or PUBLIC_APP_URL changes.
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

      // Re-register webhooks for all active instances so that the ?token= query
      // param is present in the URL Whatsmiau calls. Run this for both
      // single-tenant and multi-tenant deployments: a one-empresa production
      // deploy can still use a per-tenant instance and needs the same repair.
      void reRegisterTenantWebhooks();
    } catch (err) {
      console.warn('[Server] Auto-bind failed:', err);
    }
  })();

  // P1.13 — periodic sweep of churned customers' Whatsmiau instances. Runs
  // 5 min after startup (lets paywall cache warm), then every 6h. Idempotent:
  // re-running after a successful sweep is a no-op. Customers within the
  // 30-day grace window are NOT touched.
  startSubscriptionSweepLoop();

  // P2.19 — periodic sweep of expired pending orders. Runs 2 min after startup,
  // then every 24h. Deletes rows where expires_at < NOW() - 7 days. Non-critical:
  // errors are swallowed and never crash the process.
  startPendingOrderSweeper();

  // Self-service account deletion — purges accounts whose 14-day grace period
  // elapsed (delete_account RPC + Whatsmiau + storage). Runs 3 min after startup,
  // then hourly. Idempotent.
  startAccountDeletionSweepLoop();

  // ZLM-105 — abandoned ZeloMenu cart recovery. Sends ONE recovery nudge for a
  // cart left open 2–24h. Runs 3 min after startup, then every 15 min. Respects
  // the global AI gate; one-shot guaranteed by a race-safe metadata claim.
  startAbandonedCartRecoverySweeper();

  // Webhook events raw retention — deletes processed rows >30d and stuck rows
  // >37d. Prevents unbounded table growth (hit 1.38 GB before this was added).
  startWebhookEventsSweeper();

  // Onboarding follow-up — Day 3, 7, 14, 21, 28 nutrition + conversion sequence
  // (Day 0 fires synchronously via /api/onboarding/welcome). Idempotent: re-run
  // is no-op via UNIQUE(user_id, day) on the log tables.
  startOnboardingFollowupLoop();

  // Campanhas usam uma fila persistente com lease; chamar duas vezes no mesmo
  // processo retorna o mesmo worker e não abre concorrência adicional.
  startOutboundWorker();
});
