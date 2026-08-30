import axios from 'axios';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { broadcast, type WsEvent } from './ws.js';
import { getEmpresaAndTokenForInstance, getInstanceForEmpresa, setConnectionState } from './instanceManager.js';
import { getBoundEmpresaId } from './supabase.js';
import { redactInstance } from './redact.js';
import { normalizeWhatsAppTextFormatting } from '../src/domain/whatsappFormatting.js';

/**
 * P0.2 / P1.11 — broadcast a legacy single-tenant lifecycle event (QR, connect,
 * disconnect) ONLY when the singleton empresaId is bound. The legacy WhatsApp
 * lifecycle (`startWhatsApp`, `fetchQR`, `disconnectWhatsApp`,
 * `syncStatusFromUpstream`, `handleConnectionUpdate`) was originally written
 * for the single-tenant beta where every connected operator belonged to the
 * same empresa.
 *
 * The previous pattern `broadcast(event, getBoundEmpresaId() ?? undefined)`
 * fanned out to EVERY connected WS client when the singleton was null
 * (multi-tenant mode), which leaked Donutopia's QR codes / connection events
 * to every other empresa's dashboard. We now drop the broadcast entirely
 * when there's no bound empresa — the per-instance webhook handler covers
 * connection events for tenants with their own Whatsmiau instance.
 */
function broadcastLegacyLifecycleEvent(event: WsEvent): void {
  const boundEmpresa = getBoundEmpresaId();
  if (!boundEmpresa) {
    // Multi-tenant mode — no global "primary" empresa. Per-empresa events
    // come through /webhook/:instance and broadcast scoped via processWebhookEvent.
    return;
  }
  broadcast(event, boundEmpresa);
}

const BASE_URL = (process.env.WHATSMIAU_BASE_URL || 'https://api.whatsmiau.dev').replace(/\/$/, '');
const API_KEY = process.env.WHATSMIAU_API_KEY || '';

// Whatsmiau message IDs sent by this server process — used to skip the fromMe
// webhook echo that Whatsmiau fires for every outbound API send.
//
// P1.7 — TTL ampliado de 30s → 10min. Redeploys demoram ~2-3min
// e Whatsmiau às vezes atrasa o echo (queue lag). Com 30s, qualquer atraso
// >30s fazia o echo ser tratado como mensagem orgânica do operador →
// duplicate row em zelochat_messages.
//
// LIMITAÇÃO: este Map não sobrevive a restart do processo. Após redeploy,
// outbounds enviados ANTES do restart cujo echo chega DEPOIS são persistidos
// duplicado. Solução completa seria persistir wa_message_id em
// zelochat_messages (UNIQUE index já existe da migration 015) e dedupar
// no DB layer — fica pra próximo sprint.
const SENT_DEDUP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const recentSentIds = new Map<string, number>();
const sentDedupCleanupTimer = setInterval(() => {
  const cutoff = Date.now() - SENT_DEDUP_TTL_MS;
  for (const [id, ts] of recentSentIds) {
    if (ts < cutoff) recentSentIds.delete(id);
  }
}, 60_000);
sentDedupCleanupTimer.unref?.();

function trackSent(id: string | undefined): void {
  if (id) recentSentIds.set(id, Date.now());
}

export function wasSentByServer(id: string): boolean {
  return recentSentIds.has(id);
}

// Bootstrap instance name. After P0-02 (multi-instance per empresa), this is
// only used by the legacy connection lifecycle (status/QR/health-check) which
// still tracks a single "primary" connection. All SEND functions now accept
// an optional empresaId and resolve the right instance per-call via
// getInstanceForEmpresa() — see resolveInstance() below.
export let INSTANCE_NAME = process.env.WHATSMIAU_INSTANCE || 'zelochat';

/**
 * Resolves the Whatsmiau instance to use for an outbound API call. When an
 * empresaId is supplied (which all routes/ai callers do), we look up that
 * empresa's dedicated instance. Otherwise we fall back to INSTANCE_NAME, which
 * preserves single-tenant behavior for any caller not yet threading empresaId.
 */
async function resolveInstance(empresaId?: string | null): Promise<string> {
  if (empresaId) {
    const inst = await getInstanceForEmpresa(empresaId);
    if (inst) return inst;
  }
  return INSTANCE_NAME;
}
let instanceInternalId = ''; // MongoDB _id from Whatsmiau API
let ownJid = ''; // JID of the linked WhatsApp number (e.g. "5511999@s.whatsapp.net")

export function getOwnJid(): string {
  return ownJid;
}

function setOwnJid(raw: string): void {
  if (!raw) return;
  ownJid = raw.includes('@') ? raw : `${raw}@s.whatsapp.net`;
}

export type ConnectionStatus = 'disconnected' | 'qr' | 'connecting' | 'connected';

let connectionStatus: ConnectionStatus = 'disconnected';
let currentQR: string | null = null;
let incomingMessageHandler: ((msg: any, empresaId: string | null) => void) | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY_MS = 5 * 60 * 1000; // 5 min cap

// When true, the reconnect scheduler and health check short-circuit so that a
// user-initiated logout is not immediately undone by the auto-reconnect loop.
// Reset to false on explicit reconnect attempts (fetchQR / startWhatsApp).
let manuallyDisconnected = false;

export function isManuallyDisconnected(): boolean {
  return manuallyDisconnected;
}

// P1.14 — `wipeAuthInfo` removida. Era safety net da era pré-Whatsmiau
// quando rodávamos Baileys local. Agora todo auth está no Whatsmiau
// upstream (não temos creds.json local). O rmSync com path relativo
// `auth_info_baileys` era também um footgun: se algum dev rodasse o
// server de um cwd inesperado, podia apagar conteúdo errado. Removendo
// o código morto + import de fs.

function apiHeaders() {
  return { apikey: API_KEY };
}

async function buildWebhookUrl(instanceName: string): Promise<string> {
  const publicUrl = getPublicWebhookUrl();
  const webhookUrl = new URL(`${publicUrl}/webhook/${encodeURIComponent(instanceName)}`);
  const ctx = await getEmpresaAndTokenForInstance(instanceName);
  if (ctx?.webhookToken) {
    webhookUrl.searchParams.set('token', ctx.webhookToken);
  }
  return webhookUrl.toString();
}

function v2Url(path: string): string {
  return `${BASE_URL}${BASE_URL.endsWith('/v2') ? '' : '/v2'}${path}`;
}

function extractWhatsmiauMessageId(data: any): string | undefined {
  const candidates = [
    data?.key?.id,
    data?.data?.key?.id,
    data?.message?.key?.id,
    data?.data?.message?.key?.id,
    data?.response?.key?.id,
    data?.response?.data?.key?.id,
    data?.response?.message?.key?.id,
    data?.response?.data?.message?.key?.id,
    data?.messageId,
    data?.data?.messageId,
    data?.response?.messageId,
    data?.response?.data?.messageId,
    data?.id,
    data?.data?.id,
    data?.response?.id,
    data?.response?.data?.id,
  ];

  return candidates.find((id): id is string => typeof id === 'string' && id.trim().length > 0);
}

function toWhatsmiauNumber(jidOrPhone: string): string {
  const localPart = String(jidOrPhone || '').split('@')[0] ?? '';
  const digits = localPart.replace(/\D/g, '');
  if (!digits) {
    throw new Error('Número de WhatsApp inválido para envio.');
  }
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
    return `55${digits}`;
  }
  return digits;
}

const TUNNEL_URL_FILE = resolve('.tunnel-url');
let lastRegisteredWebhook = '';
const PRODUCTION_WEBHOOK_URL = 'https://chat.zelopdv.com.br';

function isLocalWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname.endsWith('.local')
    );
  } catch {
    return true;
  }
}

function allowLocalWebhookRegister(): boolean {
  const v = (process.env.WHATSMIAU_ALLOW_LOCAL_WEBHOOK_REGISTER || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function redactWebhookUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.search = url.searchParams.has('token') ? '?token=***' : '';
    return url.toString();
  } catch {
    return '<invalid-webhook-url>';
  }
}

function readTunnelUrl(): string | null {
  try {
    if (!existsSync(TUNNEL_URL_FILE)) return null;
    const url = readFileSync(TUNNEL_URL_FILE, 'utf8').trim();
    return url || null;
  } catch {
    return null;
  }
}

export function getPublicWebhookUrl(): string {
  // Priority:
  // 1. Explicit WEBHOOK_PUBLIC_URL (manual override — set this in Dokploy)
  // 2. PUBLIC_APP_URL (already used for Stripe return URLs — same domain serves WS)
  // 3. Cloudflared tunnel file (dev)
  // 4. Production fallback — fail toward the real public app, never localhost
  // 5. Localhost only when explicitly allowed for an isolated sandbox
  if (process.env.WEBHOOK_PUBLIC_URL) return process.env.WEBHOOK_PUBLIC_URL.replace(/\/$/, '');
  if (process.env.PUBLIC_APP_URL) return process.env.PUBLIC_APP_URL.replace(/\/$/, '');
  const tunnelUrl = readTunnelUrl();
  if (tunnelUrl) return tunnelUrl.replace(/\/$/, '');
  if (!allowLocalWebhookRegister()) return PRODUCTION_WEBHOOK_URL;
  return 'http://localhost:3001';
}

function isWebhookRegisterDisabled(): boolean {
  const v = (process.env.WHATSMIAU_DISABLE_WEBHOOK_REGISTER || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export async function registerWebhook(force = false): Promise<boolean> {
  // Dev-safety guard: when set, skip webhook registration entirely so that a
  // local server booted against the production .env cannot silently overwrite
  // the production webhook URL on Whatsmiau (see CLAUDE.md → "Local dev steals
  // the production webhook"). Outbound sends still work; inbound stays pointed
  // at prod.
  if (isWebhookRegisterDisabled()) {
    console.log('[whatsapp] webhook register skipped (WHATSMIAU_DISABLE_WEBHOOK_REGISTER=1)');
    return true;
  }

  const webhookUrl = await buildWebhookUrl(INSTANCE_NAME);
  console.log(`[WhatsmiauTrace] register_legacy_start instance=${redactInstance(INSTANCE_NAME)} webhook=${redactWebhookUrl(webhookUrl)}`);
  if (isLocalWebhookUrl(webhookUrl) && !allowLocalWebhookRegister()) {
    console.warn('[whatsapp] refusing to register local webhook URL. Set WEBHOOK_PUBLIC_URL/PUBLIC_APP_URL, use a tunnel, or set WHATSMIAU_ALLOW_LOCAL_WEBHOOK_REGISTER=1 for an isolated sandbox.');
    return false;
  }

  if (!force && webhookUrl === lastRegisteredWebhook) return true;

  try {
    // 1. Register via /webhook/set — standard webhook URL + events setup
    //    NOTE: webhookBase64 here means "encode entire payload in base64" (NOT media)
    //    so we intentionally do NOT set it.
    await axios.post(
      `${BASE_URL}/webhook/set/${INSTANCE_NAME}`,
      {
        webhook: {
          enabled: true,
          url: webhookUrl,
          webhookByEvents: false,
          base64: true, // This enables media base64
          events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'MESSAGES_DELETE', 'CONNECTION_UPDATE', 'CONTACTS_UPSERT'],
        },
      },
      { headers: apiHeaders() },
    );

    // 2. Update instance to enable media base64 — per docs, this endpoint's
    //    base64 field means "mídias nos eventos vêm codificadas em base64"
    try {
      const updateRes = await axios.put(
        `${BASE_URL}/v2/instance/update/${INSTANCE_NAME}`,
        {
          webhook: {
            enabled: true,
            url: webhookUrl,
            base64: true,
            events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'MESSAGES_DELETE', 'CONNECTION_UPDATE', 'CONTACTS_UPSERT'],
          },
        },
        { headers: { ...apiHeaders(), 'Content-Type': 'application/json' } },
      );
      console.log('[WhatsApp] Instance update response:', JSON.stringify(updateRes.data)?.slice(0, 400));
    } catch (updateErr: any) {
      console.warn('[WhatsApp] Instance update for base64 failed:', updateErr?.response?.status, updateErr?.response?.data ?? (updateErr instanceof Error ? updateErr.message : updateErr));
    }

    // 3. Verify the current webhook config shows base64=true
    try {
      const findRes = await axios.get(
        `${BASE_URL}/v2/webhook/find/${INSTANCE_NAME}`,
        { headers: apiHeaders() },
      );
      console.log('[WhatsApp] Current webhook config:', JSON.stringify(findRes.data)?.slice(0, 600));
    } catch {
      // non-fatal
    }

    lastRegisteredWebhook = webhookUrl;
    console.log(`[WhatsmiauTrace] register_legacy_done instance=${redactInstance(INSTANCE_NAME)} webhook=${redactWebhookUrl(webhookUrl)}`);
    return true;
  } catch (err) {
    console.error(`[WhatsmiauTrace] register_legacy_error instance=${redactInstance(INSTANCE_NAME)} webhook=${redactWebhookUrl(webhookUrl)}:`, err instanceof Error ? err.message : err);
    return false;
  }
}

export function getStatus(): ConnectionStatus {
  return connectionStatus;
}

export function getQR(): string | null {
  return currentQR;
}

export function onIncomingMessage(handler: (msg: any, empresaId: string | null) => void): void {
  incomingMessageHandler = handler;
}

/**
 * Forwards a webhook message to the registered handler. `empresaId` is the
 * value resolved from the apikey token (review fix C3) — it tells the handler
 * which tenant the message belongs to without relying on a global singleton.
 */
export function dispatchIncomingMessage(msg: any, empresaId: string | null = null): void {
  if (incomingMessageHandler) {
    incomingMessageHandler(msg, empresaId);
  }
}

function scheduleReconnect(): void {
  if (manuallyDisconnected) {
    console.log('[WhatsApp] Reconnect suppressed — manually disconnected.');
    return;
  }
  if (reconnectTimer) return; // already scheduled
  const delay = Math.min(5_000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY_MS);
  reconnectAttempts++;
  console.log(`[WhatsApp] Scheduling reconnect attempt #${reconnectAttempts} in ${delay / 1000}s...`);
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (manuallyDisconnected) return; // user disconnected while timer was pending
    if (connectionStatus === 'connected') return;
    console.log(`[WhatsApp] Reconnect attempt #${reconnectAttempts}...`);
    try {
      await fetchQR();
    } catch (err) {
      console.error('[WhatsApp] Reconnect failed:', err instanceof Error ? err.message : err);
      scheduleReconnect();
    }
  }, delay);
}

/**
 * Handles connection.update webhook events from Whatsmiau.
 *
 * `empresaId` (when available — resolved from the webhook URL `/webhook/:instance`
 * or the legacy apikey header) is used to persist the per-empresa connection
 * state on `empresa_perfil.whatsmiau_connected` and feed P0-04 disconnect alerts.
 *
 * The in-memory lifecycle (status / QR / reconnect) is still global — it tracks
 * the bound empresa's connection. Multi-empresa lifecycle lands with P1-01.
 */
export function handleConnectionUpdate(data: any, empresaId: string | null = null): void {
  const state: string = data?.state ?? data?.instance?.state ?? '';
  const ownerJid: string = data?.ownerJid ?? data?.instance?.ownerJid ?? '';

  if (state === 'open') {
    // If the user just manually disconnected, ignore a racing 'open' event.
    // Whatsmiau may fire this right before it processes our logout call.
    if (manuallyDisconnected) {
      console.log('[WhatsApp] Ignoring late connection.update=open after manual disconnect.');
      return;
    }
    connectionStatus = 'connected';
    currentQR = null;
    reconnectAttempts = 0;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    setOwnJid(ownerJid);
    broadcast({ type: 'connection', data: 'connected' }, empresaId ?? undefined);
    if (empresaId) {
      const phone = ownerJid ? ownerJid.split('@')[0] : null;
      void setConnectionState(empresaId, true, phone);
    }
    console.log('[WhatsApp] Connected!');
  } else if (state === 'close') {
    connectionStatus = 'disconnected';
    currentQR = null;
    broadcast({ type: 'connection', data: 'disconnected' }, empresaId ?? undefined);
    if (empresaId) {
      void setConnectionState(empresaId, false);
    }
    if (manuallyDisconnected) {
      console.log('[WhatsApp] Disconnected by user — auto-reconnect suppressed.');
      return;
    }
    console.log('[WhatsApp] Disconnected — will auto-reconnect.');
    scheduleReconnect();
  } else if (state === 'connecting') {
    if (manuallyDisconnected) return; // ignore stale connecting events
    connectionStatus = 'connecting';
    broadcast({ type: 'connection', data: 'connecting' }, empresaId ?? undefined);
  }
}

export interface QuotedContext {
  waMessageId: string;
  fromMe: boolean;
  remoteJid: string;
  previewText?: string;
}

function buildQuotedPayload(quoted: QuotedContext) {
  return {
    key: { id: quoted.waMessageId, fromMe: quoted.fromMe, remoteJid: quoted.remoteJid },
    message: { conversation: quoted.previewText ?? '' },
  };
}

export async function sendTextMessage(
  jid: string,
  text: string,
  empresaId?: string | null,
  quoted?: QuotedContext | null,
  instanceOverride?: string,
): Promise<string | null> {
  const instance = instanceOverride || await resolveInstance(empresaId);
  const normalizedText = normalizeWhatsAppTextFormatting(text);
  const res = await axios.post(
    `${BASE_URL}/message/sendText/${instance}`,
    { number: toWhatsmiauNumber(jid), text: normalizedText, ...(quoted ? { quoted: buildQuotedPayload(quoted) } : {}) },
    { headers: apiHeaders() },
  );
  const id = extractWhatsmiauMessageId(res.data) ?? null;
  trackSent(id ?? undefined);
  return id;
}

export interface ButtonDef {
  id: string;
  displayText: string;
  type?: 'reply' | 'pix';
  pixData?: { currency: string; keyType: string; key: string };
}

export async function sendButtonMessage(
  jid: string,
  title: string,
  description: string,
  footer: string,
  buttons: ButtonDef[],
  empresaId?: string | null,
  instanceOverride?: string,
): Promise<string | null> {
  const instance = instanceOverride || await resolveInstance(empresaId);
  const res = await axios.post(
    `${BASE_URL}/message/sendButtons/${instance}`,
    {
      number: toWhatsmiauNumber(jid),
      title: normalizeWhatsAppTextFormatting(title),
      description: normalizeWhatsAppTextFormatting(description),
      footer: normalizeWhatsAppTextFormatting(footer),
      buttons: buttons.map((b) => {
        if (b.type === 'pix' && b.pixData) {
          return { type: 'pix', displayText: b.displayText, id: b.id, ...b.pixData };
        }
        return { type: 'reply', displayText: b.displayText, id: b.id };
      }),
    },
    { headers: apiHeaders() },
  );
  const id = extractWhatsmiauMessageId(res.data) ?? null;
  trackSent(id ?? undefined);
  return id;
}

export async function sendMediaMessage(
  jid: string,
  params: {
    mediatype: 'image' | 'document' | 'video';
    mimetype: string;
    media: string;
    caption?: string;
    fileName?: string;
  },
  empresaId?: string | null,
  quoted?: QuotedContext | null,
  instanceOverride?: string,
): Promise<string | null> {
  const instance = instanceOverride || await resolveInstance(empresaId);
  const normalizedParams = {
    ...params,
    caption: params.caption ? normalizeWhatsAppTextFormatting(params.caption) : undefined,
  };
  const res = await axios.post(
    `${BASE_URL}/message/sendMedia/${instance}`,
    { number: toWhatsmiauNumber(jid), ...normalizedParams, ...(quoted ? { quoted: buildQuotedPayload(quoted) } : {}) },
    { headers: apiHeaders() },
  );
  const id = extractWhatsmiauMessageId(res.data) ?? null;
  trackSent(id ?? undefined);
  return id;
}

// PTT audio — uses a dedicated endpoint (sendWhatsAppAudio) per Whatsmiau docs
export async function sendWhatsAppAudio(
  jid: string,
  audioUrl: string,
  empresaId?: string | null,
  quoted?: QuotedContext | null,
  instanceOverride?: string,
): Promise<string | null> {
  const instance = instanceOverride || await resolveInstance(empresaId);
  const res = await axios.post(
    `${BASE_URL}/message/sendWhatsAppAudio/${instance}`,
    { number: toWhatsmiauNumber(jid), audio: audioUrl, encoding: true, ...(quoted ? { quoted: buildQuotedPayload(quoted) } : {}) },
    { headers: apiHeaders() },
  );
  const id = extractWhatsmiauMessageId(res.data) ?? null;
  trackSent(id ?? undefined);
  return id;
}

export async function sendContactMessage(
  jid: string,
  contact: { fullName: string; phoneNumber: string; organization?: string },
  empresaId?: string | null,
  instanceOverride?: string,
): Promise<string | null> {
  const instance = instanceOverride || await resolveInstance(empresaId);
  const res = await axios.post(
    `${BASE_URL}/message/sendContact/${instance}`,
    {
      number: toWhatsmiauNumber(jid),
      contact: [{
        fullName: contact.fullName,
        phoneNumber: contact.phoneNumber,
        ...(contact.organization ? { organization: contact.organization } : {}),
      }],
    },
    { headers: apiHeaders() },
  );
  const id = extractWhatsmiauMessageId(res.data) ?? null;
  trackSent(id ?? undefined);
  return id;
}

export async function sendStickerMessage(
  jid: string,
  sticker: string,
  empresaId?: string | null,
  quoted?: QuotedContext | null,
  instanceOverride?: string,
): Promise<string | null> {
  const instance = instanceOverride || await resolveInstance(empresaId);
  const res = await axios.post(
    `${BASE_URL}/message/sendSticker/${instance}`,
    { number: toWhatsmiauNumber(jid), sticker, ...(quoted ? { quoted: buildQuotedPayload(quoted) } : {}) },
    { headers: apiHeaders() },
  );
  const id = extractWhatsmiauMessageId(res.data) ?? null;
  trackSent(id ?? undefined);
  return id;
}

export async function fetchProfilePicture(
  jid: string,
  empresaId?: string | null,
): Promise<string | null> {
  try {
    const instance = await resolveInstance(empresaId);
    const res = await axios.get(`${BASE_URL}/chat/fetchProfilePictureUrl/${instance}`, {
      headers: apiHeaders(),
      params: { number: jid },
    });
    return res.data?.profilePictureUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * Per-instance status fetch — bypasses ALL module globals. Queries Whatsmiau
 * directly so each empresa's status is true to its own instance, not the
 * legacy bound singleton's. Used by `/api/status` and `/api/qr` after P1-01.
 *
 * P1.12 — cache de 5s da resposta da lista do Whatsmiau. O endpoint
 * `/evolution/instances` retorna TODAS as instâncias da conta Whatsmiau
 * em cada call. Sem cache, /api/status (chamado a cada 3s pelo
 * WhatsAppIntegrationCard) gera N×3s req/s contra Whatsmiau, vazando o
 * inventário completo de instâncias em todo log de erro. Cache de 5s
 * mantém latência baixa, reduz pressão na API upstream e diminui
 * superfície de exposição. Per-instance endpoint do Evolution
 * (`/instance/connectionState/{instance}`) seria ideal mas não confirmei
 * que Whatsmiau expõe — TODO.
 */
let instancesListCache: { data: any[]; fetchedAt: number } | null = null;
const INSTANCES_LIST_CACHE_TTL_MS = 5_000;

async function fetchInstancesList(): Promise<any[]> {
  const now = Date.now();
  if (instancesListCache && now - instancesListCache.fetchedAt < INSTANCES_LIST_CACHE_TTL_MS) {
    return instancesListCache.data;
  }
  const { data: instances } = await axios.get(`${BASE_URL}/evolution/instances`, {
    headers: apiHeaders(),
    timeout: 10_000,
  });
  const list: any[] = Array.isArray(instances) ? instances : (instances?.data ?? []);
  instancesListCache = { data: list, fetchedAt: now };
  return list;
}

export async function fetchInstanceConnectionState(instanceName: string): Promise<ConnectionStatus> {
  if (!instanceName) return 'disconnected';
  try {
    const list = await fetchInstancesList();
    // Whatsmiau appends _{userId} to whatsmiau_instance_id (e.g. "zelo-abc_d3c6ca80")
    // but we store only the base name. Accept exact match or base-name prefix match.
    const match = list.find((i) => {
      const id: string = i.whatsmiau_instance_id ?? i.name ?? '';
      return id === instanceName || id.startsWith(`${instanceName}_`);
    });
    const status: string = match?.status ?? '';
    if (status === 'CONNECTED' || status === 'open') return 'connected';
    if (status === 'connecting') return 'connecting';
    return 'disconnected';
  } catch (err) {
    console.warn(`[WhatsApp] fetchInstanceConnectionState(${redactInstance(instanceName)}) failed:`, err instanceof Error ? err.message : err);
    return 'disconnected';
  }
}

/**
 * Per-instance QR fetch. Returns either { status: 'connected' } when the
 * instance is already paired, or { status: 'qr', qr } with a fresh data URI.
 *
 * Multi-tenant safe — never reads or mutates the module-level currentQR /
 * connectionStatus globals (which only track the bound singleton).
 */
export async function fetchInstanceQR(instanceName: string): Promise<{ status: ConnectionStatus; qr: string | null; upstreamError?: string; upstreamStatus?: number }> {
  if (!instanceName) return { status: 'disconnected', qr: null, upstreamError: 'instance name vazio' };

  const upstream = await fetchInstanceConnectionState(instanceName);
  if (upstream === 'connected') return { status: 'connected', qr: null };

  // P2.15 — keep the HTTP request fast. Whatsmiau can take a few seconds to
  // propagate a newly created instance; the previous implementation slept
  // 1.5s + 3.5s inside the /api/qr handler. Return "connecting" instead and
  // let the frontend's existing refresh/poll path ask again.
  try {
    const res = await axios.get(`${BASE_URL}/v2/instance/connect/${instanceName}`, {
      headers: apiHeaders(),
      timeout: 10_000,
    });
    if (res.data?.connected === true) {
      return { status: 'connected', qr: null };
    }
    const raw: string = res.data?.base64 ?? res.data?.qrcode?.base64 ?? res.data?.code ?? '';
    if (raw) {
      const qr = raw.startsWith('data:') ? raw : `data:image/png;base64,${raw}`;
      return { status: 'qr', qr };
    }
    return {
      status: 'connecting',
      qr: null,
      upstreamError: 'o WhatsApp ainda não retornou o QR; tente novamente em alguns segundos',
    };
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    const msg = err instanceof Error ? err.message : String(err);
    const upstreamError = status ? `whatsmiau ${status}: ${msg}` : msg;
    console.error(`[WhatsApp] fetchInstanceQR(${redactInstance(instanceName)}) falhou:`, upstreamError);
    // The connect endpoint often holds the request while Whatsmiau starts the
    // pairing session. A client timeout here does not mean the instance is
    // disconnected forever; keep the UI polling instead of stranding the user.
    if (axios.isAxiosError(err) && err.code === 'ECONNABORTED') {
      return { status: 'connecting', qr: null, upstreamError: 'o WhatsApp ainda está preparando o QR Code' };
    }
    return {
      status: 'disconnected',
      qr: null,
      upstreamError: status ? `serviço de WhatsApp ${status}` : 'serviço de WhatsApp indisponível',
      upstreamStatus: status,
    };
  }
}

/**
 * Per-instance logout. Calls Whatsmiau's logout endpoint scoped to a single
 * instance — does NOT touch any module-level state. Safe to call repeatedly.
 */
export async function logoutInstance(instanceName: string): Promise<void> {
  if (!instanceName) throw new Error('logoutInstance: instance name required');
  const url = `${BASE_URL}/v2/instance/logout/${instanceName}`;
  try {
    await axios.delete(url, { headers: apiHeaders(), timeout: 15_000 });
  } catch (err: any) {
    const status = err?.response?.status;
    if (status === 404 || status === 400) return; // already logged out
    throw err;
  }
}

/**
 * Per-instance webhook registration. Used when a brand-new empresa instance
 * is created so Whatsmiau knows where to deliver inbound events for that
 * specific tenant.
 */
export async function setWebhookForInstance(instanceName: string): Promise<void> {
  if (isWebhookRegisterDisabled()) return;
  if (!instanceName) return;
  const webhookUrl = await buildWebhookUrl(instanceName);
  console.log(`[WhatsmiauTrace] register_instance_start instance=${redactInstance(instanceName)} webhook=${redactWebhookUrl(webhookUrl)}`);
  if (isLocalWebhookUrl(webhookUrl) && !allowLocalWebhookRegister()) {
    console.warn(`[WhatsApp] refusing to register local webhook URL for instance "${redactInstance(instanceName)}". Set WEBHOOK_PUBLIC_URL/PUBLIC_APP_URL or WHATSMIAU_ALLOW_LOCAL_WEBHOOK_REGISTER=1 for an isolated sandbox.`);
    return;
  }
  try {
    await axios.post(
      `${BASE_URL}/webhook/set/${instanceName}`,
      {
        webhook: {
          enabled: true,
          url: webhookUrl,
          webhookByEvents: false,
          base64: true,
          events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'MESSAGES_DELETE', 'CONNECTION_UPDATE', 'CONTACTS_UPSERT'],
        },
      },
      { headers: apiHeaders() },
    );
    try {
      await axios.put(
        `${BASE_URL}/v2/instance/update/${instanceName}`,
        {
          webhook: {
            enabled: true,
            url: webhookUrl,
            base64: true,
            events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'MESSAGES_DELETE', 'CONNECTION_UPDATE', 'CONTACTS_UPSERT'],
          },
        },
        { headers: { ...apiHeaders(), 'Content-Type': 'application/json' } },
      );
    } catch {
      // Non-fatal — the /webhook/set call above already enables it. The /v2/instance/update
      // is a redundancy belt that's only needed for media base64 propagation.
    }
    console.log(`[WhatsmiauTrace] register_instance_done instance=${redactInstance(instanceName)} webhook=${redactWebhookUrl(webhookUrl)}`);
  } catch (err) {
    console.error(`[WhatsmiauTrace] register_instance_error instance=${redactInstance(instanceName)} webhook=${redactWebhookUrl(webhookUrl)}:`, err instanceof Error ? err.message : err);
  }
}

export async function fetchQR(): Promise<void> {
  // If user manually disconnected, do not silently re-pair. Caller must first
  // call reconnectWhatsApp() (wired to an explicit "Gerar QR Code" click).
  if (manuallyDisconnected) {
    console.log('[WhatsApp] fetchQR skipped — session was manually disconnected.');
    connectionStatus = 'disconnected';
    currentQR = null;
    return;
  }

  // 1. Check real connection state via instances list (connectionState endpoint is not supported)
  try {
    const { data: instances } = await axios.get(`${BASE_URL}/evolution/instances`, {
      headers: apiHeaders(),
    });
    const list: any[] = Array.isArray(instances) ? instances : (instances?.data ?? []);
    const instance = list.find(
      (i) => (i.whatsmiau_instance_id ?? i.name ?? '') === INSTANCE_NAME || i.id === instanceInternalId,
    ) ?? list[0];

    const status: string = instance?.status ?? '';
    console.log('[WhatsApp] fetchQR: instance status from API =', status);

    if (status === 'CONNECTED' || status === 'open') {
      connectionStatus = 'connected';
      currentQR = null;
      // Scope the broadcast to the bound (legacy) empresa — without this, every
      // connected WS client (including tenants with their own instances) would
      // see Donutopia's connection events.
      broadcastLegacyLifecycleEvent({ type: 'connection', data: 'connected' });
      console.log('[WhatsApp] fetchQR: already connected — no QR needed.');
      return;
    }
  } catch {
    // continue to QR generation
  }

  // 2. Try to get QR code via v2 endpoint. Whatsmiau migrou silenciosamente:
  // /evolution/instance/connect/* agora retorna 500 "invalid instance id".
  // /v2/instance/connect/{name} aceita tanto instanceName quanto id composto.
  const ids = [instanceInternalId, INSTANCE_NAME].filter(Boolean);
  for (const id of ids) {
    try {
      const res = await axios.get(`${BASE_URL}/v2/instance/connect/${id}`, {
        headers: apiHeaders(),
      });
      console.log('[WhatsApp] Connect response keys:', Object.keys(res.data ?? {}));
      console.log('[WhatsApp] Connect response (trimmed):', JSON.stringify(res.data)?.slice(0, 400));

      // Whatsmiau returns {"connected":true} when already paired
      if (res.data?.connected === true) {
        connectionStatus = 'connected';
        currentQR = null;
        broadcastLegacyLifecycleEvent({ type: 'connection', data: 'connected' });
        console.log('[WhatsApp] fetchQR: already connected (connect endpoint confirmed).');
        return;
      }

      const raw: string = res.data?.base64 ?? res.data?.qrcode?.base64 ?? res.data?.code ?? '';
      if (raw) {
        currentQR = raw.startsWith('data:') ? raw : `data:image/png;base64,${raw}`;
        connectionStatus = 'qr';
        broadcastLegacyLifecycleEvent({ type: 'qr', data: currentQR });
        console.log('[WhatsApp] QR code ready — scan with your phone');
        return;
      }
      console.warn('[WhatsApp] Connect response had no QR field:', JSON.stringify(res.data)?.slice(0, 400));
    } catch (err) {
      console.error(`[WhatsApp] fetchQR error for id "${redactInstance(id)}":`, err instanceof Error ? err.message : err);
    }
  }

  throw new Error('Não foi possível obter o QR Code. Verifique as credenciais da API Whatsmiau.');
}

export async function startWhatsApp(): Promise<void> {
  if (!API_KEY) {
    console.error('[WhatsApp] WHATSMIAU_API_KEY is not set. Add it to your .env file.');
    return;
  }

  // 1. Resolve instance — use existing if plan limit reached
  try {
    const { data: instances } = await axios.get(`${BASE_URL}/evolution/instances`, {
      headers: apiHeaders(),
    });
    const list: any[] = Array.isArray(instances) ? instances : (instances?.data ?? []);
    console.log(`[WhatsApp] Instances found: count=${list.length}`);

    const resolveName = (i: any): string =>
      i.whatsmiau_instance_id ?? i.name ?? i.instanceName ?? i.instance?.instanceName ?? '';

    const named = list.find((i) => resolveName(i) === INSTANCE_NAME);

    const resolvedInstance = named ?? (list.length > 0 ? list[0] : null);
    if (resolvedInstance) {
      INSTANCE_NAME = resolveName(resolvedInstance) || INSTANCE_NAME;
      instanceInternalId = resolvedInstance.id ?? '';
      setOwnJid(resolvedInstance.ownerJid ?? resolvedInstance.owner ?? resolvedInstance.phoneNumber ?? '');
      console.log(`[WhatsApp] Using instance "${redactInstance(INSTANCE_NAME)}" (id: ${redactInstance(instanceInternalId)}).`);

      // Check if already connected via status field (connectionState endpoint is not supported)
      const instanceStatus: string = resolvedInstance.status ?? '';
      if (instanceStatus === 'CONNECTED' || instanceStatus === 'open') {
        connectionStatus = 'connected';
        broadcastLegacyLifecycleEvent({ type: 'connection', data: 'connected' });
        console.log('[WhatsApp] Already connected!');
      }
    } else {
      await axios.post(
        `${BASE_URL}/evolution/instance/create`,
        { instanceName: INSTANCE_NAME, qrcode: true, integration: 'WHATSAPP-BAILEYS' },
        { headers: apiHeaders() },
      );
      console.log(`[WhatsApp] Instance "${redactInstance(INSTANCE_NAME)}" created.`);
    }
  } catch (err) {
    console.error('[WhatsApp] Error during instance setup:', err);
  }

  // 2. Register webhook (will re-register automatically if tunnel URL changes)
  await registerWebhook(true);

  if (connectionStatus === 'connected') return;

  await fetchQR();

  // 3. Periodic health check — reconnect if Whatsmiau drops the session silently
  setInterval(async () => {
    if (manuallyDisconnected) return;     // respect explicit user logout
    if (connectionStatus === 'connected') return;
    if (reconnectTimer) return; // reconnect already in progress
    console.log('[WhatsApp] Health check: not connected — triggering reconnect.');
    scheduleReconnect();
  }, 5 * 60 * 1000); // every 5 minutes
}

export async function disconnectWhatsApp(): Promise<void> {
  // Set the flag *first* so that any concurrent webhook events (connection.update),
  // reconnect timers, or /api/qr/refresh polls short-circuit immediately.
  manuallyDisconnected = true;

  // Stop any pending reconnect attempts.
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  reconnectAttempts = 0;

  // Whatsmiau v2 logout is keyed by instance name (not the MongoDB _id).
  // Endpoint lives under /v2/ — docs: https://whatsmiau.dev/docs#instance-logout
  if (INSTANCE_NAME) {
    const logoutUrl = `${BASE_URL}/v2/instance/logout/${INSTANCE_NAME}`;
    console.log(`[WhatsApp] Logout URL: ${logoutUrl}`);
    try {
      await axios.delete(logoutUrl, {
        headers: apiHeaders(),
        timeout: 15_000,
      });
      console.log('[WhatsApp] Whatsmiau logout confirmed.');
    } catch (err: any) {
      const status = err?.response?.status;
      // 404 / 400 → instance is already logged out upstream. Treat as success
      // so repeated clicks don't error.
      if (status === 404 || status === 400) {
        console.log('[WhatsApp] Logout: instance already disconnected upstream.');
      } else {
        // Non-fatal: roll back the flag so the user can retry, but surface the error.
        console.error('[WhatsApp] Logout request failed:', err instanceof Error ? err.message : err);
        manuallyDisconnected = false;
        throw new Error('Falha ao desconectar o WhatsApp. Tente novamente.');
      }
    }
  }

  // Clear in-memory session state.
  connectionStatus = 'disconnected';
  currentQR = null;
  ownJid = '';

  broadcastLegacyLifecycleEvent({ type: 'connection', data: 'disconnected' });
  console.log('[WhatsApp] Disconnected by user.');
}

/**
 * Queries Whatsmiau for the instance's actual status and syncs our in-memory
 * `connectionStatus` to ground truth. Broadcasts to WS if the state changed.
 *
 * Use this after disconnect/connect actions to avoid showing stale UI when
 * the upstream state diverges from our local cache (e.g. if the logout
 * request silently failed or the device re-paired on its own).
 */
export async function syncStatusFromUpstream(): Promise<ConnectionStatus> {
  try {
    const { data: instances } = await axios.get(`${BASE_URL}/evolution/instances`, {
      headers: apiHeaders(),
      timeout: 10_000,
    });
    const list: any[] = Array.isArray(instances) ? instances : (instances?.data ?? []);
    const instance = list.find(
      (i) => (i.whatsmiau_instance_id ?? i.name ?? '') === INSTANCE_NAME || i.id === instanceInternalId,
    );
    const upstreamStatus: string = instance?.status ?? '';
    const resolved: ConnectionStatus =
      upstreamStatus === 'CONNECTED' || upstreamStatus === 'open' ? 'connected' : 'disconnected';

    if (resolved !== connectionStatus) {
      connectionStatus = resolved;
      if (resolved === 'disconnected') currentQR = null;
      broadcastLegacyLifecycleEvent({ type: 'connection', data: resolved });
      console.log(`[WhatsApp] Status synced from upstream → ${resolved}`);
    }
  } catch (err) {
    console.warn('[WhatsApp] syncStatusFromUpstream failed:', err instanceof Error ? err.message : err);
  }
  return connectionStatus;
}

/**
 * Re-arms the connection logic after a manual disconnect. Call this from the
 * explicit "Gerar QR Code" path so that fetchQR() and the reconnect scheduler
 * start working again.
 */
export async function reconnectWhatsApp(): Promise<void> {
  if (manuallyDisconnected) {
    console.log('[WhatsApp] Clearing manual-disconnect flag — user requested new QR.');
    manuallyDisconnected = false;
    reconnectAttempts = 0;
  }
}

// ─── Typing / Presence ───────────────────────────────────────────────────────

export type PresenceType = 'composing' | 'paused' | 'available' | 'unavailable';

export async function sendPresence(
  jid: string,
  presence: PresenceType,
  delayMs = 0,
  empresaId?: string | null,
): Promise<void> {
  if (process.env.ZELOCHAT_DISABLE_WHATSAPP_NETWORK === '1') return;
  try {
    const instance = await resolveInstance(empresaId);
    await axios.post(
      `${BASE_URL}/chat/sendPresence/${instance}`,
      { number: toWhatsmiauNumber(jid), presence, ...(delayMs > 0 ? { delay: delayMs } : {}) },
      { headers: apiHeaders() },
    );
  } catch (err) {
    // Non-fatal — don't let presence failure block message delivery
    console.warn('[WhatsApp] sendPresence error:', err instanceof Error ? err.message : err);
  }
}

// ─── Mark as Read ─────────────────────────────────────────────────────────────

export async function markWhatsAppMessageAsRead(
  jid: string,
  messageId: string,
  empresaId?: string | null,
): Promise<void> {
  if (process.env.ZELOCHAT_DISABLE_WHATSAPP_NETWORK === '1') return;
  try {
    const instance = await resolveInstance(empresaId);
    await axios.post(
      `${BASE_URL}/chat/markMessageAsRead/${instance}`,
      { readMessages: [{ remoteJid: jid, id: messageId }] },
      { headers: apiHeaders() },
    );
  } catch (err) {
    // Non-fatal — read receipt failure must not block the reply pipeline.
    // Mirrors sendPresence's posture above.
    console.warn('[WhatsApp] markMessageAsRead error:', err instanceof Error ? err.message : err);
  }
}

// ─── Validate Numbers ─────────────────────────────────────────────────────────

export async function validateWhatsAppNumbers(
  numbers: string[],
  empresaId?: string | null,
): Promise<{ number: string; exists: boolean; jid?: string }[]> {
  const instance = await resolveInstance(empresaId);
  const res = await axios.post(
    `${BASE_URL}/chat/whatsappNumbers/${instance}`,
    { numbers },
    { headers: apiHeaders() },
  );
  return res.data ?? [];
}

// ─── Interactive List ─────────────────────────────────────────────────────────

export interface ListRow { title: string; description?: string; rowId: string }
export interface ListSection { title: string; rows: ListRow[] }

export async function sendListMessage(
  jid: string,
  params: {
    title?: string;
    description: string;
    buttonText: string;
    footerText?: string;
    sections: ListSection[];
    delay?: number;
  },
  empresaId?: string | null,
  instanceOverride?: string,
): Promise<string | null> {
  const instance = instanceOverride || await resolveInstance(empresaId);
  const res = await axios.post(
    `${BASE_URL}/message/sendList/${instance}`,
    { number: toWhatsmiauNumber(jid), ...params },
    { headers: apiHeaders() },
  );
  const id = extractWhatsmiauMessageId(res.data) ?? null;
  trackSent(id ?? undefined);
  return id;
}

// ─── Location ─────────────────────────────────────────────────────────────────

export async function sendLocationMessage(
  jid: string,
  params: { latitude: number; longitude: number; name?: string; address?: string; delay?: number },
  empresaId?: string | null,
  instanceOverride?: string,
): Promise<string | null> {
  const instance = instanceOverride || await resolveInstance(empresaId);
  const res = await axios.post(
    `${BASE_URL}/message/sendLocation/${instance}`,
    { number: toWhatsmiauNumber(jid), ...params },
    { headers: apiHeaders() },
  );
  const id = extractWhatsmiauMessageId(res.data) ?? null;
  trackSent(id ?? undefined);
  return id;
}

// ─── Reaction ─────────────────────────────────────────────────────────────────

export async function sendReaction(
  jid: string,
  messageId: string,
  reaction: string,
  fromMe = false,
  empresaId?: string | null,
  instanceOverride?: string,
): Promise<string | null> {
  const instance = instanceOverride || await resolveInstance(empresaId);
  const res = await axios.post(
    `${BASE_URL}/message/sendReaction/${instance}`,
    { reaction, key: { remoteJid: jid, id: messageId, fromMe } },
    { headers: apiHeaders() },
  );
  const id = extractWhatsmiauMessageId(res.data) ?? null;
  trackSent(id ?? undefined);
  return id;
}

// ─── Poll ─────────────────────────────────────────────────────────────────────

export async function sendPollMessage(
  jid: string,
  params: { name: string; values: string[]; selectableCount?: number; delay?: number },
  empresaId?: string | null,
  instanceOverride?: string,
): Promise<string | null> {
  const instance = instanceOverride || await resolveInstance(empresaId);
  const res = await axios.post(
    `${BASE_URL}/message/sendPoll/${instance}`,
    { number: toWhatsmiauNumber(jid), ...params },
    { headers: apiHeaders() },
  );
  const id = extractWhatsmiauMessageId(res.data) ?? null;
  trackSent(id ?? undefined);
  return id;
}

// ─── Revoke Message ───────────────────────────────────────────────────────────

export async function revokeMessage(
  jid: string,
  messageId: string,
  fromMe = true,
  empresaId?: string | null,
): Promise<void> {
  const instance = await resolveInstance(empresaId);
  await axios.delete(v2Url(`/chat/deleteMessageForEveryone/${instance}`), {
    headers: apiHeaders(),
    data: { id: messageId, remoteJid: jid, fromMe },
  });
}
