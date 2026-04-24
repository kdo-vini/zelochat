import axios from 'axios';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { broadcast } from './ws.js';

const BASE_URL = (process.env.WHATSMIAU_BASE_URL || 'https://api.whatsmiau.dev').replace(/\/$/, '');
const API_KEY = process.env.WHATSMIAU_API_KEY || '';
export let INSTANCE_NAME = process.env.WHATSMIAU_INSTANCE || 'zelochat';
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
let incomingMessageHandler: ((msg: any) => void) | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY_MS = 5 * 60 * 1000; // 5 min cap

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

export async function registerWebhook(force = false): Promise<boolean> {
  const publicUrl = getPublicWebhookUrl();
  const webhookUrl = `${publicUrl}/webhook`;

  if (!force && webhookUrl === lastRegisteredWebhook) return true;

  try {
    await axios.post(
      `${BASE_URL}/webhook/set/${INSTANCE_NAME}`,
      {
        webhook: {
          enabled: true,
          url: webhookUrl,
          webhookByEvents: false,
          webhookBase64: true,
          events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'CONTACTS_UPSERT'],
        },
      },
      { headers: apiHeaders() },
    );
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

export function onIncomingMessage(handler: (msg: any) => void): void {
  incomingMessageHandler = handler;
}

export function dispatchIncomingMessage(msg: any): void {
  if (incomingMessageHandler) {
    incomingMessageHandler(msg);
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return; // already scheduled
  const delay = Math.min(5_000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY_MS);
  reconnectAttempts++;
  console.log(`[WhatsApp] Scheduling reconnect attempt #${reconnectAttempts} in ${delay / 1000}s...`);
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
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

export function handleConnectionUpdate(data: any): void {
  const state: string = data?.state ?? data?.instance?.state ?? '';

  if (state === 'open') {
    connectionStatus = 'connected';
    currentQR = null;
    reconnectAttempts = 0;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    setOwnJid(data?.ownerJid ?? data?.instance?.ownerJid ?? '');
    broadcast({ type: 'connection', data: 'connected' });
    console.log('[WhatsApp] Connected!');
  } else if (state === 'close') {
    connectionStatus = 'disconnected';
    broadcast({ type: 'connection', data: 'disconnected' });
    console.log('[WhatsApp] Disconnected — will auto-reconnect.');
    scheduleReconnect();
  } else if (state === 'connecting') {
    connectionStatus = 'connecting';
    broadcast({ type: 'connection', data: 'connecting' });
  }
}

export async function sendTextMessage(jid: string, text: string): Promise<void> {
  await axios.post(
    `${BASE_URL}/message/sendText/${INSTANCE_NAME}`,
    { number: jid, text },
    { headers: apiHeaders() },
  );
}

export async function sendButtonMessage(
  jid: string,
  title: string,
  description: string,
  footer: string,
  buttons: { id: string; displayText: string }[],
): Promise<void> {
  await axios.post(
    `${BASE_URL}/message/sendButtons/${INSTANCE_NAME}`,
    {
      number: jid,
      title,
      description,
      footer,
      buttons: buttons.map((b) => ({ type: 'reply', displayText: b.displayText, id: b.id })),
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
): Promise<void> {
  await axios.post(
    `${BASE_URL}/message/sendMedia/${INSTANCE_NAME}`,
    { number: jid, ...params },
    { headers: apiHeaders() },
  );
}

// PTT audio — uses a dedicated endpoint (sendWhatsAppAudio) per Whatsmiau docs
export async function sendWhatsAppAudio(jid: string, audioUrl: string): Promise<void> {
  await axios.post(
    `${BASE_URL}/message/sendWhatsAppAudio/${INSTANCE_NAME}`,
    { number: jid, audio: audioUrl, encoding: true },
    { headers: apiHeaders() },
  );
}

export async function fetchProfilePicture(jid: string): Promise<string | null> {
  try {
    const res = await axios.get(`${BASE_URL}/chat/fetchProfilePictureUrl/${INSTANCE_NAME}`, {
      headers: apiHeaders(),
      params: { number: jid },
    });
    return res.data?.profilePictureUrl ?? null;
  } catch {
    return null;
  }
}

export async function fetchQR(): Promise<void> {
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
      broadcast({ type: 'connection', data: 'connected' });
      console.log('[WhatsApp] fetchQR: already connected — no QR needed.');
      return;
    }
  } catch {
    // continue to QR generation
  }

  // 2. Try to get QR code — MongoDB _id first (name-based endpoint returns 500)
  const ids = [instanceInternalId, INSTANCE_NAME].filter(Boolean);
  for (const id of ids) {
    try {
      const res = await axios.get(`${BASE_URL}/evolution/instance/connect/${id}`, {
        headers: apiHeaders(),
      });
      console.log('[WhatsApp] Connect response keys:', Object.keys(res.data ?? {}));
      console.log('[WhatsApp] Connect response (trimmed):', JSON.stringify(res.data)?.slice(0, 400));

      // Whatsmiau returns {"connected":true} when already paired
      if (res.data?.connected === true) {
        connectionStatus = 'connected';
        currentQR = null;
        broadcast({ type: 'connection', data: 'connected' });
        console.log('[WhatsApp] fetchQR: already connected (connect endpoint confirmed).');
        return;
      }

      const raw: string = res.data?.base64 ?? res.data?.qrcode?.base64 ?? res.data?.code ?? '';
      if (raw) {
        currentQR = raw.startsWith('data:') ? raw : `data:image/png;base64,${raw}`;
        connectionStatus = 'qr';
        broadcast({ type: 'qr', data: currentQR });
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
        broadcast({ type: 'connection', data: 'connected' });
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
    if (connectionStatus === 'connected') return;
    if (reconnectTimer) return; // reconnect already in progress
    console.log('[WhatsApp] Health check: not connected — triggering reconnect.');
    scheduleReconnect();
  }, 5 * 60 * 1000); // every 5 minutes
}

export async function disconnectWhatsApp(): Promise<void> {
  if (!instanceInternalId) {
    throw new Error('ID da instância não encontrado. Reinicie o servidor e tente novamente.');
  }
  await axios.delete(`${BASE_URL}/evolution/instance/logout/${instanceInternalId}`, {
    headers: apiHeaders(),
  });
  connectionStatus = 'disconnected';
  currentQR = null;
  broadcast({ type: 'connection', data: 'disconnected' });
  console.log('[WhatsApp] Disconnected by user.');
}
