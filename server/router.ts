import { Router, Request, Response } from 'express';
import express from 'express';
import axios from 'axios';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions.js';
import { broadcast } from './ws.js';
import {
  getStatus,
  getQR,
  fetchQR,
  disconnectWhatsApp,
  reconnectWhatsApp,
  sendTextMessage,
  sendPresence,
  sendMediaMessage,
  sendWhatsAppAudio,
  sendContactMessage,
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
  type QuotedContext,
} from './whatsapp.js';
import {
  getSessionsPage,
  getSession,
  addAssistantMessage,
  createAssistantMessageIntent,
  handleOutboundMessage,
  messageExistsByWhatsAppId,
  markAssistantMessageSendFailed,
  markAssistantMessageSendSucceeded,
  updateMessageReaction,
  deleteMessageByWhatsAppId,
  updateSessionProfilePic,
  setAutoReply,
  markSessionAsRead,
  markSessionsAsRead,
  archiveSessions,
  setSessionPinned,
  deleteSession,
  updateSessionName,
  formatPhone,
  serializeForJid,
} from './messageHandler.js';
import {
  generateAndSendReply,
  getAI,
  confirmPendingOrder,
  cancelPendingOrder,
  getPendingOrder,
  pendingOrderRequiresPixReceipt,
  sendPixReceiptRequiredMessage,
  getPublicAppBaseUrl,
} from './ai.js';
import { buildPublicStoreUrl } from '../src/domain/zelomenuSlug.js';
import { simulateAtendimento, type SimulatePayload } from './aiSimulator.js';
import { recordRawWebhookEvent, markWebhookEventProcessed } from './webhookLog.js';
import { redactInstance, redactJid } from './redact.js';
import { getConfig, setConfig, loadAiSettingsFromDb, ensureAiSettingsHydrated } from './configStore.js';
import { checkAiRouteRateLimit, validateAiCompletePayload, validateGenerateInstructionsPayload } from './aiRouteGuards.js';
import { recordAiUsage } from './aiUsage.js';
import { buildAiHealthReport } from './aiHealth.js';
import { runManagerAssistant, validateManagerRequest } from './managerAssistant.js';
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
import { buildDashboardOverview } from './dashboardMetrics.js';
import {
  listTags,
  createTag,
  updateTag,
  deleteTag,
  getSessionTagsFull,
  applyTagToSession,
  removeTagFromSession,
  getAllSessionTagsForEmpresa,
  TagTenantMismatchError,
} from './tags.js';
import {
  acknowledgeSession,
  countOpenEscalations,
  escalateSession,
  listEscalationEvents,
  resolveSession,
} from './escalation.js';
import { extractBearerToken } from './supabase.js';
import { requireEmpresaId, requireEmpresaAndUserId, requireActiveZelochatSubscription, isEmpresaSubscriptionActive, setBoundEmpresaId, uploadMediaForSend, getServiceSupabase } from './supabase.js';
import { sendWelcomePack, runDailyOnboardingFollowup } from './onboardingFollowup.js';
import {
  clearMissingOwnInstanceForEmpresa,
  getEmpresaAndTokenForInstance,
  getOrCreateOwnInstanceForEmpresa,
  setConnectionState,
} from './instanceManager.js';
import { createCheckoutSession, createPortalSession, syncFromStripe, changePlan, setStripeCancelAtPeriodEnd } from './billing.js';
import { parseScheduleFromDescription } from './scheduleParser.js';
import {
  acceptWhatsAppCartReviewSession,
  confirmPublicCartSession,
  getEmpresaZeloMenuSlug,
  getPublicCartSession,
  getPublicStoreBySlug,
  getWhatsAppCartReviewSession,
  getZeloMenuStoreSettings,
  openPublicOrderCartSession,
  openWhatsAppCartSession,
  setEmpresaZeloMenuSlug,
  updatePublicCartSession,
  updateZeloMenuStoreSettings,
} from './zelomenuCartSessions.js';
import { cancelCanonicalOrder, createManualZeloOrder, getCanonicalOrder, LEGACY_CANONICAL_ORDER_SELECT, transitionCanonicalOrder } from './canonicalOrders.js';

// Self-service account deletion grace period (must match the deletion sweeper).
const ACCOUNT_DELETION_GRACE_DAYS = 14;
import { handleCreatePixCharge, handleGetPixStatus, handleAbacatePayWebhook } from './billingPix.js';
import { cancelPendingReply } from './replyDebouncer.js';
import type { ChatAttachment } from '../src/types.js';
import { classifyOrderTransitionError, getOrderTransitionErrorMessage } from '../src/domain/orderTransitionError.js';
import {
  DEFAULT_AI_GLOBAL_MODE,
  normalizeAiGlobalMode,
  normalizeAiScheduleDays,
  normalizeAiScheduleTime,
  type AiGlobalMode,
  type AiScheduleDays,
} from '../src/domain/aiSchedule.js';

const router = Router();

const ORDER_NOTIFICATION_COLUMNS = LEGACY_CANONICAL_ORDER_SELECT;


interface AiSettingsPayload {
  mode: AiGlobalMode;
  scheduleStart: string | null;
  scheduleEnd: string | null;
  scheduleDays: AiScheduleDays | null;
}

function readAiSettingsFromConfig(empresaId: string): AiSettingsPayload {
  const config = getConfig(empresaId);
  return {
    mode: normalizeAiGlobalMode(config.aiMode) ?? DEFAULT_AI_GLOBAL_MODE,
    scheduleStart: normalizeAiScheduleTime(config.aiScheduleStart),
    scheduleEnd: normalizeAiScheduleTime(config.aiScheduleEnd),
    scheduleDays: config.aiScheduleDays ?? null,
  };
}

function getInternalApiKeyFromRequest(req: Request): string {
  const headerKey = req.header('x-zelochat-internal-key')?.trim();
  if (headerKey) return headerKey;
  const auth = extractBearerToken(req);
  return auth?.trim() ?? '';
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function normalizeInternalWhatsAppJid(to: unknown): string {
  if (typeof to !== 'string') throw new Error('INVALID_TO');
  const value = to.trim();
  if (/^\d+@s\.whatsapp\.net$/i.test(value)) return value.toLowerCase();
  const digits = value.replace(/\D/g, '');
  if (!digits) throw new Error('INVALID_TO');
  const withCountry = digits.startsWith('55') ? digits : `55${digits}`;
  if (withCountry.length < 12 || withCountry.length > 13) throw new Error('INVALID_TO');
  return `${withCountry}@s.whatsapp.net`;
}

function serializeInternalSendError(error: unknown): {
  error: string;
  message: string;
  providerStatus?: number;
  providerBody?: unknown;
} {
  if (axios.isAxiosError(error)) {
    const providerStatus = error.response?.status;
    const providerBody = error.response?.data;
    const providerMessage =
      typeof providerBody === 'string'
        ? providerBody
        : typeof providerBody?.message === 'string'
          ? providerBody.message
          : typeof providerBody?.error === 'string'
            ? providerBody.error
            : error.message;

    return {
      error: 'INTERNAL_WHATSAPP_SEND_FAILED',
      message: providerMessage || 'Falha ao enviar mensagem pelo provedor de WhatsApp.',
      ...(providerStatus ? { providerStatus } : {}),
      ...(providerBody ? { providerBody } : {}),
    };
  }

  return {
    error: 'INTERNAL_WHATSAPP_SEND_FAILED',
    message: error instanceof Error ? error.message : String(error || 'Falha ao enviar mensagem.'),
  };
}

function serializeManualSendError(error: unknown): {
  error: string;
  message: string;
  providerStatus?: number;
  providerMessage?: string;
} {
  if (axios.isAxiosError(error)) {
    const providerStatus = error.response?.status;
    const providerBody = error.response?.data;
    const providerMessage =
      typeof providerBody === 'string'
        ? providerBody
        : typeof providerBody?.message === 'string'
          ? providerBody.message
          : typeof providerBody?.error === 'string'
            ? providerBody.error
            : error.message;

    return {
      error: 'WHATSAPP_SEND_FAILED',
      message: 'Não foi possível enviar a mensagem pelo WhatsApp agora. Verifique se o WhatsApp está conectado e tente novamente.',
      ...(providerStatus ? { providerStatus } : {}),
      ...(providerMessage ? { providerMessage } : {}),
    };
  }

  return {
    error: 'WHATSAPP_SEND_FAILED',
    message: 'Não foi possível confirmar o envio pelo WhatsApp agora. Tente novamente em alguns instantes.',
    providerMessage: error instanceof Error ? error.message : String(error || 'Falha ao enviar mensagem.'),
  };
}

async function resolveTechneEmpresaProfile(): Promise<{ id: string; internalKeyHash: string | null }> {
  const fromEnv = (process.env.TECHNE_EMPRESA_ID || '').trim();
  if (fromEnv) {
    const { data, error } = await getServiceSupabase()
      .from('empresa_perfil')
      .select('id, zelochat_internal_send_key_hash')
      .eq('id', fromEnv)
      .maybeSingle();
    if (error) throw error;
    const row = data as { id?: string; zelochat_internal_send_key_hash?: string | null } | null;
    if (!row?.id) throw new Error('TECHNE_EMPRESA_NOT_FOUND');
    return { id: row.id, internalKeyHash: row.zelochat_internal_send_key_hash ?? null };
  }

  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('empresa_perfil')
    .select('id, zelochat_internal_send_key_hash')
    .eq('zelochat_mode', 'general')
    .limit(2);

  if (error) throw error;
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  if (rows.length > 1) throw new Error('TECHNE_EMPRESA_AMBIGUOUS');
  const row = rows[0] as { id?: string; zelochat_internal_send_key_hash?: string | null } | undefined;
  if (!row?.id) throw new Error('TECHNE_EMPRESA_NOT_FOUND');
  return { id: row.id, internalKeyHash: row.zelochat_internal_send_key_hash ?? null };
}

async function requireInternalApiKey(req: Request): Promise<string> {
  const received = getInternalApiKeyFromRequest(req);
  if (!received) throw new Error('UNAUTHORIZED');

  const profile = await resolveTechneEmpresaProfile();
  const configured = (process.env.ZELOCHAT_INTERNAL_API_KEY || process.env.TECHNE_INTERNAL_API_KEY || '').trim();
  if (configured && safeEqualString(received, configured)) return profile.id;

  if (profile.internalKeyHash && safeEqualString(sha256Hex(received), profile.internalKeyHash)) {
    return profile.id;
  }

  if (!configured && !profile.internalKeyHash) throw new Error('INTERNAL_API_NOT_CONFIGURED');
  throw new Error('UNAUTHORIZED');
}

// JIDs that recently had a button action handled — used to suppress duplicate text events
// that WhatsApp/Whatsmiau sends for the same button click (within 5-second window)
const recentlyHandled = new Map<string, number>();

setInterval(() => {
  const cutoff = Date.now() - 10_000;
  for (const [jid, ts] of recentlyHandled) {
    if (ts < cutoff) recentlyHandled.delete(jid);
  }
}, 30_000);

/**
 * POST /internal/whatsapp/send-text
 * Server-to-server endpoint for Techne systems to send a simple WhatsApp text
 * through the Techne ZeloChat instance. Auth uses ZELOCHAT_INTERNAL_API_KEY
 * (or legacy TECHNE_INTERNAL_API_KEY), not a user JWT.
 */
router.post('/internal/whatsapp/send-text', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireInternalApiKey(req);
    const { to, message } = req.body as { to?: unknown; message?: unknown };
    const jid = normalizeInternalWhatsAppJid(to);
    const text = typeof message === 'string' ? message.trim() : '';
    if (!text) {
      res.status(400).json({ error: 'MESSAGE_REQUIRED' });
      return;
    }
    if (text.length > 4000) {
      res.status(400).json({ error: 'MESSAGE_TOO_LONG' });
      return;
    }

    const instance = await getOrCreateOwnInstanceForEmpresa(empresaId);
    const connectionState = await fetchInstanceConnectionState(instance);
    if (connectionState !== 'connected') {
      res.status(409).json({ error: 'TECHNE_WHATSAPP_NOT_CONNECTED' });
      return;
    }

    const intent = await createAssistantMessageIntent(jid, text, empresaId);
    try {
      const waMessageId = await sendTextMessage(jid, text, empresaId);
      await markAssistantMessageSendSucceeded(empresaId, intent.id, waMessageId).catch((markError) => {
        console.warn('[Router] Internal WhatsApp sent, but failed to mark DB message as sent:', markError);
      });
      res.json({ ok: true, empresaId, to: jid, messageId: waMessageId ?? null, dbMessageId: intent.id });
    } catch (sendError) {
      const payload = serializeInternalSendError(sendError);
      await markAssistantMessageSendFailed(empresaId, intent.id, payload.message).catch((markError) => {
        console.warn('[Router] Failed to mark internal WhatsApp send as failed:', markError);
      });
      console.error('[Router] Internal WhatsApp provider send error:', sendError);
      res.status(502).json(payload);
    }
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'UNKNOWN';
    if (message === 'UNAUTHORIZED') {
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }
    if (message === 'INTERNAL_API_NOT_CONFIGURED') {
      res.status(503).json({ error: 'INTERNAL_API_NOT_CONFIGURED' });
      return;
    }
    if (message === 'INVALID_TO' || message === 'MESSAGE_REQUIRED' || message === 'MESSAGE_TOO_LONG') {
      res.status(400).json({ error: message });
      return;
    }
    if (message === 'TECHNE_EMPRESA_NOT_FOUND') {
      res.status(404).json({ error: 'TECHNE_EMPRESA_NOT_FOUND' });
      return;
    }
    if (message === 'TECHNE_EMPRESA_AMBIGUOUS') {
      res.status(503).json({ error: message });
      return;
    }
    if (message === 'TECHNE_WHATSAPP_NOT_CONNECTED') {
      res.status(409).json({ error: message });
      return;
    }
    console.error('[Router] Internal WhatsApp send error:', error);
    res.status(500).json({ error: 'INTERNAL_WHATSAPP_SEND_FAILED' });
  }
});

function safeJsonParse<T = any>(value: string): T | null {
  try { return JSON.parse(value) as T; } catch { return null; }
}

/**
 * 🚨 CRITICAL — webhook event router (multi-tenant boundary)
 *
 * Core webhook event processor — same logic for every entry point. The
 * legacy `/webhook` returns 410 (its singleton-based empresaId resolution
 * was unsafe for multi-tenant); the supported entry is `/webhook/:instance`
 * which resolves empresaId via DB lookup on `empresa_perfil.whatsmiau_instance`.
 *
 * `empresaId` is INVIOLABLE here — it's the tenant boundary. Every persistence
 * call below MUST thread it explicitly. Defaulting to `getBoundEmpresaId()`
 * inside helpers is a known hazard (see CLAUDE.md §"Critical functions to
 * touch with extreme care") — tagged P0.2 in CODE_REVIEW.md.
 *
 * BUTTERFLY EFFECT — what cascades if you mis-attribute messages here:
 *   • Customer A's WhatsApp message lands in Customer B's operator dashboard
 *   • AI replies to Customer A spend Customer B's OpenAI budget
 *   • Order created for Customer B with Customer A's customer_phone
 *   • Privacy + LGPD incident in either direction
 *
 * Hot-path correctness rules:
 *   1. Fail-closed on subscription check (isEmpresaSubscriptionActive)
 *   2. Hard-button + soft-confirm short-circuits run BEFORE the AI dispatch
 *      (see Layer 3 of CLAUDE.md's 3-layer trap)
 *   3. fromMe messages are echoes of our own outbound — handled separately
 *      to avoid double-persisting
 *   4. recentlyHandled deduplication runs against retried webhook deliveries
 *
 * Always test the full webhook → handler → AI chain after changes here.
 */
async function processWebhookEvent(empresaId: string, body: any): Promise<void> {
  const event: string = (body?.event ?? '').toLowerCase().replace(/_/g, '.');
  const data = body?.data;

  console.log(`[WebhookTrace] process start empresa=${empresaId} event=${event || '<empty>'} hasData=${!!data}`);

  if (!data) {
    console.warn(`[WebhookTrace] skip empresa=${empresaId} event=${event || '<empty>'} reason=no_data`);
    return;
  }

  if (event === 'messages.upsert') {
    if (!data.message) {
      console.warn(`[WebhookTrace] skip empresa=${empresaId} event=${event} reason=no_message`);
      return;
    }

    // Block processing for empresas without an active subscription — inbound
    // messages trigger AI inference and Supabase writes, both of which cost money.
    // Fail-open on DB errors so a transient outage never silences a paying customer.
    const subscriptionActive = await isEmpresaSubscriptionActive(empresaId);
    if (!subscriptionActive) {
      console.warn(`[WebhookTrace] skip empresa=${empresaId} event=${event} reason=subscription_inactive`);
      return;
    }

    // Messages sent from the operator's phone (not via the app). Save them so the
    // conversation history stays complete. Skip multi-device protocol artifacts and
    // any message already saved by /api/send (identified by its Whatsmiau key id).
    if (data.key?.fromMe) {
      if (data.message?.deviceSentMessage) {
        console.log(`[WebhookTrace] skip empresa=${empresaId} event=${event} reason=from_me_device_sent`);
        return;
      }
      const msgId: string = data.key?.id ?? '';
      if (msgId && wasSentByServer(msgId) && await messageExistsByWhatsAppId(empresaId, msgId)) {
        console.log(`[WebhookTrace] skip empresa=${empresaId} event=${event} reason=from_me_echo_known messageId=${msgId}`);
        return;
      }
      const remoteJid: string = data.key?.remoteJid ?? '';
      if (!remoteJid.endsWith('@s.whatsapp.net')) {
        console.log(`[WebhookTrace] skip empresa=${empresaId} event=${event} jid=${redactJid(remoteJid)} reason=from_me_non_individual`);
        return;
      }
      console.log(`[WebhookTrace] from_me_persist empresa=${empresaId} jid=${redactJid(remoteJid)} messageId=${msgId || '<missing>'}`);
      handleOutboundMessage(data, empresaId).catch((err) =>
        console.error('[Webhook] fromMe persist failed:', err),
      );
      return;
    }

    // Secondary guard: outbound messages wrapped by multi-device protocol
    if (data.message?.deviceSentMessage) {
      console.log(`[WebhookTrace] skip empresa=${empresaId} event=${event} reason=device_sent_message`);
      return;
    }
    const remoteJid: string = data.key?.remoteJid ?? '';
    if (remoteJid === 'status@broadcast') {
      console.log(`[WebhookTrace] skip empresa=${empresaId} event=${event} reason=status_broadcast`);
      return;
    }
    if (remoteJid.endsWith('@g.us')) {
      console.log(`[WebhookTrace] skip empresa=${empresaId} event=${event} jid=${redactJid(remoteJid)} reason=group_message`);
      return;
    }
    if (remoteJid.endsWith('@broadcast')) {
      console.log(`[WebhookTrace] skip empresa=${empresaId} event=${event} jid=${redactJid(remoteJid)} reason=broadcast_list`);
      return;
    }
    if (!remoteJid.endsWith('@s.whatsapp.net')) {
      console.log(`[WebhookTrace] skip empresa=${empresaId} event=${event} jid=${redactJid(remoteJid)} reason=non_individual_jid`);
      return;
    }
    const botJid = getOwnJid();
    if (botJid && remoteJid === botJid) {
      console.log(`[WebhookTrace] skip empresa=${empresaId} event=${event} jid=${redactJid(remoteJid)} reason=own_jid`);
      return;
    }

    console.log(`[WebhookTrace] inbound_candidate empresa=${empresaId} jid=${redactJid(remoteJid)} messageId=${data.key?.id ?? '<missing>'}`);

    // Reactions: update the target message's reactions array instead of saving as text
    const reactionMsg = data.message?.reactionMessage;
    if (reactionMsg) {
      const targetId: string = reactionMsg.key?.id ?? '';
      const emoji: string = reactionMsg.text ?? '';
      const fromMe: boolean = reactionMsg.key?.fromMe ?? false;
      if (targetId) {
        console.log(`[WebhookTrace] reaction empresa=${empresaId} jid=${redactJid(remoteJid)} targetId=${targetId} fromMe=${fromMe}`);
        updateMessageReaction({ empresaId, targetWaMessageId: targetId, emoji, fromMe }).catch(
          (err) => console.error('[Webhook] reaction update failed:', err),
        );
      }
      return;
    }

    const interactiveParams = data.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
    const interactiveId = interactiveParams
      ? safeJsonParse<{ id?: string }>(interactiveParams)?.id ?? ''
      : '';
    const buttonId: string =
      data.message?.buttonsResponseMessage?.selectedButtonId ??
      data.message?.templateButtonReplyMessage?.selectedId ??
      interactiveId ?? '';

    const buttonDisplayText = data.message?.buttonsResponseMessage?.selectedDisplayText;
    const interactiveText = data.message?.interactiveResponseMessage?.body?.text ?? '';
    const msgText = (
      data.message?.conversation ??
      data.message?.extendedTextMessage?.text ??
      buttonDisplayText ??
      interactiveText ?? ''
    ).trim();

    // "Hard" button click: an explicit button-id from Whatsmiau OR plain text that
    // matches a button label we sent. These MUST short-circuit the AI even
    // when no pending order exists — otherwise the AI re-interprets "✅ Confirmar"
    // as the customer placing a new order and creates a duplicate.
    //
    // P1.15 — antes era exact-match em "✅ Confirmar" / "❌ Cancelar". Whatsmiau
    // (e clientes WhatsApp diferentes) variam:
    //   • "✅Confirmar" (sem espaço)
    //   • "Confirmar ✅" (emoji no fim)
    //   • "CONFIRMAR" (alguns templates uppercase)
    //   • VS16 variations (U+2705 vs U+2705+U+FE0F)
    //   • smart-quote period: "Confirmar."
    // Cada miss fazia o texto cair no AI como freeform input → AI achava que
    // era um pedido novo → duplicate-order bug. Agora normalizamos accent +
    // case + emoji + punct e checamos se o token "confirmar"/"cancelar" está
    // presente.
    const buttonTextNormalized = msgText
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Mn}/gu, '')          // strip combining accents
      .replace(/[\p{S}\p{P}\s]+/gu, ' ') // collapse symbols/emoji/punct/whitespace
      .trim();
    // Match only exact button labels/tokens. Natural text such as
    // "confirmar mais tarde?" or "cancelar só a coca" is an edit/question, not
    // consent to confirm/cancel the whole order.
    const isConfirmText = buttonTextNormalized === 'confirmar'
      || buttonTextNormalized === 'confirm order'
      || buttonTextNormalized === 'confirmar pedido';
    const isCancelText = buttonTextNormalized === 'cancelar'
      || buttonTextNormalized === 'cancel order'
      || buttonTextNormalized === 'cancelar pedido';

    const isHardConfirm = buttonId === 'CONFIRM_ORDER' || isConfirmText;
    const isHardCancel = buttonId === 'CANCEL_ORDER' || isCancelText;

    if (isHardConfirm || isHardCancel) {
      // ──────────────────────────────────────────────────────────────────
      // CRITICAL — order confirmation hard-button path
      // ──────────────────────────────────────────────────────────────────
      // Serialize through the same per-JID queue used by `handleIncomingMessage`
      // so a button click and a parallel inbound text (or a webhook retry of
      // the same click) cannot both pass the `getPendingOrder` check before
      // either has called `clearPendingOrder`. Without the queue, two
      // concurrent confirms can both insert the order — the original
      // duplicate-order bug, see CLAUDE.md §"Order confirmation flow".
      //
      // BUTTERFLY EFFECT: this is Layer 3 of the 3-layer trap. If you change
      // the short-circuit logic here, a button click can leak into the AI as
      // freeform input → AI calls `criar_pedido` from scratch → duplicate order
      // → customer gets billed twice. Always re-test the duplicate-order
      // scenario from the issue history before merging changes here.
      // ──────────────────────────────────────────────────────────────────
      await serializeForJid(remoteJid, async () => {
        const handledKey = `${empresaId}:${remoteJid}`;
        // P0.13 — Whatsmiau retries deliver the same button click 2-3 times
        // when ack is slow. Without retry detection in the no-pending branch
        // below, the customer received 2-3 copies of "Seu pedido já foi
        // confirmado!". We capture the prior marker BEFORE overwriting so we
        // can tell "first delivery" from "retry of a click we already
        // processed" and short-circuit silently on retries.
        const prevHandledAt = recentlyHandled.get(handledKey);
        const isRetry = !!prevHandledAt && Date.now() - prevHandledAt < 5000;
        recentlyHandled.set(handledKey, Date.now()); // block duplicate events for 5s
        if (isRetry) {
          console.log(`[Webhook] hard-button retry suppressed for ${remoteJid} (prev ${Date.now() - prevHandledAt}ms ago)`);
          return;
        }

        const pending = await getPendingOrder(remoteJid, empresaId);
        if (pending) {
          try {
            if (isHardConfirm) {
              if (pendingOrderRequiresPixReceipt(pending)) {
                await sendPixReceiptRequiredMessage(remoteJid, empresaId);
              } else {
                await confirmPendingOrder(remoteJid, empresaId);
              }
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
            const waMessageId = await sendTextMessage(remoteJid, ack, empresaId);
            await addAssistantMessage(remoteJid, ack, undefined, empresaId, undefined, { waMessageId });
          } catch (err) {
            console.error('[Webhook] idempotent confirm reply failed:', err);
          }
        }
      });
      // A definitive button interaction supersedes any pending debounced reply.
      // Without this, a "oi" arriving 5s before the click would still fire the
      // AI 5s after — customer sees the order ack AND a redundant greeting.
      cancelPendingReply(empresaId, remoteJid);
      return;
    }

    // Soft confirmation keywords (Sim/Não and short forms) — used when buttons
    // can't be sent and the AI fell back to a plain-text prompt. Only act on
    // these when a pending order is actually waiting; otherwise let the AI
    // process them naturally (e.g. "Sim" answering an unrelated question).
    if (msgText) {
      // P1.21 — antes a normalização fazia `.replace(/[^a-z]/g, '')` que
      // colapsa "10s" → "s" e "uns 10min" → "smin" (depois "s" se truncasse).
      // Customer escrevendo "5min" virava confirmação de pedido. Agora
      // strip apenas acentos + trailing whitespace/punct e checa exact-match
      // contra um whitelist mínimo, igual ao approach do P0.9/P0.10 em ai.ts.
      const normalized = msgText
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Mn}/gu, '')
        .replace(/[\s\p{P}\p{S}]+$/u, '')
        .trim();
      const isSoftConfirm = normalized === 'sim' || normalized === 's';
      const isSoftCancel = normalized === 'nao' || normalized === 'n';
      if (isSoftConfirm || isSoftCancel) {
        // Serialize through the per-JID queue (see hard-confirm block above).
        // Without this, a soft "Sim" arriving while a button click is in-flight
        // can read the same pending row and trigger a second confirm.
        const handled = await serializeForJid(remoteJid, async () => {
          const pending = await getPendingOrder(remoteJid, empresaId);
          if (!pending) return false;
          recentlyHandled.set(`${empresaId}:${remoteJid}`, Date.now());
          try {
            if (isSoftConfirm) {
              if (pendingOrderRequiresPixReceipt(pending)) {
                await sendPixReceiptRequiredMessage(remoteJid, empresaId);
              } else {
                await confirmPendingOrder(remoteJid, empresaId);
              }
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
        if (handled) {
          // Soft confirm/cancel resolved a real pending order — same logic as
          // the hard-button branch: kill any debounced reply for this contact.
          cancelPendingReply(empresaId, remoteJid);
          return;
        }
      }
    }

    // Suppress any further duplicate events within 5 seconds of a button action
    const handledTs = recentlyHandled.get(`${empresaId}:${remoteJid}`);
    if (handledTs) {
      if (Date.now() - handledTs < 5000) {
        console.log(`[WebhookTrace] skip empresa=${empresaId} jid=${redactJid(remoteJid)} reason=recently_handled ageMs=${Date.now() - handledTs}`);
        return;
      }
      recentlyHandled.delete(`${empresaId}:${remoteJid}`);
    }

    console.log(`[WebhookTrace] dispatchIncomingMessage empresa=${empresaId} jid=${redactJid(remoteJid)} messageId=${data.key?.id ?? '<missing>'}`);
    dispatchIncomingMessage(data, empresaId);
  } else if (event === 'connection.update') {
    console.log(`[WebhookTrace] connection.update empresa=${empresaId} state=${data?.state ?? data?.instance?.state ?? '<unknown>'}`);
    handleConnectionUpdate(data, empresaId);
  } else if (event === 'messages.update') {
    console.log(`[WebhookTrace] messages.update empresa=${empresaId} count=${Array.isArray(data) ? data.length : 1}`);
    // Delivery / read receipts — broadcast to frontend so it can update message ticks.
    // P2.16 — Guard: only broadcast if the payload carries a remoteJid that indicates
    // this update belongs to the resolved empresa. The empresaId itself is already
    // validated at the webhook entry point (/webhook/:instance → DB lookup), but a
    // malformed or cross-tenant payload could carry a mismatched empresa_id in its
    // metadata. If empresa_id is present in the payload, assert it matches; otherwise
    // require at minimum a valid remoteJid (non-empty, individual chat) before
    // broadcasting.
    const updates = Array.isArray(data) ? data : [data];
    for (const u of updates) {
      if (!u?.keyId && !u?.messageId) continue;
      // If the payload includes an empresa_id field, verify it matches the resolved empresa.
      if (u.empresa_id && u.empresa_id !== empresaId) {
        console.warn('[Webhook] messages.update: payload empresa_id mismatch — expected', empresaId, 'got', u.empresa_id, '— skipping broadcast');
        continue;
      }
      // Require a valid individual-chat JID; skip if missing or group/broadcast.
      const remoteJid: string = u.remoteJid ?? '';
      if (!remoteJid || !remoteJid.endsWith('@s.whatsapp.net')) continue;
      broadcast(
        {
          type: 'message_status',
          data: {
            messageId: u.keyId ?? u.messageId,
            remoteJid,
            status: u.status, // 'DELIVERY_ACK' | 'READ'
          },
        },
        empresaId,
      );
    }
  } else if (event === 'messages.delete') {
    console.log(`[WebhookTrace] messages.delete empresa=${empresaId} count=${Array.isArray(data) ? data.length : 1}`);
    const deletions = Array.isArray(data) ? data : [data];
    for (const d of deletions) {
      const messageId = d?.id ?? d?.key?.id ?? d?.messageId;
      const remoteJid = d?.remoteJid ?? d?.key?.remoteJid ?? '';
      if (!messageId || !remoteJid || !remoteJid.endsWith('@s.whatsapp.net')) continue;
      await deleteMessageByWhatsAppId({
        empresaId,
        jid: remoteJid,
        waMessageId: messageId,
      });
    }
  } else if (event === 'contacts.upsert') {
    console.log(`[WebhookTrace] contacts.upsert empresa=${empresaId} count=${Array.isArray(data) ? data.length : 1}`);
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
  } else {
    console.warn(`[WebhookTrace] unhandled event empresa=${empresaId} event=${event || '<empty>'}`);
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
 * `empresa_perfil.whatsmiau_instance = :instance`.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * CRITICAL — webhook authentication (P0.1)
 * ──────────────────────────────────────────────────────────────────────────
 * Authentication runs in TWO LAYERS:
 *
 *   1. URL path: the instance name in the path is a per-tenant identifier.
 *      It's not strictly a secret (it appears in Whatsmiau's dashboard, our
 *      logs, error reports), so we don't rely on it alone.
 *
 *   2. webhook_token: accepted from `apikey` / `x-webhook-token` headers or
 *      `?token=` query param. The query param exists because Whatsmiau v2 has
 *      historically accepted custom header config without forwarding those
 *      headers on delivery. Webhook registration now includes the token in
 *      the configured URL, so the route fails closed by default.
 *
 * Emergency rollout lever: WEBHOOK_REQUIRE_TOKEN=1 enforces strict token auth.
 * While the fleet is being re-registered, missing tokens are accepted for a
 * known instance, but mismatched tokens are always rejected.
 *
 * BUTTERFLY EFFECT: changes here cascade to (a) the AI dispatch — a forged
 * webhook can inject prompts into the AI; (b) the order pipeline — fake
 * confirmations create real zelochat_orders rows; (c) the operator's chat
 * UI — fake messages appear as if from real customers; (d) OpenAI quota —
 * attacker-controlled prompts spend our money. ALWAYS test the full
 * webhook → AI → order chain after touching this handler.
 * ──────────────────────────────────────────────────────────────────────────
 */
router.post('/webhook/:instance', async (req: Request, res: Response) => {
  const instance = req.params.instance?.trim();
  const bodyEvent = String(req.body?.event ?? '').toLowerCase().replace(/_/g, '.');
  const bodyMessageId = req.body?.data?.key?.id ?? req.body?.data?.id ?? '<missing>';
  console.log(`[WebhookTrace] received instance=${redactInstance(instance)} event=${bodyEvent || '<empty>'} messageId=${bodyMessageId}`);
  if (!instance) {
    console.warn('[WebhookTrace] reject reason=missing_instance');
    res.status(400).json({ error: 'missing instance' });
    return;
  }
  const ctx = await getEmpresaAndTokenForInstance(instance);
  if (!ctx) {
    console.warn(`[WebhookTrace] reject instance=${redactInstance(instance)} event=${bodyEvent || '<empty>'} reason=unknown_instance`);
    res.status(404).json({ error: 'unknown instance' });
    return;
  }
  const { empresaId, webhookToken } = ctx;

  // Webhook token auth (P0.1): fail closed by default. We accept either a
  // header or query token because Whatsmiau has not reliably forwarded custom
  // headers historically; setWebhookForInstance registers `?token=...`.
  const queryToken = Array.isArray(req.query.token) ? req.query.token[0] : req.query.token;
  const headerToken = (
    (req.headers['apikey'] as string | undefined) ??
    (req.headers['x-webhook-token'] as string | undefined) ??
    (typeof queryToken === 'string' ? queryToken : undefined) ??
    ''
  ).trim();

  const strictWebhookToken = (process.env.WEBHOOK_REQUIRE_TOKEN ?? '').toLowerCase();
  const requireToken = strictWebhookToken === '1' || strictWebhookToken === 'true' || strictWebhookToken === 'yes';

  let authStatus: 'token_match' | 'token_missing' | 'token_mismatch';
  if (headerToken) {
    if (!safeEqualString(headerToken, webhookToken)) {
      console.warn(`[WebhookTrace] reject instance=${redactInstance(instance)} empresa=${empresaId} event=${bodyEvent || '<empty>'} reason=token_mismatch`);
      res.status(401).json({ error: 'invalid webhook token' });
      return;
    }
    authStatus = 'token_match';
  } else if (requireToken) {
    console.warn(`[WebhookTrace] reject instance=${redactInstance(instance)} empresa=${empresaId} event=${bodyEvent || '<empty>'} reason=token_missing_strict`);
    res.status(401).json({ error: 'webhook token required' });
    return;
  } else {
    console.warn(`[WebhookTrace] token missing for known instance=${redactInstance(instance)} empresa=${empresaId}; accepting during webhook registration rollout`);
    authStatus = 'token_missing';
  }

  // Ack the webhook FIRST — Whatsmiau's retry timer starts the moment we
  // accept the body, and the work below (raw log + AI dispatch) can take
  // hundreds of ms. Holding the response open here is what triggered prior
  // double-deliveries.
  res.json({ ok: true });
  console.log(`[WebhookTrace] ack instance=${redactInstance(instance)} empresa=${empresaId} event=${bodyEvent || '<empty>'} auth=${authStatus}`);

  // Defense layer: persist the raw payload BEFORE processing. If
  // processWebhookEvent (or any helper it calls) regresses again like the
  // 2026-04-29 P0.14 incident, we can replay from this log instead of losing
  // the data forever — Whatsmiau exposes no history endpoint. Failures are
  // swallowed inside the helper; processing must continue even if the log
  // insert fails. See server/webhookLog.ts and migration 016.
  // The auth_status column captures whether the apikey header was present
  // and matched, so we can verify Whatsmiau adoption before flipping strict.
  const rawEventId = await recordRawWebhookEvent(instance, empresaId, req.body, authStatus);
  console.log(`[WebhookTrace] raw_event_saved empresa=${empresaId} rawEventId=${rawEventId ?? '<none>'}`);

  let processingError: unknown = null;
  try {
    await processWebhookEvent(empresaId, req.body);
  } catch (err) {
    processingError = err;
    console.error(`[Webhook] processWebhookEvent threw for instance "${redactInstance(instance)}":`, err);
  }
  await markWebhookEventProcessed(rawEventId, processingError);
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

function sendZeloMenuCartError(res: Response, error: unknown): void {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';

  if (message === 'UNAUTHORIZED' || message === 'EMPRESA_NOT_FOUND' || message === 'SUBSCRIPTION_INACTIVE') {
    sendAuthError(res, error);
    return;
  }

  if (message === 'INVALID_REMOTE_JID') {
    res.status(400).json({ error: 'Conversa inválida para abrir o carrinho.' });
    return;
  }

  if (message === 'REVIEW_NOT_READY') {
    res.status(409).json({ error: 'Este pedido ainda não está pronto para entrar na produção.' });
    return;
  }

  if (message === 'REVIEW_NEEDS_ADJUSTMENT') {
    res.status(409).json({ error: 'O pedido precisa de ajuste antes do aceite. Revise estoque, preço ou agenda.' });
    return;
  }

  if (message === 'PIX_RECEIPT_PENDING') {
    res.status(409).json({ error: 'Ainda falta o comprovante Pix antes do aceite.' });
    return;
  }

  if (message === 'PRODUCT_NOT_FOUND') {
    res.status(400).json({ error: 'Um item do carrinho não existe mais no cardápio.' });
    return;
  }

  if (message === 'PRODUCT_UNAVAILABLE') {
    res.status(409).json({ error: 'Um item do carrinho não está disponível no momento.' });
    return;
  }

  if (message === 'PRODUCT_STOCK_EXCEEDED') {
    res.status(409).json({ error: 'A quantidade de um item ultrapassa o estoque atual.' });
    return;
  }

  if (message === 'DELIVERY_DISABLED') {
    res.status(409).json({ error: 'A entrega não está disponível para este carrinho.' });
    return;
  }

  if (message === 'EMPTY_CART') {
    res.status(400).json({ error: 'Adicione pelo menos um item ao pedido.' });
    return;
  }

  if (message === 'CUSTOMER_DETAILS_REQUIRED') {
    res.status(400).json({ error: 'Preencha os dados obrigatórios antes de confirmar o pedido.' });
    return;
  }

  if (message === 'INVALID_SLUG') {
    res.status(400).json({ error: 'Use de 3 a 40 letras, números ou hífens (ex.: casa-dos-salgados).' });
    return;
  }

  if (message === 'RESERVED_SLUG') {
    res.status(409).json({ error: 'Esse endereço é reservado. Escolha outro.' });
    return;
  }

  if (message === 'SLUG_TAKEN') {
    res.status(409).json({ error: 'Esse endereço já está em uso por outra loja. Escolha outro.' });
    return;
  }

  // ZLM-204: bairro fora da tabela não é mais erro — vira taxa "a confirmar"
  // (resolveDeliveryFeeForNeighborhood), então não há mais mapeamento de
  // INVALID_DELIVERY_NEIGHBORHOOD aqui.

  if (message === 'STALE_CART_TOKEN') {
    res.status(409).json({ error: 'Este link do carrinho está desatualizado. Peça um link novo no WhatsApp.' });
    return;
  }

  if (message === 'CART_ALREADY_CONFIRMED') {
    res.status(409).json({ error: 'Este pedido já foi confirmado. Para mudar algo, chame a loja pelo WhatsApp.' });
    return;
  }

  if (message === 'CART_ALREADY_CLOSED') {
    res.status(409).json({ error: 'Este carrinho não pode mais ser confirmado. Chame a loja pelo WhatsApp.' });
    return;
  }

  res.status(500).json({ error: 'Não consegui processar o carrinho agora.' });
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

  if (message === 'REDIRECT_PHONE_REQUIRED') {
    res.status(400).json({ error: 'Informe o número para encaminhar o cliente.' });
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
 * AbacatePay — Pix one-time charges (cobrança transparente).
 * No Stripe subscription involved: each payment activates 30 days of access.
 * Webhook at /api/webhooks/abacatepay is exempt from the paywall middleware
 * (AbacatePay has no JWT) and receives the raw body for HMAC verification.
 */
router.post('/api/billing/pix/create', handleCreatePixCharge);
router.get('/api/billing/pix/status/:paymentId', handleGetPixStatus);
router.post('/api/webhooks/abacatepay', handleAbacatePayWebhook);

/**
 * GET /api/healthz — Always-200 liveness probe. Used by Dokploy's healthcheck
 * (and any other platform via Dockerfile HEALTHCHECK) — must NOT require auth
 * or do any DB / upstream calls so the container can be marked healthy as soon
 * as it can answer HTTP.
 */
router.get('/api/healthz', (_req: Request, res: Response) => {
  res.json({ ok: true, build: 'pix-v1' });
});

/**
 * GET /api/version — Returns this backend's build version.
 *
 * The frontend polls this and compares against the version baked into its
 * own bundle. When they differ (Dokploy rolled out a new build), the
 * UpdateAvailableBanner prompts the operator to refresh. Resolved ONCE at
 * module load — do NOT compute on every request, that would make the
 * frontend think every poll is a new release.
 *
 * Cache-busted aggressively so a CDN/proxy in front of the API never serves
 * a stale version string after a deploy.
 */
const _resolvedEnv = (s: string | undefined) =>
  s && !s.startsWith('${') ? s : undefined;

let _pkgVersion = 'unknown';
try {
  _pkgVersion = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
} catch { /* ignore */ }

const BUILD_VERSION =
  _resolvedEnv(process.env.PUBLIC_APP_VERSION) ||
  _resolvedEnv(process.env.VITE_PUBLIC_APP_VERSION) ||
  _resolvedEnv(process.env.SOURCE_COMMIT) ||
  _resolvedEnv(process.env.GIT_COMMIT_SHA) ||
  _pkgVersion;

router.get('/api/version', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.json({ version: BUILD_VERSION, checkedAt: new Date().toISOString() });
});

async function fetchQrForEmpresaWithMissingInstanceRecovery(empresaId: string) {
  const instance = await getOrCreateOwnInstanceForEmpresa(empresaId);
  await setWebhookForInstance(instance);
  const result = await fetchInstanceQR(instance);

  if (result.upstreamStatus !== 404) return result;

  // FIX 2026-06-05: instância apagada fora do ZeloChat deixava o DB apontando
  // para um nome morto; ao receber 404 no QR, limpamos só esse ponteiro e
  // criamos uma nova instância para o próximo pareamento.
  console.warn(`[WhatsApp] QR instance missing upstream; recreating empresa=${empresaId} instance=${redactInstance(instance)}`);
  const cleared = await clearMissingOwnInstanceForEmpresa(empresaId, instance);
  if (!cleared) return result;

  const replacement = await getOrCreateOwnInstanceForEmpresa(empresaId);
  await setWebhookForInstance(replacement);
  return fetchInstanceQR(replacement);
}

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
    const result = await fetchQrForEmpresaWithMissingInstanceRecovery(empresaId);
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
    const result = await fetchQrForEmpresaWithMissingInstanceRecovery(empresaId);
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
 * GET /api/sessions — Returns a paginated, server-filtered inbox page.
 */
router.get('/api/sessions', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const rawLimit = parseInt(String(req.query.limit ?? '50'), 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null;
    const statusRaw = typeof req.query.status === 'string' ? req.query.status : 'all';
    const status = ['all', 'unread', 'active', 'escalated', 'resolved', 'archived'].includes(statusRaw)
      ? statusRaw as 'all' | 'unread' | 'active' | 'escalated' | 'resolved' | 'archived'
      : 'all';
    const search = typeof req.query.q === 'string' ? req.query.q : null;
    const tagId = typeof req.query.tagId === 'string' ? req.query.tagId : null;
    const page = await getSessionsPage(empresaId, { limit, cursor, status, search, tagId });
    res.json(page);
  } catch (error) {
    sendAuthError(res, error);
  }
});

/** GET /api/sessions/tags-map — all session→tag assignments for the empresa, in one batch. */
router.get('/api/sessions/tags-map', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const map = await getAllSessionTagsForEmpresa(empresaId);
    const obj: Record<string, unknown[]> = {};
    for (const [sessionId, sessionTags] of map) obj[sessionId] = sessionTags;
    res.json({ map: obj });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/**
 * Bulk routes — registered before `/api/sessions/:jid/...` so the `:jid`
 * placeholder never swallows the literal "bulk" segment.
 * Body shape (all three): `{ jids: string[] }`.
 */
function parseBulkJids(body: unknown): string[] | null {
  if (!body || typeof body !== 'object') return null;
  const raw = (body as { jids?: unknown }).jids;
  if (!Array.isArray(raw)) return null;
  const jids = raw.filter((j): j is string => typeof j === 'string' && j.length > 0);
  if (jids.length === 0) return null;
  return jids;
}

router.post('/api/sessions/bulk/read', async (req: Request, res: Response) => {
  const jids = parseBulkJids(req.body);
  if (!jids) {
    res.status(400).json({ error: 'Campo obrigatório: jids (array de JIDs).' });
    return;
  }
  try {
    const empresaId = await requireEmpresaId(req);
    await markSessionsAsRead(jids, empresaId);
    res.json({ ok: true, count: jids.length });
  } catch (error) {
    sendAuthError(res, error);
  }
});

router.post('/api/sessions/bulk/archive', async (req: Request, res: Response) => {
  const jids = parseBulkJids(req.body);
  if (!jids) {
    res.status(400).json({ error: 'Campo obrigatório: jids (array de JIDs).' });
    return;
  }
  try {
    const empresaId = await requireEmpresaId(req);
    await archiveSessions(jids, empresaId);
    res.json({ ok: true, count: jids.length });
  } catch (error) {
    sendAuthError(res, error);
  }
});

router.post('/api/sessions/bulk/delete', async (req: Request, res: Response) => {
  const jids = parseBulkJids(req.body);
  if (!jids) {
    res.status(400).json({ error: 'Campo obrigatório: jids (array de JIDs).' });
    return;
  }
  try {
    const empresaId = await requireEmpresaId(req);
    // Reuse single-session delete to preserve message-cleanup lifecycle.
    for (const jid of jids) {
      await deleteSession(jid, empresaId);
    }
    res.json({ ok: true, count: jids.length });
  } catch (error) {
    sendAuthError(res, error);
  }
});

/**
 * GET /api/sessions/:jid — Returns a specific session with its messages.
 * Query params: limit (number, default 50, max 200), before (ISO timestamp cursor)
 */
router.get('/api/sessions/:jid', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const rawLimit = parseInt(String(req.query.limit ?? '50'), 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;
    const before = typeof req.query.before === 'string' ? req.query.before : undefined;
    const session = await getSession(req.params.jid, empresaId, limit, before);
    if (!session) {
      res.status(404).json({ error: 'Conversa não encontrada' });
      return;
    }
    res.json({ session, hasMore: session.hasMore });
  } catch (error) {
    sendAuthError(res, error);
  }
});

/**
 * GET /api/sessions/:jid/messages — Returns paginated messages for a session (for infinite scroll).
 * Query params: limit (number, default 50, max 200), before (ISO timestamp cursor)
 */
router.get('/api/sessions/:jid/messages', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const rawLimit = parseInt(String(req.query.limit ?? '50'), 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;
    const before = typeof req.query.before === 'string' ? req.query.before : undefined;
    const session = await getSession(req.params.jid, empresaId, limit, before);
    if (!session) {
      res.status(404).json({ error: 'Conversa não encontrada' });
      return;
    }
    res.json({ messages: session.messages, hasMore: session.hasMore });
  } catch (error) {
    sendAuthError(res, error);
  }
});

/**
 * POST /api/send — Sends a text message to a WhatsApp contact.
 * Body: { to: string (jid), message?: string, attachment?: ChatAttachment }
 */
router.post('/api/send', express.json({ limit: '50mb' }), async (req: Request, res: Response) => {
  const { to, message, attachment, quoted } = req.body as {
    to?: string;
    message?: string;
    attachment?: ChatAttachment;
    quoted?: QuotedContext | null;
  };

  if (!to || (!message?.trim() && !attachment)) {
    res.status(400).json({ error: 'Campo "to" e conteúdo da mensagem são obrigatórios.' });
    return;
  }

  try {
    const empresaId = await requireEmpresaId(req);
    const trimmedMessage = message?.trim() ?? '';
    const validQuoted = quoted?.waMessageId ? quoted : null;
    let waMessageId: string | undefined;
    let outboundAttachment = attachment;

    if (attachment?.dataUrl) {
      const mediaUrl = await uploadMediaForSend(
        attachment.dataUrl,
        attachment.fileName,
        attachment.mimeType,
        empresaId,
      );
      outboundAttachment = { ...attachment, dataUrl: mediaUrl };
    }

    const intent = await createAssistantMessageIntent(to, trimmedMessage, empresaId, outboundAttachment, {
      quotedWaId: validQuoted?.waMessageId ?? null,
      quotedFromMe: validQuoted?.fromMe ?? null,
      quotedPreview: validQuoted?.previewText ?? null,
    });

    try {
      if (outboundAttachment?.dataUrl) {
        if (outboundAttachment.type === 'audio') {
          // Audio PTT uses a dedicated endpoint with different params (no mediatype/caption)
          waMessageId = await sendWhatsAppAudio(to, outboundAttachment.dataUrl, empresaId, validQuoted);
        } else {
          waMessageId = await sendMediaMessage(to, {
            mediatype: outboundAttachment.type === 'image' ? 'image' : outboundAttachment.type === 'video' ? 'video' : 'document',
            mimetype: outboundAttachment.mimeType,
            media: outboundAttachment.dataUrl,
            caption: trimmedMessage || undefined,
            fileName: outboundAttachment.fileName,
          }, empresaId, validQuoted);
        }
      } else {
        waMessageId = await sendTextMessage(to, trimmedMessage, empresaId, validQuoted);
      }
      await markAssistantMessageSendSucceeded(empresaId, intent.id, waMessageId ?? null).catch((markError) => {
        console.warn('[Router] WhatsApp sent, but failed to mark DB message as sent:', markError);
      });
      res.json({ ok: true, messageId: waMessageId ?? null, dbMessageId: intent.id });
    } catch (sendError) {
      const payload = serializeManualSendError(sendError);
      await markAssistantMessageSendFailed(empresaId, intent.id, payload.providerMessage ?? payload.message).catch((markError) => {
        console.warn('[Router] Failed to mark WhatsApp send as failed:', markError);
      });
      console.error('[Router] WhatsApp provider send error:', sendError);
      res.status(502).json({
        error: payload.message,
        code: payload.error,
        ...(payload.providerStatus ? { providerStatus: payload.providerStatus } : {}),
      });
    }
  } catch (error: any) {
    if (error instanceof Error && (error.message === 'UNAUTHORIZED' || error.message === 'EMPRESA_NOT_FOUND')) {
      sendAuthError(res, error);
      return;
    }
    console.error('[Router] Send error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/send-contact — Sends a vCard contact to a WhatsApp contact.
 * Body: { to: string (jid), fullName: string, phoneNumber: string, organization?: string }
 */
router.post('/api/send-contact', express.json({ limit: '50kb' }), async (req: Request, res: Response) => {
  const { to, fullName, phoneNumber, organization } = req.body as {
    to?: string;
    fullName?: string;
    phoneNumber?: string;
    organization?: string;
  };

  if (!to || !fullName?.trim() || !phoneNumber?.trim()) {
    res.status(400).json({ error: 'Campos obrigatórios: to, fullName, phoneNumber' });
    return;
  }

  try {
    const empresaId = await requireEmpresaId(req);
    await sendContactMessage(to, { fullName: fullName.trim(), phoneNumber: phoneNumber.trim(), organization: organization?.trim() || undefined }, empresaId);
    await addAssistantMessage(to, `[Contato enviado] ${fullName.trim()}`, undefined, empresaId);
    res.json({ ok: true });
  } catch (error: any) {
    if (error instanceof Error && (error.message === 'UNAUTHORIZED' || error.message === 'EMPRESA_NOT_FOUND')) {
      sendAuthError(res, error);
      return;
    }
    console.error('[Router] Send contact error:', error);
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
    const settings = readAiSettingsFromConfig(empresaId);
    res.json({ enabled: settings.mode !== 'always_off' });
  } catch (error) {
    sendAuthError(res, error);
  }
});

/**
 * GET /api/ai/health — safe per-empresa readiness snapshot for AI operations.
 */
router.get('/api/ai-settings', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    await ensureAiSettingsHydrated(empresaId);
    res.json(readAiSettingsFromConfig(empresaId));
  } catch (error) {
    sendAuthError(res, error);
  }
});

router.get('/api/ai/health', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    await ensureAiSettingsHydrated(empresaId);
    res.json({ health: buildAiHealthReport(getConfig(empresaId)) });
  } catch (error) {
    sendAuthError(res, error);
  }
});

/**
 * POST /api/ai/manager — Backend-owned internal management assistant.
 * The model may suggest actions, but only validated backend actions mutate state.
 */
router.post('/api/ai/manager', express.json({ limit: '128kb' }), async (req: Request, res: Response) => {
  try {
    const { empresaId, userId } = await requireEmpresaAndUserId(req);
    const payload = validateManagerRequest(req.body);
    if (payload.ok === false) {
      res.status(400).json({ error: payload.error });
      return;
    }

    const rateLimit = checkAiRouteRateLimit(empresaId, userId, 'manager');
    if (rateLimit.ok === false) {
      if (rateLimit.retryAfterSeconds) res.set('Retry-After', String(rateLimit.retryAfterSeconds));
      recordAiUsage({ empresaId, feature: 'ai_manager', model: 'gpt-4o-mini', status: 'rate_limited' });
      res.status(rateLimit.status).json({ error: rateLimit.error });
      return;
    }

    await ensureAiSettingsHydrated(empresaId);
    const result = await runManagerAssistant(empresaId, payload.value);
    res.json(result);
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === 'UNAUTHORIZED' || error.message === 'EMPRESA_NOT_FOUND')) {
      sendAuthError(res, error);
      return;
    }
    console.error('[AI Manager] Error:', error);
    res.status(500).json({ error: 'Falha ao processar a gestao por conversa.' });
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
    const mode: AiGlobalMode = enabled ? 'always_on' : 'always_off';
    setConfig(empresaId, { aiEnabled: enabled, aiMode: mode });
    try {
      await getServiceSupabase()
        .from('empresa_perfil')
        .update({ ai_enabled: enabled, ai_mode: mode, updated_at: new Date().toISOString() })
        .eq('id', empresaId);
    } catch (err) {
      console.warn('[Router] ai_enabled/ai_mode persist failed (column missing?):', err);
    }
    broadcast({ type: 'ai_enabled', data: { enabled } }, empresaId);
    res.json({ ok: true, enabled });
  } catch (error) {
    sendAuthError(res, error);
  }
});

router.post('/api/ai-settings', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const mode = normalizeAiGlobalMode(req.body?.mode);
    if (!mode) {
      res.status(400).json({ error: 'Modo da IA inválido.' });
      return;
    }

    const scheduleStart = normalizeAiScheduleTime(req.body?.scheduleStart);
    const scheduleEnd = normalizeAiScheduleTime(req.body?.scheduleEnd);
    const scheduleDays = normalizeAiScheduleDays(req.body?.scheduleDays);

    if (mode === 'scheduled') {
      // Per-day schedule wins. If the operator sent neither a per-day payload
      // nor a usable legacy window, reject so they can't accidentally land in
      // a "scheduled but no schedule" state (the kill-switch would silence
      // every reply, see configStore §"fail-closed posture").
      if (scheduleDays) {
        const hasEnabledDay = (Object.values(scheduleDays) as AiScheduleDays[keyof AiScheduleDays][])
          .some((day) => day.enabled);
        if (!hasEnabledDay) {
          res.status(400).json({ error: 'Habilite pelo menos um dia para a agenda da IA.' });
          return;
        }
      } else if (!scheduleStart || !scheduleEnd || scheduleStart === scheduleEnd) {
        res.status(400).json({ error: 'Informe horários válidos para a agenda da IA.' });
        return;
      }
    }

    const aiEnabled = mode !== 'always_off';
    setConfig(empresaId, {
      aiEnabled,
      aiMode: mode,
      aiScheduleStart: scheduleStart,
      aiScheduleEnd: scheduleEnd,
      aiScheduleDays: scheduleDays,
    });
    const supabase = getServiceSupabase();
    const updatedAt = new Date().toISOString();
    const updateWithDays = await supabase
      .from('empresa_perfil')
      .update({
        ai_enabled: aiEnabled,
        ai_mode: mode,
        ai_schedule_start: scheduleStart,
        ai_schedule_end: scheduleEnd,
        ai_schedule_days: scheduleDays,
        updated_at: updatedAt,
      })
      .eq('id', empresaId);
    if (updateWithDays.error?.message?.includes('ai_schedule_days')) {
      console.warn('[Router] ai_schedule_days column missing - persisting legacy fields only. Run migration 040.');
      const fallback = await supabase
        .from('empresa_perfil')
        .update({
          ai_enabled: aiEnabled,
          ai_mode: mode,
          ai_schedule_start: scheduleStart,
          ai_schedule_end: scheduleEnd,
          updated_at: updatedAt,
        })
        .eq('id', empresaId);
      if (fallback.error) {
        console.warn('[Router] ai settings persist failed (legacy fallback):', fallback.error);
      }
    } else if (updateWithDays.error) {
      console.warn('[Router] ai settings persist failed (column missing?):', updateWithDays.error);
    }
    broadcast({ type: 'ai_enabled', data: { enabled: aiEnabled } }, empresaId);
    res.json({ ok: true, ...readAiSettingsFromConfig(empresaId) });
  } catch (error) {
    sendAuthError(res, error);
  }
});

/**
 * POST /api/ai/schedule-parse — Converts a natural-language description
 * into a proposed AiScheduleDays for the wizard's "describe in a sentence"
 * shortcut and the incremental-edit flow ("muda só quarta pra 24h").
 *
 * Never persists — returns the proposal so the frontend can render a
 * preview. Operator confirms via the existing POST /api/ai-settings.
 */
router.post('/api/ai/schedule-parse', express.json({ limit: '32kb' }), async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
    if (!description || description.length > 600) {
      res.status(400).json({ error: 'Descrição inválida.' });
      return;
    }
    const currentSchedule = normalizeAiScheduleDays(req.body?.currentSchedule);
    // Use server-derived "today" in the empresa timezone — never trust the
    // client clock for date resolution.
    const config = getConfig(empresaId);
    const timezone = config.timezone || 'America/Sao_Paulo';
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const result = await parseScheduleFromDescription(empresaId, {
      description,
      currentSchedule,
      currentBlockedDates: config.blockedDates ?? [],
      today,
    });
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    if (
      message === 'INVALID_SCHEDULE_DESCRIPTION'
      || message === 'INVALID_SCHEDULE_JSON'
      || message === 'INVALID_SCHEDULE_MODE'
      || message === 'INVALID_SCHEDULE_DAYS'
      || message === 'SCHEDULE_HAS_NO_ENABLED_DAYS'
      || message === 'EMPTY_SCHEDULE_RESPONSE'
    ) {
      res.status(422).json({ error: 'Não consegui entender a descrição. Tente reformular ou edite manualmente.' });
      return;
    }
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
        .from('zelo_orders')
        .select(ORDER_NOTIFICATION_COLUMNS)
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
    const order = orderRes.data as unknown as Record<string, unknown> | null;

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

    const waMessageId = await sendTextMessage(jid, text, empresaId);
    await addAssistantMessage(jid, text, undefined, empresaId, undefined, { waMessageId });

    res.json({ ok: true });
  } catch (error) {
    sendDriverError(res, error);
  }
});

/**
 * POST /api/orders/manual
 * Body: { customerName, customerPhone, items: [{product, quantity, unitPrice}], pickupDate, pickupTime,
 *         deliveryAddress?, paymentMethod?, observations? }
 * Creates a manual order via the canonical create_zelo_order RPC (source='manual').
 */
router.post('/api/orders/manual', express.json({ limit: '50kb' }), async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const body = req.body as Record<string, unknown>;

    // Validate required fields
    const customerName = typeof body.customerName === 'string' ? body.customerName.trim() : '';
    const customerPhone = typeof body.customerPhone === 'string' ? body.customerPhone.trim() : '';
    const pickupDate = typeof body.pickupDate === 'string' ? body.pickupDate.trim() : '';
    const pickupTime = typeof body.pickupTime === 'string' ? body.pickupTime.trim() : '';

    if (!customerName) { res.status(400).json({ error: 'Nome do cliente é obrigatório.' }); return; }
    if (!pickupDate || !pickupTime) { res.status(400).json({ error: 'Data e hora são obrigatórias.' }); return; }

    const rawItems = Array.isArray(body.items) ? body.items : [];
    const items: Array<{ product: string; quantity: number; unitPrice: number }> = [];
    for (const raw of rawItems) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      const product = typeof r.product === 'string' ? r.product.trim() : '';
      const quantity = Number(r.quantity);
      const unitPrice = Number(r.unitPrice);
      if (!product || !Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isInteger(quantity) || quantity < 1 || quantity > 999) continue;
      items.push({ product, quantity, unitPrice: Math.round(unitPrice * 100) / 100 });
    }
    if (items.length === 0) {
      res.status(400).json({ error: 'Adicione ao menos um item com preço.' });
      return;
    }

    const deliveryAddress = typeof body.deliveryAddress === 'string' ? body.deliveryAddress.trim() : '';
    const paymentMethod = typeof body.paymentMethod === 'string' ? body.paymentMethod.trim() : '';
    const observations = typeof body.observations === 'string' ? body.observations.trim() : '';
    // Client-supplied so a retry after a lost response reuses the same key
    // instead of risking a duplicate order (create_zelo_order dedupes on
    // (empresa_id, idempotency_key)); createManualZeloOrder falls back to a
    // fresh one if this is missing/invalid.
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim().slice(0, 128) : undefined;

    const order = await createManualZeloOrder({
      empresaId,
      customerName,
      customerPhone,
      items,
      pickupDate,
      pickupTime,
      deliveryAddress: deliveryAddress || undefined,
      paymentMethod: paymentMethod || undefined,
      observations: observations || undefined,
      idempotencyKey: idempotencyKey || undefined,
    });

    res.json({ order });
  } catch (error: any) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      sendAuthError(res, error); return;
    }
    if (error instanceof Error && error.message === 'EMPRESA_NOT_FOUND') {
      sendAuthError(res, error); return;
    }
    const msg = error instanceof Error ? error.message : 'unknown';
    if (msg.includes('Produto não encontrado')) {
      res.status(400).json({ error: msg, code: 'PRODUCT_NOT_FOUND' }); return;
    }
    if (msg.includes('total não confere')) {
      res.status(400).json({ error: msg, code: 'TOTAL_MISMATCH' }); return;
    }
    console.error('[Router] POST /api/orders/manual error:', error);
    res.status(500).json({ error: 'Não foi possível criar o pedido.' });
  }
});

router.delete('/api/orders/:id', async (req: Request, res: Response) => {
  try {
    const { empresaId, userId } = await requireEmpresaAndUserId(req);
    const expectedRevision = Number((req.body as { expectedRevision?: unknown } | undefined)?.expectedRevision);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      res.status(400).json({ error: 'RevisÃ£o invÃ¡lida.' }); return;
    }
    await cancelCanonicalOrder(empresaId, req.params.id, expectedRevision, userId);
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'REVISION_CONFLICT') {
      res.status(409).json({ error: 'REVISION_CONFLICT' }); return;
    }
    sendDriverError(res, error);
  }
});

/**
 * PATCH /api/orders/:id/status
 * Body: { status: 'pending' | 'preparing' | 'ready' | 'out_for_delivery' | 'delivered' }
 * Updates the order status and, for transitions into preparing/ready/out_for_delivery,
 * fires a WhatsApp notification to the customer if the empresa has the toggle on.
 *
 * FIX 2026-07-23: Supabase transition failures are plain objects, not native
 * Error instances; normalize them here so a blocked order is not reported as
 * an opaque 500/UNKNOWN_ERROR to every operator.
 */
router.patch('/api/orders/:id/status', async (req: Request, res: Response) => {
  const ALLOWED: ReadonlyArray<string> = ['pending', 'preparing', 'ready', 'out_for_delivery', 'delivered'];
  try {
    const empresaId = await requireEmpresaId(req);
    const orderId = req.params.id;
    const { status, expectedRevision } = (req.body ?? {}) as { status?: string; expectedRevision?: number };

    if (!status || !ALLOWED.includes(status) || !Number.isSafeInteger(expectedRevision) || expectedRevision! < 0) {
      res.status(400).json({ error: 'Status inválido.' });
      return;
    }

    const supabase = getServiceSupabase();

    const existing = await getCanonicalOrder(empresaId, orderId);
    if (!existing) {
      res.status(404).json({ error: 'Pedido não encontrado.' });
      return;
    }

    const oldStatus = existing.status;

    const { userId } = await requireEmpresaAndUserId(req);
    const updated = await transitionCanonicalOrder({
      empresaId,
      orderId,
      expectedRevision: expectedRevision!,
      status: status as typeof existing.status,
      actorId: userId,
    });

    // ZLM-301 — reflete a mudança de status no ticket de cozinha do PDV (bundle).
    // Best-effort + flag-gated: nunca derruba o update do pedido no ZeloChat.
    if (oldStatus !== status) {
      void Promise.resolve()
        .catch((err) => console.error('[ZeloMenu] sync status Chat->PDV falhou:', err));
    }

    const shouldNotify =
      oldStatus !== status &&
      (status === 'preparing' || status === 'ready' || status === 'out_for_delivery');

    if (shouldNotify) {
      try {
        const customerPhoneRaw = existing.customerPhone.replace(/\D/g, '');

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
            const customerName = existing.customerName.split(' ')[0] || 'tudo bem';
            const isDelivery = !!existing.deliveryAddress;
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

            const waMessageId = await sendTextMessage(jid, text, empresaId);
            await addAssistantMessage(jid, text, undefined, empresaId, undefined, { waMessageId });
          }
        }
      } catch (err) {
        console.error('[order status notify] failed:', err);
      }
    }

    res.json({ ok: true, order: updated });
  } catch (error) {
    const failure = classifyOrderTransitionError(error);
    console.error('[orders/status] transição recusada:', {
      code: failure.code,
      message: getOrderTransitionErrorMessage(error),
      error,
    });
    res.status(failure.httpStatus).json({ error: failure.userMessage });
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
  const { naturalInput, kind, redirectPhone, redirectMessage } = (req.body ?? {}) as {
    naturalInput?: string;
    kind?: string;
    redirectPhone?: string | null;
    redirectMessage?: string | null;
  };
  if (!naturalInput?.trim()) {
    res.status(400).json({ error: 'Descreva o gatilho em português.' });
    return;
  }
  if (
    kind !== undefined &&
    kind !== 'notify_manager' &&
    kind !== 'escalate_human' &&
    kind !== 'redirect_contact'
  ) {
    res.status(400).json({ error: 'Tipo de gatilho inválido.' });
    return;
  }
  try {
    const empresaId = await requireEmpresaId(req);
    const trigger = await createTrigger(
      empresaId,
      naturalInput,
      kind as TriggerKind | undefined,
      redirectPhone,
      redirectMessage,
    );
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

// ── Tags ─────────────────────────────────────────────────────────────────────

router.get('/api/tags', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const tags = await listTags(empresaId);
    res.json({ tags });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/api/tags', async (req: Request, res: Response) => {
  const { name, color, aiInstructions, autoApplyCondition } = (req.body ?? {}) as {
    name?: string; color?: string; aiInstructions?: string | null; autoApplyCondition?: string | null;
  };
  if (!name?.trim()) {
    res.status(400).json({ error: 'Nome da tag é obrigatório.' });
    return;
  }
  try {
    const empresaId = await requireEmpresaId(req);
    const tag = await createTag(
      empresaId,
      name,
      color || '#6366f1',
      aiInstructions ?? null,
      autoApplyCondition ?? null,
    );
    res.status(201).json({ tag });
  } catch (error: unknown) {
    const pg = error as { code?: string };
    if (pg.code === '23505') {
      res.status(400).json({ error: 'Já existe uma tag com esse nome.' });
      return;
    }
    res.status(500).json({ error: String(error) });
  }
});

router.put('/api/tags/:id', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const tag = await updateTag(empresaId, req.params.id, req.body ?? {});
    if (!tag) {
      res.status(404).json({ error: 'Tag não encontrada.' });
      return;
    }
    res.json({ tag });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.delete('/api/tags/:id', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const deleted = await deleteTag(empresaId, req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Tag não encontrada.' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/api/sessions/:sessionId/tags/:tagId', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    await applyTagToSession(empresaId, req.params.sessionId, req.params.tagId);
    const updatedTags = await getSessionTagsFull(empresaId, req.params.sessionId);
    broadcast({ type: 'session_tags_updated', data: { sessionId: req.params.sessionId, tags: updatedTags } }, empresaId);
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof TagTenantMismatchError) {
      res.status(404).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: String(error) });
  }
});

router.delete('/api/sessions/:sessionId/tags/:tagId', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    await removeTagFromSession(empresaId, req.params.sessionId, req.params.tagId);
    const updatedTags = await getSessionTagsFull(empresaId, req.params.sessionId);
    broadcast({ type: 'session_tags_updated', data: { sessionId: req.params.sessionId, tags: updatedTags } }, empresaId);
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof TagTenantMismatchError) {
      res.status(404).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: String(error) });
  }
});

router.get('/api/sessions/:sessionId/tags', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const tags = await getSessionTagsFull(empresaId, req.params.sessionId);
    res.json({ tags });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

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

router.get('/api/dashboard/overview', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const rawRange = req.query.range;
    const range = rawRange === '7d' || rawRange === '30d' || rawRange === 'custom'
      ? rawRange
      : 'today';
    const overview = await buildDashboardOverview(
      empresaId,
      range,
      req.query.startDate,
      req.query.endDate,
    );
    res.json({ overview });
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

router.post('/api/sessions/:jid/pin', async (req: Request, res: Response) => {
  const pinned = !!(req.body as { pinned?: unknown })?.pinned;
  try {
    const empresaId = await requireEmpresaId(req);
    await setSessionPinned(req.params.jid, pinned, empresaId);
    res.json({ ok: true, pinned });
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
 * DELETE /api/account — Self-service account deletion (LGPD Art. 18, III).
 * SCHEDULES deletion with a 14-day grace period instead of purging immediately:
 * cancels the Stripe sub at period end if applicable (no-op for Pix/AbacatePay
 * customers — their subscriptions are one-time charges with no recurrence) and
 * stamps empresa_perfil.deletion_scheduled_at. The deletion sweeper runs the
 * irreversible purge (delete_account RPC + Whatsmiau + storage) after grace.
 * The user can reactivate via POST /api/account/reactivate before then.
 */
router.delete('/api/account', async (req: Request, res: Response) => {
  try {
    const { empresaId, userId } = await requireEmpresaAndUserId(req);

    // Cancel Stripe at period end (reversible on reactivation). No-op for
    // Pix/AbacatePay customers — setStripeCancelAtPeriodEnd returns early when
    // payment_provider !== 'stripe', so the 502 below never fires for them.
    try {
      await setStripeCancelAtPeriodEnd(userId, true);
    } catch (err) {
      console.error('[account/delete] Stripe schedule-cancel failed:', err);
      res.status(502).json({ error: 'Não foi possível agendar o cancelamento da assinatura. Tente novamente.' });
      return;
    }

    const now = new Date();
    const scheduledAt = new Date(now.getTime() + ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000);
    const { error } = await getServiceSupabase()
      .from('empresa_perfil')
      .update({
        deletion_scheduled_at: scheduledAt.toISOString(),
        deletion_requested_at: now.toISOString(),
        deletion_source: 'zelochat',
      })
      .eq('id', empresaId);
    if (error) {
      console.error('[account/delete] schedule error:', error);
      res.status(500).json({ error: 'Falha ao agendar a exclusão.' });
      return;
    }

    res.json({ ok: true, scheduledAt: scheduledAt.toISOString(), graceDays: ACCOUNT_DELETION_GRACE_DAYS });
  } catch (error) {
    sendAuthError(res, error);
  }
});

/**
 * POST /api/account/reactivate — Cancels a pending account deletion within the
 * grace period. Clears the schedule and resumes the Stripe subscription.
 */
router.post('/api/account/reactivate', async (req: Request, res: Response) => {
  try {
    const { empresaId, userId } = await requireEmpresaAndUserId(req);

    try {
      await setStripeCancelAtPeriodEnd(userId, false);
    } catch (err) {
      console.warn('[account/reactivate] Stripe resume warning (continuing):', err);
    }

    const { error } = await getServiceSupabase()
      .from('empresa_perfil')
      .update({ deletion_scheduled_at: null, deletion_requested_at: null, deletion_source: null })
      .eq('id', empresaId);
    if (error) {
      console.error('[account/reactivate] error:', error);
      res.status(500).json({ error: 'Falha ao reativar a conta.' });
      return;
    }

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
    const { empresaId, userId } = await requireEmpresaAndUserId(req);
    const payload = validateGenerateInstructionsPayload(req);
    if (payload.ok === false) {
      if (payload.retryAfterSeconds) res.set('Retry-After', String(payload.retryAfterSeconds));
      res.status(payload.status).json({ error: payload.error });
      return;
    }

    const rateLimit = checkAiRouteRateLimit(empresaId, userId, 'generate-instructions');
    if (rateLimit.ok === false) {
      if (rateLimit.retryAfterSeconds) res.set('Retry-After', String(rateLimit.retryAfterSeconds));
      recordAiUsage({ empresaId, feature: 'ai_generate_instructions', model: 'gpt-4o-mini', status: 'rate_limited' });
      res.status(rateLimit.status).json({ error: rateLimit.error });
      return;
    }

    const { hint } = payload.value;
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

    let response;
    try {
      response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.85,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: userContext },
        ],
      });
    } catch (error) {
      recordAiUsage({
        empresaId,
        feature: 'ai_generate_instructions',
        model: 'gpt-4o-mini',
        status: 'error',
      });
      throw error;
    }
    recordAiUsage({
      empresaId,
      feature: 'ai_generate_instructions',
      model: 'gpt-4o-mini',
      status: 'success',
      usage: response.usage,
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
router.post('/api/ai/complete', express.json({ limit: '512kb' }), async (req: Request, res: Response) => {
  try {
    const { empresaId, userId } = await requireEmpresaAndUserId(req);
    const payload = validateAiCompletePayload(req);
    if (payload.ok === false) {
      if (payload.retryAfterSeconds) res.set('Retry-After', String(payload.retryAfterSeconds));
      res.status(payload.status).json({ error: payload.error });
      return;
    }

    const rateLimit = checkAiRouteRateLimit(empresaId, userId, 'complete');
    if (rateLimit.ok === false) {
      if (rateLimit.retryAfterSeconds) res.set('Retry-After', String(rateLimit.retryAfterSeconds));
      recordAiUsage({ empresaId, feature: 'ai_manual_reply', model: 'gpt-4o-mini', status: 'rate_limited' });
      res.status(rateLimit.status).json({ error: rateLimit.error });
      return;
    }

    const { messages, temperature, responseFormat } = payload.value;
    const openai = getAI();
    const params: ChatCompletionCreateParamsNonStreaming = {
      model: 'gpt-4o-mini',
      messages,
      temperature,
    };
    if (responseFormat === 'json') {
      params.response_format = { type: 'json_object' };
    }
    let response;
    try {
      response = await openai.chat.completions.create(params);
    } catch (error) {
      recordAiUsage({
        empresaId,
        feature: 'ai_manual_reply',
        model: params.model,
        status: 'error',
      });
      throw error;
    }
    recordAiUsage({
      empresaId,
      feature: 'ai_manual_reply',
      model: params.model,
      status: 'success',
      usage: response.usage,
    });
    res.json({ content: response.choices[0].message.content });
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === 'UNAUTHORIZED' || error.message === 'EMPRESA_NOT_FOUND')) {
      sendAuthError(res, error);
      return;
    }
    console.error('[AI Proxy] Error:', error);
    res.status(500).json({ error: 'Falha ao processar a solicitação da IA.' });
  }
});

/**
 * POST /api/ai/simulate — Dry-run the AI pipeline without touching the DB or sending WhatsApp messages.
 * Body: { customerMessage, customerName?, conversationHistory?, configOverride? }
 */
router.post('/api/ai/simulate', async (req: Request, res: Response) => {
  try {
    const { empresaId, userId } = await requireEmpresaAndUserId(req);

    const rateLimit = checkAiRouteRateLimit(empresaId, userId, 'complete');
    if (rateLimit.ok === false) {
      if (rateLimit.retryAfterSeconds) res.set('Retry-After', String(rateLimit.retryAfterSeconds));
      recordAiUsage({ empresaId, feature: 'ai_simulator', model: 'gpt-4o-mini', status: 'rate_limited' });
      res.status(rateLimit.status).json({ error: rateLimit.error });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const customerMessage = typeof body.customerMessage === 'string' ? body.customerMessage.trim() : '';
    if (!customerMessage) {
      res.status(400).json({ error: 'customerMessage é obrigatório.' });
      return;
    }
    if (customerMessage.length > 2000) {
      res.status(400).json({ error: 'customerMessage excede 2000 caracteres.' });
      return;
    }

    const rawHistory = Array.isArray(body.conversationHistory) ? body.conversationHistory : [];
    if (rawHistory.length > 20) {
      res.status(400).json({ error: 'conversationHistory não pode ter mais de 20 mensagens.' });
      return;
    }

    const payload: SimulatePayload = {
      customerMessage,
      customerName: typeof body.customerName === 'string' ? body.customerName : undefined,
      conversationHistory: rawHistory
        .filter((m): m is { role: 'user' | 'assistant'; content: string } =>
          m !== null &&
          typeof m === 'object' &&
          (m.role === 'user' || m.role === 'assistant') &&
          typeof m.content === 'string',
        ),
      configOverride:
        body.configOverride !== null && typeof body.configOverride === 'object'
          ? (body.configOverride as SimulatePayload['configOverride'])
          : undefined,
    };

    const result = await simulateAtendimento(empresaId, payload);
    res.json(result);
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === 'UNAUTHORIZED' || error.message === 'EMPRESA_NOT_FOUND')) {
      sendAuthError(res, error);
      return;
    }
    console.error('[AI Simulate] Error:', error);
    res.status(500).json({ error: 'Falha ao processar a simulação.' });
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
 *
 * P0.4 — Validate the Supabase JWT locally via `requireEmpresaId` BEFORE
 * forwarding upstream. The previous version trusted any string in the
 * Authorization header and simply re-sent it — turning ZeloChat into an
 * open proxy for any Supabase token from any project that shared the
 * auth pool. By calling `requireEmpresaId(req)`, we (a) reject malformed
 * or expired tokens locally, and (b) tie the proxied request to a known
 * empresa in our DB. The paywall middleware in `server/index.ts` also
 * gates this route, so cancelled customers can't keep pulling catalog
 * data after their subscription lapses.
 */
router.get('/api/produtos', async (req: Request, res: Response) => {
  try {
    await requireEmpresaId(req);

    const authHeader = req.headers.authorization!;
    const onlyVisible = req.query.onlyVisible ?? 'true';
    const url = new URL('https://www.zelopdv.com.br/api/produtos');
    url.searchParams.set('onlyVisible', String(onlyVisible));

    const upstream = await axios.get(url.toString(), {
      headers: { Authorization: authHeader, Accept: 'application/json' },
    });

    res.json(upstream.data);
  } catch (err: any) {
    if (err?.message === 'UNAUTHORIZED' || err?.message === 'EMPRESA_NOT_FOUND') {
      sendAuthError(res, err);
      return;
    }
    const status = err?.response?.status ?? 502;
    const msg = err?.response?.data?.error ?? err?.message ?? 'Upstream error';
    res.status(status).json({ error: msg });
  }
});

router.post('/api/zelomenu/cart-sessions/whatsapp', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const session = await openWhatsAppCartSession({
      empresaId,
      remoteJid: req.body?.remoteJid,
      customerName: req.body?.customerName,
      customerPhone: req.body?.customerPhone,
      items: req.body?.items,
      fulfillment: req.body?.fulfillment,
      paymentMethod: req.body?.paymentMethod,
      observations: req.body?.observations,
      source: req.body?.source === 'operator' ? 'operator' : 'ai_prebuilt',
    });
    res.status(201).json(session);
  } catch (error) {
    sendZeloMenuCartError(res, error);
  }
});

router.get('/api/zelomenu/cart-sessions/review', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const payload = await getWhatsAppCartReviewSession({
      empresaId,
      remoteJid: String(req.query.remoteJid ?? ''),
      shortId: typeof req.query.shortId === 'string' ? req.query.shortId : null,
    });
    if (!payload) {
      res.status(404).json({ error: 'Pedido do cardápio não encontrado nesta conversa.' });
      return;
    }
    res.json(payload);
  } catch (error) {
    sendZeloMenuCartError(res, error);
  }
});

router.post('/api/zelomenu/cart-sessions/:id/accept', async (req: Request, res: Response) => {
  try {
    const { empresaId, userId } = await requireEmpresaAndUserId(req);
    const payload = await acceptWhatsAppCartReviewSession({
      empresaId,
      sessionId: req.params.id,
      acceptedByUserId: userId,
      acceptedByName: req.body?.acceptedByName,
    });
    if (!payload) {
      res.status(404).json({ error: 'Pedido do cardápio não encontrado nesta conversa.' });
      return;
    }
    res.json(payload);
  } catch (error) {
    sendZeloMenuCartError(res, error);
  }
});

// ZLM-203 — Loja pública por slug (menu.zelopdv.com.br/{slug}).
// GET resolve slug→empresa e devolve negócio + catálogo (sem sessão, só browse).
router.get('/public-api/zelomenu/store/:slug', async (req: Request, res: Response) => {
  try {
    const store = await getPublicStoreBySlug(req.params.slug);
    if (!store) {
      res.status(404).json({ error: 'Loja não encontrada.' });
      return;
    }
    res.json({ business: store.business, catalog: store.catalog });
  } catch (error) {
    sendZeloMenuCartError(res, error);
  }
});

// POST cria uma sessão public_order e devolve o token; o front redireciona pro
// carrinho público existente (/menu/carrinho/:token) pra revisar/confirmar.
router.post('/public-api/zelomenu/store/:slug/cart', async (req: Request, res: Response) => {
  try {
    const result = await openPublicOrderCartSession({
      slug: req.params.slug,
      customerName: req.body?.customerName,
      customerPhone: req.body?.customerPhone,
      items: req.body?.items,
      fulfillment: req.body?.fulfillment,
      paymentMethod: req.body?.paymentMethod,
      observations: req.body?.observations,
    });
    if (!result) {
      res.status(404).json({ error: 'Loja não encontrada.' });
      return;
    }
    res.json({ token: result.publicToken, path: result.publicPath, orderingId: result.orderingId });
  } catch (error) {
    sendZeloMenuCartError(res, error);
  }
});

// ZLM-203 — operador define/lê o slug público da própria loja (self-service, D-046).
// Atrás do paywall global (/api/* exige assinatura chat/bundle ativa = ZeloMenu por D-014).
function zelomenuPublicBaseUrl(): string {
  return process.env.ZELOMENU_PUBLIC_BASE_URL || getPublicAppBaseUrl();
}

router.get('/api/zelomenu/slug', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const slug = await getEmpresaZeloMenuSlug(empresaId);
    res.json({ slug, publicUrl: slug ? buildPublicStoreUrl(zelomenuPublicBaseUrl(), slug) : null });
  } catch (error) {
    sendZeloMenuCartError(res, error);
  }
});

router.put('/api/zelomenu/slug', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const slug = await setEmpresaZeloMenuSlug(empresaId, String(req.body?.slug ?? ''));
    res.json({ slug, publicUrl: buildPublicStoreUrl(zelomenuPublicBaseUrl(), slug) });
  } catch (error) {
    sendZeloMenuCartError(res, error);
  }
});

router.get('/api/zelomenu/settings', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const settings = await getZeloMenuStoreSettings(empresaId);
    res.json(settings);
  } catch (error) {
    sendZeloMenuCartError(res, error);
  }
});

router.patch('/api/zelomenu/settings', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const { welcomeText, featuredEnabled, featuredProductIds, categoryOrder } = req.body ?? {};
    await updateZeloMenuStoreSettings(empresaId, {
      ...(welcomeText !== undefined && { welcomeText: typeof welcomeText === 'string' ? welcomeText.slice(0, 500) : null }),
      ...(featuredEnabled !== undefined && { featuredEnabled: Boolean(featuredEnabled) }),
      ...(Array.isArray(featuredProductIds) && { featuredProductIds: featuredProductIds.map(Number).filter(Boolean) }),
      ...(Array.isArray(categoryOrder) && { categoryOrder: categoryOrder.map(String) }),
    });
    res.json({ ok: true });
  } catch (error) {
    sendZeloMenuCartError(res, error);
  }
});

router.get('/public-api/zelomenu/cart/:token', async (req: Request, res: Response) => {
  try {
    const payload = await getPublicCartSession(req.params.token);
    if (!payload) {
      res.status(404).json({ error: 'Carrinho não encontrado.' });
      return;
    }
    res.json(payload);
  } catch (error) {
    sendZeloMenuCartError(res, error);
  }
});

router.patch('/public-api/zelomenu/cart/:token', async (req: Request, res: Response) => {
  try {
    const payload = await updatePublicCartSession(req.params.token, {
      customerName: req.body?.customerName,
      customerPhone: req.body?.customerPhone,
      items: req.body?.items,
      fulfillment: req.body?.fulfillment,
      paymentMethod: req.body?.paymentMethod,
      observations: req.body?.observations,
    });
    if (!payload) {
      res.status(404).json({ error: 'Carrinho não encontrado.' });
      return;
    }
    res.json(payload);
  } catch (error) {
    sendZeloMenuCartError(res, error);
  }
});

router.post('/public-api/zelomenu/cart/:token/confirm', async (req: Request, res: Response) => {
  try {
    const payload = await confirmPublicCartSession(req.params.token);
    if (!payload) {
      res.status(404).json({ error: 'Carrinho não encontrado.' });
      return;
    }
    res.json(payload);
  } catch (error) {
    sendZeloMenuCartError(res, error);
  }
});

/**
 * POST /api/sync-config — Syncs business config from the frontend per-empresa. Requires auth.
 */
router.post('/api/sync-config', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const { name, specialty, hours, openTime, closeTime, closedDays, address, pixKey,
            blockedDates, aiInstructions, managerPhone,
            aiEnabled, aiCanReengagePending, deliveryConfig, pixReceiptConfig } = req.body;
    setConfig(empresaId, { name, specialty, hours, openTime, closeTime, closedDays, address, pixKey,
                           blockedDates, aiInstructions, managerPhone,
                           ...(typeof aiEnabled === 'boolean' ? { aiEnabled } : {}),
                           ...(typeof aiCanReengagePending === 'boolean' ? { aiCanReengagePending } : {}),
                           ...(deliveryConfig !== undefined ? { deliveryConfig } : {}),
                           ...(pixReceiptConfig !== undefined ? { pixReceiptConfig } : {}) });
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
    // FIX 2026-06-01: browser snapshots do not own stock truth → reload the
    // shared ZeloPDV catalog from DB so estoque_atual/controlar_estoque cannot
    // be bypassed by a stale /api/sync-config payload.
    await loadAiSettingsFromDb(empresaId);
    res.json({ ok: true });
  } catch (error) {
    sendAuthError(res, error);
  }
});

// ─── Validate WhatsApp numbers ────────────────────────────────────────────────

// P1.3 — rate limit per-empresa pra /api/whatsapp/validate-numbers.
// Antes: cap de 50 por request mas sem limite por unidade de tempo —
// um operator (ou conta comprometida) podia rodar em loop e usar o
// endpoint Whatsmiau como enumerador grátis de telefones em WhatsApp.
// Limite agora: 200 números/empresa/hora. Sliding window simples em
// memória; multi-node deploy precisaria de Redis, mas single-replica
// atual é OK.
const validateNumbersUsage = new Map<string, { count: number; resetAt: number }>();
const VALIDATE_NUMBERS_HOURLY_CAP = 200;
const VALIDATE_NUMBERS_WINDOW_MS = 60 * 60 * 1000;

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

    // P1.3 — rate limit
    const now = Date.now();
    const entry = validateNumbersUsage.get(empresaId);
    if (entry && entry.resetAt > now) {
      if (entry.count + numbers.length > VALIDATE_NUMBERS_HOURLY_CAP) {
        const minutesLeft = Math.ceil((entry.resetAt - now) / 60_000);
        return res.status(429).json({
          error: `Limite de ${VALIDATE_NUMBERS_HOURLY_CAP} números por hora atingido. Tente novamente em ${minutesLeft} min.`,
        });
      }
      entry.count += numbers.length;
    } else {
      validateNumbersUsage.set(empresaId, { count: numbers.length, resetAt: now + VALIDATE_NUMBERS_WINDOW_MS });
    }

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
  const { remoteJid, fromMe, dbMessageId } = req.body ?? {};
  if (!remoteJid) {
    res.status(400).json({ error: 'Campo obrigatório: remoteJid.' });
    return;
  }
  try {
    const empresaId = await requireEmpresaId(req);
    await revokeMessage(remoteJid, req.params.id, fromMe ?? true, empresaId);
    const deleted = await deleteMessageByWhatsAppId({
      empresaId,
      jid: remoteJid,
      waMessageId: req.params.id,
      dbMessageId: typeof dbMessageId === 'string' ? dbMessageId : null,
    });
    res.json({ ok: true, ...deleted });
  } catch (error: any) {
    if (error instanceof Error && (error.message === 'UNAUTHORIZED' || error.message === 'EMPRESA_NOT_FOUND')) {
      sendAuthError(res, error);
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

// ─── Onboarding follow-up ─────────────────────────────────────────────────────
//
// `/api/onboarding/welcome` — JWT-auth, disparada pelo frontend logo após o
// upsert que marca `zelochat_onboarding_done=true`. Manda WhatsApp + Email
// Day 0. Fire-and-forget no cliente: erro aqui não trava entrada no app.
//
// `/api/cron/onboarding-followup` — Bearer CRON_SECRET, gatilho manual da
// rotina diária (Day 3, 7, 14, 21, 28). O loop in-process já roda automático
// via startOnboardingFollowupLoop(); essa rota existe pra debugging e pra
// permitir cron externo se um dia precisarmos.

router.post('/api/onboarding/welcome', async (req: Request, res: Response) => {
  try {
    const { userId } = await requireEmpresaAndUserId(req);
    const result = await sendWelcomePack(userId);
    res.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof Error && (error.message === 'UNAUTHORIZED' || error.message === 'EMPRESA_NOT_FOUND')) {
      sendAuthError(res, error);
      return;
    }
    console.error('[onboarding/welcome] error:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

router.post('/api/cron/onboarding-followup', async (req: Request, res: Response) => {
  const expected = (process.env.CRON_SECRET || '').trim();
  if (!expected) {
    res.status(503).json({ error: 'CRON_SECRET_NOT_CONFIGURED' });
    return;
  }
  const received = extractBearerToken(req)?.trim() ?? '';
  if (!received || !safeEqualString(received, expected)) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }

  try {
    const result = await runDailyOnboardingFollowup();
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error('[cron/onboarding-followup] error:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/presence — operator typing indicator.
 * Fire-and-forget: failures never bubble to the client. Body:
 *   { jid: string, presence: 'composing' | 'available' }
 */
router.post('/api/presence', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const { jid, presence } = (req.body || {}) as { jid?: string; presence?: 'composing' | 'available' };
    if (!jid || (presence !== 'composing' && presence !== 'available')) {
      res.status(400).json({ error: 'invalid_payload' });
      return;
    }
    void sendPresence(jid, presence, presence === 'composing' ? 3000 : 0, empresaId);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === 'UNAUTHORIZED' || err.message === 'EMPRESA_NOT_FOUND')) {
      sendAuthError(res, err);
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : 'unknown' });
  }
});

export default router;
