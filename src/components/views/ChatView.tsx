import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  Bot,
  Check,
  FileText,
  ImagePlus,
  Info,
  Loader2,
  MessageCircle,
  Mic,
  MicOff,
  MoreVertical,
  Paperclip,
  Pencil,
  Phone,
  Plus,
  Search,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { formatLastMessageTime, normalizePhoneNumber } from '../../domain/chat';
import { getManualChatAssistSuggestion, getOwnerResponse } from '../../services/openaiService';
import type { ChatAttachment, ChatSession, QuickResponse } from '../../types';
import { MessageBubble } from './MessageBubble';
import { EscaladoBadge } from '../shared/EscaladoBadge';
import { SlaTimer } from '../shared/SlaTimer';
import { EscalationLogCard } from '../shared/EscalationLogCard';
import { useEscalationEvents } from '../../hooks/useEscalationEvents';
import { ConfirmModal } from '../ConfirmModal';
import { ContactAvatar } from '../ContactAvatar';
import { Modal, useModalTitleId } from '../Modal';
import { getFriendlyErrorMessage } from '../../services/errorMessages';

/* ─── Utilities ───────────────────────────────────────────────── */

const CHAT_SESSION_ROW_HEIGHT = 73;
const CHAT_LIST_OVERSCAN = 8;
const CHAT_LIST_VIRTUALIZE_AFTER = 80;

function formatPhoneDisplay(phone: string): string {
  if (!phone) return phone;
  const digits = normalizePhoneNumber(phone);
  const local = digits.startsWith('55') ? digits.slice(2) : digits;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return phone;
}

function formatAttachmentSize(sizeBytes?: number): string {
  if (!sizeBytes) return 'Arquivo';
  if (sizeBytes < 1024 * 1024) return `${Math.max(sizeBytes / 1024, 1).toFixed(0)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') { resolve(reader.result); return; }
      reject(new Error('Não foi possível ler o arquivo.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Falha ao ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

/* ─── Props ───────────────────────────────────────────────────── */

export interface ChatViewProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  setActiveSessionId: (id: string | null) => void;
  quickResponses: QuickResponse[];
  chatLoading: boolean;
  chatError: string | null;
  token: string | null;
  authLoading: boolean;
  profilePics: Record<string, string>;
  send: (jid: string, payload: { text: string; attachment?: ChatAttachment }) => Promise<void>;
  toggleAutoReply: (jid: string, enabled: boolean) => Promise<void>;
  updateSessionName: (jid: string, name: string) => Promise<void>;
  hydrateSession: (jid: string) => Promise<void>;
  onDeleteSession: (id: string) => Promise<void>;
  onDailyContextUpdate: (items: { id: string; text: string }[]) => void;
  resolveEscalation: (jid: string) => Promise<void>;
  escalateManually: (jid: string, reason?: string) => Promise<void>;
  acknowledgeEscalation: (jid: string) => Promise<void>;
  /** Bumps when a new escalation event arrives so the sidebar log can refetch. */
  escalationRefetchKey?: string | number | null;
}

/* ─── Component ───────────────────────────────────────────────── */

export function ChatView({
  sessions,
  activeSessionId,
  setActiveSessionId,
  quickResponses,
  chatLoading,
  chatError,
  token,
  authLoading,
  profilePics,
  send,
  toggleAutoReply,
  updateSessionName,
  hydrateSession,
  onDeleteSession,
  onDailyContextUpdate,
  resolveEscalation,
  escalateManually,
  acknowledgeEscalation,
  escalationRefetchKey,
}: ChatViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [ownerInput, setOwnerInput] = useState('');
  const [chatActionError, setChatActionError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<ChatAttachment | null>(null);
  const [attachmentLoading, setAttachmentLoading] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newChatPhone, setNewChatPhone] = useState('');
  const [newChatMessage, setNewChatMessage] = useState('');
  const [newChatLoading, setNewChatLoading] = useState(false);
  const [newChatError, setNewChatError] = useState<string | null>(null);
  const [deleteSessionPending, setDeleteSessionPending] = useState<{ id: string; name: string } | null>(null);
  const [aiAssistMenuOpen, setAiAssistMenuOpen] = useState(false);
  const [aiAssistLoading, setAiAssistLoading] = useState<'improve' | 'reply' | null>(null);
  const newChatTitleId = useModalTitleId();
  const chatListRef = useRef<HTMLDivElement>(null);
  const [chatListScrollTop, setChatListScrollTop] = useState(0);
  const [chatListViewportHeight, setChatListViewportHeight] = useState(0);

  const [isRecording, setIsRecording] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Conversation list width — persisted so the operator's preferred layout survives reloads.
  // Bounds keep at least the avatar+name visible on the lower end and prevent the list from
  // crowding out the chat panel on the upper end.
  const LIST_WIDTH_KEY = 'zelochat:chatListWidth';
  const LIST_WIDTH_MIN = 240;
  const LIST_WIDTH_MAX = 520;
  const LIST_WIDTH_DEFAULT = 300;
  const [listWidth, setListWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return LIST_WIDTH_DEFAULT;
    const stored = Number(window.localStorage.getItem(LIST_WIDTH_KEY));
    if (!Number.isFinite(stored) || stored <= 0) return LIST_WIDTH_DEFAULT;
    return Math.min(LIST_WIDTH_MAX, Math.max(LIST_WIDTH_MIN, stored));
  });
  const isResizingRef = useRef(false);

  const handleListResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return;
      const next = Math.min(LIST_WIDTH_MAX, Math.max(LIST_WIDTH_MIN, ev.clientX));
      setListWidth(next);
    };
    const onUp = () => {
      isResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      // Persist on release so we don't write 200× during the drag.
      setListWidth((current) => {
        try { window.localStorage.setItem(LIST_WIDTH_KEY, String(current)); } catch { /* ignore */ }
        return current;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sessions;
    const queryPhone = normalizePhoneNumber(q);
    return sessions.filter((s) => {
      const phone = normalizePhoneNumber(s.customerPhone);
      return (
        s.customerName.toLowerCase().includes(q) ||
        s.lastMessage.toLowerCase().includes(q) ||
        (!!queryPhone && phone.includes(queryPhone))
      );
    });
  }, [sessions, searchQuery]);

  useEffect(() => {
    const el = chatListRef.current;
    if (!el) return;
    const updateHeight = () => setChatListViewportHeight(el.clientHeight);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setChatListScrollTop(0);
    chatListRef.current?.scrollTo({ top: 0 });
  }, [searchQuery]);

  const chatListWindow = useMemo(() => {
    const shouldVirtualize = filteredSessions.length > CHAT_LIST_VIRTUALIZE_AFTER;
    if (!shouldVirtualize) {
      return {
        sessions: filteredSessions,
        topPad: 0,
        bottomPad: 0,
      };
    }

    const viewport = chatListViewportHeight || 640;
    const start = Math.max(0, Math.floor(chatListScrollTop / CHAT_SESSION_ROW_HEIGHT) - CHAT_LIST_OVERSCAN);
    const visibleCount = Math.ceil(viewport / CHAT_SESSION_ROW_HEIGHT) + CHAT_LIST_OVERSCAN * 2;
    const end = Math.min(filteredSessions.length, start + visibleCount);

    return {
      sessions: filteredSessions.slice(start, end),
      topPad: start * CHAT_SESSION_ROW_HEIGHT,
      bottomPad: (filteredSessions.length - end) * CHAT_SESSION_ROW_HEIGHT,
    };
  }, [chatListScrollTop, chatListViewportHeight, filteredSessions]);

  const activeSessionMessages = useMemo(
    () => sessions.find((s) => s.id === activeSessionId)?.messages,
    [sessions, activeSessionId],
  );

  useEffect(() => {
    setEditingName(false);
    setMobileDetailsOpen(false);
    setAiAssistMenuOpen(false);
  }, [activeSessionId]);

  // Stamp acknowledged_at on the open escalation event the first time the
  // operator opens the escalated chat — used for SLA "time to acknowledge"
  // analytics and to mark the chat as "seen by operator" in the backend.
  useEffect(() => {
    if (activeSession?.status === 'escalated' && !activeSession.acknowledgedAt) {
      void acknowledgeEscalation(activeSession.id);
    }
  }, [activeSession?.id, activeSession?.status, activeSession?.acknowledgedAt, acknowledgeEscalation]);

  const { events: escalationEvents, loading: escalationsLoading } = useEscalationEvents(
    token,
    activeSession?.id ?? null,
    { refetchKey: escalationRefetchKey ?? activeSession?.escalatedAt ?? activeSession?.acknowledgedAt ?? null },
  );

  const [resolvingEscalation, setResolvingEscalation] = useState(false);
  const handleResolveEscalation = async () => {
    if (!activeSession) return;
    setResolvingEscalation(true);
    try {
      await resolveEscalation(activeSession.id);
    } catch (err) {
      setChatActionError(err instanceof Error ? err.message : 'Falha ao marcar como resolvido.');
    } finally {
      setResolvingEscalation(false);
    }
  };

  const handleManualEscalate = async () => {
    if (!activeSession) return;
    try {
      await escalateManually(activeSession.id);
    } catch (err) {
      setChatActionError(err instanceof Error ? err.message : 'Falha ao escalar conversa.');
    }
  };

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [activeSessionId, activeSessionMessages]);

  /* ─── Handlers ──────────────────────────────────────────────── */

  const handleAttachmentSelect = async (
    event: React.ChangeEvent<HTMLInputElement>,
    type: ChatAttachment['type'],
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setAttachmentLoading(true);
    setChatActionError(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setPendingAttachment({
        type,
        mimeType: file.type || (type === 'image' ? 'image/jpeg' : 'application/octet-stream'),
        fileName: file.name,
        sizeBytes: file.size,
        dataUrl,
      });
    } catch (error) {
      setChatActionError(error instanceof Error ? error.message : 'Não foi possível carregar o arquivo.');
    } finally {
      setAttachmentLoading(false);
    }
  };

  const handleAutoReplyToggle = async (enabled: boolean) => {
    if (!activeSession) return;
    setChatActionError(null);
    try {
      await toggleAutoReply(activeSession.id, enabled);
    } catch (error) {
      setChatActionError(error instanceof Error ? error.message : 'Não foi possível atualizar o modo de atendimento.');
    }
  };

  const handleSaveCustomerName = async () => {
    if (!activeSession || !editNameValue.trim()) return;
    try {
      await updateSessionName(activeSession.id, editNameValue.trim());
      setEditingName(false);
    } catch (err) {
      setChatActionError(err instanceof Error ? err.message : 'Não foi possível salvar o nome.');
    }
  };

  const handleStartRecording = async () => {
    setChatActionError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        const dataUrl = await readFileAsDataUrl(new File([blob], `audio.${mimeType.split('/')[1].split(';')[0]}`, { type: mimeType }));
        setPendingAttachment({ type: 'audio', mimeType, fileName: `audio.${mimeType.split('/')[1].split(';')[0]}`, sizeBytes: blob.size, dataUrl });
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch {
      setChatActionError('Não foi possível acessar o microfone. Verifique as permissões do navegador.');
    }
  };

  const handleStopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  const handleOwnerSend = async () => {
    const text = ownerInput.trim();
    if (!text && !pendingAttachment) return;
    if (isSending) return;
    setChatActionError(null);

    if (!pendingAttachment && text.startsWith('/')) {
      const cmd = text.slice(1).toUpperCase();
      const qr = quickResponses.find((r) => r.trigger === cmd);
      if (qr) {
        if (!activeSessionId) { setChatActionError('Selecione uma conversa para enviar a resposta rápida.'); return; }
        setIsSending(true);
        try { await send(activeSessionId, { text: qr.response }); setOwnerInput(''); }
        catch (e) { setChatActionError(e instanceof Error ? e.message : 'Não foi possível enviar.'); }
        finally { setIsSending(false); }
        return;
      }
      try {
        const result = await getOwnerResponse(text.slice(1));
        const newCtx = (result as string[]).map((t) => ({ id: crypto.randomUUID(), text: t }));
        onDailyContextUpdate(newCtx);
        setOwnerInput('');
      } catch { setChatActionError('Não foi possível atualizar o contexto da IA agora.'); }
      return;
    }

    if (!activeSessionId) { setChatActionError('Selecione uma conversa para enviar uma mensagem.'); return; }
    setIsSending(true);
    try {
      await send(activeSessionId, { text, attachment: pendingAttachment ?? undefined });
      setOwnerInput('');
      setPendingAttachment(null);
    } catch (e) {
      setChatActionError(e instanceof Error ? e.message : 'Não foi possível enviar.');
    } finally {
      setIsSending(false);
    }
  };

  const handleAiAssist = async (mode: 'improve' | 'reply') => {
    if (!activeSession) return;
    if (activeSession.autoReply) {
      setChatActionError('Essa ajuda de IA fica disponível quando o atendimento está em modo manual.');
      return;
    }
    if (mode === 'improve' && !ownerInput.trim()) {
      setChatActionError('Digite uma mensagem primeiro para a IA melhorar o texto.');
      return;
    }

    setAiAssistMenuOpen(false);
    setAiAssistLoading(mode);
    setChatActionError(null);
    try {
      const suggestion = await getManualChatAssistSuggestion(activeSession.messages, {
        mode,
        draft: ownerInput,
        customerName: activeSession.customerName,
      });
      setOwnerInput(suggestion.trim());
    } catch (error) {
      setChatActionError(getFriendlyErrorMessage(error) || 'Não foi possível gerar a sugestão agora.');
    } finally {
      setAiAssistLoading(null);
    }
  };

  const handleStartNewConversation = async () => {
    let digits = normalizePhoneNumber(newChatPhone.trim());
    if (!digits) { setNewChatError('Digite um número de telefone válido.'); return; }
    if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
      digits = `55${digits}`;
    }
    if (digits.length < 12 || digits.length > 15) {
      setNewChatError('Número inválido. Use DDD + número (ex: 14998360854) ou com DDI (ex: 5514998360854).');
      return;
    }
    const text = newChatMessage.trim();
    if (!text) { setNewChatError('Digite uma mensagem para iniciar a conversa.'); return; }
    if (!token) { setNewChatError('Faça login para iniciar conversas.'); return; }

    const jid = `${digits}@s.whatsapp.net`;
    setNewChatLoading(true);
    setNewChatError(null);
    try {
      await send(jid, { text });
      await hydrateSession(jid);
      setActiveSessionId(jid);
      setShowNewChatModal(false);
      setNewChatPhone('');
      setNewChatMessage('');
    } catch (err) {
      setNewChatError(err instanceof Error ? err.message : 'Não foi possível iniciar a conversa.');
    } finally {
      setNewChatLoading(false);
    }
  };

  /* ─── Render ────────────────────────────────────────────────── */

  return (
    <>
      <div className="flex flex-1 overflow-hidden">
        {/* Session list */}
        <aside
          style={{ ['--list-width' as string]: `${listWidth}px` }}
          className={`relative flex-shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-surface)] w-full md:w-[var(--list-width)] ${
            activeSessionId ? 'hidden md:flex' : 'flex'
          }`}
        >
          <div className="px-4 py-3.5 border-b border-[var(--color-line)] flex-shrink-0 flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-[var(--color-ink)]">Lista de Conversas</h2>
            <button
              onClick={() => { setShowNewChatModal(true); setNewChatError(null); }}
              title="Nova conversa"
              className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-brand)] transition-colors"
            >
              <Plus className="w-4 h-4" strokeWidth={2} />
            </button>
          </div>

          <div className="px-3 py-2.5 border-b border-[var(--color-line)] flex-shrink-0">
            <div className="flex items-center gap-2 bg-[var(--color-surface-muted)] rounded-lg px-3 py-2">
              <Search className="w-3.5 h-3.5 text-[var(--color-ink-faint)] flex-shrink-0" strokeWidth={1.8} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Pesquisar..."
                className="flex-1 bg-transparent text-[13px] outline-none text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)]"
              />
            </div>
          </div>

          <div
            ref={chatListRef}
            onScroll={(e) => setChatListScrollTop(e.currentTarget.scrollTop)}
            className="flex-1 overflow-y-auto custom-scrollbar"
          >
            {chatLoading && sessions.length === 0 && (
              <p className="px-4 py-3 text-[12.5px] text-[var(--color-ink-muted)]">Carregando conversas…</p>
            )}

            {!token && !authLoading && (
              <div className="mx-3 my-3 bg-[var(--color-warn-soft)] rounded-lg px-3 py-2.5">
                <p className="text-[12.5px] text-[var(--color-warn)] font-medium">
                  Faça login no Supabase em Perfil para carregar as conversas do WhatsApp.
                </p>
              </div>
            )}

            {(chatError || chatActionError) && (
              <div className="mx-3 my-2 bg-[var(--color-alert-soft)] rounded-lg px-3 py-2">
                <p className="text-[12px] text-[var(--color-alert)]">{chatActionError ?? chatError}</p>
              </div>
            )}

            {!chatLoading && filteredSessions.length === 0 && token && (
              <p className="px-4 py-3 text-[12.5px] text-[var(--color-ink-muted)]">Nenhuma conversa encontrada.</p>
            )}

            {chatListWindow.topPad > 0 && (
              <div aria-hidden="true" style={{ height: chatListWindow.topPad }} />
            )}

            {chatListWindow.sessions.map((s) => {
              const isEscalated = s.status === 'escalated';
              return (
              <div
                key={s.id}
                style={{ height: CHAT_SESSION_ROW_HEIGHT }}
                className={`relative flex items-center gap-3 px-3 py-3 border-b border-[var(--color-line)] transition-colors group ${
                  isEscalated ? 'border-l-4 border-l-[var(--color-alert)] bg-[var(--color-alert-soft)]' : ''
                } ${
                  activeSessionId === s.id
                    ? isEscalated
                      ? 'bg-[var(--color-alert-soft)]'
                      : 'bg-[var(--color-brand-soft)]'
                    : !isEscalated && 'hover:bg-[var(--color-surface-muted)]'
                }`}
                onMouseEnter={() => setHoveredSessionId(s.id)}
                onMouseLeave={() => setHoveredSessionId(null)}
              >
                <button
                  onClick={() => setActiveSessionId(s.id)}
                  className="flex items-center gap-3 flex-1 min-w-0 text-left"
                >
                  <ContactAvatar
                    url={profilePics[s.id]}
                    name={s.customerName}
                    size="md"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <h3 className="text-[13.5px] font-semibold text-[var(--color-ink)] truncate">{s.customerName}</h3>
                        {isEscalated && <EscaladoBadge />}
                      </div>
                      {isEscalated ? (
                        <SlaTimer escalatedAt={s.escalatedAt} className="flex-shrink-0 ml-1" />
                      ) : (
                        <span className={`text-[11px] text-[var(--color-ink-faint)] flex-shrink-0 ml-1 transition-opacity ${hoveredSessionId === s.id ? 'opacity-0' : ''}`}>
                          {formatLastMessageTime(s.lastMessageTime)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[12.5px] text-[var(--color-ink-muted)] truncate flex-1">{s.lastMessage}</p>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {s.alerts && s.alerts.length > 0 && (
                          <span className="rounded-full bg-[var(--color-alert)] px-1.5 py-0.5 text-[10px] font-bold text-white">!</span>
                        )}
                        {s.unreadCount > 0 && (
                          <span className="rounded-full bg-[var(--color-brand)] min-w-[18px] h-[18px] flex items-center justify-center px-1 text-[10px] font-bold text-white">
                            {s.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>

                {hoveredSessionId === s.id && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteSessionPending({ id: s.id, name: s.customerName });
                    }}
                    title="Excluir conversa"
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-lg text-[var(--color-ink-faint)] hover:bg-[var(--color-alert-soft)] hover:text-[var(--color-alert)] transition-colors flex-shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" strokeWidth={1.8} />
                  </button>
                )}
              </div>
              );
            })}

            {chatListWindow.bottomPad > 0 && (
              <div aria-hidden="true" style={{ height: chatListWindow.bottomPad }} />
            )}
          </div>

          {/* Drag handle to resize the conversation list. The thin visible bar sits on the
              border itself; the wider invisible hit area gives a generous grab target without
              shifting the layout. */}
          <div
            onMouseDown={handleListResizeStart}
            onDoubleClick={() => {
              setListWidth(LIST_WIDTH_DEFAULT);
              try { window.localStorage.setItem(LIST_WIDTH_KEY, String(LIST_WIDTH_DEFAULT)); } catch { /* ignore */ }
            }}
            title="Arraste para redimensionar (duplo clique para padrão)"
            className="absolute top-0 right-[-3px] z-10 h-full w-[6px] cursor-col-resize group hidden md:block"
          >
            <div className="h-full w-px mx-auto bg-transparent group-hover:bg-[var(--color-brand)] transition-colors" />
          </div>
        </aside>

        {/* Chat panel */}
        <main className={`relative flex-col overflow-hidden wa-pattern w-full md:flex-1 ${
          activeSessionId ? 'flex' : 'hidden md:flex'
        }`}>
          {activeSession ? (
            <>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => void handleAttachmentSelect(event, 'image')}
              />
              <input
                ref={documentInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/csv"
                className="hidden"
                onChange={(event) => void handleAttachmentSelect(event, 'document')}
              />

              {/* Header */}
              <div className="z-10 flex min-h-14 flex-shrink-0 items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-wa-panel)]/80 px-4 py-2 backdrop-blur-sm">
                <div className="flex min-w-0 items-center gap-1">
                <button
                  onClick={() => setActiveSessionId(null)}
                  aria-label="Voltar"
                  className="md:hidden flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-surface)]/70 transition-colors"
                >
                  <ArrowLeft className="h-5 w-5" strokeWidth={2} />
                </button>
                <button
                  onClick={() => setDetailsOpen((v) => !v)}
                  className="flex min-w-0 items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-surface)]/70"
                >
                  <ContactAvatar
                    url={profilePics[activeSession.id]}
                    name={activeSession.customerName}
                    size="md"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-[13.5px] font-semibold text-[var(--color-ink)]">
                        {activeSession.customerName}
                      </h2>
                      {activeSession.alerts && activeSession.alerts.length > 0 && (
                        <span className="rounded-full bg-[var(--color-alert-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-alert)]">
                          {activeSession.alerts.join(', ')}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-[11.5px] text-[var(--color-ink-muted)]">
                      {activeSession.customerPhone ? formatPhoneDisplay(activeSession.customerPhone) : 'Contato do WhatsApp'}
                    </p>
                  </div>
                </button>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-card)]">
                    <button
                      onClick={() => void handleAutoReplyToggle(false)}
                      className={`rounded-full px-3 py-1 text-[11.5px] font-medium transition-colors ${
                        !activeSession.autoReply
                          ? 'bg-[var(--color-ink)] text-white'
                          : 'text-[var(--color-ink-muted)]'
                      }`}
                    >
                      Manual
                    </button>
                    <button
                      onClick={() => void handleAutoReplyToggle(true)}
                      className={`rounded-full px-3 py-1 text-[11.5px] font-medium transition-colors ${
                        activeSession.autoReply
                          ? 'bg-[var(--color-brand)] text-white'
                          : 'text-[var(--color-ink-muted)]'
                      }`}
                    >
                      IA
                    </button>
                  </div>
                  {/* Desktop toggle */}
                  <button
                    onClick={() => setDetailsOpen((v) => !v)}
                    className="hidden md:inline-flex rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)]"
                  >
                    {detailsOpen ? 'Fechar perfil' : 'Abrir perfil'}
                  </button>
                  {/* Mobile: open details overlay */}
                  <button
                    onClick={() => setMobileDetailsOpen(true)}
                    aria-label="Detalhes"
                    className="md:hidden flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-surface)]/70 transition-colors"
                  >
                    <Info className="h-5 w-5" strokeWidth={1.8} />
                  </button>
                  <div className="relative">
                    <button
                      onClick={() => setChatMenuOpen((v) => !v)}
                      className="rounded-lg p-1.5 text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)]"
                    >
                      <MoreVertical className="h-4 w-4" strokeWidth={1.8} />
                    </button>
                    {chatMenuOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setChatMenuOpen(false)} />
                        <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] overflow-hidden">
                          <button
                            onClick={() => {
                              setChatMenuOpen(false);
                              if (activeSession) {
                                setDeleteSessionPending({ id: activeSession.id, name: activeSession.customerName });
                              }
                            }}
                            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-[13px] text-[var(--color-alert)] hover:bg-[var(--color-alert-soft)] transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.8} />
                            Excluir conversa
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Messages */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-1">
                <div className="self-center mb-2">
                  <span className="text-[11px] font-medium text-[var(--color-ink-faint)] bg-[var(--color-wa-panel)]/60 px-3 py-1 rounded-full">
                    Criptografia de ponta a ponta
                  </span>
                </div>

                <AnimatePresence initial={false}>
                  {activeSession.messages.map((message, idx, arr) => {
                    const isSystem = message.kind === 'text' && (message.content ?? '').includes('[SISTEMA]');
                    const systemText = (message.content ?? '').replace('[SISTEMA]', '').trim();

                    if (isSystem) {
                      return (
                        <motion.div
                          key={message.id}
                          initial={{ opacity: 0, scale: 0.96 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="self-center my-1"
                        >
                          <span className="inline-block text-[11.5px] font-medium bg-[var(--color-warn-soft)] text-[var(--color-warn)] px-3 py-1 rounded-full">
                            {systemText}
                          </span>
                        </motion.div>
                      );
                    }

                    const isLastInGroup =
                      idx === arr.length - 1 || arr[idx + 1].role !== message.role;

                    return (
                      <motion.div
                        key={message.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.15 }}
                      >
                        <MessageBubble
                          message={message}
                          isLastInGroup={isLastInGroup}
                          profilePicUrl={profilePics[activeSession.id]}
                          customerName={activeSession.customerName}
                        />
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>

              {/* Input bar */}
              <div className="relative flex-shrink-0 bg-[var(--color-wa-panel)]/80 backdrop-blur-sm border-t border-[var(--color-line)] p-3">
                <AnimatePresence>
                  {!pendingAttachment && ownerInput.startsWith('/') && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                      className="absolute bottom-full left-4 right-4 z-50 mb-2 max-h-52 overflow-y-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-pop)] custom-scrollbar"
                    >
                      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-line)]">
                        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
                          Respostas rápidas
                        </span>
                      </div>
                      {quickResponses
                        .filter((r) => r.trigger.includes(ownerInput.slice(1).toUpperCase()))
                        .map((r) => (
                          <button
                            key={r.id}
                            onClick={() => setOwnerInput(`/${r.trigger}`)}
                            className="w-full border-b border-[var(--color-line)] px-3 py-2.5 text-left last:border-0 hover:bg-[var(--color-surface-muted)] transition-colors"
                          >
                            <span className="text-[13px] font-semibold text-[var(--color-ink)]">/{r.trigger}</span>
                            <span className="block truncate text-[12px] text-[var(--color-ink-muted)] mt-0.5">{r.response}</span>
                          </button>
                        ))}
                      {quickResponses.filter((r) => r.trigger.includes(ownerInput.slice(1).toUpperCase())).length === 0 && (
                        <p className="px-3 py-3 text-center text-[12.5px] italic text-[var(--color-ink-faint)]">
                          Comando não encontrado
                        </p>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                {pendingAttachment && (
                  <div className="mb-3 flex items-start gap-3 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)]/92 p-3 shadow-[var(--shadow-card)]">
                    {pendingAttachment.type === 'image' ? (
                      <img
                        src={pendingAttachment.dataUrl}
                        alt={pendingAttachment.fileName}
                        className="h-16 w-16 rounded-xl object-cover"
                      />
                    ) : pendingAttachment.type === 'audio' ? (
                      <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]">
                        <Mic className="h-6 w-6" strokeWidth={1.8} />
                      </div>
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]">
                        <FileText className="h-6 w-6" strokeWidth={1.8} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-[var(--color-ink)]">{pendingAttachment.fileName}</p>
                      <p className="text-[12px] text-[var(--color-ink-muted)]">
                        {pendingAttachment.type === 'image' ? 'Imagem pronta para envio' : pendingAttachment.type === 'audio' ? 'Áudio pronto para envio' : 'Documento pronto para envio'} • {formatAttachmentSize(pendingAttachment.sizeBytes)}
                      </p>
                    </div>
                    <button
                      onClick={() => setPendingAttachment(null)}
                      className="rounded-lg p-1.5 text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)]"
                    >
                      <X className="h-4 w-4" strokeWidth={1.8} />
                    </button>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => imageInputRef.current?.click()}
                      disabled={attachmentLoading || isSending}
                      className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-surface)] text-[var(--color-ink-muted)] shadow-[var(--shadow-card)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-50"
                      title="Enviar imagem"
                    >
                      <ImagePlus className="h-4.5 w-4.5" strokeWidth={1.8} />
                    </button>
                    <button
                      onClick={() => documentInputRef.current?.click()}
                      disabled={attachmentLoading || isRecording || isSending}
                      className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-surface)] text-[var(--color-ink-muted)] shadow-[var(--shadow-card)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-50"
                      title="Enviar documento"
                    >
                      <Paperclip className="h-4.5 w-4.5" strokeWidth={1.8} />
                    </button>
                    <button
                      onClick={isRecording ? handleStopRecording : handleStartRecording}
                      disabled={attachmentLoading || !!pendingAttachment || isSending}
                      className={`flex h-10 w-10 items-center justify-center rounded-xl shadow-[var(--shadow-card)] transition-colors disabled:opacity-50 ${
                        isRecording
                          ? 'animate-pulse bg-red-500 text-white hover:bg-red-600'
                          : 'bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
                      }`}
                      title={isRecording ? 'Parar gravação' : 'Gravar áudio'}
                    >
                      {isRecording ? <MicOff className="h-4.5 w-4.5" strokeWidth={1.8} /> : <Mic className="h-4.5 w-4.5" strokeWidth={1.8} />}
                    </button>
                  </div>
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={ownerInput}
                      onChange={(e) => setOwnerInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && !isSending && void handleOwnerSend()}
                      disabled={isSending || aiAssistLoading !== null}
                      placeholder={pendingAttachment ? 'Adicione uma legenda (opcional)' : 'Digite uma mensagem ou /atalho'}
                      className="w-full bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl px-4 py-2.5 text-[13.5px] outline-none shadow-[var(--shadow-card)] focus:ring-2 focus:ring-[var(--color-brand)]/20 focus:border-[var(--color-brand)] transition-all pr-12 disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      {pendingAttachment ? (
                        <Paperclip className="h-4 w-4 text-[var(--color-brand)]" strokeWidth={1.8} />
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              if (activeSession.autoReply || aiAssistLoading) return;
                              setAiAssistMenuOpen((open) => !open);
                            }}
                            disabled={activeSession.autoReply || aiAssistLoading !== null || isSending}
                            title={activeSession.autoReply ? 'Disponível no modo manual' : 'Sugestões de IA'}
                            className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                              activeSession.autoReply
                                ? 'cursor-not-allowed text-[var(--color-ink-faint)]'
                                : 'text-[var(--color-brand)] hover:bg-[var(--color-brand-soft)]'
                            }`}
                          >
                            {aiAssistLoading ? (
                              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
                            ) : (
                              <Bot className="h-4 w-4" strokeWidth={1.8} />
                            )}
                          </button>

                          <AnimatePresence>
                            {aiAssistMenuOpen && (
                              <>
                                <motion.button
                                  type="button"
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  exit={{ opacity: 0 }}
                                  className="fixed inset-0 z-40 cursor-default"
                                  onClick={() => setAiAssistMenuOpen(false)}
                                />
                                <motion.div
                                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                                  animate={{ opacity: 1, y: 0, scale: 1 }}
                                  exit={{ opacity: 0, y: 8, scale: 0.98 }}
                                  className="absolute bottom-full right-0 z-50 mb-3 w-56 overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-pop)]"
                                >
                                  <button
                                    type="button"
                                    onClick={() => void handleAiAssist('improve')}
                                    disabled={!ownerInput.trim()}
                                    className="flex w-full items-start gap-3 border-b border-[var(--color-line)] px-3 py-3 text-left transition-colors hover:bg-[var(--color-surface-muted)] disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    <Pencil className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-brand)]" strokeWidth={1.8} />
                                    <span className="block min-w-0">
                                      <span className="block text-[12.5px] font-semibold text-[var(--color-ink)]">Melhorar mensagem</span>
                                      <span className="block text-[11.5px] leading-relaxed text-[var(--color-ink-muted)]">Corrige e deixa mais amigável sem perder o tom humano.</span>
                                    </span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleAiAssist('reply')}
                                    className="flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-[var(--color-surface-muted)]"
                                  >
                                    <MessageCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-brand)]" strokeWidth={1.8} />
                                    <span className="block min-w-0">
                                      <span className="block text-[12.5px] font-semibold text-[var(--color-ink)]">Gerar resposta</span>
                                      <span className="block text-[11.5px] leading-relaxed text-[var(--color-ink-muted)]">Lê o contexto do chat e sugere a próxima resposta.</span>
                                    </span>
                                  </button>
                                </motion.div>
                              </>
                            )}
                          </AnimatePresence>
                        </>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => void handleOwnerSend()}
                    disabled={isSending || (!ownerInput.trim() && !pendingAttachment)}
                    className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all flex-shrink-0 ${
                      isSending
                        ? 'bg-[var(--color-brand)] text-white shadow-[var(--shadow-card)] cursor-not-allowed'
                        : ownerInput || pendingAttachment
                          ? 'bg-[var(--color-brand)] text-white shadow-[var(--shadow-card)] hover:bg-[var(--color-brand-deep)]'
                          : 'bg-[var(--color-surface-muted)] text-[var(--color-ink-faint)]'
                    }`}
                  >
                    {isSending
                      ? <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} />
                      : <Send className="w-4 h-4" strokeWidth={2} />
                    }
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8">
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-[var(--color-surface)] flex items-center justify-center mx-auto mb-4 shadow-[var(--shadow-card)]">
                  <MessageCircle className="w-7 h-7 text-[var(--color-ink-faint)]" strokeWidth={1.5} />
                </div>
                <p className="text-[15px] font-semibold text-[var(--color-ink)]">
                  {token ? 'Nenhuma conversa ativa' : 'Faça login para abrir as conversas da empresa'}
                </p>
                <p className="mt-1.5 text-[13px] text-[var(--color-ink-muted)] max-w-xs mx-auto leading-relaxed">
                  Assim que o WhatsApp receber mensagens, elas aparecem aqui em tempo real.
                </p>
              </div>
            </div>
          )}
        </main>

        {/* Customer details panel — desktop inline + mobile overlay */}
        {activeSession && (
          <>
            {/* Mobile backdrop */}
            <AnimatePresence>
              {mobileDetailsOpen && (
                <motion.div
                  key="mobile-details-backdrop"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="fixed inset-0 z-40 bg-black/40 md:hidden"
                  onClick={() => setMobileDetailsOpen(false)}
                />
              )}
            </AnimatePresence>

          <aside className={`flex-col border-l border-[var(--color-line)] bg-[var(--color-surface)] overflow-y-auto custom-scrollbar
            ${mobileDetailsOpen
              ? 'flex fixed inset-y-0 right-0 z-50 w-[85vw] max-w-[320px] shadow-2xl'
              : detailsOpen
                ? 'hidden md:flex w-[260px] flex-shrink-0'
                : 'hidden'
            }
          `}>
            <div className="px-4 py-3.5 border-b border-[var(--color-line)] flex-shrink-0 flex items-center justify-between">
              <h3 className="text-[13.5px] font-semibold text-[var(--color-ink)]">Perfil do cliente</h3>
              <button
                onClick={() => { setDetailsOpen(false); setMobileDetailsOpen(false); }}
                className="rounded-md p-1 text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)] transition-colors"
              >
                <X className="h-4 w-4" strokeWidth={1.8} />
              </button>
            </div>

            {activeSession.status === 'escalated' && (
              <div className="border-b border-[var(--color-alert)] bg-[var(--color-alert-soft)] px-4 py-3 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <EscaladoBadge />
                  <SlaTimer escalatedAt={activeSession.escalatedAt} />
                </div>
                <p className="text-[12px] text-[var(--color-ink)]">
                  Esta conversa precisa de atendimento humano. A IA está pausada até você marcar como resolvido.
                </p>
                <button
                  type="button"
                  onClick={handleResolveEscalation}
                  disabled={resolvingEscalation}
                  className="rounded-md bg-[var(--color-brand)] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[var(--color-brand-deep)] disabled:opacity-50"
                >
                  {resolvingEscalation ? 'Marcando…' : 'Marcar como resolvido'}
                </button>
              </div>
            )}

            <div className="flex flex-col items-center gap-2 px-4 py-5 border-b border-[var(--color-line)]">
              <ContactAvatar
                url={profilePics[activeSession.id]}
                name={activeSession.customerName}
                size="lg"
              />
              <div className="text-center w-full px-2">
                {editingName ? (
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus
                      type="text"
                      value={editNameValue}
                      onChange={(e) => setEditNameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleSaveCustomerName();
                        if (e.key === 'Escape') setEditingName(false);
                      }}
                      className="flex-1 text-[13px] font-medium text-center bg-[var(--color-surface-muted)] border border-[var(--color-brand)] rounded-lg px-2 py-1 outline-none"
                    />
                    <button
                      onClick={() => void handleSaveCustomerName()}
                      className="w-6 h-6 flex items-center justify-center rounded-md bg-[var(--color-brand)] text-white"
                    >
                      <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
                    </button>
                    <button
                      onClick={() => setEditingName(false)}
                      className="w-6 h-6 flex items-center justify-center rounded-md text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-muted)]"
                    >
                      <X className="w-3.5 h-3.5" strokeWidth={2} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-1">
                    <p className="text-[14px] font-semibold text-[var(--color-ink)]">{activeSession.customerName}</p>
                    <button
                      onClick={() => { setEditNameValue(activeSession.customerName); setEditingName(true); }}
                      className="w-5 h-5 flex items-center justify-center rounded text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] hover:bg-[var(--color-surface-muted)] transition-colors"
                    >
                      <Pencil className="w-3 h-3" strokeWidth={2} />
                    </button>
                  </div>
                )}
                <p className="text-[12px] text-[var(--color-ink-muted)] mt-0.5">
                  {activeSession.customerPhone ? formatPhoneDisplay(activeSession.customerPhone) : '—'}
                </p>
              </div>
              {activeSession.alerts && activeSession.alerts.length > 0 && (
                <div className="flex flex-wrap gap-1 justify-center">
                  {activeSession.alerts.map((alert) => (
                    <span key={alert} className="rounded-full bg-[var(--color-alert-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-alert)]">
                      {alert}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="px-4 py-4 flex flex-col gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)] mb-1.5">Informações</p>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[12.5px] text-[var(--color-ink-muted)]">Telefone</span>
                    <span className="text-[12.5px] font-medium text-[var(--color-ink)]">
                      {activeSession.customerPhone ? formatPhoneDisplay(activeSession.customerPhone) : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[12.5px] text-[var(--color-ink-muted)]">Modo IA</span>
                    <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full ${activeSession.autoReply ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]' : 'bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)]'}`}>
                      {activeSession.autoReply ? 'Ativo' : 'Manual'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[12.5px] text-[var(--color-ink-muted)]">Última mensagem</span>
                    <span className="text-[12px] text-[var(--color-ink-faint)]">{formatLastMessageTime(activeSession.lastMessageTime)}</span>
                  </div>
                </div>
              </div>

              {activeSession.status !== 'escalated' && (
                <button
                  type="button"
                  onClick={handleManualEscalate}
                  className="self-start rounded-md border border-[var(--color-alert)] px-2 py-1 text-[11px] font-semibold text-[var(--color-alert)] hover:bg-[var(--color-alert-soft)]"
                  title="Marcar esta conversa como urgente e desativar a IA"
                >
                  Escalar para humano
                </button>
              )}

              <EscalationLogCard events={escalationEvents} loading={escalationsLoading} />
            </div>
          </aside>
          </>
        )}
      </div>

      {/* ── Nova conversa modal ──────────────────────────────────── */}
      {showNewChatModal && (
        <Modal
          open
          onClose={() => {
            if (!newChatLoading) setShowNewChatModal(false);
          }}
          titleId={newChatTitleId}
          disableEscape={newChatLoading}
          panelClassName="w-[400px] max-w-[calc(100vw-2rem)] bg-[var(--color-surface)] rounded-2xl shadow-[var(--shadow-pop)] border border-[var(--color-line)] overflow-hidden"
        >
              <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-line)]">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-[var(--color-brand-soft)] flex items-center justify-center">
                    <Phone className="w-4 h-4 text-[var(--color-brand-deep)]" strokeWidth={1.8} />
                  </div>
                  <h3 id={newChatTitleId} className="text-[14px] font-semibold text-[var(--color-ink)]">Nova conversa</h3>
                </div>
                <button
                  onClick={() => {
                    if (!newChatLoading) setShowNewChatModal(false);
                  }}
                  disabled={newChatLoading}
                  aria-label="Fechar"
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <X className="w-4 h-4" strokeWidth={1.8} />
                </button>
              </div>

              <div className="px-5 py-4 flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[12px] font-semibold text-[var(--color-ink-muted)] uppercase tracking-wide">
                    Número do WhatsApp
                  </label>
                  <input
                    autoFocus
                    type="tel"
                    value={newChatPhone}
                    onChange={(e) => setNewChatPhone(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void handleStartNewConversation()}
                    placeholder="DDD + número ou DDI + DDD + número"
                    className="w-full bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-xl px-4 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-[var(--color-brand)]/20 focus:border-[var(--color-brand)] transition-all"
                  />
                  <p className="text-[11.5px] text-[var(--color-ink-faint)]">
                    Só o DDD + número (o +55 é adicionado automaticamente).
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[12px] font-semibold text-[var(--color-ink-muted)] uppercase tracking-wide">
                    Primeira mensagem
                  </label>
                  <textarea
                    value={newChatMessage}
                    onChange={(e) => setNewChatMessage(e.target.value)}
                    placeholder="Olá! Como posso ajudar?"
                    rows={3}
                    className="w-full bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-xl px-4 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-[var(--color-brand)]/20 focus:border-[var(--color-brand)] transition-all resize-none"
                  />
                </div>

                {newChatError && (
                  <div className="bg-[var(--color-alert-soft)] rounded-xl px-3.5 py-2.5">
                    <p className="text-[12.5px] text-[var(--color-alert)]">{newChatError}</p>
                  </div>
                )}
              </div>

              <div className="px-5 pb-5 flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    if (!newChatLoading) setShowNewChatModal(false);
                  }}
                  disabled={newChatLoading}
                  className="px-4 py-2 rounded-xl text-[13px] font-medium text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => void handleStartNewConversation()}
                  disabled={newChatLoading}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand-deep)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed shadow-[var(--shadow-card)]"
                >
                  {newChatLoading ? (
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" strokeWidth={2} />
                  )}
                  {newChatLoading ? 'Enviando…' : 'Iniciar conversa'}
                </button>
              </div>
        </Modal>
      )}

      <ConfirmModal
        open={deleteSessionPending !== null}
        title="Excluir conversa?"
        message={`Excluir a conversa com ${deleteSessionPending?.name}? Esta ação não pode ser desfeita.`}
        onClose={() => setDeleteSessionPending(null)}
        onConfirm={async () => { await onDeleteSession(deleteSessionPending!.id); }}
        confirmLabel="Excluir"
        confirmLoadingLabel="Excluindo..."
      />
    </>
  );
}
