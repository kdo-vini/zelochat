import { WebSocketServer, WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'http';
import { resolveEmpresaIdFromToken } from './supabase.js';

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
  | 'escalation_triggered'
  | 'escalation_resolved'
  | 'session_status_changed';

export interface WsEvent {
  type: WsEventType;
  data: unknown;
}

let wss: WebSocketServer | null = null;

/**
 * Maps each connected WebSocket to the empresa_id it's authorized for. We
 * authenticate at handshake using the Supabase JWT passed as `?token=…` and
 * scope every broadcast — without this, a connected operator at empresa A
 * receives messages and (worse) escalation events from empresa B.
 *
 * Connections without a resolvable empresa stay in the map with `null` and
 * receive only events explicitly broadcast unscoped (e.g. global QR / connection
 * status, which today don't carry sensitive per-tenant data).
 */
const clientEmpresa = new WeakMap<WebSocket, string | null>();

function parseTokenFromRequest(req: IncomingMessage): string | null {
  if (!req.url) return null;
  try {
    const url = new URL(req.url, 'http://placeholder');
    const token = url.searchParams.get('token');
    return token && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

export function createWsServer(httpServer: Server): WebSocketServer {
  wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', async (ws, req) => {
    clientEmpresa.set(ws, null);
    const token = parseTokenFromRequest(req);
    if (token) {
      try {
        const empresaId = await resolveEmpresaIdFromToken(token);
        clientEmpresa.set(ws, empresaId);
        console.log(`[WS] Client connected (empresa=${empresaId.slice(0, 8)}…)`);
      } catch (err) {
        console.warn('[WS] Token resolve failed — client connected without empresa scope:', (err as Error).message);
      }
    } else {
      console.log('[WS] Client connected (no token — will receive only unscoped events)');
    }
    ws.on('close', () => {
      clientEmpresa.delete(ws);
      console.log('[WS] Client disconnected');
    });
  });

  return wss;
}

/**
 * Broadcasts a typed event. When `empresaId` is provided, fan out only to
 * clients whose handshake JWT resolved to the same empresa. When omitted, fan
 * out to every connected client (use sparingly — only for genuinely global
 * signals like QR / connection status).
 */
export function broadcast(event: WsEvent, empresaId?: string | null): void {
  if (!wss) return;
  const payload = JSON.stringify(event);
  wss.clients.forEach((client) => {
    if (client.readyState !== WebSocket.OPEN) return;
    if (empresaId) {
      const clientEmpresaId = clientEmpresa.get(client);
      // Only deliver to clients on the same empresa. Unauthenticated clients
      // (clientEmpresaId == null) deliberately do NOT receive scoped events.
      if (clientEmpresaId !== empresaId) return;
    }
    client.send(payload);
  });
}
