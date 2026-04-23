import { broadcast } from './ws.js';

/**
 * In-memory store of all WhatsApp sessions and their messages.
 * Keyed by remoteJid (e.g., "5511999998888@s.whatsapp.net").
 */

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface StoredSession {
  id: string; // remoteJid
  customerName: string;
  customerPhone: string;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
  messages: StoredMessage[];
  status: 'active' | 'archived';
  autoReply: boolean;
}

const sessions = new Map<string, StoredSession>();

export function getSession(jid: string): StoredSession | undefined {
  return sessions.get(jid);
}

export function getAllSessions(): StoredSession[] {
  return Array.from(sessions.values());
}

/**
 * Extracts a phone number from a WhatsApp JID.
 * "5511999998888@s.whatsapp.net" → "5511999998888"
 */
function phoneFromJid(jid: string): string {
  return jid.replace(/@.*$/, '');
}

/**
 * Formats a phone number for display.
 * "5511999998888" → "(11) 99999-8888"
 */
function formatPhone(phone: string): string {
  // Remove country code (55) for Brazilian numbers
  const local = phone.startsWith('55') ? phone.slice(2) : phone;
  if (local.length === 11) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  }
  return phone;
}

function nowTimestamp(): string {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Extracts the text content from a Baileys message object.
 */
function extractText(msg: any): string | null {
  const m = msg.message;
  if (!m) return null;

  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage?.caption) return `[📷 Imagem] ${m.imageMessage.caption}`;
  if (m.imageMessage) return '[📷 Imagem]';
  if (m.videoMessage?.caption) return `[🎥 Vídeo] ${m.videoMessage.caption}`;
  if (m.videoMessage) return '[🎥 Vídeo]';
  if (m.audioMessage) return '[🎵 Áudio]';
  if (m.documentMessage) return `[📎 ${m.documentMessage.fileName || 'Documento'}]`;
  if (m.stickerMessage) return '[🏷️ Sticker]';
  if (m.contactMessage) return '[👤 Contato]';
  if (m.locationMessage) return '[📍 Localização]';

  return null;
}

/**
 * Handles an incoming Baileys message: creates or updates the session,
 * stores the message, and broadcasts to the frontend.
 */
export function handleIncomingMessage(msg: any): void {
  const jid = msg.key.remoteJid;
  if (!jid) return;

  const text = extractText(msg);
  if (!text) return;

  const phone = phoneFromJid(jid);
  const pushName = msg.pushName || phone;
  const timestamp = nowTimestamp();
  const messageId = makeId();

  let session = sessions.get(jid);

  if (!session) {
    // Create a new session for this contact
    session = {
      id: jid,
      customerName: pushName,
      customerPhone: formatPhone(phone),
      lastMessage: text,
      lastMessageTime: timestamp,
      unreadCount: 1,
      messages: [],
      status: 'active',
      autoReply: true, // Auto-reply ON by default
    };
    sessions.set(jid, session);
  }

  const storedMsg: StoredMessage = {
    id: messageId,
    role: 'user',
    content: text,
    timestamp,
  };

  session.messages.push(storedMsg);
  session.lastMessage = text;
  session.lastMessageTime = timestamp;
  session.unreadCount += 1;

  // Broadcast to frontend
  broadcast({
    type: 'message',
    data: {
      sessionId: jid,
      customerName: session.customerName,
      customerPhone: session.customerPhone,
      message: storedMsg,
      autoReply: session.autoReply,
    },
  });
}

/**
 * Adds an assistant (outbound) message to the session store.
 */
export function addAssistantMessage(jid: string, content: string): void {
  const session = sessions.get(jid);
  if (!session) return;

  const storedMsg: StoredMessage = {
    id: makeId(),
    role: 'assistant',
    content,
    timestamp: nowTimestamp(),
  };

  session.messages.push(storedMsg);
  session.lastMessage = content;
  session.lastMessageTime = storedMsg.timestamp;

  broadcast({
    type: 'message_sent',
    data: {
      sessionId: jid,
      message: storedMsg,
    },
  });
}

/**
 * Toggles auto-reply for a session.
 */
export function setAutoReply(jid: string, enabled: boolean): void {
  const session = sessions.get(jid);
  if (session) {
    session.autoReply = enabled;
  }
}
