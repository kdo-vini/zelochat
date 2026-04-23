import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatAttachment, ChatMessage, ChatSession } from '../types';
import { WS_URL } from '../config';
import {
  bindEmpresa,
  deleteSession as deleteSessionApi,
  fetchProfilePicture as fetchProfilePictureApi,
  getSession,
  getSessions,
  markSessionRead,
  sendMessage,
  setSessionAutoReply,
  updateSessionName as updateSessionNameApi,
} from '../services/waApi';

type SessionEventPayload = {
  sessionId: string;
  customerName?: string;
  customerPhone?: string;
  message: ChatMessage;
  autoReply?: boolean;
  unreadCount?: number;
  lastMessage?: string;
  lastMessageTime?: string;
};

type WsEvent =
  | { type: 'message'; data: SessionEventPayload }
  | { type: 'message_sent'; data: SessionEventPayload }
  | { type: 'qr' | 'connection'; data: unknown };

function upsertMessage(messages: ChatMessage[], next: ChatMessage): ChatMessage[] {
  if (messages.some((message) => message.id === next.id)) {
    return messages;
  }

  return [...messages, next];
}

function mergeSessions(previous: ChatSession[], incoming: ChatSession[]): ChatSession[] {
  const previousById = new Map(previous.map((session) => [session.id, session]));

  return incoming.map((session) => {
    const existing = previousById.get(session.id);
    return {
      ...session,
      messages: existing?.messages ?? session.messages ?? [],
      alerts: existing?.alerts ?? session.alerts,
    };
  });
}

function reorderSessionToTop(sessions: ChatSession[], sessionId: string): ChatSession[] {
  const index = sessions.findIndex((session) => session.id === sessionId);
  if (index <= 0) {
    return sessions;
  }

  const next = [...sessions];
  const [session] = next.splice(index, 1);
  next.unshift(session);
  return next;
}

export function useWhatsAppSessions(token: string | null) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (!token) {
      setSessions([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await bindEmpresa(token);
      const nextSessions = await getSessions(token);
      setSessions((previous) => mergeSessions(previous, nextSessions));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar as conversas.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  const hydrateSession = useCallback(async (jid: string) => {
    if (!token || !jid) return;

    try {
      const session = await getSession(token, jid);
      setSessions((previous) => {
        const exists = previous.some((item) => item.id === session.id);
        const next = exists
          ? previous.map((item) => (item.id === session.id ? { ...item, ...session } : item))
          : [session, ...previous];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível abrir a conversa.');
    }
  }, [token]);

  const send = useCallback(async (
    jid: string,
    params: { text?: string; attachment?: ChatAttachment },
  ) => {
    if (!token) {
      throw new Error('Faça login para enviar mensagens.');
    }

    await sendMessage(token, jid, {
      message: params.text,
      attachment: params.attachment,
    });
  }, [token]);

  const toggleAutoReply = useCallback(async (jid: string, enabled: boolean) => {
    if (!token) {
      throw new Error('Faça login para alterar o modo de atendimento.');
    }

    setSessions((previous) =>
      previous.map((session) =>
        session.id === jid ? { ...session, autoReply: enabled } : session,
      ),
    );

    try {
      await setSessionAutoReply(token, jid, enabled);
    } catch (error) {
      setSessions((previous) =>
        previous.map((session) =>
          session.id === jid ? { ...session, autoReply: !enabled } : session,
        ),
      );
      throw error;
    }
  }, [token]);

  const deleteSession = useCallback(async (jid: string) => {
    if (!token) {
      throw new Error('Faça login para excluir conversas.');
    }

    await deleteSessionApi(token, jid);
    setSessions((prev) => prev.filter((s) => s.id !== jid));
  }, [token]);

  const fetchProfilePicture = useCallback(async (jid: string): Promise<string | null> => {
    if (!token) return null;
    return fetchProfilePictureApi(token, jid);
  }, [token]);

  const updateSessionName = useCallback(async (jid: string, name: string) => {
    if (!token) throw new Error('Faça login para editar o perfil.');
    await updateSessionNameApi(token, jid, name);
    setSessions((prev) =>
      prev.map((s) => s.id === jid ? { ...s, customerName: name } : s),
    );
  }, [token]);

  const markRead = useCallback(async (jid: string) => {
    if (!jid) return;

    setSessions((previous) =>
      previous.map((session) =>
        session.id === jid ? { ...session, unreadCount: 0 } : session,
      ),
    );

    if (!token) return;

    try {
      await markSessionRead(token, jid);
    } catch {
      // Local optimistic update is enough for the current session list.
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!token) {
      wsRef.current?.close();
      wsRef.current = null;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      return;
    }

    const wsUrl = WS_URL;
    let disposed = false;

    const connect = () => {
      if (disposed) return;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as WsEvent;

          if (parsed.type !== 'message' && parsed.type !== 'message_sent') {
            return;
          }

          const payload = parsed.data;
          const nextLastMessage = payload.lastMessage ?? payload.message.content;
          const nextLastMessageTime = payload.lastMessageTime ?? payload.message.timestamp;

          setSessions((previous) => {
            const existing = previous.find((session) => session.id === payload.sessionId);
            const nextSession: ChatSession = existing
              ? {
                  ...existing,
                  customerName: payload.customerName ?? existing.customerName,
                  customerPhone: payload.customerPhone ?? existing.customerPhone,
                  lastMessage: nextLastMessage,
                  lastMessageTime: nextLastMessageTime,
                  unreadCount:
                    parsed.type === 'message'
                      ? payload.unreadCount ?? existing.unreadCount + 1
                      : existing.unreadCount,
                  autoReply: payload.autoReply ?? existing.autoReply,
                  messages: upsertMessage(existing.messages ?? [], payload.message),
                }
              : {
                  id: payload.sessionId,
                  customerName: payload.customerName ?? payload.sessionId,
                  customerPhone: payload.customerPhone ?? '',
                  lastMessage: nextLastMessage,
                  lastMessageTime: nextLastMessageTime,
                  unreadCount: parsed.type === 'message' ? payload.unreadCount ?? 1 : 0,
                  messages: [payload.message],
                  status: 'active',
                  autoReply: payload.autoReply ?? true,
                };

            const merged = existing
              ? previous.map((session) =>
                  session.id === payload.sessionId ? nextSession : session,
                )
              : [nextSession, ...previous];

            return reorderSessionToTop(merged, payload.sessionId);
          });
        } catch {
          // Ignore malformed WS payloads.
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        reconnectRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [token]);

  return {
    sessions,
    loading,
    error,
    refresh,
    hydrateSession,
    send,
    markRead,
    toggleAutoReply,
    deleteSession,
    fetchProfilePicture,
    updateSessionName,
  };
}
