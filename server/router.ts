import { Router, Request, Response } from 'express';
import express from 'express';
import axios from 'axios';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions.js';
import { broadcast } from './ws.js';
import {
  getStatus,
  getQR,
  fetchQR,
  disconnectWhatsApp,
  reconnectWhatsApp,
  sendTextMessage,
  sendMediaMessage,
  sendWhatsAppAudio,
  fetchProfilePicture,
  handleConnectionUpdate,
  dispatchIncomingMessage,
  getOwnJid,
  markWhatsAppMessageAsRead,
  validateWhatsAppNumbers,
  sendListMessage,
  sendLocationMessage,
  sendReaction,
  sendPollMessage,
  revokeMessage,
  syncStatusFromUpstream,
  fetchInstanceConnectionState,
  fetchInstanceQR,
  logoutInstance,
  setWebhookForInstance,
  wasSentByServer,
} from './whatsapp.js';
import {
  getAllSessions,
  getSession,
  addAssistantMessage,
  updateSessionProfilePic,
  setAutoReply,
  markSessionAsRead,
  deleteSession,
  updateSessionName,
  formatPhone,
  serializeForJid,
} from './messageHandler.js';
import { generateAndSendReply, getAI, confirmPendingOrder, cancelPendingOrder, getPendingOrder } from './ai.js';
import { getConfig, setConfig, loadAiSettingsFromDb, ensureAiSettingsHydrated } from './configStore.js';
import { createDriver, deleteDriver, listDrivers, updateDriver } from './drivers.js';
import {
  createTrigger,
  deleteTrigger,
  fetchDisabledBuiltinIds,
  listTriggers,
  setBuiltinTriggerDisabled,
  updateTrigger,
  type TriggerKind,
} from './triggers.js';
import { BUILTIN_TRIGGERS, isBuiltinTriggerId } from './builtinTriggers.js';
import {
  acknowledgeSession,
  countOpenEscalations,
  escalateSession,
  listEscalationEvents,
  resolveSession,
} from './escalation.js';
import { extractBearerToken } from './supabase.js';
import { requireEmpresaId, requireActiveZelochatSubscription, isEmpresaSubscriptionActive, setBoundEmpresaId, uploadMediaForSend, getServiceSupabase } from './supabase.js';
import { getEmpresaForInstance, getOrCreateOwnInstanceForEmpresa, setConnectionState } from './instanceManager.js';
import { createCheckoutSession, createPortalSession, syncFromStripe, changePlan } from './billing.js';
import type { ChatAttachment } from '../src/types.js';

const router = Router();

// JIDs that recently had a button action handled — used to suppress duplicate text events
// that WhatsApp/Whatsmiau sends for the same button click (within 5-second window)
const recentlyHandled = new Map<string, number>();

setInterval(() => {
  const cutoff = Date.now() - 10_000;
  for (const [jid, ts] of recentlyHandled) {
    if (ts < cutoff) recentlyHandled.delete(jid);
  }
}, 30_000);

function safeJsonParse<T = any>(value: string): T | null {
  try { return JSON.parse(value) as T; } catch { return null; }
}

/**
 * Core webhook event processor — same logic for every entry point. Exported via
 * the two routes below: legacy `/webhook` (apikey-header auth) and the new
 * per-instance `/webhook/:instance` (URL-path auth via empresa lookup on the
 * instance name). Both resolve to the same empresaId before getting here.
 */
async function processWebhookEvent(empresaId: string, body: any): Promise<void> {
  const event: string = (body?.event ?? '').toLowerCase().replace(/_/g, '.');
  const data = body?.data;

  if (!data) return;

  if (event === 'messages.upsert') {
    if (!data.message) return;

    // Block processing for empresas without an active subscription — inbound
    // messages trigger AI inference and Supabase writes, both of which cost money.
    // Fail-open on DB errors so a transient outage never silences a paying customer.
    const subscriptionActive = await isEmpresaSubscriptionActive(empresaId);
    if (!subscriptionActive) {
      console.warn(`[Webhook] messages.upsert bloqueado — empresa ${empresaId} sem assinatura ativa`);
      return;
    }

    // Messages sent from the operator's phone (not via the app). Save them so the
    // conversation history stays complete. Skip multi-device protocol artifacts and
    // any message already saved by /api/send (identified by its Whatsmiau key id).
    if (data.key?.fromMe) {
      if (data.message?.deviceSentMessage) return;
      const msgId: string = data.key?.id ?? '';
      if (msgId && wasSentByServer(msgId)) return;
      const remoteJid: string = data.key?.remoteJid ?? '';
      if (!remoteJid.endsWith('@s.whatsapp.net')) return;
      const msgText = (
        data.message?.conversation ??
        data.message?.extendedTextMessage?.text ??
        ''
      ).trim();
      if (msgText) {
        addAssistantMessage(remoteJid, msgText, undefined, empresaId).catch((err) =>
          console.error('[Webhook] fromMe persist failed:', err),
        );
      }
      return;
    }

    // Secondary guard: outbound messages wrapped by multi-device protocol
    if (data.message?.deviceSentMessage) return;
    const remoteJid: string = data.key?.remoteJid ?? '';
    if (remoteJid === 'status@broadcast') return;
    if (remoteJid.endsWith('@g.us')) return;   // ignore group messages
    if (remoteJid.endsWith('@broadcast')) return; // ignore broadcast lists
    if (!remoteJid.endsWith('@s.whatsapp.net')) return; // only individual chats
    const botJid = getOwnJid();
    if (botJid && remoteJid === botJid) return;

    const interactiveParams = data.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
    const interactiveId = interactiveParams
      ? safeJsonParse<{ id?: string }>(interactiveParams)?.id ?? ''
      : '';
    const buttonId: string =
      data.message?.buttonsResponseMessage?.selectedButtonId ??
      data.message?.templateButtonReplyMessage?.selectedId ??
      interactiveId ?? '';

    const interactiveText = data.message?.interactiveResponseMessage?.body?.text ?? '';
    const msgText = (
      data.message?.conversation ??
      data.message?.extendedTextMessage?.text ??
      interactiveText ?? ''
    ).trim();

    // "Hard" button click: an explicit button-id from Whatsmiau OR plain text that
    // exactly matches a button label we sent. These MUST short-circuit the AI even
    // when no pending order exists — otherwise the AI re-interprets "✅ Confirmar"
    // as the customer placing a new order and creates a duplicate.
    const isHardConfirm =
      buttonId === 'CONFIRM_ORDER' || msgText === '✅ Confirmar' || msgText === 'CONFIRM_ORDER';
    const isHardCancel =
      buttonId === 'CANCEL_ORDER' || msgText === '❌ Cancelar' || msgText === 'CANCEL_ORDER';

    if (isHardConfirm || isHardCancel) {
      // Serialize through the same per-JID queue used by `handleIncomingMessage`
      // so a button click and a parallel inbound text (or a webhook retry of
      // the same click) cannot both pass the `getPendingOrder` check before
      // either has called `clearPendingOrder`. Without the queue, two
      // concurrent confirms can both insert the order — the original
      // duplicate-order bug, see CLAUDE.md §"Order confirmation flow".
      await serializeForJid(remoteJid, async () => {
        recentlyHandled.set(remoteJid, Date.now()); // block duplicate events for 5s
        const pending = await getPendingOrder(remoteJid, empresaId);
        if (pending) {
          try {
            if (isHardConfirm) {
              await confirmPendingOrder(remoteJid, empresaId);
            } else {
              await cancelPendingOrder(remoteJid, empresaId);
            }
          } catch (err) {
            console.error(
              `[Webhook] ${isHardConfirm ? 'confirm' : 'cancel'}PendingOrder failed:`,
              err,
            );
          }
          return;
        }
        // No pending — order already finalized or never existed. Reply
        // idempotently. NEVER fall through to the AI for a button click.
        if (isHardConfirm) {
          const ack = 'Seu pedido já foi confirmado! ✅ Qualquer dúvida é só chamar 😊';
          try {
            await sendTextMessage(remoteJid, ack, empresaId);
            await addAssistantMessage(remoteJid, ack, undefined, empresaId);
          } catch (err) {
            console.error('[Webhook] idempotent confirm reply failed:', err);
          }
        }
      });
      return;
    }

    // Soft confirmation keywords (Sim/Não and short forms) — used when buttons
    // can't be sent and the AI fell back to a plain-text prompt. Only act on
    // these when a pending order is actually waiting; otherwise let the AI
    // process them naturally (e.g. "Sim" answering an unrelated question).
    if (msgText) {
      // Normalize before regex: trim, lowercase, strip surrounding punctuation
      // so "Sim.", " NÃO ", "sim!" all match. Anchored regex on raw text
      // missed accents/casing/whitespace and leaked into the AI as freeform.
      const normalized = msgText
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{M}/gu, '') // strip combining accent marks
        .replace(/[^a-z]/g, '');
      const isSoftConfirm = normalized === 'sim' || normalized === 's';
      const isSoftCancel = normalized === 'nao' || normalized === 'n';
      if (isSoftConfirm || isSoftCancel) {
        // Serialize through the per-JID queue (see hard-confirm block above).
        // Without this, a soft "Sim" arriving while a button click is in-flight
        // can read the same pending row and trigger a second confirm.
        const handled = await serializeForJid(remoteJid, async () => {
          const pending = await getPendingOrder(remoteJid, empresaId);
          if (!pending) return false;
          recentlyHandled.set(remoteJid, Date.now());
          try {
            if (isSoftConfirm) {
              await confirmPendingOrder(remoteJid, empresaId);
            } else {
              await cancelPendingOrder(remoteJid, empresaId);
            }
          } catch (err) {
            console.error(
              `[Webhook] soft ${isSoftConfirm ? 'confirm' : 'cancel'}PendingOrder failed:`,
              err,
            );
          }
          return true;
        });
        if (handled) return;
      }
    }

    // Suppress any further duplicate events within 5 seconds of a button action
    const handledTs = recentlyHandled.get(remoteJid);
    if (handledTs) {
      if (Date.now() - handledTs < 5000) return; // duplicate — skip AI
      recentlyHandled.delete(remoteJid);
    }

    dispatchIncomingMessage(data, empresaId);
  } else if (event === 'connection.update') {
    handleConnectionUpdate(data, empresaId);
  } else if (event === 'messages.update') {
    // Delivery / read receipts — broadcast to frontend so it can update message ticks
    const updates = Array.isArray(data) ? data : [data];
    for (const u of updates) {
      if (!u?.keyId && !u?.messageId) continue;
      broadcast(
        {
          type: 'message_status',
          data: {
            messageId: u.keyId ?? u.messageId,
            remoteJid: u.remoteJid,
            status: u.status, // 'DELIVERY_ACK' | 'READ'
          },
        },
        empresaId,
      );
    }
  } else if (event === 'messages.delete') {
    const deletions = Array.isArray(data) ? data : [data];
    for (const d of deletions) {
      if (!d?.id) continue;
      broadcast(
        { type: 'message_deleted', data: { messageId: d.id, remoteJid: d.remoteJid } },
        empresaId,
      );
    }
  } else if (event === 'contacts.upsert') {
    const contacts = Array.isArray(data) ? data : [data];
    for (const c of contacts) {
      const remoteJid: string = c?.remoteJid ?? '';
      const pushName: string = c?.pushName ?? '';
      if (remoteJid && pushName) {
        broadcast(
          { type: 'contact_update', data: { remoteJid, pushName, profilePicUrl: c?.profilePicUrl } },
          empresaId,
        );

        // Save profile picture to database — empresaId comes from the validated token (C3),
        // not from the global singleton.
        if (c?.profilePicUrl) {
          updateSessionProfilePic(empresaId, remoteJid, c.profilePicUrl).catch((err) => {
            console.error('[Webhook] Failed to save profile picture:', err);
          });
        }
      }
    }
  }
}

/**
 * POST /webhook — REMOVED (2026-04-29).
 *
 * The legacy single-tenant route resolved empresaId via the bound singleton
 * (`getBoundEmpresaId()`), which is non-deterministic in multi-tenant setups
 * and caused a privacy leak: messages from one empresa were attributed to
 * whichever empresa happened to be auto-bound at startup. All instances must
 * now use the per-instance URL `/webhook/:instance`. We deliberately respond
 * 410 (not 404) so any stale Whatsmiau registration surfaces loudly.
 */
router.post('/webhook', async (_req: Request, res: Response) => {
  console.warn('[Webhook] 410 — POST /webhook is removed; use /webhook/:instance');
  res.status(410).json({ error: 'legacy webhook removed; reconfigure to /webhook/:instance' });
});

/**
 * POST /webhook/:instance — Per-instance entry point used by the multi-tenant
 * setup (P0-02). Whatsmiau's webhook URL for each empresa's instance is set to
 * `${PUBLIC_URL}/webhook/${instance}`. We resolve the empresa via DB lookup on
 * `empresa_perfil.whatsmiau_instance = :instance` — no apikey header required
 * because the URL path is itself the per-tenant secret (instance names are not
 * guessable; combined with Whatsmiau's source IP this is enough authentication
 * for the beta).
 */
router.post('/webhook/:instance', async (req: Request, res: Response) => {
  const instance = req.params.instance?.trim();
  if (!instance) {
    res.status(400).json({ error: 'missing instance' });
    return;
  }
  const empresaId = await getEmpresaForInstance(instance);
  if (!empresaId) {
    console.warn(`[Webhook] 404 — instance "${instance}" has no empresa assigned`);
    res.status(404).json({ error: 'unknown instance' });
    return;
  }
  res.json({ ok: true });
  await processWebhookEvent(empresaId, req.body);
});


function sendAuthError(res: Response, error: unknown): void {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';

  if (message === 'UNAUTHORIZED') {
    res.status(401).json({ error: 'Não autenticado' });
    return;
  }

  if (message === 'EMPRESA_NOT_FOUND') {
    res.status(403).json({ error: 'Empresa não encontrada para este usuário' });
    return;
  }

  if (message === 'SUBSCRIPTION_INACTIVE') {
    res.status(402).json({
      error: 'Ative seu plano ZeloChat para conectar o WhatsApp.',
      code: 'SUBSCRIPTION_INACTIVE',
    });
    return;
  }

  res.status(500).json({ error: message });
}

function sendDriverError(res: Response, error: unknown): void {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';

  if (message === 'UNAUTHORIZED' || message === 'EMPRESA_NOT_FOUND') {
    sendAuthError(res, error);
    return;
  }

  if (message === 'INVALID_DRIVER_PAYLOAD') {
    res.status(400).json({ error: 'Nome e WhatsApp do entregador são obrigatórios.' });
    return;
  }

  if (message === 'INVALID_DRIVER_STATUS') {
    res.status(400).json({ error: 'Status de entregador inválido.' });
    return;
  }

  if (message.includes('zelochat_drivers_empresa_id_phone_key')) {
    res.status(409).json({ error: 'Já existe um entregador com esse WhatsApp nesta empresa.' });
    return;
  }

  res.status(500).json({ error: message });
}

function sendTriggerError(res: Response, error: unknown): void {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';

  if (message === 'UNAUTHORIZED' || message === 'EMPRESA_NOT_FOUND') {
    sendAuthError(res, error);
    return;
  }

  if (message === 'INVALID_TRIGGER_PAYLOAD') {
    res.status(400).json({ error: 'Descrição do gatilho não pode ser vazia.' });
    return;
  }

  if (message === 'INVALID_TRIGGER_PARSE') {
    res.status(400).json({ error: 'Não consegui entender esse gatilho. Tente descrever com mais detalhes.' });
    return;
  }

  if (message === 'INVALID_TRIGGER_KIND') {
    res.status(400).json({ error: 'Tipo de gatilho inválido.' });
    return;
  }

  res.status(500).json({ error: message });
}

/**
 * Billing — Stripe checkout, customer portal, and post-checkout sync.
 * Webhook processing is centralised in zeloPDV-Prod (`/api/billing/webhook`),
 * which writes to the shared `subscriptions` table that ZeloChat reads from.
 */
router.post('/api/billing/checkout', createCheckoutSession);
router.post('/api/billing/portal', createPortalSession);
router.post('/api/billing/sync', syncFromStripe);
router.post('/api/billing/change-plan', changePlan);

/**
 * GET /api/healthz — Always-200 liveness probe. Used by Railway's health
 * checker (railway.json `healthcheckPath`) — must NOT require auth or do
 * any DB / upstream calls so the container can be marked healthy as soon
 * as it can answer HTTP.
 */
router.get('/api/healthz', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

/**
 * GET /api/status — Returns this empresa's WhatsApp connection status.
 *
 * Multi-tenant: requires auth and queries Whatsmiau for THIS empresa's
 * instance only. Never returns another tenant's state — the empresa with
 * NULL whatsmiau_instance simply gets 'disconnected' (we don't auto-create
 * the instance here; that happens lazily on /api/qr).
 *
 * `?verify=1` is preserved for backwards compatibility but is now a no-op
 * since every read is already a fresh upstream query.
 */
router.get('/api/status', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const supabase = getServiceSupabase();
    const { data } = await supabase
      .from('empresa_perfil')
      .select('whatsmiau_instance')
      .eq('id', empresaId)
      .maybeSingle();
    const instance = (data as { whatsmiau_instance?: string | null } | null)?.whatsmiau_instance;
    if (!instance) {
      res.json({ status: 'disconnected' });
      return;
    }
    const status = await fetchInstanceConnectionState(instance);
    res.json({ status });
  } catch (err) {
    if (err instanceof Error && (err.message === 'UNAUTHORIZED' || err.message === 'EMPRESA_NOT_FOUND')) {
      sendAuthError(res, err);
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

/**
 * GET /api/qr — Returns this empresa's QR code as a base64 data URI.
 *
 * Multi-tenant: requires active subscription. Resolves THIS empresa's
 * Whatsmiau instance (creating it on first use if NULL), then queries that
 * instance for its current QR. Never reads or returns another tenant's QR.
 */
router.get('/api/qr', async (req: Request, res: Response) => {
  try {
    await requireActiveZelochatSubscription(req);
    const empresaId = await requireEmpresaId(req);
    const instance = await getOrCreateOwnInstanceForEmpresa(empresaId);
    // First-time creation: register the per-instance webhook so Whatsmiau
    // delivers events to /webhook/${instance}. Idempotent — safe to call again.
    await setWebhookForInstance(instance);
    const result = await fetchInstanceQR(instance);
    res.json({ qr: result.qr, status: result.status, upstreamError: result.upstreamError });
  } catch (err) {
    if (err instanceof Error && (err.message === 'UNAUTHORIZED' || err.message === 'SUBSCRIPTION_INACTIVE' || err.message === 'EMPRESA_NOT_FOUND')) {
      sendAuthError(res, err);
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

/**
 * POST /api/whatsapp/disconnect — Logs THIS empresa's WhatsApp out only.
 *
 * Multi-tenant: scoped to the caller's empresa instance. Calling this never
 * touches another tenant's session.
 */
router.post('/api/whatsapp/disconnect', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const supabase = getServiceSupabase();
    const { data } = await supabase
      .from('empresa_perfil')
      .select('whatsmiau_instance')
      .eq('id', empresaId)
      .maybeSingle();
    const instance = (data as { whatsmiau_instance?: string | null } | null)?.whatsmiau_instance;
    if (!instance) {
      // No instance assigned — already "disconnected" from this empresa's POV.
      res.json({ ok: true, status: 'disconnected' });
      return;
    }
    await logoutInstance(instance);
    await setConnectionState(empresaId, false);
    res.json({ ok: true, status: 'disconnected' });
  } catch (err) {
    if (err instanceof Error && (err.message === 'UNAUTHORIZED' || err.message === 'EMPRESA_NOT_FOUND')) {
      sendAuthError(res, err);
      return;
    }
    const msg = err instanceof Error ? err.message : 'Erro ao desconectar.';
    res.status(500).json({ error: msg });
  }
});

/**
 * POST /api/qr/refresh — Forces a fresh QR pull for THIS empresa's instance.
 *
 * Multi-tenant: same scoping as /api/qr. The legacy global manuallyDisconnected
 * flag is irrelevant here because each empresa has its own instance with its
 * own connection lifecycle on Whatsmiau's side.
 */
router.post('/api/qr/refresh', async (req: Request, res: Response) => {
  try {
    await requireActiveZelochatSubscription(req);
    const empresaId = await requireEmpresaId(req);
    const instance = await getOrCreateOwnInstanceForEmpresa(empresaId);
    await setWebhookForInstance(instance);
    const result = await fetchInstanceQR(instance);
    // Surface upstreamError pro frontend mostrar mensagem específica.
    // Não é 500 — Whatsmiau pode estar lento, user pode tentar de novo.
    res.json({ qr: result.qr, status: result.status, upstreamError: result.upstreamError });
  } catch (err) {
    if (err instanceof Error && (err.message === 'UNAUTHORIZED' || err.message === 'SUBSCRIPTION_INACTIVE' || err.message === 'EMPRESA_NOT_FOUND')) {
      sendAuthError(res, err);
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

/**
 * GET /api/sessions — Returns all active WhatsApp sessions.
 */
router.get('/api/sessions', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const sessions = await getAllSessions(empresaId);
    res.json({ sessions });
  } catch (error) {
    sendAuthError(res, error);
  }
});

/**
 * GET /api/sessions/:jid — Returns a specific session with its messages.
 */
router.get('/api/sessions/:jid', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const session = await getSession(req.params.jid, empresaId);
    if (!session) {
      res.status(404).json({ error: 'Conversa não encontrada' });
      return;
    }
    res.json({ session });
  } catch (error) {
    sendAuthError(res, error);
  }
});

/**
 * POST /api/send — Sends a text message to a WhatsApp contact.
 * Body: { to: string (jid), message?: string, attachment?: ChatAttachment }
 */
router.post('/api/send', express.json({ limit: '6mb' }), async (req: Request, res: Response) => {
  const { to, message, attachment } = req.body as {
    to?: string;
    message?: string;
    attachment?: ChatAttachment;
  };

  if (!to || (!message?.trim() && !attachment)) {
    res.status(400).json({ error: 'Campo "to" e conteúdo da mensagem são obrigatórios.' });
    return;
  }

  try {
    const empresaId = await requireEmpresaId(req);
    const trimmedMessage = message?.trim() ?? '';

    if (attachment?.dataUrl) {
      // Whatsmiau only accepts public URLs — upload to Supabase Storage first
      const mediaUrl = await uploadMediaForSend(
        attachment.dataUrl,
        attachment.fileName,
        attachment.mimeType,
      );
      if (attachment.type === 'audio') {
        // Audio PTT uses a dedicated endpoint with different params (no mediatype/caption)
        await sendWhatsAppAudio(to, mediaUrl, empresaId);
      } else {
        await sendMediaMessage(to, {
          mediatype: attachment.type === 'image' ? 'image' : 'document',
          mimetype: attachment.mimeType,
          media: mediaUrl,
          caption: trimmedMessage || undefined,
          fileName: attachment.fileName,
        }, empresaId);
      }
    } else {
      await sendTextMessage(to, trimmedMessage, empresaId);
    }

    await addAssistantMessage(to, trimmedMessage, undefined, empresaId, attachment);
    res.json({ ok: true });
  } catch (error: any) {
    if (error instanceof Error && (error.message === 'UNAUTHORIZED' || error.message === 'EMPRESA_NOT_FOUND')) {
      sendAuthError(res, error);
      return;
    }
    console.error('[Router] Send error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/api/bind-empresa', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    setBoundEmpresaId(empresaId);
    // Hydrate the in-memory kill-switch + re-engage flag from the DB so restarts
    // preserve the dono's choice. Same canonical loader used by the lazy webhook
    // path — single source of truth for these flags.
    try {
      await loadAiSettingsFromDb(empresaId);
    } catch (err) {
      // Columns may not exist yet (migrations 008/009 not applied) — defaults apply.
      console.warn('[Router] ai_enabled/ai_can_reengage_pending column unavailable:', err);
    }
    res.json({ ok: true, empresaId });
  } catch (error) {
    sendAuthError(res, error);
  }
});

/**
 * GET /api/ai-enabled — returns the empresa's global AI kill-switch state.
 */
router.get('/api/ai-enabled', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    // Ensure the in-memory cache reflects the DB before answering — otherwise the
    // frontend could render the toggle as "on" when the DB says "off" simply because
    // the server just rebooted and nobody had bound this empresa yet.
    await ensureAiSettingsHydrated(empresaId);
    res.json({ enabled: getConfig(empresaId).aiEnabled === true });
  } catch (error) {
    sendAuthError(res, error);
  }
});

/**
 * POST /api/ai-enabled — toggles the global AI kill-switch. Persisted in empresa_perfil.
 * Body: { enabled: boolean }
 */
router.post('/api/ai-enabled', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const enabled = Boolean(req.body?.enabled);
    setConfig(empresaId, { aiEnabled: enabled });
    try {
      await getServiceSupabase()
        .from('empresa_perfil')
        .update({ ai_enabled: enabled, updated_at: new Date().toISOString() })
        .eq('id', empresaId);
    } catch (err) {
      console.warn('[Router] ai_enabled persist failed (column missing?):', err);
    }
    broadcast({ type: 'ai_enabled', data: { enabled } }, empresaId);
    res.json({ ok: true, enabled });
  } catch (error) {
    sendAuthError(res, error);
  }
});

/**
 * POST /api/ai/reply — Generates an AI reply for a session and sends it.
 * Body: { jid: string }
 */
router.get('/api/drivers', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const drivers = await listDrivers(empresaId);
    res.json({ drivers });
  } catch (error) {
    sendDriverError(res, error);
  }
});

router.post('/api/drivers', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const driver = await createDriver(empresaId, req.body ?? {});
    res.status(201).json({ driver });
  } catch (error) {
    sendDriverError(res, error);
  }
});

router.put('/api/drivers/:id', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const driver = await updateDriver(empresaId, req.params.id, req.body ?? {});

    if (!driver) {
      res.status(404).json({ error: 'Entregador não encontrado.' });
      return;
    }

    res.json({ driver });
  } catch (error) {
    sendDriverError(res, error);
  }
});

router.delete('/api/drivers/:id', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const deleted = await deleteDriver(empresaId, req.params.id);

    if (!deleted) {
      res.status(404).json({ error: 'Entregador não encontrado.' });
      return;
    }

    res.json({ ok: true });
  } catch (error) {
    sendDriverError(res, error);
  }
});

/**
 * POST /api/drivers/:id/dispatch
 * Body: { orderId: string }
 * Sends a WhatsApp message to the driver with full order details, via the empresa's
 * own Whatsmiau instance — replaces the legacy wa.me deeplink flow.
 */
router.post('/api/drivers/:id/dispatch', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const driverId = req.params.id;
    const { orderId } = (req.body ?? {}) as { orderId?: string };

    if (!orderId) {
      res.status(400).json({ error: 'orderId é obrigatório.' });
      return;
    }

    const supabase = getServiceSupabase();

    const [driverRes, orderRes, empresaRes] = await Promise.all([
      supabase
        .from('zelochat_drivers')
        .select('id, name, phone, status')
        .eq('id', driverId)
        .eq('empresa_id', empresaId)
        .maybeSingle(),
      supabase
        .from('zelochat_orders')
        .select('*')
        .eq('id', orderId)
        .eq('empresa_id', empresaId)
        .maybeSingle(),
      supabase
        .from('empresa_perfil')
        .select('nome_exibicao')
        .eq('id', empresaId)
        .maybeSingle(),
    ]);

    if (driverRes.error) throw new Error(driverRes.error.message);
    if (orderRes.error) throw new Error(orderRes.error.message);

    const driver = driverRes.data as { id: string; name: string; phone: string } | null;
    const order = orderRes.data as Record<string, unknown> | null;

    if (!driver) {
      res.status(404).json({ error: 'Entregador não encontrado.' });
      return;
    }
    if (!order) {
      res.status(404).json({ error: 'Pedido não encontrado.' });
      return;
    }

    const empresaNome = (empresaRes.data as { nome_exibicao?: string } | null)?.nome_exibicao ?? '';
    const items = (order.items as { product: string; quantity: number }[]) ?? [];
    const itemsText = items.length
      ? items.map((it) => `• ${it.quantity}× ${it.product}`).join('\n')
      : '• (sem itens)';
    const total = Number(order.total ?? 0);
    const customerPhone = (order.customer_phone as string | null) ?? '';
    const formattedCustomerPhone = customerPhone ? formatPhone(customerPhone.replace(/\D/g, '')) : '—';
    const address = (order.delivery_address as string | null) ?? '—';
    const payment = (order.payment_method as string | null) ?? '—';
    const customerName = (order.customer_name as string | null) ?? '—';

    const text = [
      `🛵 *Nova entrega*${empresaNome ? ` — ${empresaNome}` : ''}`,
      '',
      `👤 *Cliente:* ${customerName}`,
      `📞 *Telefone:* ${formattedCustomerPhone}`,
      `📍 *Endereço:* ${address}`,
      `💳 *Pagamento:* ${payment}`,
      '',
      '*Itens:*',
      itemsText,
      '',
      `💰 *Total:* R$ ${total.toFixed(2).replace('.', ',')}`,
    ].join('\n');

    const driverPhone = driver.phone.replace(/\D/g, '');
    const jid = `${driverPhone}@s.whatsapp.net`;

    await sendTextMessage(jid, text, empresaId);
    await addAssistantMessage(jid, text, undefined, empresaId);

    res.json({ ok: true });
  } catch (error) {
    sendDriverError(res, error);
  }
});

/**
 * PATCH /api/orders/:id/status
 * Body: { status: 'pending' | 'preparing' | 'ready' | 'out_for_delivery' | 'delivered' }
 * Updates the order status and, for transitions into preparing/ready/out_for_delivery,
 * fires a WhatsApp notification to the customer if the empresa has the toggle on.
 */
router.patch('/api/orders/:id/status', async (req: Request, res: Response) => {
  const ALLOWED: ReadonlyArray<string> = ['pending', 'preparing', 'ready', 'out_for_delivery', 'delivered'];
  try {
    const empresaId = await requireEmpresaId(req);
    const orderId = req.params.id;
    const { status } = (req.body ?? {}) as { status?: string };

    if (!status || !ALLOWED.includes(status)) {
      res.status(400).json({ error: 'Status inválido.' });
      return;
    }

    const supabase = getServiceSupabase();

    const { data: existing, error: loadErr } = await supabase
      .from('zelochat_orders')
      .select('*')
      .eq('id', orderId)
      .eq('empresa_id', empresaId)
      .maybeSingle();

    if (loadErr) throw new Error(loadErr.message);
    if (!existing) {
      res.status(404).json({ error: 'Pedido não encontrado.' });
      return;
    }

    const oldStatus = (existing as { status: string }).status;

    const { error: updErr } = await supabase
      .from('zelochat_orders')
      .update({ status })
      .eq('id', orderId)
      .eq('empresa_id', empresaId);

    if (updErr) throw new Error(updErr.message);

    const shouldNotify =
      oldStatus !== status &&
      (status === 'preparing' || status === 'ready' || status === 'out_for_delivery');

    if (shouldNotify) {
      try {
        const customerPhoneRaw = ((existing as { customer_phone: string | null }).customer_phone ?? '').replace(/\D/g, '');

        if (customerPhoneRaw) {
          const { data: empresa } = await supabase
            .from('empresa_perfil')
            .select('notify_customer_preparing, notify_customer_ready, notify_customer_out_for_delivery')
            .eq('id', empresaId)
            .maybeSingle();

          const flags = empresa as {
            notify_customer_preparing?: boolean;
            notify_customer_ready?: boolean;
            notify_customer_out_for_delivery?: boolean;
          } | null;

          const flagOn =
            (status === 'preparing' && flags?.notify_customer_preparing) ||
            (status === 'ready' && flags?.notify_customer_ready) ||
            (status === 'out_for_delivery' && flags?.notify_customer_out_for_delivery);

          if (flagOn) {
            const customerName = ((existing as { customer_name: string | null }).customer_name ?? '').split(' ')[0] || 'tudo bem';
            const isDelivery = !!((existing as { delivery_address: string | null }).delivery_address);
            const templates: Record<string, string> = {
              preparing: `Olá ${customerName}! 👨‍🍳 Recebemos seu pedido e já estamos preparando. Em breve avisamos quando estiver pronto!`,
              ready: isDelivery
                ? `${customerName}, seu pedido está prontinho! 🎉 Em breve sairá para entrega.`
                : `${customerName}, seu pedido está pronto para retirada! 🎉 Pode vir buscar.`,
              out_for_delivery: `${customerName}, saiu pra entrega! 🛵 Seu pedido já está a caminho.`,
            };
            const text = templates[status];

            const phoneWithDdi = customerPhoneRaw.startsWith('55') ? customerPhoneRaw : `55${customerPhoneRaw}`;
            const jid = `${phoneWithDdi}@s.whatsapp.net`;

            await sendTextMessage(jid, text, empresaId);
            await addAssistantMessage(jid, text, undefined, empresaId);
          }
        }
      } catch (err) {
        console.error('[order status notify] failed:', err);
      }
    }

    res.json({ ok: true });
  } catch (error) {
    sendDriverError(res, error);
  }
});

router.get('/api/triggers', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const triggers = await listTriggers(empresaId);
    res.json({ triggers });
  } catch (error) {
    sendTriggerError(res, error);
  }
});

router.post('/api/triggers', async (req: Request, res: Response) => {
  const { naturalInput, kind } = (req.body ?? {}) as { naturalInput?: string; kind?: string };
  if (!naturalInput?.trim()) {
    res.status(400).json({ error: 'Descreva o gatilho em português.' });
    return;
  }
  if (kind !== undefined && kind !== 'notify_manager' && kind !== 'escalate_human') {
    res.status(400).json({ error: 'Tipo de gatilho inválido.' });
    return;
  }
  try {
    const empresaId = await requireEmpresaId(req);
    const trigger = await createTrigger(empresaId, naturalInput, kind as TriggerKind | undefined);
    res.status(201).json({ trigger });
  } catch (error) {
    sendTriggerError(res, error);
  }
});

router.patch('/api/triggers/:id', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const trigger = await updateTrigger(empresaId, req.params.id, req.body ?? {});
    if (!trigger) {
      res.status(404).json({ error: 'Gatilho não encontrado.' });
      return;
    }
    res.json({ trigger });
  } catch (error) {
    sendTriggerError(res, error);
  }
});

router.delete('/api/triggers/:id', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const triggerId = req.params.id;
    if (isBuiltinTriggerId(triggerId)) {
      res.status(400).json({ error: 'Gatilhos do sistema não podem ser excluídos. Desative-o em vez disso.' });
      return;
    }
    const deleted = await deleteTrigger(empresaId, triggerId);
    if (!deleted) {
      res.status(404).json({ error: 'Gatilho não encontrado.' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    sendTriggerError(res, error);
  }
});

/**
 * GET /api/triggers/builtin — list all baseline (system) triggers and which are disabled.
 */
router.get('/api/triggers/builtin', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const disabled = await fetchDisabledBuiltinIds(empresaId);
    const disabledSet = new Set(disabled);
    res.json({
      builtins: BUILTIN_TRIGGERS.map((t) => ({
        id: t.id,
        kind: t.kind,
        name: t.name,
        conditionDescription: t.conditionDescription,
        disabled: disabledSet.has(t.id),
      })),
    });
  } catch (error) {
    sendTriggerError(res, error);
  }
});

/**
 * PATCH /api/triggers/builtin/:id — toggle a baseline trigger on/off for this empresa.
 * Body: { disabled: boolean }
 */
router.patch('/api/triggers/builtin/:id', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const builtinId = req.params.id;
    if (!isBuiltinTriggerId(builtinId)) {
      res.status(400).json({ error: 'ID inválido para gatilho do sistema.' });
      return;
    }
    const disabled = Boolean(req.body?.disabled);
    const next = await setBuiltinTriggerDisabled(empresaId, builtinId, disabled);
    res.json({ ok: true, disabledIds: next });
  } catch (error) {
    sendTriggerError(res, error);
  }
});

/**
 * POST /api/sessions/:jid/escalate — manual operator escalation (no AI involvement).
 * Body: { reason?: string }
 */
router.post('/api/sessions/:jid/escalate', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const reason = String((req.body?.reason ?? '')).trim() || 'Escalação manual pelo atendente';
    const result = await escalateSession(empresaId, req.params.jid, {
      triggerId: null,
      triggerKind: 'escalate_human',
      triggerName: 'Escalação manual',
      reasonCategory: 'manual',
      reasonText: reason,
      customerMessageExcerpt: null,
      // Operator already knows what they're doing; skip the customer-facing handoff
      // text so they can write their own first message manually.
      skipCustomerMessage: true,
    });
    if (!result) {
      res.status(404).json({ error: 'Conversa não encontrada.' });
      return;
    }
    res.json({ ok: true, event: result.event, reEscalated: result.reEscalated });
  } catch (error) {
    sendAuthError(res, error);
  }
});

/**
 * POST /api/sessions/:jid/resolve — operator marks an escalated conversation as resolved.
 * Auto-reply stays OFF (per design — operator must explicitly re-enable).
 */
router.post('/api/sessions/:jid/resolve', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    // Resolve `auth.users.id` (resolved_by) from the bearer token if available.
    let userId: string | null = null;
    const token = extractBearerToken(req);
    if (token) {
      const { data: authData } = await getServiceSupabase().auth.getUser(token);
      userId = authData.user?.id ?? null;
    }
    const result = await resolveSession(empresaId, req.params.jid, userId);
    res.json({ ok: true, ...result });
  } catch (error) {
    sendAuthError(res, error);
  }
});

/**
 * POST /api/sessions/:jid/acknowledge — fired when the operator opens an escalated chat.
 * Stamps acknowledged_at on the open event row (used for SLA metrics).
 */
router.post('/api/sessions/:jid/acknowledge', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    await acknowledgeSession(empresaId, req.params.jid);
    res.json({ ok: true });
  } catch (error) {
    sendAuthError(res, error);
  }
});

/**
 * GET /api/sessions/:jid/escalation-events — full audit log for the contact sidebar.
 */
router.get('/api/sessions/:jid/escalation-events', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const events = await listEscalationEvents(empresaId, req.params.jid);
    res.json({ events });
  } catch (error) {
    sendAuthError(res, error);
  }
});

/**
 * GET /api/escalations/open-count — used by the global nav pill.
 */
router.get('/api/escalations/open-count', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const count = await countOpenEscalations(empresaId);
    res.json({ count });
  } catch (error) {
    sendAuthError(res, error);
  }
});

router.post('/api/ai/reply', async (req: Request, res: Response) => {
  const { jid } = req.body;

  if (!jid) {
    res.status(400).json({ error: 'Campo "jid" é obrigatório.' });
    return;
  }

  try {
    const empresaId = await requireEmpresaId(req);
    const reply = await generateAndSendReply(jid, empresaId);
    if (reply) {
      res.json({ ok: true, reply });
    } else {
      res.status(500).json({ error: 'Não foi possível gerar a resposta.' });
    }
  } catch (error) {
    sendAuthError(res, error);
  }
});

/**
 * POST /api/sessions/:jid/auto-reply — Toggle auto-reply for a session.
 * Body: { enabled: boolean }
 */
router.post('/api/sessions/:jid/auto-reply', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const { enabled } = req.body;
    await setAutoReply(req.params.jid, !!enabled, empresaId);
    res.json({ ok: true });
  } catch (error) {
    sendAuthError(res, error);
  }
});

router.post('/api/sessions/:jid/read', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    await markSessionAsRead(req.params.jid, empresaId);
    res.json({ ok: true });
  } catch (error) {
    sendAuthError(res, error);
  }
});

// Mark a specific WhatsApp message as read (requires the WA message ID, not the DB UUID)
router.post('/api/sessions/:jid/mark-read', async (req: Request, res: Response) => {
  const { messageId } = req.body as { messageId?: string };
  if (!messageId) {
    res.status(400).json({ error: 'Campo obrigatório: messageId.' });
    return;
  }
  try {
    const empresaId = await requireEmpresaId(req);
    await markWhatsAppMessageAsRead(req.params.jid, messageId, empresaId);
    res.json({ ok: true });
  } catch (error) {
    sendAuthError(res, error);
  }
});

router.delete('/api/sessions/:jid', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    await deleteSession(req.params.jid, empresaId);
    res.json({ ok: true });
  } catch (error) {
    sendAuthError(res, error);
  }
});

/**
 * POST /api/ai/generate-instructions — Generates a starter master prompt for the agent.
 * Uses the business profile on the server so a blank textarea can be filled with one click.
 * Body: { hint?: string } — optional extra guidance from the user.
 */
router.post('/api/ai/generate-instructions', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const { hint } = (req.body ?? {}) as { hint?: string };
    const cfg = getConfig(empresaId);

    const openai = getAI();
    const systemInstruction = `Você é um engenheiro de prompts. Sua tarefa é escrever DIRETRIZES OPERACIONAIS (NÃO uma mensagem de boas-vindas, NÃO uma resposta ao cliente) que serão usadas como system prompt de um agente de IA que atende clientes de uma lanchonete brasileira no WhatsApp.

O QUE VOCÊ DEVE ESCREVER:
Uma lista de regras de comportamento em segunda pessoa ("Seja ...", "Responda ...", "Escale ...", "Nunca ..."), curta e direta, 6 a 12 linhas, entre 300 e 900 caracteres.

EXEMPLO DE FORMATO ESPERADO (imite este estilo de imperativos):
Seja simpático, direto e informal — tom de WhatsApp brasileiro, com emojis moderados.
Mantenha respostas curtas (1-3 frases).
Sempre colete nome, produto, quantidade, data e horário de retirada antes de confirmar encomendas.
Se o cliente demonstrar frustração, raiva ou pedir explicitamente para falar com uma pessoa, escale para atendimento humano.
Nunca invente preços, horários ou produtos que não estejam no cardápio.
Confirme os dados do pedido no final, repetindo-os, antes de finalizar.

REGRAS DE SAÍDA:
- Escreva APENAS as diretrizes, uma por linha, em imperativo.
- NUNCA escreva uma saudação, apresentação ou mensagem dirigida ao cliente (ex: "Oi!", "Bem-vindo", "Estou aqui pra te ajudar").
- NÃO use Markdown (sem "#", "-", "*", "•").
- NÃO use aspas envolvendo o texto, sem preâmbulos tipo "Aqui estão:".
- Se a lanchonete tiver nome/especialidade, pode mencionar no contexto da diretriz (ex: "Represente a padaria X com orgulho"), mas o foco é COMO se comportar, não O QUE falar.`;

    const userContext = `Contexto da lanchonete (use só para ajustar tom e foco das diretrizes):
Nome: ${cfg.name || 'não informado'}
Especialidade: ${cfg.specialty || 'não informada'}
${hint ? `\nPedido extra do dono: ${hint}` : ''}

Escreva agora as diretrizes operacionais do agente.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.85,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userContext },
      ],
    });

    const content = response.choices[0]?.message?.content?.trim() || '';
    res.json({ instructions: content });
  } catch (error) {
    if (error instanceof Error && (error.message === 'UNAUTHORIZED' || error.message === 'EMPRESA_NOT_FOUND')) {
      sendAuthError(res, error);
      return;
    }
    console.error('[AI Generate Instructions] Error:', error);
    res.status(500).json({ error: 'Falha ao gerar instruções.' });
  }
});

/**
 * POST /api/ai/complete — Proxy for frontend AI calls. Requires auth.
 * Body: { messages: array, temperature?: number, responseFormat?: 'json' }
 */
router.post('/api/ai/complete', async (req: Request, res: Response) => {
  const { messages, temperature = 0.7, responseFormat } = req.body;

  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: 'Campo "messages" é obrigatório e deve ser um array.' });
    return;
  }

  try {
    await requireEmpresaId(req);
    const openai = getAI();
    const params: ChatCompletionCreateParamsNonStreaming = {
      model: 'gpt-4o-mini',
      messages,
      temperature,
    };
    if (responseFormat === 'json') {
      params.response_format = { type: 'json_object' };
    }
    const response = await openai.chat.completions.create(params);
    res.json({ content: response.choices[0].message.content });
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === 'UNAUTHORIZED' || error.message === 'EMPRESA_NOT_FOUND')) {
      sendAuthError(res, error);
      return;
    }
    console.error('[AI Proxy] Error:', error);
    res.status(500).json({ error: 'AI request failed' });
  }
});

router.get('/api/sessions/:jid/profile-picture', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const url = await fetchProfilePicture(req.params.jid, empresaId);
    res.json({ url });
  } catch (error) {
    sendAuthError(res, error);
  }
});

router.patch('/api/sessions/:jid/name', async (req: Request, res: Response) => {
  const { name } = req.body as { name?: string };
  if (!name?.trim()) {
    res.status(400).json({ error: 'Nome não pode ser vazio.' });
    return;
  }

  try {
    const empresaId = await requireEmpresaId(req);
    await updateSessionName(req.params.jid, name, empresaId);
    res.json({ ok: true });
  } catch (error) {
    sendAuthError(res, error);
  }
});

/**
 * GET /api/produtos — Proxy para zelopdv.com.br (evita CORS no frontend).
 * Requer Authorization: Bearer <token> — repassa diretamente para a API.
 */
router.get('/api/produtos', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ error: 'Authorization header ausente.' });
    return;
  }

  try {
    const onlyVisible = req.query.onlyVisible ?? 'true';
    const url = new URL('https://www.zelopdv.com.br/api/produtos');
    url.searchParams.set('onlyVisible', String(onlyVisible));

    const upstream = await axios.get(url.toString(), {
      headers: { Authorization: authHeader, Accept: 'application/json' },
    });

    res.json(upstream.data);
  } catch (err: any) {
    const status = err?.response?.status ?? 502;
    const msg = err?.response?.data?.error ?? err?.message ?? 'Upstream error';
    res.status(status).json({ error: msg });
  }
});

/**
 * POST /api/sync-config — Syncs business config from the frontend per-empresa. Requires auth.
 */
router.post('/api/sync-config', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const { name, specialty, hours, closedDays, address, pixKey,
            products, catalogHierarchy, blockedDates, dailyContext, aiInstructions, managerPhone,
            aiEnabled, aiCanReengagePending, deliveryConfig } = req.body;
    setConfig(empresaId, { name, specialty, hours, closedDays, address, pixKey,
                           products, catalogHierarchy, blockedDates, dailyContext, aiInstructions, managerPhone,
                           ...(typeof aiEnabled === 'boolean' ? { aiEnabled } : {}),
                           ...(typeof aiCanReengagePending === 'boolean' ? { aiCanReengagePending } : {}),
                           ...(deliveryConfig !== undefined ? { deliveryConfig } : {}) });
    if (typeof aiCanReengagePending === 'boolean') {
      try {
        await getServiceSupabase()
          .from('empresa_perfil')
          .update({ ai_can_reengage_pending: aiCanReengagePending, updated_at: new Date().toISOString() })
          .eq('id', empresaId);
      } catch (err) {
        console.warn('[Router] ai_can_reengage_pending persist failed (column missing?):', err);
      }
    }
    res.json({ ok: true });
  } catch (error) {
    sendAuthError(res, error);
  }
});

// ─── Validate WhatsApp numbers ────────────────────────────────────────────────

router.post('/api/whatsapp/validate-numbers', async (req: Request, res: Response) => {
  const { numbers } = req.body as { numbers?: string[] };
  if (!Array.isArray(numbers) || numbers.length === 0) {
    res.status(400).json({ error: 'Campo "numbers" é obrigatório e deve ser um array.' });
    return;
  }
  if (numbers.length > 50) {
    return res.status(400).json({ error: 'Máximo de 50 números por consulta.' });
  }
  try {
    const empresaId = await requireEmpresaId(req);
    const result = await validateWhatsAppNumbers(numbers, empresaId);
    res.json({ result });
  } catch (error) {
    sendAuthError(res, error);
  }
});

// ─── Send interactive list ────────────────────────────────────────────────────

router.post('/api/send/list', async (req: Request, res: Response) => {
  const { to, title, description, buttonText, footerText, sections } = req.body ?? {};
  if (!to || !description || !buttonText || !Array.isArray(sections)) {
    res.status(400).json({ error: 'Campos obrigatórios: to, description, buttonText, sections.' });
    return;
  }
  try {
    const empresaId = await requireEmpresaId(req);
    await sendListMessage(to, { title, description, buttonText, footerText, sections }, empresaId);
    res.json({ ok: true });
  } catch (error: any) {
    if (error instanceof Error && (error.message === 'UNAUTHORIZED' || error.message === 'EMPRESA_NOT_FOUND')) {
      sendAuthError(res, error);
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

// ─── Send location ────────────────────────────────────────────────────────────

router.post('/api/send/location', async (req: Request, res: Response) => {
  const { to, latitude, longitude, name, address } = req.body ?? {};
  if (!to || latitude == null || longitude == null) {
    res.status(400).json({ error: 'Campos obrigatórios: to, latitude, longitude.' });
    return;
  }
  try {
    const empresaId = await requireEmpresaId(req);
    await sendLocationMessage(to, { latitude, longitude, name, address }, empresaId);
    res.json({ ok: true });
  } catch (error: any) {
    if (error instanceof Error && (error.message === 'UNAUTHORIZED' || error.message === 'EMPRESA_NOT_FOUND')) {
      sendAuthError(res, error);
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

// ─── Send reaction ────────────────────────────────────────────────────────────

router.post('/api/send/reaction', async (req: Request, res: Response) => {
  const { to, messageId, reaction, fromMe } = req.body ?? {};
  if (!to || !messageId || !reaction) {
    res.status(400).json({ error: 'Campos obrigatórios: to, messageId, reaction.' });
    return;
  }
  try {
    const empresaId = await requireEmpresaId(req);
    await sendReaction(to, messageId, reaction, fromMe ?? false, empresaId);
    res.json({ ok: true });
  } catch (error: any) {
    if (error instanceof Error && (error.message === 'UNAUTHORIZED' || error.message === 'EMPRESA_NOT_FOUND')) {
      sendAuthError(res, error);
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

// ─── Send poll ────────────────────────────────────────────────────────────────

router.post('/api/send/poll', async (req: Request, res: Response) => {
  const { to, name, values, selectableCount } = req.body ?? {};
  if (!to || !name || !Array.isArray(values) || values.length === 0) {
    res.status(400).json({ error: 'Campos obrigatórios: to, name, values (array).' });
    return;
  }
  try {
    const empresaId = await requireEmpresaId(req);
    await sendPollMessage(to, { name, values, selectableCount }, empresaId);
    res.json({ ok: true });
  } catch (error: any) {
    if (error instanceof Error && (error.message === 'UNAUTHORIZED' || error.message === 'EMPRESA_NOT_FOUND')) {
      sendAuthError(res, error);
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

// ─── Revoke message ───────────────────────────────────────────────────────────

router.delete('/api/messages/:id', async (req: Request, res: Response) => {
  const { remoteJid, fromMe } = req.body ?? {};
  if (!remoteJid) {
    res.status(400).json({ error: 'Campo obrigatório: remoteJid.' });
    return;
  }
  try {
    const empresaId = await requireEmpresaId(req);
    await revokeMessage(remoteJid, req.params.id, fromMe ?? true, empresaId);
    res.json({ ok: true });
  } catch (error: any) {
    if (error instanceof Error && (error.message === 'UNAUTHORIZED' || error.message === 'EMPRESA_NOT_FOUND')) {
      sendAuthError(res, error);
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

export default router;
