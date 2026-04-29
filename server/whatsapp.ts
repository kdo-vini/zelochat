import axios from 'axios';
import { existsSync, readFileSync, rmSync } from 'fs';
import { resolve } from 'path';
import { broadcast, type WsEvent } from './ws.js';
import { getInstanceForEmpresa, setConnectionState } from './instanceManager.js';
import { getBoundEmpresaId } from './supabase.js';
import { sendDisconnectAlert, sendReconnectConfirmation } from './email.js';

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
// webhook echo that Whatsmiau fires for every outbound API send. TTL: 30 s.
const recentSentIds = new Map<string, number>();
setInterval(() => {
  const cutoff = Date.now() - 30_000;
  for (const [id, ts] of recentSentIds) {
    if (ts < cutoff) recentSentIds.delete(id);
  }
}, 60_000);

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

const AUTH_INFO_DIR = resolve('auth_info_baileys');
function wipeAuthInfo(): void {
  try {
    if (existsSync(AUTH_INFO_DIR)) {
      rmSync(AUTH_INFO_DIR, { recursive: true, force: true });
      console.log('[WhatsApp] auth_info_baileys folder removed.');
    }
  } catch (err) {
    console.warn('[WhatsApp] Failed to remove auth_info_baileys:', err instanceof Error ? err.message : err);
  }
}

function apiHeaders() {
  return { apikey: API_KEY };
}

const TUNNEL_URL_FILE = resolve('.tunnel-url');
let lastRegisteredWebhook = '';

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
  // 1. Explicit WEBHOOK_PUBLIC_URL (manual override)
  // 2. RAILWAY_PUBLIC_DOMAIN (auto-injected by Railway)
  // 3. Cloudflared tunnel file (dev)
  // 4. Localhost (dev fallback)
  if (process.env.WEBHOOK_PUBLIC_URL) return process.env.WEBHOOK_PUBLIC_URL.replace(/\/$/, '');
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  const tunnelUrl = readTunnelUrl();
  if (tunnelUrl) return tunnelUrl.replace(/\/$/, '');
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

  const publicUrl = getPublicWebhookUrl();
  const webhookUrl = `${publicUrl}/webhook/${INSTANCE_NAME}`;

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
    console.log(`[WhatsApp] Webhook registered → ${webhookUrl}`);
    return true;
  } catch (err) {
    console.error('[WhatsApp] Error registering webhook:', err instanceof Error ? err.message : err);
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
      void (async () => {
        const { wasConnected } = await setConnectionState(empresaId, true, phone);
        // Only email on real reconnect (was previously offline — avoids noise on startup).
        if (!wasConnected) void sendReconnectConfirmation(empresaId);
      })();
    }
    console.log('[WhatsApp] Connected!');
  } else if (state === 'close') {
    connectionStatus = 'disconnected';
    currentQR = null;
    broadcast({ type: 'connection', data: 'disconnected' }, empresaId ?? undefined);
    if (empresaId) {
      void (async () => {
        const { wasConnected } = await setConnectionState(empresaId, false);
        // Only email on real disconnect (not on startup / already-offline noise).
        if (wasConnected && !manuallyDisconnected) void sendDisconnectAlert(empresaId);
      })();
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

export async function sendTextMessage(
  jid: string,
  text: string,
  empresaId?: string | null,
): Promise<string | undefined> {
  const instance = await resolveInstance(empresaId);
  const res = await axios.post(
    `${BASE_URL}/message/sendText/${instance}`,
    { number: jid, text },
    { headers: apiHeaders() },
  );
  const id = (res.data as any)?.key?.id as string | undefined;
  trackSent(id);
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
): Promise<void> {
  const instance = await resolveInstance(empresaId);
  await axios.post(
    `${BASE_URL}/message/sendButtons/${instance}`,
    {
      number: jid,
      title,
      description,
      footer,
      buttons: buttons.map((b) => {
        if (b.type === 'pix' && b.pixData) {
          return { type: 'pix', displayText: b.displayText, id: b.id, ...b.pixData };
        }
        return { type: 'reply', displayText: b.displayText, id: b.id };
      }),
    },
    { headers: apiHeaders() },
  );
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
): Promise<string | undefined> {
  const instance = await resolveInstance(empresaId);
  const res = await axios.post(
    `${BASE_URL}/message/sendMedia/${instance}`,
    { number: jid, ...params },
    { headers: apiHeaders() },
  );
  const id = (res.data as any)?.key?.id as string | undefined;
  trackSent(id);
  return id;
}

// PTT audio — uses a dedicated endpoint (sendWhatsAppAudio) per Whatsmiau docs
export async function sendWhatsAppAudio(
  jid: string,
  audioUrl: string,
  empresaId?: string | null,
): Promise<string | undefined> {
  const instance = await resolveInstance(empresaId);
  const res = await axios.post(
    `${BASE_URL}/message/sendWhatsAppAudio/${instance}`,
    { number: jid, audio: audioUrl, encoding: true },
    { headers: apiHeaders() },
  );
  const id = (res.data as any)?.key?.id as string | undefined;
  trackSent(id);
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
 */
export async function fetchInstanceConnectionState(instanceName: string): Promise<ConnectionStatus> {
  if (!instanceName) return 'disconnected';
  try {
    const { data: instances } = await axios.get(`${BASE_URL}/evolution/instances`, {
      headers: apiHeaders(),
      timeout: 10_000,
    });
    const list: any[] = Array.isArray(instances) ? instances : (instances?.data ?? []);
    const match = list.find((i) => (i.whatsmiau_instance_id ?? i.name ?? '') === instanceName);
    const status: string = match?.status ?? '';
    if (status === 'CONNECTED' || status === 'open') return 'connected';
    if (status === 'connecting') return 'connecting';
    return 'disconnected';
  } catch (err) {
    console.warn(`[WhatsApp] fetchInstanceConnectionState(${instanceName}) failed:`, err instanceof Error ? err.message : err);
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
export async function fetchInstanceQR(instanceName: string): Promise<{ status: ConnectionStatus; qr: string | null; upstreamError?: string }> {
  if (!instanceName) return { status: 'disconnected', qr: null, upstreamError: 'instance name vazio' };

  const upstream = await fetchInstanceConnectionState(instanceName);
  if (upstream === 'connected') return { status: 'connected', qr: null };

  // Whatsmiau às vezes retorna sem QR no primeiro request logo após criar a
  // instância — leva uns segundos pra propagar. Tentamos até 3x com backoff.
  const delays = [0, 1500, 3500];
  let lastUpstreamError = '';
  for (const delay of delays) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    try {
      const res = await axios.get(`${BASE_URL}/v2/instance/connect/${instanceName}`, {
        headers: apiHeaders(),
        timeout: 15_000,
      });
      if (res.data?.connected === true) {
        return { status: 'connected', qr: null };
      }
      const raw: string = res.data?.base64 ?? res.data?.qrcode?.base64 ?? res.data?.code ?? '';
      if (raw) {
        const qr = raw.startsWith('data:') ? raw : `data:image/png;base64,${raw}`;
        return { status: 'qr', qr };
      }
      // Resposta válida sem QR — capturar pra contexto (raro)
      lastUpstreamError = 'whatsmiau respondeu sem QR; tentando novamente';
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const msg = err instanceof Error ? err.message : String(err);
      lastUpstreamError = status ? `whatsmiau ${status}: ${msg}` : msg;
      console.error(`[WhatsApp] fetchInstanceQR(${instanceName}) tentativa falhou:`, lastUpstreamError);
    }
  }

  return { status: 'disconnected', qr: null, upstreamError: lastUpstreamError || 'whatsmiau não retornou QR após retries' };
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
  const publicUrl = getPublicWebhookUrl();
  const webhookUrl = `${publicUrl}/webhook/${instanceName}`;
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
    console.log(`[WhatsApp] webhook registered for instance "${instanceName}" → ${webhookUrl}`);
  } catch (err) {
    console.error(`[WhatsApp] setWebhookForInstance(${instanceName}) failed:`, err instanceof Error ? err.message : err);
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
      console.error(`[WhatsApp] fetchQR error for id "${id}":`, err instanceof Error ? err.message : err);
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
    console.log('[WhatsApp] Instances found:', JSON.stringify(list, null, 2));

    const resolveName = (i: any): string =>
      i.whatsmiau_instance_id ?? i.name ?? i.instanceName ?? i.instance?.instanceName ?? '';

    const named = list.find((i) => resolveName(i) === INSTANCE_NAME);

    const resolvedInstance = named ?? (list.length > 0 ? list[0] : null);
    if (resolvedInstance) {
      INSTANCE_NAME = resolveName(resolvedInstance) || INSTANCE_NAME;
      instanceInternalId = resolvedInstance.id ?? '';
      setOwnJid(resolvedInstance.ownerJid ?? resolvedInstance.owner ?? resolvedInstance.phoneNumber ?? '');
      console.log(`[WhatsApp] Using instance "${INSTANCE_NAME}" (id: ${instanceInternalId}).`);

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
      console.log(`[WhatsApp] Instance "${INSTANCE_NAME}" created.`);
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
        throw new Error('Falha ao desconectar no Whatsmiau. Tente novamente.');
      }
    }
  }

  // Wipe legacy local Baileys auth so a stale creds.json can never silently re-auth.
  wipeAuthInfo();

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
  try {
    const instance = await resolveInstance(empresaId);
    await axios.post(
      `${BASE_URL}/chat/sendPresence/${instance}`,
      { number: jid, presence, ...(delayMs > 0 ? { delay: delayMs } : {}) },
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
  const instance = await resolveInstance(empresaId);
  await axios.post(
    `${BASE_URL}/chat/markMessageAsRead/${instance}`,
    { readMessages: [{ remoteJid: jid, id: messageId }] },
    { headers: apiHeaders() },
  );
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
): Promise<void> {
  const instance = await resolveInstance(empresaId);
  await axios.post(
    `${BASE_URL}/message/sendList/${instance}`,
    { number: jid, ...params },
    { headers: apiHeaders() },
  );
}

// ─── Location ─────────────────────────────────────────────────────────────────

export async function sendLocationMessage(
  jid: string,
  params: { latitude: number; longitude: number; name?: string; address?: string; delay?: number },
  empresaId?: string | null,
): Promise<void> {
  const instance = await resolveInstance(empresaId);
  await axios.post(
    `${BASE_URL}/message/sendLocation/${instance}`,
    { number: jid, ...params },
    { headers: apiHeaders() },
  );
}

// ─── Reaction ─────────────────────────────────────────────────────────────────

export async function sendReaction(
  jid: string,
  messageId: string,
  reaction: string,
  fromMe = false,
  empresaId?: string | null,
): Promise<void> {
  const instance = await resolveInstance(empresaId);
  await axios.post(
    `${BASE_URL}/message/sendReaction/${instance}`,
    { reaction, key: { remoteJid: jid, id: messageId, fromMe } },
    { headers: apiHeaders() },
  );
}

// ─── Poll ─────────────────────────────────────────────────────────────────────

export async function sendPollMessage(
  jid: string,
  params: { name: string; values: string[]; selectableCount?: number; delay?: number },
  empresaId?: string | null,
): Promise<void> {
  const instance = await resolveInstance(empresaId);
  await axios.post(
    `${BASE_URL}/message/sendPoll/${instance}`,
    { number: jid, ...params },
    { headers: apiHeaders() },
  );
}

// ─── Revoke Message ───────────────────────────────────────────────────────────

export async function revokeMessage(
  jid: string,
  messageId: string,
  fromMe = true,
  empresaId?: string | null,
): Promise<void> {
  const instance = await resolveInstance(empresaId);
  await axios.delete(`${BASE_URL}/chat/deleteMessageForEveryone/${instance}`, {
    headers: apiHeaders(),
    data: { id: messageId, remoteJid: jid, fromMe },
  });
}
