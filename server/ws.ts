import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';

export type WsEventType = 'qr' | 'connection' | 'message' | 'message_sent' | 'order_created' | 'message_status' | 'message_deleted' | 'contact_update';

export interface WsEvent {
  type: WsEventType;
  data: unknown;
}

let wss: WebSocketServer | null = null;

export function createWsServer(httpServer: Server): WebSocketServer {
  wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    console.log('[WS] Client connected');
    ws.on('close', () => console.log('[WS] Client disconnected'));
  });

  return wss;
}

/**
 * Broadcasts a typed event to all connected WebSocket clients.
 */
export function broadcast(event: WsEvent): void {
  if (!wss) return;
  const payload = JSON.stringify(event);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}
