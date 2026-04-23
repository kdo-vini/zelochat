import { useEffect, useRef, useCallback, useState } from 'react';
import { Dispatch } from 'react';
import { AppAction } from '../state/rootReducer';
import { ChatMessage } from '../types/chat';

const WS_URL = `ws://${window.location.hostname}:3001/ws`;
const API_BASE = `http://${window.location.hostname}:3001`;

export type WhatsAppConnectionStatus = 'disconnected' | 'qr' | 'connecting' | 'connected';

interface UseWhatsAppOptions {
  dispatch: Dispatch<AppAction>;
}

interface UseWhatsAppReturn {
  status: WhatsAppConnectionStatus;
  qrCode: string | null;
  sendMessage: (to: string, message: string) => Promise<boolean>;
  triggerAIReply: (jid: string) => Promise<string | null>;
}

/**
 * React hook that connects to the Baileys server via WebSocket.
 * Receives real-time incoming WhatsApp messages and dispatches them
 * to the app state as ChatSession upserts.
 */
export function useWhatsApp({ dispatch }: UseWhatsAppOptions): UseWhatsAppReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<WhatsAppConnectionStatus>('disconnected');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[useWhatsApp] Connected to server');
      // Fetch initial status
      fetch(`${API_BASE}/api/status`)
        .then((r) => r.json())
        .then((data) => setStatus(data.status))
        .catch(() => {});
    };

    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);

        switch (parsed.type) {
          case 'qr':
            setQrCode(parsed.data);
            setStatus('qr');
            break;

          case 'connection':
            setStatus(parsed.data as WhatsAppConnectionStatus);
            if (parsed.data === 'connected') setQrCode(null);
            break;

          case 'message': {
            // Incoming customer message → upsert session + add message
            const { sessionId, customerName, customerPhone, message } = parsed.data;
            dispatch({
              type: 'chat/upsertSession',
              payload: {
                sessionId,
                customerName,
                customerPhone,
                message: message as ChatMessage,
              },
            });
            break;
          }

          case 'message_sent': {
            // Outbound message confirmation → add message to session
            const { sessionId, message } = parsed.data;
            dispatch({
              type: 'chat/addMessage',
              payload: { sessionId, message: message as ChatMessage },
            });
            break;
          }
        }
      } catch (err) {
        console.error('[useWhatsApp] Failed to parse WS message:', err);
      }
    };

    ws.onclose = () => {
      console.log('[useWhatsApp] Disconnected — reconnecting in 3s');
      reconnectTimeout.current = setTimeout(connect, 3000);
    };

    ws.onerror = (err) => {
      console.error('[useWhatsApp] WebSocket error:', err);
      ws.close();
    };
  }, [dispatch]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const sendMessage = useCallback(async (to: string, message: string): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/api/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, message }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  const triggerAIReply = useCallback(async (jid: string): Promise<string | null> => {
    try {
      const res = await fetch(`${API_BASE}/api/ai/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jid }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.reply || null;
    } catch {
      return null;
    }
  }, []);

  return { status, qrCode, sendMessage, triggerAIReply };
}
