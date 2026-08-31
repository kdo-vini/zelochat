import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AudioTranscriptStatus,
  ChatAttachment,
  ChatMessage,
  ChatSession,
  ChatSessionsQuery,
  EscalationEvent,
  MessageStatus,
  SessionStatus,
  TakeoverSource,
} from '../types';
import { WS_URL } from '../config';
import { isRetryableOutboundFailure } from '../domain/outbound';
import { serializeStructuredMessage } from '../domain/chat';
import {
  acknowledgeSession as acknowledgeSessionApi,
  archiveSessions as archiveSessionsApi,
  bindEmpresa,
  bulkDeleteSessions as bulkDeleteSessionsApi,
  deleteMessage as deleteMessageApi,
  deleteFailedMessage as deleteFailedMessageApi,
  deleteSession as deleteSessionApi,
  escalateSessionManually as escalateSessionManuallyApi,
  fetchProfilePicture as fetchProfilePictureApi,
  getSession,
  getOlderMessages,
  getSessions,
  markSessionRead,
  markSessionsRead,
  resolveSession as resolveSessionApi,
  sendMessage,
  retryFailedMessage as retryFailedMessageApi,
  setSessionAutoReply,
  setSessionPinned as setSessionPinnedApi,
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

type EscalationTriggeredPayload = {
  sessionId: string;
  empresaId: string;
  event: EscalationEvent;
  sessionStatus: SessionStatus;
  escalatedAt: string;
};

type EscalationResolvedPayload = {
  sessionId: string;
  empresaId: string;
  resolvedAt: string;
  resolvedCount: number;
};

type SessionStatusChangedPayload = {
  sessionId: string;
  empresaId: string;
  status: SessionStatus;
  escalatedAt?: string | null;
};

type MessageUpdatePayload = {
  sessionId: string;
  messageId: string;
  patch: {
    audio_transcript?: string | null;
    audio_transcript_status?: AudioTranscriptStatus | null;
  };
};

type MessageDeletedPayload = {
  sessionId: string;
  messageId: string;
  dbMessageId?: string | null;
};

type MessageStatusPayload = {
  messageId: string;
  dbMessageId?: string | null;
  remoteJid?: string;
  status: string;
};

type ReactionUpdatePayload = {
  sessionId: string | null;
  dbMessageId: string;
  targetWaMessageId: string;
  reactions: Array<{ emoji: string; fromMe: boolean }>;
};

export type ConversationModeChangedPayload = {
  sessionIds: string[];
  mode: 'ai' | 'human';
  epoch: string;
  source: TakeoverSource | 'resume';
  changedAt: string;
};

type WsEvent =
  | { type: 'auth_ok'; data: { empresaId: string } }
  | { type: 'message'; data: SessionEventPayload }
  | { type: 'message_sent'; data: SessionEventPayload }
  | { type: 'message_update'; data: MessageUpdatePayload }
  | { type: 'message_status'; data: MessageStatusPayload }
  | { type: 'message_deleted'; data: MessageDeletedPayload }
  | { type: 'reaction_update'; data: ReactionUpdatePayload }
  | { type: 'contact_update'; data: { remoteJid: string, pushName: string, profilePicUrl?: string } }
  | { type: 'escalation_triggered'; data: EscalationTriggeredPayload }
  | { type: 'escalation_resolved'; data: EscalationResolvedPayload }
  | { type: 'session_status_changed'; data: SessionStatusChangedPayload }
  | { type: 'conversation_mode_changed'; data: ConversationModeChangedPayload }
  | { type: 'session_read'; data: { sessionId: string; unreadCount: number } }
  | { type: 'session_pinned'; data: { sessionId: string; pinned: boolean } }
  | { type: 'session_tags_updated'; data: { sessionId: string; tags: { id: string; name: string; color: string; aiInstructions: string | null; empresaId: string; createdAt: string }[] } }
  | { type: 'qr' | 'connection'; data: unknown };

export interface EscalationNotice {
  sessionId: string;
  event: EscalationEvent;
  reEscalated: boolean;
  receivedAt: number;
}

export function upsertMessage(messages: ChatMessage[], next: ChatMessage): ChatMessage[] {
  const index = messages.findIndex((message) => message.id === next.id);
  if (index < 0) return [...messages, next];
  const merged = { ...messages[index], ...next };
  if (Object.keys(merged).every((key) => merged[key as keyof ChatMessage] === messages[index][key as keyof ChatMessage])) {
    return messages;
  }
  return messages.map((message, messageIndex) => messageIndex === index ? merged : message);
}

function removeMessage(messages: ChatMessage[], payload: Pick<MessageDeletedPayload, 'messageId' | 'dbMessageId'>): ChatMessage[] {
  return messages.filter((message) =>
    message.id !== payload.dbMessageId &&
    message.id !== payload.messageId &&
    message.waMessageId !== payload.messageId,
  );
}

export function normalizeMessageStatus(status: string): ChatMessage['status'] | null {
  const value = status.toLowerCase();
  if (value === 'read' || value === 'read_ack') return 'read';
  if (value === 'delivered' || value === 'delivery_ack') return 'delivered';
  if (value === 'sent' || value === 'server_ack') return 'sent';
  if (value === 'failed') return 'failed_before_dispatch';
  if (
    value === 'preparing' || value === 'queued' || value === 'sending' ||
    value === 'dispatch_started' || value === 'failed_before_dispatch' ||
    value === 'delivery_uncertain' || value === 'cancelled'
  ) return value as MessageStatus;
  return null;
}

function toOutboundState(status: ChatMessage['status']): ChatMessage['outboundState'] | undefined {
  if (
    status === 'preparing' || status === 'queued' || status === 'sending' ||
    status === 'dispatch_started' || status === 'sent' ||
    status === 'failed_before_dispatch' || status === 'delivery_uncertain' ||
    status === 'cancelled'
  ) return status;
  return undefined;
}

export function applyConversationModeChanged(
  sessions: ChatSession[],
  payload: ConversationModeChangedPayload,
): ChatSession[] {
  const family = new Set(payload.sessionIds);
  return sessions.map((session) => {
    if (!family.has(session.id)) return session;
    const resumed = payload.source === 'resume' && payload.mode === 'ai';
    return {
      ...session,
      conversationMode: payload.mode,
      conversationEpoch: payload.epoch,
      autoReply: payload.mode === 'ai',
      takeoverSource: resumed ? null : payload.source as TakeoverSource,
      takeoverAt: resumed ? null : payload.changedAt,
    };
  });
}

function isVisibleConversationMessage(message: ChatMessage): boolean {
  return (message.role === 'user' || message.role === 'assistant') && Boolean(message.content);
}

function latestVisibleMessage(messages: ChatMessage[] | undefined): ChatMessage | undefined {
  return [...(messages ?? [])].reverse().find(isVisibleConversationMessage);
}

function parseSessionActivityTime(value: string | null | undefined): number {
  if (!value || /^\d{2}:\d{2}$/.test(value)) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortSessionsForList(sessions: ChatSession[]): ChatSession[] {
  return sessions
    .map((session, index) => ({ session, index }))
    .sort((left, right) => {
      if (!!left.session.pinned !== !!right.session.pinned) {
        return right.session.pinned ? 1 : -1;
      }

      const activityDiff =
        parseSessionActivityTime(right.session.lastMessageTime) -
        parseSessionActivityTime(left.session.lastMessageTime);
      if (activityDiff !== 0) return activityDiff;

      return left.index - right.index;
    })
    .map(({ session }) => session);
}

function applyDeletedMessage(session: ChatSession, payload: MessageDeletedPayload): ChatSession {
  const messages = removeMessage(session.messages ?? [], payload);
  if (messages.length === (session.messages ?? []).length) return session;

  const latest = latestVisibleMessage(messages);
  return {
    ...session,
    messages,
    lastMessage: latest?.preview ?? '',
    lastMessageTime: latest?.timestamp ?? session.lastMessageTime,
  };
}

function mergeSessions(previous: ChatSession[], incoming: ChatSession[]): ChatSession[] {
  const previousById = new Map(previous.map((session) => [session.id, session]));

  return sortSessionsForList(incoming.map((session) => {
    const existing = previousById.get(session.id);
    return {
      ...session,
      conversationMode: session.conversationMode ?? (session.autoReply === false ? 'human' : 'ai'),
      autoReply: (session.conversationMode ?? (session.autoReply === false ? 'human' : 'ai')) === 'ai',
      messages: (existing?.messages ?? session.messages ?? []).map((message) => {
        const status = message.status ? normalizeMessageStatus(message.status) : null;
        return status ? { ...message, status, outboundState: toOutboundState(status) ?? message.outboundState } : message;
      }),
      alerts: existing?.alerts ?? session.alerts,
    };
  }));
}

export function useWhatsAppSessions(token: string | null) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastEscalation, setLastEscalation] = useState<EscalationNotice | null>(null);
  const [waConnected, setWaConnected] = useState<boolean | null>(null);
  const [sessionsCursor, setSessionsCursor] = useState<string | null>(null);
  const [hasMoreSessions, setHasMoreSessions] = useState(false);
  const [loadingMoreSessions, setLoadingMoreSessions] = useState(false);
  const lastSessionQueryRef = useRef<ChatSessionsQuery>({ limit: 50 });
  // P1.33 — track the WebSocket layer separately from the WhatsApp/Whatsmiau
  // connection. The previous state machine only flipped on explicit
  // `connection` events from the server, so when the WS itself dropped the
  // operator's UI showed stale "Conectado". Now `wsConnected` is true only
  // while the socket is open; AppShell reads it to render a "Reconectando…"
  // pill.
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [lastTagsUpdate, setLastTagsUpdate] = useState<{ sessionId: string; tags: { id: string; name: string; color: string; aiInstructions: string | null; empresaId: string; createdAt: string }[]; ts: number } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const connectedAtRef = useRef(0);
  const pendingSendIntentKeysRef = useRef(new Map<string, string>());
  const pendingRetryIntentKeysRef = useRef(new Map<string, string>());

  const refresh = useCallback(async (query: ChatSessionsQuery = {}) => {
    if (!token) {
      setSessions([]);
      setError(null);
      setSessionsCursor(null);
      setHasMoreSessions(false);
      return;
    }

    setLoading(true);
    setError(null);
    const nextQuery: ChatSessionsQuery = { limit: 50, ...query, cursor: null };
    lastSessionQueryRef.current = nextQuery;

    try {
      await bindEmpresa(token);
      const page = await getSessions(token, nextQuery);
      setSessions((previous) => mergeSessions(previous, page.sessions));
      setSessionsCursor(page.nextCursor);
      setHasMoreSessions(page.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar as conversas.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadMoreSessions = useCallback(async () => {
    if (!token || !hasMoreSessions || !sessionsCursor || loadingMoreSessions) return;
    setLoadingMoreSessions(true);
    setError(null);
    try {
      const page = await getSessions(token, {
        ...lastSessionQueryRef.current,
        cursor: sessionsCursor,
      });
      setSessions((previous) => sortSessionsForList([...previous, ...page.sessions.filter((next) => !previous.some((s) => s.id === next.id))]));
      setSessionsCursor(page.nextCursor);
      setHasMoreSessions(page.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar mais conversas.');
    } finally {
      setLoadingMoreSessions(false);
    }
  }, [hasMoreSessions, loadingMoreSessions, sessionsCursor, token]);

  const hydrateSession = useCallback(async (jid: string) => {
    if (!token || !jid) return;

    try {
      const session = await getSession(token, jid);
      setSessions((previous) => {
        const seen = new Set<string>();
        let replaced = false;

        const next = previous.reduce((acc: ChatSession[], item) => {
          if (item.id !== session.id && item.id !== jid) {
            acc.push(item);
            return acc;
          }

          if (!seen.has(session.id)) {
            acc.push({
              ...item,
              ...session,
                  messages: session.messages ?? item.messages ?? [],
                  hasMoreMessages: session.hasMore,
                  alerts: item.alerts ?? session.alerts,
            });
            seen.add(session.id);
            replaced = true;
          }
          return acc;
        }, []);

        return sortSessionsForList(replaced ? next : [{ ...session, hasMoreMessages: session.hasMore }, ...previous]);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível abrir a conversa.');
    }
  }, [token]);

  const loadOlderMessages = useCallback(async (jid: string) => {
    if (!token || !jid) return;
    const current = sessions.find((session) => session.id === jid);
    const oldest = current?.messages?.[0];
    if (!oldest || current?.hasMoreMessages === false) return;

    try {
      const page = await getOlderMessages(token, jid, oldest.timestamp);
      setSessions((previous) =>
        previous.map((session) => {
          if (session.id !== jid) return session;
          const existingIds = new Set((session.messages ?? []).map((message) => message.id));
          const older = page.messages.filter((message) => !existingIds.has(message.id));
          return {
            ...session,
            messages: [...older, ...(session.messages ?? [])],
            hasMoreMessages: page.hasMore,
          };
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar mensagens antigas.');
    }
  }, [sessions, token]);

  const send = useCallback(async (
    jid: string,
    params: { text?: string; attachment?: ChatAttachment; quoted?: { waMessageId: string; fromMe: boolean; remoteJid: string; previewText?: string } | null },
  ) => {
    if (!token) {
      throw new Error('Faça login para enviar mensagens.');
    }

    const intentSignature = JSON.stringify({
      jid,
      text: params.text?.trim() ?? '',
      attachment: params.attachment ? {
        type: params.attachment.type,
        mimeType: params.attachment.mimeType,
        fileName: params.attachment.fileName,
        sizeBytes: params.attachment.sizeBytes ?? null,
        dataUrl: params.attachment.dataUrl ?? null,
      } : null,
      quoted: params.quoted ?? null,
    });
    const idempotencyKey = pendingSendIntentKeysRef.current.get(intentSignature) ?? crypto.randomUUID();
    pendingSendIntentKeysRef.current.set(intentSignature, idempotencyKey);

    try {
      const result = await sendMessage(token, jid, {
        message: params.text,
        attachment: params.attachment,
        quoted: params.quoted,
        idempotencyKey,
      });
      const status = normalizeMessageStatus(result.status) ?? 'queued';
      const timestamp = new Date().toISOString();
      const content = serializeStructuredMessage({ text: params.text, attachment: params.attachment });
      const optimistic: ChatMessage = {
        id: result.messageId,
        role: 'assistant',
        content,
        preview: params.text?.trim() || (params.attachment ? `[${params.attachment.fileName}]` : ''),
        timestamp,
        kind: params.attachment?.type ?? 'text',
        attachment: params.attachment,
        status,
        outboundState: toOutboundState(status),
        outboundOrigin: 'human_zelochat',
        outboundJobId: result.jobId,
        quotedWaId: params.quoted?.waMessageId,
        quotedFromMe: params.quoted?.fromMe,
        quotedPreview: params.quoted?.previewText,
      };
      setSessions((previous) => previous.map((session) => session.id === jid ? {
        ...session,
        conversationMode: 'human',
        autoReply: false,
        takeoverSource: 'zelochat_operator',
        takeoverAt: timestamp,
        lastMessage: optimistic.preview,
        lastMessageTime: timestamp,
        messages: upsertMessage(session.messages ?? [], optimistic),
      } : session));
      pendingSendIntentKeysRef.current.delete(intentSignature);
    } catch (error) {
      throw error;
    }
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

  const deleteMessage = useCallback(async (jid: string, message: ChatMessage) => {
    if (!token) {
      throw new Error('Faca login para apagar mensagens.');
    }
    const isFailedOutgoing = message.role === 'assistant' && isRetryableOutboundFailure(message.status);
    if (!message.waMessageId && !isFailedOutgoing) {
      throw new Error('Esta mensagem ainda nao tem o ID do WhatsApp para apagar para todos.');
    }

    const payload: MessageDeletedPayload = {
      sessionId: jid,
      messageId: message.waMessageId,
      dbMessageId: message.id,
    };

    setSessions((previous) =>
      previous.map((session) =>
        session.id === jid ? applyDeletedMessage(session, payload) : session,
      ),
    );

    try {
      if (isFailedOutgoing) {
        await deleteFailedMessageApi(token, message.id);
        return;
      }
      await deleteMessageApi(token, message.waMessageId, {
        remoteJid: jid,
        fromMe: message.role === 'assistant',
        dbMessageId: message.id,
      });
    } catch (error) {
      void hydrateSession(jid);
      throw error;
    }
  }, [hydrateSession, token]);

  const retryFailedMessage = useCallback(async (jid: string, message: ChatMessage) => {
    if (!token) throw new Error('Faça login para reenviar mensagens.');
    if (message.role !== 'assistant' || !isRetryableOutboundFailure(message.status)) {
      throw new Error('Apenas mensagens que não foram enviadas podem ser reenviadas.');
    }

    setSessions((previous) =>
      previous.map((session) =>
        session.id === jid
          ? { ...session, messages: session.messages.map((item) => item.id === message.id ? { ...item, status: 'sending' } : item) }
          : session,
      ),
    );

    try {
      const idempotencyKey = pendingRetryIntentKeysRef.current.get(message.id) ?? crypto.randomUUID();
      pendingRetryIntentKeysRef.current.set(message.id, idempotencyKey);
      await retryFailedMessageApi(token, message.id, idempotencyKey);
      pendingRetryIntentKeysRef.current.delete(message.id);
    } catch (error) {
      void hydrateSession(jid);
      throw error;
    }
  }, [hydrateSession, token]);

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

  const resolveEscalation = useCallback(async (jid: string) => {
    if (!token) throw new Error('Faça login para resolver a conversa.');
    await resolveSessionApi(token, jid);
    setSessions((previous) =>
      previous.map((session) =>
        session.id === jid
          ? { ...session, status: 'resolved' as SessionStatus, escalatedAt: null }
          : session,
      ),
    );
  }, [token]);

  const escalateManually = useCallback(async (jid: string, reason?: string) => {
    if (!token) throw new Error('Faça login para escalar.');
    await escalateSessionManuallyApi(token, jid, reason);
  }, [token]);

  const acknowledgeEscalation = useCallback(async (jid: string) => {
    if (!token) return;
    try {
      await acknowledgeSessionApi(token, jid);
      setSessions((previous) =>
        previous.map((session) =>
          session.id === jid && session.status === 'escalated'
            ? { ...session, acknowledgedAt: session.acknowledgedAt ?? new Date().toISOString() }
            : session,
        ),
      );
    } catch {
      // best-effort — acknowledgment is purely metric
    }
  }, [token]);

  const dismissEscalation = useCallback(() => setLastEscalation(null), []);

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

  const markManyRead = useCallback(async (jids: string[]) => {
    const targets = jids.filter(Boolean);
    if (targets.length === 0) return;

    const targetSet = new Set(targets);
    setSessions((previous) =>
      previous.map((session) =>
        targetSet.has(session.id) ? { ...session, unreadCount: 0 } : session,
      ),
    );

    if (!token) return;
    try {
      await markSessionsRead(token, targets);
    } catch {
      // Best-effort; the optimistic state already reflects the intent.
    }
  }, [token]);

  const bulkArchive = useCallback(async (jids: string[]) => {
    const targets = jids.filter(Boolean);
    if (targets.length === 0 || !token) return;
    await archiveSessionsApi(token, targets);
    const targetSet = new Set(targets);
    setSessions((previous) =>
      previous.map((session) =>
        targetSet.has(session.id)
          ? { ...session, status: 'archived' as SessionStatus, escalatedAt: null }
          : session,
      ),
    );
  }, [token]);

  const bulkDelete = useCallback(async (jids: string[]) => {
    const targets = jids.filter(Boolean);
    if (targets.length === 0 || !token) return;
    await bulkDeleteSessionsApi(token, targets);
    const targetSet = new Set(targets);
    setSessions((previous) => previous.filter((session) => !targetSet.has(session.id)));
  }, [token]);

  const togglePin = useCallback(async (jid: string) => {
    if (!jid || !token) return;
    let nextPinned = false;
    setSessions((previous) =>
      sortSessionsForList(previous.map((session) => {
        if (session.id !== jid) return session;
        nextPinned = !session.pinned;
        return { ...session, pinned: nextPinned };
      })),
    );
    try {
      await setSessionPinnedApi(token, jid, nextPinned);
    } catch (error) {
      // Roll back on failure so the UI matches server state.
      setSessions((previous) =>
        sortSessionsForList(previous.map((session) =>
          session.id === jid ? { ...session, pinned: !nextPinned } : session,
        )),
      );
      throw error;
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
    reconnectAttemptRef.current = 0;
    connectedAtRef.current = 0;

    const connect = () => {
      if (disposed) return;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        if (disposed || wsRef.current !== ws) return;

        try {
          const parsed = JSON.parse(event.data) as WsEvent;

          if (parsed.type === 'auth_ok') {
            connectedAtRef.current = Date.now();
            setWsConnected(true);
            // Re-bind empresa on every (re)connect so server restarts don't break message routing
            void bindEmpresa(token);
            return;
          }

          if (parsed.type === 'conversation_mode_changed') {
            setSessions((previous) => applyConversationModeChanged(previous, parsed.data));
            return;
          }

          if (parsed.type === 'escalation_triggered') {
            const data = parsed.data;
            setSessions((previous) => {
              const next = previous.map((session) =>
                session.id === data.sessionId
                  ? {
                      ...session,
                      status: 'escalated' as SessionStatus,
                      escalatedAt: data.escalatedAt,
                      autoReply: false,
                    }
                  : session,
              );
              return sortSessionsForList(next);
            });
            setLastEscalation({
              sessionId: data.sessionId,
              event: data.event,
              reEscalated: false,
              receivedAt: Date.now(),
            });
            return;
          }

          if (parsed.type === 'escalation_resolved') {
            const data = parsed.data;
            setSessions((previous) =>
              previous.map((session) =>
                session.id === data.sessionId
                  ? { ...session, status: 'resolved', escalatedAt: null }
                  : session,
              ),
            );
            return;
          }

          if (parsed.type === 'session_status_changed') {
            const data = parsed.data;
            setSessions((previous) =>
              previous.map((session) =>
                session.id === data.sessionId
                  ? {
                      ...session,
                      status: data.status,
                      escalatedAt: data.escalatedAt ?? session.escalatedAt,
                    }
                  : session,
              ),
            );
            return;
          }

          if (parsed.type === 'session_read') {
            const data = parsed.data;
            setSessions((previous) =>
              previous.map((session) =>
                session.id === data.sessionId
                  ? { ...session, unreadCount: data.unreadCount }
                  : session,
              ),
            );
            return;
          }

          if (parsed.type === 'session_pinned') {
            const data = parsed.data;
            setSessions((previous) =>
              sortSessionsForList(previous.map((session) =>
                session.id === data.sessionId
                  ? { ...session, pinned: data.pinned }
                  : session,
              )),
            );
            return;
          }

          if (parsed.type === 'message_update') {
            const { sessionId, messageId, patch } = parsed.data;
            setSessions((previous) =>
              previous.map((session) =>
                session.id === sessionId
                  ? {
                      ...session,
                      messages: session.messages.map((m) =>
                        m.id === messageId ? { ...m, ...patch } : m,
                      ),
                    }
                  : session,
              ),
            );
            return;
          }

          if (parsed.type === 'message_deleted') {
            const data = parsed.data;
            setSessions((previous) =>
              sortSessionsForList(previous.map((session) =>
                session.id === data.sessionId ? applyDeletedMessage(session, data) : session,
              )),
            );
            return;
          }

          if (parsed.type === 'message_status') {
            const nextStatus = normalizeMessageStatus(parsed.data.status);
            if (!nextStatus) return;
            setSessions((previous) =>
              previous.map((session) => ({
                ...session,
                messages: (session.messages ?? []).map((message) => {
                  const matches =
                    message.id === parsed.data.dbMessageId ||
                    message.id === parsed.data.messageId ||
                    message.waMessageId === parsed.data.messageId;
                  return matches ? { ...message, status: nextStatus, outboundState: toOutboundState(nextStatus) ?? message.outboundState } : message;
                }),
              })),
            );
            return;
          }

          if (parsed.type === 'reaction_update') {
            const { sessionId, dbMessageId, reactions } = parsed.data;
            if (!sessionId) return;
            setSessions((previous) =>
              previous.map((session) => {
                if (session.id !== sessionId) return session;
                return {
                  ...session,
                  messages: session.messages.map((msg) =>
                    msg.id === dbMessageId ? { ...msg, reactions } : msg,
                  ),
                };
              }),
            );
            return;
          }

          if (parsed.type === 'contact_update') {
            setSessions((previous) => previous.map((session) => 
              session.id === (parsed.data as any).remoteJid && (parsed.data as any).profilePicUrl
                ? { ...session, profilePicUrl: (parsed.data as any).profilePicUrl, customerName: (parsed.data as any).pushName || session.customerName }
                : session
            ));
            return;
          }

          if (parsed.type === 'connection') {
            const status = parsed.data as string;
            setWaConnected(status === 'connected');
            return;
          }

          if (parsed.type === 'session_tags_updated') {
            setLastTagsUpdate({ ...parsed.data, ts: Date.now() });
            return;
          }

          if (parsed.type !== 'message' && parsed.type !== 'message_sent') {
            return;
          }

          const payload = parsed.data;
          const payloadStatus = payload.message.status ? normalizeMessageStatus(payload.message.status) : null;
          const nextMessage = payloadStatus
            ? { ...payload.message, status: payloadStatus, outboundState: toOutboundState(payloadStatus) ?? payload.message.outboundState }
            : payload.message;
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
                  messages: upsertMessage(existing.messages ?? [], nextMessage),
                }
              : {
                  id: payload.sessionId,
                  customerName: payload.customerName ?? payload.sessionId,
                  customerPhone: payload.customerPhone ?? '',
                  lastMessage: nextLastMessage,
                  lastMessageTime: nextLastMessageTime,
                  unreadCount: parsed.type === 'message' ? payload.unreadCount ?? 1 : 0,
                  messages: [nextMessage],
                  status: 'active',
                  autoReply: payload.autoReply ?? true,
                  conversationMode: payload.autoReply === false ? 'human' : 'ai',
                };

            const merged = existing
              ? previous.map((session) =>
                  session.id === payload.sessionId ? nextSession : session,
                )
              : [nextSession, ...previous];

            return sortSessionsForList(merged);
          });
        } catch {
          // Ignore malformed WS payloads.
        }
      };

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'auth', token }));
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (disposed) return;
        // Reset backoff counter when the connection was stable for ≥10s
        const stableMs = connectedAtRef.current > 0 ? Date.now() - connectedAtRef.current : 0;
        if (stableMs >= 10_000) reconnectAttemptRef.current = 0;
        connectedAtRef.current = 0;
        const attempt = reconnectAttemptRef.current++;
        // Exponential: 1s→2s→4s→8s→16s→30s cap, ±25% jitter to stagger tabs
        const base = Math.min(1_000 * 2 ** attempt, 30_000);
        const jitter = 0.75 + Math.random() * 0.5;
        reconnectRef.current = setTimeout(connect, Math.round(base * jitter));
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
    loadMoreSessions,
    hasMoreSessions,
    loadingMoreSessions,
    hydrateSession,
    loadOlderMessages,
    send,
    markRead,
    markManyRead,
    bulkArchive,
    bulkDelete,
    togglePin,
    toggleAutoReply,
    deleteSession,
    deleteMessage,
    retryFailedMessage,
    fetchProfilePicture,
    updateSessionName,
    lastEscalation,
    dismissEscalation,
    resolveEscalation,
    escalateManually,
    acknowledgeEscalation,
    waConnected,
    wsConnected,
    lastTagsUpdate,
  };
}
