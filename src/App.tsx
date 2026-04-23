import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import {
  Bike,
  Bot,
  Calendar as CalendarIcon,
  Check,
  CheckCheck,
  Coffee,
  Download,
  FileText,
  ImagePlus,
  Kanban,
  LayoutDashboard,
  MessageCircle,
  MoreVertical,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Pencil,
  Phone,
  Package,
  Plus,
  Search,
  Send,
  Settings,
  ShoppingBag,
  Trash2,
  User,
  UserCheck,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { DashboardView } from './components/views/DashboardView';
import { KanbanView } from './components/views/KanbanView';
import { CalendarView } from './components/views/CalendarView';
import { AIConfigsView } from './components/views/AIConfigsView';
import { SettingsView } from './components/views/SettingsView';
import { ProfileView } from './components/views/ProfileView';
import { DriversView } from './components/views/DriversView';
import { CatalogView } from './components/views/CatalogView';
import { useDrivers } from './hooks/useDrivers';
import { useProdutos } from './hooks/useProdutos';
import { useEmpresaPerfil } from './hooks/useEmpresaPerfil';
import { useSupabaseSession } from './hooks/useSupabaseSession';
import { useWhatsAppSessions } from './hooks/useWhatsAppSessions';
import { getOwnerResponse } from './services/openaiService';
import { mapProdutoToProduct } from './services/zeloApi';
import { loadInitialState, saveInitialState } from './services/statePersistence';
import { buildContactKey, normalizePhoneNumber } from './domain/chat';
import type { ChatAttachment, ChatSession, Order, ZeloState } from './types';

type View =
  | 'dashboard'
  | 'chat'
  | 'kanban'
  | 'calendar'
  | 'ai-configs'
  | 'settings'
  | 'profile'
  | 'drivers'
  | 'catalog';

/* ─── Nav definitions ─────────────────────────────────────────── */
interface NavItem {
  id: View;
  icon: LucideIcon;
  label: string;
  description: string;
}

const NAV_PRIMARY: NavItem[] = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'Visão geral',  description: 'Métricas e alertas do dia' },
  { id: 'chat',      icon: MessageCircle,   label: 'Atendimento',  description: 'Conversas no WhatsApp' },
  { id: 'kanban',    icon: Kanban,          label: 'Produção',     description: 'Fila de pedidos' },
  { id: 'drivers',   icon: Bike,            label: 'Motoboys',     description: 'Entregadores' },
];

const NAV_SECONDARY: NavItem[] = [
  { id: 'calendar',   icon: CalendarIcon, label: 'Agenda',     description: 'Pedidos por data' },
  { id: 'catalog',    icon: ShoppingBag,  label: 'Cardápio',   description: 'Produtos e preços' },
  { id: 'ai-configs', icon: Bot,          label: 'Cérebro IA', description: 'Configurar assistente' },
];

/* ─── NavButton component ─────────────────────────────────────── */
interface NavButtonProps {
  item: NavItem;
  active: boolean;
  expanded: boolean;
  badge?: number;
  onClick: () => void;
}

const NavButton: React.FC<NavButtonProps> = ({ item, active, expanded, badge, onClick }) => {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      title={!expanded ? item.label : undefined}
      className={`group relative w-full flex items-center rounded-[10px] transition-all ${
        expanded ? 'gap-3 px-3 py-2.5' : 'justify-center px-0 py-2.5'
      } ${
        active
          ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]'
          : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)]'
      }`}
    >
      <Icon
        className="w-[18px] h-[18px] flex-shrink-0"
        strokeWidth={active ? 2.2 : 1.8}
      />

      {expanded && (
        <div className="flex-1 text-left overflow-hidden">
          <p className="text-[13.5px] font-medium leading-tight">{item.label}</p>
          <p className="text-[11px] text-[var(--color-ink-faint)] truncate mt-[-1px]">{item.description}</p>
        </div>
      )}

      {badge != null && badge > 0 && (
        <span className={`flex-shrink-0 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-[var(--color-alert)] text-white text-[10px] font-bold ${
          expanded ? '' : 'absolute top-1.5 right-1.5 min-w-[14px] h-[14px] text-[9px]'
        }`}>
          {badge > 99 ? '99+' : badge}
        </span>
      )}

      {/* Tooltip when collapsed */}
      {!expanded && (
        <span className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-md bg-[var(--color-ink)] px-2.5 py-1.5 text-[12px] font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
          {item.label}
        </span>
      )}
    </button>
  );
};

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error('Não foi possível ler o arquivo.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Falha ao ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

/** Formata um número de telefone para exibição, suportando números brasileiros. */
function formatPhoneDisplay(phone: string): string {
  if (!phone) return phone;
  const digits = normalizePhoneNumber(phone);
  const local = digits.startsWith('55') ? digits.slice(2) : digits;
  if (local.length === 11) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  }
  if (local.length === 10) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  }
  // Já está formatado ou é formato desconhecido — retorna como está
  return phone;
}

function formatAttachmentSize(sizeBytes?: number): string {
  if (!sizeBytes) return 'Arquivo';
  if (sizeBytes < 1024 * 1024) {
    return `${Math.max(sizeBytes / 1024, 1).toFixed(0)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sessionMatchesOrder(session: ChatSession, order: Order): boolean {
  const sessionKey = buildContactKey(session.customerPhone || session.id);
  const orderKey = buildContactKey(order.customerPhone || order.customerName);

  if (sessionKey && orderKey && sessionKey === orderKey) {
    return true;
  }

  const sessionName = session.customerName.trim().toLowerCase();
  const orderName = order.customerName.trim().toLowerCase();
  return !!sessionName && sessionName === orderName;
}

/* ─── App ─────────────────────────────────────────────────────── */
export default function App() {
  const [activeView, setActiveView] = useState<View>('chat');
  const [state, setState] = useState<ZeloState>(() => loadInitialState());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [ownerInput, setOwnerInput] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [chatActionError, setChatActionError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<ChatAttachment | null>(null);
  const [attachmentLoading, setAttachmentLoading] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState<boolean>(() => {
    try {
      return localStorage.getItem('zelochat_sidebar_expanded') !== 'false';
    } catch { return true; }
  });
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newChatPhone, setNewChatPhone] = useState('');
  const [newChatMessage, setNewChatMessage] = useState('');
  const [newChatLoading, setNewChatLoading] = useState(false);
  const [newChatError, setNewChatError] = useState<string | null>(null);
  const [profilePics, setProfilePics] = useState<Record<string, string>>({});
  const [editingName, setEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);

  const { session, token, loading: authLoading } = useSupabaseSession();
  const { empresa, save: saveEmpresa } = useEmpresaPerfil(session);
  const {
    sessions,
    loading: chatLoading,
    error: chatError,
    hydrateSession,
    send,
    markRead,
    toggleAutoReply,
    deleteSession,
    fetchProfilePicture,
    updateSessionName,
  } = useWhatsAppSessions(token);
  const {
    data: produtosPdv,
    loading: produtosLoading,
    error: produtosError,
    refresh: refreshProdutos,
  } = useProdutos({ token, onlyVisible: true });
  const {
    drivers,
    loading: driversLoading,
    error: driversError,
    createDriver,
    updateDriver,
    deleteDriver,
  } = useDrivers(token);

  useEffect(() => { saveInitialState(state); }, [state]);

  useEffect(() => {
    try { localStorage.setItem('zelochat_sidebar_expanded', String(sidebarExpanded)); } catch {}
  }, [sidebarExpanded]);

  // Hydrate businessInfo + profile from the real empresa_perfil when user is authenticated
  useEffect(() => {
    if (!empresa) return;
    setState((prev) => ({
      ...prev,
      businessInfo: {
        ...prev.businessInfo,
        name:    empresa.nome_exibicao ?? prev.businessInfo.name,
        address: empresa.endereco      ?? prev.businessInfo.address,
        phone:   empresa.contato       ?? prev.businessInfo.phone,
        pixKey:  empresa.chave_pix     ?? prev.businessInfo.pixKey,
      },
      profile: {
        ...prev.profile,
        name:   empresa.nome_exibicao ?? prev.profile.name,
        ...(empresa.logo_url ? { avatar: empresa.logo_url } : {}),
      },
    }));
  }, [empresa]);

  useEffect(() => {
    setState((prev) => prev.sessions === sessions ? prev : { ...prev, sessions });
  }, [sessions]);

  useEffect(() => {
    const mapped = produtosPdv.map(mapProdutoToProduct);
    setState((prev) => {
      const same =
        prev.products.length === mapped.length &&
        prev.products.every((p, i) => {
          const n = mapped[i];
          return n && p.id === n.id && p.name === n.name && p.price === n.price && p.available === n.available && p.category === n.category;
        });
      return same ? prev : { ...prev, products: mapped };
    });
  }, [produtosPdv]);

  useEffect(() => {
    setState((prev) => {
      const same =
        prev.drivers.length === drivers.length &&
        prev.drivers.every((driver, index) => {
          const next = drivers[index];
          return next &&
            driver.id === next.id &&
            driver.name === next.name &&
            driver.phone === next.phone &&
            driver.status === next.status;
        });

      return same ? prev : { ...prev, drivers };
    });
  }, [drivers]);

  useEffect(() => {
    if (state.sessions.length === 0) { setActiveSessionId(null); return; }
    setActiveSessionId((cur) =>
      cur && state.sessions.some((s) => s.id === cur) ? cur : state.sessions[0].id,
    );
  }, [state.sessions]);

  useEffect(() => {
    if (!activeSessionId) return;
    void hydrateSession(activeSessionId);
    void markRead(activeSessionId);
  }, [activeSessionId, hydrateSession, markRead]);

  useEffect(() => {
    setPendingAttachment(null);
    setChatActionError(null);
  }, [activeSessionId]);

  // Busca fotos de perfil para sessões ainda não carregadas
  useEffect(() => {
    if (!token || sessions.length === 0) return;
    const missing = sessions.filter((s) => !(s.id in profilePics));
    if (missing.length === 0) return;
    missing.forEach((s) => {
      void fetchProfilePicture(s.id).then((url) => {
        if (url) setProfilePics((prev) => ({ ...prev, [s.id]: url }));
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, token]);

  // Reseta edição ao trocar de sessão
  useEffect(() => {
    setEditingName(false);
  }, [activeSessionId]);

  useEffect(() => {
    if (activeView === 'chat') scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [activeView, activeSessionId, state.sessions]);

  const syncConfigToServer = async (s: ZeloState) => {
    try {
      await fetch('/api/sync-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: s.businessInfo.name,
          specialty: s.businessInfo.specialty,
          hours: s.businessInfo.hours,
          closedDays: s.businessInfo.closedDays,
          address: s.businessInfo.address,
          pixKey: s.businessInfo.pixKey,
          products: s.products,
          blockedDates: s.blockedDates,
          dailyContext: s.dailyContext,
          aiInstructions: s.aiInstructions,
        }),
      });
    } catch { /* backend offline during frontend work */ }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void syncConfigToServer(state); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void syncConfigToServer(state); }, [state.businessInfo, state.products, state.blockedDates, state.dailyContext, state.aiInstructions]);

  const activeSession = state.sessions.find((s) => s.id === activeSessionId) ?? null;
  const filteredSessions = state.sessions.filter((s) => {
    const q = searchQuery.trim().toLowerCase();
    const phone = normalizePhoneNumber(s.customerPhone);
    const queryPhone = normalizePhoneNumber(q);
    return (
      !q ||
      s.customerName.toLowerCase().includes(q) ||
      s.lastMessage.toLowerCase().includes(q) ||
      (!!queryPhone && phone.includes(queryPhone))
    );
  });

  const sessionOrders = activeSession
    ? state.orders.filter((order) => sessionMatchesOrder(activeSession, order))
    : [];
  const liveOrders = sessionOrders.filter((order) => order.status !== 'delivered');
  const historicalOrders = sessionOrders.filter((order) => order.status === 'delivered');

  const totalUnread = state.sessions.reduce((sum, s) => sum + (s.unreadCount ?? 0), 0);

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
      setChatActionError(
        error instanceof Error ? error.message : 'Não foi possível atualizar o modo de atendimento.',
      );
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

  const handleOwnerSend = async () => {
    const text = ownerInput.trim();
    if (!text && !pendingAttachment) return;
    setChatActionError(null);

    if (!pendingAttachment && text.startsWith('/')) {
      const cmd = text.slice(1).toUpperCase();
      const qr = state.quickResponses.find((r) => r.trigger === cmd);
      if (qr) {
        if (!activeSessionId) { setChatActionError('Selecione uma conversa para enviar a resposta rápida.'); return; }
        try { await send(activeSessionId, { text: qr.response }); setOwnerInput(''); }
        catch (e) { setChatActionError(e instanceof Error ? e.message : 'Não foi possível enviar.'); }
        return;
      }
      try {
        const result = await getOwnerResponse(text.slice(1));
        const newCtx = result.map((t: string) => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text: t }));
        setState((prev) => ({ ...prev, dailyContext: [...(prev.dailyContext || []), ...newCtx] }));
        setOwnerInput('');
      } catch { setChatActionError('Não foi possível atualizar o contexto da IA agora.'); }
      return;
    }

    if (!activeSessionId) { setChatActionError('Selecione uma conversa para enviar uma mensagem.'); return; }
    try {
      await send(activeSessionId, { text, attachment: pendingAttachment ?? undefined });
      setOwnerInput('');
      setPendingAttachment(null);
    }
    catch (e) { setChatActionError(e instanceof Error ? e.message : 'Não foi possível enviar.'); }
  };

  const updateOrderStatus = (orderId: string, newStatus: Order['status']) => {
    setState((prev) => ({
      ...prev,
      orders: prev.orders.map((o) => o.id === orderId ? { ...o, status: newStatus } : o),
    }));
  };

  const handleDeleteSession = async (sessionId: string) => {
    setState((prev) => ({ ...prev, sessions: prev.sessions.filter((s) => s.id !== sessionId) }));
    if (activeSessionId === sessionId) setActiveSessionId(null);

    try {
      await deleteSession(sessionId);
    } catch (err) {
      console.error('[App] handleDeleteSession failed:', err);
      setChatActionError(err instanceof Error ? err.message : 'Não foi possível excluir a conversa.');
    }
  };

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    updateOrderStatus(result.draggableId, result.destination.droppableId as Order['status']);
  };

  const firstNameOnly = state.profile.name.split(' ')[0];

  const handleStartNewConversation = async () => {
    let digits = normalizePhoneNumber(newChatPhone.trim());
    if (!digits) {
      setNewChatError('Digite um número de telefone válido.');
      return;
    }
    // Auto-adiciona código do Brasil (+55) para números locais (10-11 dígitos sem DDI)
    if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
      digits = `55${digits}`;
    }
    if (digits.length < 12 || digits.length > 15) {
      setNewChatError('Número inválido. Use DDD + número (ex: 14998360854) ou com DDI (ex: 5514998360854).');
      return;
    }
    const text = newChatMessage.trim();
    if (!text) {
      setNewChatError('Digite uma mensagem para iniciar a conversa.');
      return;
    }
    if (!token) {
      setNewChatError('Faça login para iniciar conversas.');
      return;
    }

    const jid = `${digits}@s.whatsapp.net`;
    setNewChatLoading(true);
    setNewChatError(null);

    try {
      await send(jid, { text });
      await hydrateSession(jid);
      setActiveSessionId(jid);
      setActiveView('chat');
      setShowNewChatModal(false);
      setNewChatPhone('');
      setNewChatMessage('');
    } catch (err) {
      setNewChatError(err instanceof Error ? err.message : 'Não foi possível iniciar a conversa.');
    } finally {
      setNewChatLoading(false);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-canvas)]">
      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <aside
        className={`bg-[var(--color-surface)] border-r border-[var(--color-line)] flex flex-col py-3 flex-shrink-0 z-30 transition-[width] duration-200 ease-in-out overflow-hidden ${
          sidebarExpanded ? 'w-[220px]' : 'w-[60px]'
        }`}
      >
        {/* Logo + toggle */}
        <div className={`flex items-center mb-4 flex-shrink-0 ${sidebarExpanded ? 'px-3 justify-between' : 'px-0 justify-center flex-col gap-3'}`}>
          <div className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-xl bg-[var(--color-brand)] text-white shadow-sm">
            <Coffee className="w-5 h-5" />
          </div>
          {sidebarExpanded && (
            <span className="text-[13px] font-semibold text-[var(--color-ink)] tracking-tight flex-1 ml-2 truncate">
              ZeloChat
            </span>
          )}
          <button
            onClick={() => setSidebarExpanded((v) => !v)}
            className="w-7 h-7 flex items-center justify-center rounded-md text-[var(--color-ink-faint)] hover:text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)] transition-colors flex-shrink-0"
          >
            {sidebarExpanded
              ? <PanelLeftClose className="w-4 h-4" strokeWidth={1.8} />
              : <PanelLeftOpen className="w-4 h-4" strokeWidth={1.8} />
            }
          </button>
        </div>

        {/* Primary nav */}
        <div className={`px-2 flex-1 overflow-y-auto custom-scrollbar`}>
          {sidebarExpanded && (
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-ink-faint)] px-1 mb-1.5">
              Operação
            </p>
          )}
          <nav className="flex flex-col gap-0.5">
            {NAV_PRIMARY.map((item) => (
              <NavButton
                key={item.id}
                item={item}
                active={activeView === item.id}
                expanded={sidebarExpanded}
                badge={item.id === 'chat' ? totalUnread : undefined}
                onClick={() => setActiveView(item.id)}
              />
            ))}
          </nav>

          <div className="my-3 border-t border-[var(--color-line)]" />

          {sidebarExpanded && (
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-ink-faint)] px-1 mb-1.5">
              Gestão
            </p>
          )}
          <nav className="flex flex-col gap-0.5">
            {NAV_SECONDARY.map((item) => (
              <NavButton
                key={item.id}
                item={item}
                active={activeView === item.id}
                expanded={sidebarExpanded}
                onClick={() => setActiveView(item.id)}
              />
            ))}
          </nav>
        </div>

        {/* Bottom: settings + profile */}
        <div className="mt-auto px-2 flex flex-col gap-0.5 flex-shrink-0 pt-2 border-t border-[var(--color-line)]">
          <NavButton
            item={{ id: 'settings', icon: Settings, label: 'Configurações', description: 'Empresa e integrações' }}
            active={activeView === 'settings'}
            expanded={sidebarExpanded}
            onClick={() => setActiveView('settings')}
          />

          <button
            onClick={() => setActiveView('profile')}
            className={`w-full flex items-center rounded-[10px] transition-all ${
              sidebarExpanded ? 'gap-3 px-3 py-2' : 'justify-center px-0 py-2'
            } ${
              activeView === 'profile'
                ? 'bg-[var(--color-brand-soft)]'
                : 'hover:bg-[var(--color-surface-muted)]'
            }`}
          >
            <img
              src={state.profile.avatar}
              alt={firstNameOnly}
              className="w-7 h-7 rounded-full object-cover flex-shrink-0 ring-1 ring-[var(--color-line)]"
            />
            {sidebarExpanded && (
              <div className="flex-1 text-left overflow-hidden">
                <p className="text-[13px] font-medium leading-tight text-[var(--color-ink)] truncate">{firstNameOnly}</p>
                <p className="text-[11px] text-[var(--color-ink-faint)] truncate">{state.profile.role}</p>
              </div>
            )}
          </button>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────── */}
      <div className="relative flex flex-1 flex-col overflow-hidden">
        {activeView === 'chat' ? (
          /* ── Chat view ─────────────────────────────────────────── */
          <div className="flex flex-1 overflow-hidden">
            {/* Session list */}
            <aside className="w-[300px] flex-shrink-0 flex flex-col border-r border-[var(--color-line)] bg-[var(--color-surface)]">
              <div className="px-4 py-3.5 border-b border-[var(--color-line)] flex-shrink-0 flex items-center justify-between">
                <h2 className="text-[14px] font-semibold text-[var(--color-ink)]">Conversas Reais</h2>
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

              <div className="flex-1 overflow-y-auto custom-scrollbar">
                {chatLoading && state.sessions.length === 0 && (
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

                {filteredSessions.map((session) => (
                  <div
                    key={session.id}
                    className={`relative flex items-center gap-3 px-3 py-3 border-b border-[var(--color-line)] transition-colors group ${
                      activeSessionId === session.id
                        ? 'bg-[var(--color-brand-soft)]'
                        : 'hover:bg-[var(--color-surface-muted)]'
                    }`}
                    onMouseEnter={() => setHoveredSessionId(session.id)}
                    onMouseLeave={() => setHoveredSessionId(null)}
                  >
                    <button
                      onClick={() => setActiveSessionId(session.id)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    >
                      <div className="w-10 h-10 flex-shrink-0 rounded-full bg-[var(--color-surface-muted)] border border-[var(--color-line)] flex items-center justify-center overflow-hidden">
                        {profilePics[session.id] ? (
                          <img src={profilePics[session.id]} alt={session.customerName} className="w-full h-full object-cover" />
                        ) : (
                          <User className="w-4.5 h-4.5 text-[var(--color-ink-faint)]" strokeWidth={1.8} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <h3 className="text-[13.5px] font-semibold text-[var(--color-ink)] truncate">
                            {session.customerName}
                          </h3>
                          <span className={`text-[11px] text-[var(--color-ink-faint)] flex-shrink-0 ml-1 transition-opacity ${hoveredSessionId === session.id ? 'opacity-0' : ''}`}>
                            {session.lastMessageTime}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[12.5px] text-[var(--color-ink-muted)] truncate flex-1">
                            {session.lastMessage}
                          </p>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {session.alerts && session.alerts.length > 0 && (
                              <span className="rounded-full bg-[var(--color-alert)] px-1.5 py-0.5 text-[10px] font-bold text-white">!</span>
                            )}
                            {session.unreadCount > 0 && (
                              <span className="rounded-full bg-[var(--color-brand)] min-w-[18px] h-[18px] flex items-center justify-center px-1 text-[10px] font-bold text-white">
                                {session.unreadCount}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>

                    {/* Delete button — visible on hover */}
                    {hoveredSessionId === session.id && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm(`Excluir a conversa com ${session.customerName}? Esta ação não pode ser desfeita.`)) {
                            void handleDeleteSession(session.id);
                          }
                        }}
                        title="Excluir conversa"
                        className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-lg text-[var(--color-ink-faint)] hover:bg-[var(--color-alert-soft)] hover:text-[var(--color-alert)] transition-colors flex-shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" strokeWidth={1.8} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </aside>

            {/* Chat panel */}
            <main className="relative flex flex-1 flex-col overflow-hidden wa-pattern">
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

                  <div className="z-10 flex min-h-14 flex-shrink-0 items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-wa-panel)]/80 px-4 py-2 backdrop-blur-sm">
                    <button
                      onClick={() => setDetailsOpen((value) => !value)}
                      className="flex min-w-0 items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-surface)]/70"
                    >
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface-muted)] overflow-hidden">
                        {activeSession && profilePics[activeSession.id] ? (
                          <img src={profilePics[activeSession.id]} alt={activeSession.customerName} className="w-full h-full object-cover" />
                        ) : (
                          <User className="h-4.5 w-4.5 text-[var(--color-ink-muted)]" strokeWidth={1.8} />
                        )}
                      </div>
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
                      <button
                        onClick={() => setDetailsOpen((value) => !value)}
                        className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)]"
                      >
                        {detailsOpen ? 'Fechar perfil' : 'Abrir perfil'}
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
                                  if (activeSession && window.confirm(`Excluir a conversa com ${activeSession.customerName}? Esta ação não pode ser desfeita.`)) {
                                    void handleDeleteSession(activeSession.id);
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
                  <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-1.5">
                    <div className="self-center mb-2">
                      <span className="text-[11px] font-medium text-[var(--color-ink-faint)] bg-[var(--color-wa-panel)]/60 px-3 py-1 rounded-full">
                        Criptografia de ponta a ponta
                      </span>
                    </div>

                    <AnimatePresence initial={false}>
                      {activeSession.messages.map((message) => {
                        const isSystem = message.kind === 'text' && message.content.includes('[SISTEMA]');
                        const isUser = message.role === 'user';
                        const displayText = isSystem
                          ? message.content.replace('[SISTEMA]', '').trim()
                          : message.content;

                        if (isSystem) {
                          return (
                            <motion.div
                              key={message.id}
                              initial={{ opacity: 0, scale: 0.96 }}
                              animate={{ opacity: 1, scale: 1 }}
                              className="self-center my-1"
                            >
                              <span className="inline-block text-[11.5px] font-medium bg-[var(--color-warn-soft)] text-[var(--color-warn)] px-3 py-1 rounded-full">
                                {displayText}
                              </span>
                            </motion.div>
                          );
                        }

                        return (
                          <motion.div
                            key={message.id}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={`flex ${isUser ? 'justify-start' : 'justify-end'}`}
                          >
                            <div
                              className={`rounded-xl px-3.5 py-2 shadow-[var(--shadow-card)] ${
                                message.kind === 'image' ? 'max-w-[26rem]' : 'max-w-[72%]'
                              } ${
                                isUser
                                  ? 'bg-[var(--color-wa-bubble-in)] rounded-tl-sm text-[var(--color-ink)]'
                                  : 'bg-[var(--color-wa-bubble-out)] rounded-tr-sm text-[var(--color-ink)]'
                              }`}
                            >
                              {message.kind === 'image' && (
                                message.attachment?.dataUrl ? (
                                  <img
                                    src={message.attachment.dataUrl}
                                    alt={message.attachment.fileName}
                                    className="mb-2 max-h-72 w-full rounded-xl object-cover"
                                  />
                                ) : (
                                  <div className="mb-2 flex h-44 items-center justify-center rounded-xl bg-[var(--color-surface-muted)] text-[12px] text-[var(--color-ink-muted)]">
                                    Imagem recebida
                                  </div>
                                )
                              )}

                              {message.kind === 'document' && message.attachment && (
                                <a
                                  href={message.attachment.dataUrl}
                                  download={message.attachment.fileName}
                                  className="mb-2 flex items-center gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)]/85 px-3 py-2 transition-colors hover:bg-[var(--color-surface)]"
                                >
                                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]">
                                    <FileText className="h-4.5 w-4.5" strokeWidth={1.8} />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-[12.5px] font-semibold text-[var(--color-ink)]">
                                      {message.attachment.fileName}
                                    </p>
                                    <p className="text-[11px] text-[var(--color-ink-muted)]">
                                      {formatAttachmentSize(message.attachment.sizeBytes)}
                                    </p>
                                  </div>
                                  {message.attachment.dataUrl && (
                                    <Download className="h-4 w-4 flex-shrink-0 text-[var(--color-ink-muted)]" strokeWidth={1.8} />
                                  )}
                                </a>
                              )}

                              {displayText && <p className="text-[14px] leading-relaxed">{displayText}</p>}

                              <div className="mt-1 flex items-center justify-end gap-1">
                                <span className="text-[10.5px] text-[var(--color-ink-faint)]">{message.timestamp}</span>
                                {!isUser && (
                                  <CheckCheck className="w-3 h-3 text-[var(--color-brand)]" strokeWidth={2} />
                                )}
                              </div>
                            </div>
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
                          {state.quickResponses
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
                          {state.quickResponses.filter((r) =>
                            r.trigger.includes(ownerInput.slice(1).toUpperCase()),
                          ).length === 0 && (
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
                        ) : (
                          <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]">
                            <FileText className="h-6 w-6" strokeWidth={1.8} />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-semibold text-[var(--color-ink)]">
                            {pendingAttachment.fileName}
                          </p>
                          <p className="text-[12px] text-[var(--color-ink-muted)]">
                            {pendingAttachment.type === 'image' ? 'Imagem pronta para envio' : 'Documento pronto para envio'} • {formatAttachmentSize(pendingAttachment.sizeBytes)}
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
                          className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-surface)] text-[var(--color-ink-muted)] shadow-[var(--shadow-card)] transition-colors hover:text-[var(--color-ink)]"
                          title="Enviar imagem"
                        >
                          <ImagePlus className="h-4.5 w-4.5" strokeWidth={1.8} />
                        </button>
                        <button
                          onClick={() => documentInputRef.current?.click()}
                          className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-surface)] text-[var(--color-ink-muted)] shadow-[var(--shadow-card)] transition-colors hover:text-[var(--color-ink)]"
                          title="Enviar documento"
                        >
                          <Paperclip className="h-4.5 w-4.5" strokeWidth={1.8} />
                        </button>
                      </div>
                      <div className="relative flex-1">
                        <input
                          type="text"
                          value={ownerInput}
                          onChange={(e) => setOwnerInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && void handleOwnerSend()}
                          placeholder={pendingAttachment ? 'Adicione uma legenda (opcional)' : 'Digite uma mensagem ou /macro'}
                          className="w-full bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl px-4 py-2.5 text-[13.5px] outline-none shadow-[var(--shadow-card)] focus:ring-2 focus:ring-[var(--color-brand)]/20 focus:border-[var(--color-brand)] transition-all pr-9"
                        />
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          {pendingAttachment ? (
                            <Paperclip className="h-4 w-4 text-[var(--color-brand)]" strokeWidth={1.8} />
                          ) : ownerInput.startsWith('/') ? (
                            <Bot className="w-4 h-4 text-[var(--color-brand)]" strokeWidth={1.8} />
                          ) : (
                            <UserCheck className="w-4 h-4 text-[var(--color-ink-faint)]" strokeWidth={1.8} />
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => void handleOwnerSend()}
                        className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all flex-shrink-0 ${
                          ownerInput || pendingAttachment
                            ? 'bg-[var(--color-brand)] text-white shadow-[var(--shadow-card)] hover:bg-[var(--color-brand-deep)]'
                            : 'bg-[var(--color-surface-muted)] text-[var(--color-ink-faint)]'
                        }`}
                      >
                        <Send className="w-4 h-4" strokeWidth={2} />
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

            {/* Customer details panel */}
            {detailsOpen && activeSession && (
              <aside className="w-[260px] flex-shrink-0 flex flex-col border-l border-[var(--color-line)] bg-[var(--color-surface)] overflow-y-auto custom-scrollbar">
                <div className="px-4 py-3.5 border-b border-[var(--color-line)] flex-shrink-0 flex items-center justify-between">
                  <h3 className="text-[13.5px] font-semibold text-[var(--color-ink)]">Perfil do cliente</h3>
                  <button
                    onClick={() => setDetailsOpen(false)}
                    className="rounded-md p-1 text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)] transition-colors"
                  >
                    <X className="h-4 w-4" strokeWidth={1.8} />
                  </button>
                </div>

                <div className="flex flex-col items-center gap-2 px-4 py-5 border-b border-[var(--color-line)]">
                  <div className="w-14 h-14 rounded-full bg-[var(--color-surface-muted)] border border-[var(--color-line)] flex items-center justify-center overflow-hidden">
                    {profilePics[activeSession.id] ? (
                      <img src={profilePics[activeSession.id]} alt={activeSession.customerName} className="w-full h-full object-cover" />
                    ) : (
                      <User className="w-6 h-6 text-[var(--color-ink-faint)]" strokeWidth={1.8} />
                    )}
                  </div>
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
                        <span className="text-[12.5px] font-medium text-[var(--color-ink)]">{activeSession.customerPhone ? formatPhoneDisplay(activeSession.customerPhone) : '—'}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[12.5px] text-[var(--color-ink-muted)]">Modo IA</span>
                        <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full ${activeSession.autoReply ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]' : 'bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)]'}`}>
                          {activeSession.autoReply ? 'Ativo' : 'Manual'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[12.5px] text-[var(--color-ink-muted)]">Última mensagem</span>
                        <span className="text-[12px] text-[var(--color-ink-faint)]">{activeSession.lastMessageTime}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </aside>
            )}
          </div>
        ) : (
          /* ── Other views ────────────────────────────────────────── */
          <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[var(--color-canvas)]">
            {activeView === 'dashboard' && (
              <DashboardView state={state} setActiveView={setActiveView} />
            )}
            {activeView === 'kanban' && (
              <DragDropContext onDragEnd={onDragEnd}>
                <KanbanView state={state} onDragEnd={onDragEnd} setActiveView={setActiveView} />
              </DragDropContext>
            )}
            {activeView === 'calendar' && (
              <CalendarView
                state={state}
                selectedDate={selectedDate}
                setSelectedDate={setSelectedDate}
                showDatePicker={showDatePicker}
                setShowDatePicker={setShowDatePicker}
              />
            )}
            {activeView === 'catalog' && (
              <CatalogView
                state={state}
                isAuthenticated={!!token}
                authLoading={authLoading}
                produtosLoading={produtosLoading}
                produtosError={produtosError}
                produtosPdv={produtosPdv}
                refreshProdutos={refreshProdutos}
              />
            )}
            {activeView === 'ai-configs' && (
              <AIConfigsView state={state} setState={setState} />
            )}
            {activeView === 'settings' && (
              <SettingsView
                state={state}
                setState={setState}
                saveEmpresa={saveEmpresa}
                isAuthenticated={!!token}
              />
            )}
            {activeView === 'profile' && (
              <ProfileView
                state={state}
                setState={setState}
                empresa={empresa}
                saveEmpresa={saveEmpresa}
              />
            )}
            {activeView === 'drivers' && (
              <DriversView
                orders={state.orders}
                drivers={drivers}
                isAuthenticated={!!token}
                loading={driversLoading}
                error={driversError}
                createDriver={createDriver}
                updateDriver={updateDriver}
                deleteDriver={deleteDriver}
              />
            )}
          </div>
        )}
      </div>

      {/* ── Nova conversa modal ──────────────────────────────────── */}
      <AnimatePresence>
        {showNewChatModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) setShowNewChatModal(false); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              transition={{ duration: 0.15 }}
              className="w-[400px] bg-[var(--color-surface)] rounded-2xl shadow-[var(--shadow-pop)] border border-[var(--color-line)] overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-line)]">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-[var(--color-brand-soft)] flex items-center justify-center">
                    <Phone className="w-4 h-4 text-[var(--color-brand-deep)]" strokeWidth={1.8} />
                  </div>
                  <h3 className="text-[14px] font-semibold text-[var(--color-ink)]">Nova conversa</h3>
                </div>
                <button
                  onClick={() => setShowNewChatModal(false)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)] transition-colors"
                >
                  <X className="w-4 h-4" strokeWidth={1.8} />
                </button>
              </div>

              {/* Body */}
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

              {/* Footer */}
              <div className="px-5 pb-5 flex items-center justify-end gap-2">
                <button
                  onClick={() => setShowNewChatModal(false)}
                  className="px-4 py-2 rounded-xl text-[13px] font-medium text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)] transition-colors"
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
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
