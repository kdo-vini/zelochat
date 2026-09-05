import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { Server } from 'http';
import { resolveEmpresaIdFromToken } from './supabase.js';
import type { TakeoverSource } from './conversationControl.js';

export type WsEventType =
  | 'qr'
  | 'connection'
  | 'message'
  | 'message_sent'
  | 'message_update'
  | 'order_created'
  | 'message_status'
  | 'message_deleted'
  | 'contact_update'
  | 'ai_enabled'
  | 'session_read'
  | 'session_pinned'
  | 'escalation_triggered'
  | 'escalation_resolved'
  | 'session_status_changed'
  | 'conversation_mode_changed'
  | 'session_tags_updated'
  | 'reaction_update';

export interface ConversationModeChanged {
  type: 'conversation_mode_changed';
  data: {
    sessionIds: string[];
    mode: 'ai' | 'human';
    epoch: string;
    source: TakeoverSource | 'resume';
    changedAt: string;
  };
}

export type WsEvent = ConversationModeChanged | {
  type: Exclude<WsEventType, 'conversation_mode_changed'>;
  data: unknown;
};

let wss: WebSocketServer | null = null;

/**
 * Maps each connected WebSocket to the empresa_id it's authorized for. The
 * browser must send `{ type: "auth", token }` as the first socket message; only
 * after that succeeds do we fan out broadcasts. This keeps the Supabase JWT out
 * of URL logs/history while preserving tenant-scoped delivery.
 */
const clientEmpresa = new WeakMap<WebSocket, {
  authenticated: boolean;
  authenticating: boolean;
  empresaId: string | null;
}>();

const WS_AUTH_TIMEOUT_MS = 10_000;
const WS_MAX_PENDING_BYTES = 1024 * 1024;

/** Bound a disconnected/slow browser's outbound queue and contain I/O errors. */
export function sendWsPayload(client: WebSocket, payload: string): void {
  if (client.bufferedAmount + Buffer.byteLength(payload) > WS_MAX_PENDING_BYTES) {
    client.terminate();
    return;
  }
  try {
    client.send(payload, (error) => { if (error) client.terminate(); });
  } catch {
    client.terminate();
  }
}

function rawDataToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

function parseAuthToken(data: RawData): string | null {
  try {
    const parsed = JSON.parse(rawDataToString(data)) as { type?: unknown; token?: unknown };
    if (parsed.type !== 'auth' || typeof parsed.token !== 'string') return null;
    return parsed.token.length > 0 ? parsed.token : null;
  } catch {
    return null;
  }
}

export function createWsServer(httpServer: Server): WebSocketServer {
  // Browser messages contain only the authentication envelope.
  wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 64 * 1024 });

  wss.on('connection', (ws) => {
    clientEmpresa.set(ws, {
      authenticated: false,
      authenticating: false,
      empresaId: null,
    });

    const authTimeout = setTimeout(() => {
      const state = clientEmpresa.get(ws);
      if (!state?.authenticated && ws.readyState === WebSocket.OPEN) {
        console.warn('[WS] Client disconnected before authentication');
        ws.close(1008, 'Authentication required');
      }
    }, WS_AUTH_TIMEOUT_MS);

    ws.on('error', () => {
      clearTimeout(authTimeout);
      clientEmpresa.delete(ws);
      console.warn('[WS] Socket transport failed; disconnecting client');
      ws.terminate();
    });

    ws.on('message', async (data) => {
      const state = clientEmpresa.get(ws);
      if (!state || state.authenticated || state.authenticating) return;

      const token = parseAuthToken(data);
      if (!token) {
        console.warn('[WS] Invalid auth message');
        ws.close(1008, 'Authentication required');
        return;
      }

      state.authenticating = true;
      try {
        const empresaId = await resolveEmpresaIdFromToken(token);
        if (ws.readyState !== WebSocket.OPEN) return;

        clientEmpresa.set(ws, {
          authenticated: true,
          authenticating: false,
          empresaId,
        });
        clearTimeout(authTimeout);
        sendWsPayload(ws, JSON.stringify({ type: 'auth_ok', data: { empresaId } }));
        console.log(`[WS] Client authenticated (empresa=${empresaId.slice(0, 8)}…)`);
      } catch (err) {
        console.warn('[WS] Token resolve failed:', (err as Error).message);
        ws.close(1008, 'Authentication failed');
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      clientEmpresa.delete(ws);
      console.log('[WS] Client disconnected');
    });
  });

  return wss;
}

/**
 * Broadcasts a typed event. When `empresaId` is provided, fan out only to
 * clients whose auth message resolved to the same empresa. When omitted, fan
 * out only to authenticated clients.
 */
export function broadcast(event: WsEvent, empresaId?: string | null): void {
  if (!wss) return;
  const payload = JSON.stringify(event);
  wss.clients.forEach((client) => {
    if (client.readyState !== WebSocket.OPEN) return;
    const state = clientEmpresa.get(client);
    if (!state?.authenticated) return;

    if (empresaId) {
      // Only deliver to clients on the same empresa. Unauthenticated clients
      // deliberately do NOT receive scoped events.
      if (state.empresaId !== empresaId) return;
    }
    sendWsPayload(client, payload);
  });
}
