import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import * as QRCode from 'qrcode';
import path from 'path';
import { broadcast } from './ws.js';

const logger = pino({ level: 'silent' });

const AUTH_DIR = path.resolve(process.cwd(), 'auth_info_baileys');

export type ConnectionStatus = 'disconnected' | 'qr' | 'connecting' | 'connected';

let sock: ReturnType<typeof makeWASocket> | null = null;
let currentQR: string | null = null;
let connectionStatus: ConnectionStatus = 'disconnected';
let messageHandler: ((msg: any) => void) | null = null;

/**
 * Register a callback that will be invoked for every incoming message.
 */
export function onIncomingMessage(handler: (msg: any) => void): void {
  messageHandler = handler;
}

/**
 * Get the current connection status.
 */
export function getStatus(): ConnectionStatus {
  return connectionStatus;
}

/**
 * Get the current QR code as a base64 data URI, or null if not available.
 */
export function getQR(): string | null {
  return currentQR;
}

/**
 * Get the raw Baileys socket instance.
 */
export function getSocket(): ReturnType<typeof makeWASocket> | null {
  return sock;
}

/**
 * Starts the Baileys WhatsApp connection.
 * Handles QR code generation, reconnection, and incoming messages.
 */
export async function startWhatsApp(): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    generateHighQualityLinkPreview: false,
  });

  // --- Connection updates (QR, open, close) ---
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQR = await QRCode.toDataURL(qr);
      connectionStatus = 'qr';
      broadcast({ type: 'qr', data: currentQR });
      console.log('[WhatsApp] QR code generated — scan with your phone');
    }

    if (connection === 'open') {
      currentQR = null;
      connectionStatus = 'connected';
      broadcast({ type: 'connection', data: 'connected' });
      console.log('[WhatsApp] Connected!');
    }

    if (connection === 'close') {
      connectionStatus = 'disconnected';
      broadcast({ type: 'connection', data: 'disconnected' });

      const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = reason !== DisconnectReason.loggedOut;

      console.log(
        `[WhatsApp] Disconnected. Reason: ${reason}. Reconnecting: ${shouldReconnect}`
      );

      if (shouldReconnect) {
        connectionStatus = 'connecting';
        broadcast({ type: 'connection', data: 'connecting' });
        await startWhatsApp();
      } else {
        console.log('[WhatsApp] Logged out. Delete auth_info_baileys/ and scan again.');
      }
    }
  });

  // --- Credential updates ---
  sock.ev.on('creds.update', saveCreds);

  // --- Incoming messages ---
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      // Skip status broadcast messages and messages from self
      if (!msg.message) continue;
      if (msg.key.remoteJid === 'status@broadcast') continue;
      if (msg.key.fromMe) continue;

      if (messageHandler) {
        messageHandler(msg);
      }
    }
  });
}
