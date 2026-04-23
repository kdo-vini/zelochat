import React, { useEffect, useRef, useState } from 'react';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import {
  Bike,
  Bot,
  Calendar as CalendarIcon,
  Coffee,
  Kanban,
  LayoutDashboard,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShoppingBag,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ChatView } from './components/views/ChatView';
import { DashboardView } from './components/views/DashboardView';
import { ProductionView } from './components/views/ProductionView';
import { CalendarView } from './components/views/CalendarView';
import { AIConfigsView } from './components/views/AIConfigsView';
import { SettingsView } from './components/views/SettingsView';
import { ProfileView } from './components/views/ProfileView';
import { DriversView } from './components/views/DriversView';
import { CatalogView } from './components/views/CatalogView';
import { useDrivers } from './hooks/useDrivers';
import { useTriggers } from './hooks/useTriggers';
import { useOrders } from './hooks/useOrders';
import { useProdutos } from './hooks/useProdutos';
import { useEmpresaPerfil } from './hooks/useEmpresaPerfil';
import { useSupabaseSession } from './hooks/useSupabaseSession';
import { useWhatsAppSessions } from './hooks/useWhatsAppSessions';
import { apiUrl } from './config';
import { mapProdutoToProduct } from './services/zeloApi';
import { loadInitialState, saveInitialState } from './services/statePersistence';
import type { Order, ZeloState } from './types';

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

/* ─── App ─────────────────────────────────────────────────────── */
export default function App() {
  const [activeView, setActiveView] = useState<View>('chat');
  const [state, setState] = useState<ZeloState>(() => loadInitialState());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sidebarExpanded, setSidebarExpanded] = useState<boolean>(() => {
    try {
      return localStorage.getItem('zelochat_sidebar_expanded') !== 'false';
    } catch { return true; }
  });
  const [profilePics, setProfilePics] = useState<Record<string, string>>({});

  const syncConfigTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const {
    triggers,
    error: triggersError,
    createTrigger,
    updateTrigger: updateTriggerRequest,
    deleteTrigger: deleteTriggerRequest,
  } = useTriggers(token);
  const {
    orders: supabaseOrders,
    addOrder: addOrderToSupabase,
    updateOrderStatus: updateOrderStatusInSupabase,
    updateOrder: updateOrderInSupabase,
    deleteOrder: deleteOrderInSupabase,
  } = useOrders(session);

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
        name:         empresa.nome_exibicao    ?? prev.businessInfo.name,
        address:      empresa.endereco         ?? prev.businessInfo.address,
        phone:        empresa.contato          ?? prev.businessInfo.phone,
        pixKey:       empresa.chave_pix        ?? prev.businessInfo.pixKey,
        managerPhone: empresa.manager_phone    ?? prev.businessInfo.managerPhone,
        openTime:     empresa.horario_abertura  ?? prev.businessInfo.openTime,
        closeTime:    empresa.horario_fechamento ?? prev.businessInfo.closeTime,
        closedDays:   empresa.dias_fechamento   ?? prev.businessInfo.closedDays,
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
    setState((prev) => {
      const same =
        prev.orders.length === supabaseOrders.length &&
        prev.orders.every((o, i) => {
          const n = supabaseOrders[i];
          return n && o.id === n.id && o.status === n.status;
        });
      return same ? prev : { ...prev, orders: supabaseOrders };
    });
  }, [supabaseOrders]);

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

  // Busca fotos de perfil para sessões ainda não carregadas.
  // Armazena '' imediatamente para não re-requisitar JIDs sem foto a cada update de sessão.
  useEffect(() => {
    if (!token || sessions.length === 0) return;
    const missing = sessions.filter((s) => !(s.id in profilePics));
    if (missing.length === 0) return;
    const placeholders: Record<string, string> = {};
    missing.forEach((s) => { placeholders[s.id] = ''; });
    setProfilePics((prev) => ({ ...prev, ...placeholders }));
    missing.forEach((s) => {
      void fetchProfilePicture(s.id).then((url) => {
        if (url) setProfilePics((prev) => ({ ...prev, [s.id]: url }));
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, token]);


  const syncConfigToServer = async (s: ZeloState) => {
    if (!token) return;
    try {
      await fetch(apiUrl('/api/sync-config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          name: s.businessInfo.name,
          specialty: s.businessInfo.specialty,
          hours: `${s.businessInfo.openTime}–${s.businessInfo.closeTime}`,
          closedDays: s.businessInfo.closedDays,
          address: s.businessInfo.address,
          pixKey: s.businessInfo.pixKey,
          products: s.products,
          blockedDates: s.blockedDates,
          dailyContext: s.dailyContext,
          aiInstructions: s.aiInstructions,
          managerPhone: s.businessInfo.managerPhone,
        }),
      });
    } catch { /* backend offline during frontend work */ }
  };

  // Sync inicial — dispara assim que o token estiver disponível
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (token) void syncConfigToServer(state); }, [token]);

  // Sync debounced — aguarda 600ms sem mudanças antes de enviar ao servidor
  useEffect(() => {
    if (syncConfigTimerRef.current) clearTimeout(syncConfigTimerRef.current);
    syncConfigTimerRef.current = setTimeout(() => { void syncConfigToServer(state); }, 600);
    return () => { if (syncConfigTimerRef.current) clearTimeout(syncConfigTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.businessInfo, state.products, state.blockedDates, state.dailyContext, state.aiInstructions]);

  const totalUnread = state.sessions.reduce((sum, s) => sum + (s.unreadCount ?? 0), 0);

  const updateOrderStatus = (orderId: string, newStatus: Order['status']) => {
    setState((prev) => ({
      ...prev,
      orders: prev.orders.map((o) => o.id === orderId ? { ...o, status: newStatus } : o),
    }));
    void updateOrderStatusInSupabase(orderId, newStatus).catch((err) =>
      console.error('[App] updateOrderStatus Supabase failed:', err),
    );
  };

  const handleAddOrder = async (payload: Omit<Order, 'id' | 'createdAt'>) => {
    const order = await addOrderToSupabase(payload);
    setState((prev) => ({ ...prev, orders: [order, ...prev.orders] }));
  };

  const handleEditOrder = async (id: string, payload: Omit<Order, 'id' | 'createdAt'>) => {
    await updateOrderInSupabase(id, payload);
    setState((prev) => ({
      ...prev,
      orders: prev.orders.map((o) => o.id === id ? { ...o, ...payload } : o),
    }));
  };

  const handleDeleteOrder = async (id: string) => {
    await deleteOrderInSupabase(id);
    setState((prev) => ({ ...prev, orders: prev.orders.filter((o) => o.id !== id) }));
  };

  const handleDeleteSession = async (sessionId: string) => {
    // Snapshot for rollback before optimistic removal
    const prevSessions = state.sessions;
    const prevActiveId = activeSessionId;

    setState((prev) => ({ ...prev, sessions: prev.sessions.filter((s) => s.id !== sessionId) }));
    if (activeSessionId === sessionId) setActiveSessionId(null);

    try {
      await deleteSession(sessionId);
    } catch (err) {
      // Rollback optimistic removal on failure
      setState((prev) => ({ ...prev, sessions: prevSessions }));
      setActiveSessionId(prevActiveId);
      console.error('[App] handleDeleteSession failed:', err);
    }
  };

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    updateOrderStatus(result.draggableId, result.destination.droppableId as Order['status']);
  };

  const firstNameOnly = state.profile.name.split(' ')[0];

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
          <ChatView
            sessions={state.sessions}
            activeSessionId={activeSessionId}
            setActiveSessionId={setActiveSessionId}
            quickResponses={state.quickResponses}
            chatLoading={chatLoading}
            chatError={chatError}
            token={token}
            authLoading={authLoading}
            profilePics={profilePics}
            send={send}
            toggleAutoReply={toggleAutoReply}
            updateSessionName={updateSessionName}
            hydrateSession={hydrateSession}
            onDeleteSession={handleDeleteSession}
            onDailyContextUpdate={(items) =>
              setState((prev) => ({ ...prev, dailyContext: [...(prev.dailyContext ?? []), ...items] }))
            }
          />
        ) : (
          /* ── Other views ────────────────────────────────────────── */
          <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[var(--color-canvas)]">
            {activeView === 'dashboard' && (
              <DashboardView state={state} setActiveView={setActiveView} />
            )}
            {activeView === 'kanban' && (
              <DragDropContext onDragEnd={onDragEnd}>
                <ProductionView
                  state={state}
                  onDragEnd={onDragEnd}
                  setActiveView={setActiveView}
                  onAddOrder={handleAddOrder}
                  onEditOrder={handleEditOrder}
                  onDeleteOrder={handleDeleteOrder}
                  isAuthenticated={!!token}
                />
              </DragDropContext>
            )}
            {activeView === 'calendar' && (
              <CalendarView
                state={state}
                setState={setState}
                onNavigateToKanban={() => setActiveView('kanban')}
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
              <AIConfigsView
                state={state}
                setState={setState}
                triggers={triggers}
                triggersError={triggersError}
                createTrigger={createTrigger}
                updateTrigger={updateTriggerRequest}
                deleteTrigger={deleteTriggerRequest}
              />
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

    </div>
  );
}
