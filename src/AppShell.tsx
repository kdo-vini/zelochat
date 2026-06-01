import React, { Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import {
  Bike,
  Bot,
  Calendar as CalendarIcon,
  Coffee,
  Kanban,
  LayoutDashboard,
  MessageCircle,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShoppingBag,
  Sparkles,
  User as UserIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
// ChatView is eager — it is the default active view and the most-used feature.
// All other views are lazy so they only add JS when first navigated to.
import { ChatView } from './components/views/ChatView';
const DashboardView = lazy(() =>
  import('./components/views/DashboardView').then((m) => ({ default: m.DashboardView })),
);
const ProductionView = lazy(() =>
  import('./components/views/ProductionView').then((m) => ({ default: m.ProductionView })),
);
const CalendarView = lazy(() =>
  import('./components/views/CalendarView').then((m) => ({ default: m.CalendarView })),
);
const AIConfigsView = lazy(() =>
  import('./components/views/AIConfigsView').then((m) => ({ default: m.AIConfigsView })),
);
const SettingsView = lazy(() =>
  import('./components/views/SettingsView').then((m) => ({ default: m.SettingsView })),
);
const ProfileView = lazy(() =>
  import('./components/views/ProfileView').then((m) => ({ default: m.ProfileView })),
);
const DriversView = lazy(() =>
  import('./components/views/DriversView').then((m) => ({ default: m.DriversView })),
);
const CatalogView = lazy(() =>
  import('./components/views/CatalogView').then((m) => ({ default: m.CatalogView })),
);
const NovidadesView = lazy(() =>
  import('./components/views/NovidadesView').then((m) => ({ default: m.NovidadesView })),
);
import { useDrivers } from './hooks/useDrivers';
import { useTriggers } from './hooks/useTriggers';
import { useOrders } from './hooks/useOrders';
import { usePrinter } from './hooks/usePrinter';
import { PrinterButton } from './components/PrinterButton';
import { useCatalog } from './hooks/useCatalog';
import { useEmpresaPerfil } from './hooks/useEmpresaPerfil';
import { useQuickResponses } from './hooks/useQuickResponses';
import { useSubscription } from './hooks/useSubscription';
import { useSupabaseSession } from './hooks/useSupabaseSession';
import { useWhatsAppSessions } from './hooks/useWhatsAppSessions';
import { useOpenEscalationCount } from './hooks/useEscalationEvents';
import { useNotificationSound } from './hooks/useNotificationSound';
import { useNotifications } from './hooks/useNotifications';
import { useToast } from './contexts/ToastContext';
import { SoundUnlockBanner } from './components/shared/SoundUnlockBanner';
import { BackendOfflineBanner } from './components/shared/BackendOfflineBanner';
import { apiUrl } from './config';
import { inferCategoria } from './services/zeloApi';
import { loadInitialState, saveInitialState } from './services/statePersistence';
import type { Order, ZeloState } from './types';
import { PRICING } from './data/pricing';
import { normalizeZeloChatMode } from './domain/zelochatMode';
import type { OrderFocusRequest } from './domain/orderFocus';

type View =
  | 'dashboard'
  | 'chat'
  | 'kanban'
  | 'calendar'
  | 'ai-configs'
  | 'settings'
  | 'profile'
  | 'drivers'
  | 'catalog'
  | 'novidades';

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

const GENERAL_ALLOWED_VIEWS = new Set<View>(['chat', 'ai-configs', 'settings', 'profile', 'novidades']);
const RESTAURANT_ONLY_VIEWS = new Set<View>(['dashboard', 'kanban', 'calendar', 'drivers', 'catalog']);
const ACTIVE_SESSION_STORAGE_KEY = 'zelochat_active_session_id';
const BOOT_MARK_PREFIX = 'zelochat:boot';
const AUTO_PRINT_DEDUPE_WINDOW_MS = 60_000;

function readStoredActiveSessionId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredActiveSessionId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, id);
    else localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in private windows; selection still works in memory.
  }
}

function markBootStep(name: string): void {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return;
  performance.mark(`${BOOT_MARK_PREFIX}:${name}`);
}

/* ─── NavButton component ─────────────────────────────────────── */
interface NavButtonProps {
  item: NavItem;
  active: boolean;
  expanded: boolean;
  badge?: number;
  badgeTone?: 'unread' | 'alert';
  onClick: () => void;
}

const NavButton: React.FC<NavButtonProps> = memo(({ item, active, expanded, badge, badgeTone = 'unread', onClick }) => {
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
        <span className={`flex-shrink-0 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-white text-[10px] font-bold ${
          badgeTone === 'alert' ? 'bg-[var(--color-alert)]' : 'bg-[#25D366]'
        } ${
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
});

NavButton.displayName = 'NavButton';

// ChatView stays eager and memoised — it is the default route and renders on
// every page load. Lazy views use their own internal memo; wrapping a lazy
// component in memo() here is not useful and triggers a TS warning.
const MemoChatView = memo(ChatView);

/* ─── AppShell ────────────────────────────────────────────────── */
export default function AppShell() {
  const [activeView, setActiveView] = useState<View>('chat');
  const [state, setState] = useState<ZeloState>(() => loadInitialState());
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(() => readStoredActiveSessionId());
  const [pendingOrderFocus, setPendingOrderFocus] = useState<{ key: number; request: OrderFocusRequest } | null>(null);
  const [sidebarExpanded, setSidebarExpanded] = useState<boolean>(() => {
    try {
      return localStorage.getItem('zelochat_sidebar_expanded') !== 'false';
    } catch { return true; }
  });
  const [profilePics, setProfilePics] = useState<Record<string, string>>({});
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const [deferredDataReady, setDeferredDataReady] = useState(false);

  const syncConfigTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingOrderFocusSeqRef = useRef(0);
  const lastSyncedConfigRef = useRef<string | null>(null);
  const hasSeenConfigSnapshotRef = useRef(false);
  // P1.34 — track consecutive sync failures to surface a SINGLE toast after
  // sustained failure (not on every debounced 600ms attempt). A short blip
  // is fine to swallow; hours of failed sync needs operator awareness so
  // the AI doesn't run with stale config.
  const syncConfigFailCountRef = useRef<number>(0);
  const syncConfigToastShownRef = useRef<boolean>(false);
  const SYNC_CONFIG_FAIL_THRESHOLD = 5; // ~3s of consecutive failures (5 × 600ms)
  const empresaHydratedRef = useRef(false);
  const skipNextProfilePersistRef = useRef(false);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bootStartMarkedRef = useRef(false);

  const setActiveSessionId = useCallback((value: string | null | ((prev: string | null) => string | null)) => {
    setActiveSessionIdState((previous) => {
      const next = typeof value === 'function' ? value(previous) : value;
      writeStoredActiveSessionId(next);
      return next;
    });
  }, []);

  const { session, token, loading: authLoading } = useSupabaseSession();
  const { isActive: subscriptionActive, loading: subscriptionLoading, refresh: refreshSubscription } = useSubscription(session);
  const { empresa, save: saveEmpresa, refresh: refreshEmpresa } = useEmpresaPerfil(session);
  const [reactivatingAccount, setReactivatingAccount] = useState(false);
  const zelochatMode = normalizeZeloChatMode(empresa?.zelochat_mode);
  const isGeneralMode = zelochatMode === 'general';
  const shouldLoadCatalog = !!session && !isGeneralMode && (
    deferredDataReady ||
    activeView === 'catalog' ||
    activeView === 'ai-configs'
  );
  const shouldLoadOrders = !!session && !isGeneralMode && (
    activeView === 'dashboard' ||
    activeView === 'kanban' ||
    activeView === 'calendar' ||
    activeView === 'drivers'
  );
  const shouldLoadDrivers = !!token && !isGeneralMode && (
    activeView === 'drivers' ||
    activeView === 'settings' ||
    activeView === 'profile'
  );
  const shouldLoadTriggers = !!token && (
    activeView === 'ai-configs' ||
    activeView === 'settings' ||
    activeView === 'profile'
  );
  const shouldLoadQuickResponses = !!session && (
    deferredDataReady ||
    activeView === 'ai-configs' ||
    activeView === 'settings' ||
    activeView === 'profile'
  );
  const primaryNavItems = useMemo(
    () => NAV_PRIMARY.filter((item) => !isGeneralMode || !RESTAURANT_ONLY_VIEWS.has(item.id)),
    [isGeneralMode],
  );
  const secondaryNavItems = useMemo(
    () => NAV_SECONDARY.filter((item) => !isGeneralMode || !RESTAURANT_ONLY_VIEWS.has(item.id)),
    [isGeneralMode],
  );
  const bottomSheetItems = useMemo(
    () => [
      ...secondaryNavItems,
      { id: 'novidades' as View, icon: Sparkles, label: 'Novidades', description: 'O que mudou no sistema' },
      { id: 'settings' as View, icon: Settings, label: 'Configurações', description: 'Empresa e integrações' },
      { id: 'profile' as View, icon: UserIcon, label: 'Perfil', description: 'Sua conta' },
    ],
    [isGeneralMode, secondaryNavItems],
  );
  const {
    sessions,
    loading: chatLoading,
    error: chatError,
    refresh: refreshSessions,
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
    updateSessionName,
    lastEscalation,
    dismissEscalation,
    resolveEscalation,
    escalateManually,
    acknowledgeEscalation,
    waConnected,
    wsConnected,
    lastTagsUpdate,
  } = useWhatsAppSessions(token);
  const { count: openEscalationCount, reload: reloadOpenEscalationCount } = useOpenEscalationCount(
    token,
    lastEscalation?.event.id ?? null,
  );
  const sound = useNotificationSound();
  const { permission: notificationPermission, isVisible: tabVisible, requestPermission: requestNotificationPermission, notify } = useNotifications();
  const toast = useToast();
  const catalog = useCatalog(session, { enabled: shouldLoadCatalog });
  const {
    drivers,
    loading: driversLoading,
    error: driversError,
    createDriver,
    updateDriver,
    deleteDriver,
  } = useDrivers(token, { enabled: shouldLoadDrivers });
  const {
    triggers,
    error: triggersError,
    createTrigger,
    updateTrigger: updateTriggerRequest,
    deleteTrigger: deleteTriggerRequest,
  } = useTriggers(token, { enabled: shouldLoadTriggers });
  const printer = usePrinter();
  const autoPrintedOrdersRef = useRef(new Map<string, number>());
  const autoPrintOrder = useCallback((order: Order) => {
    const now = Date.now();
    for (const [orderId, ts] of autoPrintedOrdersRef.current) {
      if (now - ts > AUTO_PRINT_DEDUPE_WINDOW_MS) autoPrintedOrdersRef.current.delete(orderId);
    }

    const previousTs = autoPrintedOrdersRef.current.get(order.id);
    if (previousTs && now - previousTs < AUTO_PRINT_DEDUPE_WINDOW_MS) return;
    autoPrintedOrdersRef.current.set(order.id, now);

    printer.print(order, state.businessInfo.name || 'ZeloChat').catch((err) => {
      autoPrintedOrdersRef.current.delete(order.id);
      console.error('[printer] auto-print falhou para pedido', order.id, err);
      toast.error('Não consegui imprimir o pedido automaticamente. Verifique a impressora.');
    });
  }, [printer, state.businessInfo.name, toast]);

  const {
    orders: supabaseOrders,
    refresh: refreshOrders,
    addOrder: addOrderToSupabase,
    updateOrderStatus: updateOrderStatusInSupabase,
    updateOrder: updateOrderInSupabase,
    deleteOrder: deleteOrderInSupabase,
  } = useOrders(session, autoPrintOrder, { enabled: shouldLoadOrders });
  const {
    items: quickResponses,
    add: addQuickResponse,
    update: updateQuickResponse,
    remove: deleteQuickResponse,
  } = useQuickResponses(session, { enabled: shouldLoadQuickResponses });
  const catalogReadyForConfigSync = isGeneralMode || catalog.hasLoaded;

  useEffect(() => { saveInitialState(state); }, [state.dailyContext, state.businessInfo, state.profile]);

  useEffect(() => {
    try { localStorage.setItem('zelochat_sidebar_expanded', String(sidebarExpanded)); } catch {}
  }, [sidebarExpanded]);

  useEffect(() => {
    if (!bootStartMarkedRef.current) {
      bootStartMarkedRef.current = true;
      markBootStep('start');
    }
  }, []);

  useEffect(() => {
    if (!authLoading && token) markBootStep('auth-ready');
  }, [authLoading, token]);

  useEffect(() => {
    if (empresa) markBootStep('profile-ready');
  }, [empresa]);

  useEffect(() => {
    if (token && !chatLoading && sessions.length > 0) {
      window.requestAnimationFrame(() => markBootStep('chat-list-painted'));
    }
  }, [chatLoading, sessions.length, token]);

  useEffect(() => {
    if (!token) {
      setDeferredDataReady(false);
      return;
    }

    const win = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const markReady = () => {
      setDeferredDataReady(true);
      markBootStep('deferred-data-ready');
    };

    if (win.requestIdleCallback) {
      const handle = win.requestIdleCallback(markReady, { timeout: 1500 });
      return () => win.cancelIdleCallback?.(handle);
    }

    const timer = window.setTimeout(markReady, 1200);
    return () => window.clearTimeout(timer);
  }, [token]);

  useEffect(() => {
    if (isGeneralMode && !GENERAL_ALLOWED_VIEWS.has(activeView)) {
      setActiveView('chat');
      setMoreSheetOpen(false);
    }
  }, [activeView, isGeneralMode]);

  // Stripe Checkout return: when the browser comes back with ?billing=success
  // we force a sync from Stripe (in case the webhook is still racing) and
  // refresh the subscription state. ?billing=canceled just lands the user on
  // the settings page so they can retry. We strip the query param so reloads
  // don't re-trigger the side effect.
  useEffect(() => {
    if (!token) return;
    const params = new URLSearchParams(window.location.search);
    const billing = params.get('billing');
    const checkoutSessionId = params.get('session_id');
    if (!billing) return;

    if (billing === 'success' || billing === 'portal-return') {
      void (async () => {
        try {
          if (billing === 'portal-return' || checkoutSessionId) {
            await fetch(apiUrl('/api/billing/sync'), {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
              },
              body: JSON.stringify(checkoutSessionId ? { sessionId: checkoutSessionId } : {}),
            });
          }
        } catch {
          // Webhook will eventually catch up — sync is best-effort.
        }
        await refreshSubscription();
      })();
    }

    setActiveView('settings');
    params.delete('billing');
    params.delete('session_id');
    const next = params.toString();
    const url = window.location.pathname + (next ? `?${next}` : '');
    window.history.replaceState({}, '', url);
  }, [token, refreshSubscription]);

  // Hydrate businessInfo + profile from the real empresa_perfil when user is authenticated
  useEffect(() => {
    if (!empresa) return;
    empresaHydratedRef.current = true;
    skipNextProfilePersistRef.current = true;
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
        timezone:     empresa.timezone          ?? prev.businessInfo.timezone,
      },
      profile: {
        ...prev.profile,
        name:   empresa.nome_exibicao ?? prev.profile.name,
        ...(empresa.logo_url ? { avatar: empresa.logo_url } : {}),
      },
      aiInstructions: empresa.ai_instructions ?? prev.aiInstructions,
      deliveryConfig: empresa.delivery_config ?? prev.deliveryConfig,
      pixReceiptConfig: empresa.pix_receipt_config ?? prev.pixReceiptConfig,
      blockedDates:   empresa.blocked_dates   ?? prev.blockedDates,
      managerHistory: empresa.manager_history ?? prev.managerHistory,
    }));
  }, [empresa]);

  // Persist blockedDates and managerHistory to Supabase (debounced, only after initial hydration)
  useEffect(() => {
    if (!empresaHydratedRef.current) return;
    if (skipNextProfilePersistRef.current) {
      skipNextProfilePersistRef.current = false;
      return;
    }
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      void saveEmpresa({ blocked_dates: state.blockedDates, manager_history: state.managerHistory });
    }, 800);
    return () => { if (persistTimerRef.current) clearTimeout(persistTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.blockedDates, state.managerHistory]);

  // Mirror DB-backed quick responses into the shared ZeloState so ChatView keeps working unchanged.
  useEffect(() => {
    setState((prev) => {
      const same =
        prev.quickResponses.length === quickResponses.length &&
        prev.quickResponses.every((q, i) => {
          const n = quickResponses[i];
          return n && q.id === n.id && q.trigger === n.trigger && q.response === n.response;
        });
      return same ? prev : { ...prev, quickResponses };
    });
  }, [quickResponses]);

  const saveAiInstructions = useCallback(async (instructions: string): Promise<boolean> => {
    return saveEmpresa({ ai_instructions: instructions });
  }, [saveEmpresa, state.pixReceiptConfig]);

  const savePixReceiptConfig = useCallback(async (config: typeof state.pixReceiptConfig): Promise<boolean> => {
    return saveEmpresa({ pix_receipt_config: config });
  }, [saveEmpresa]);

  useEffect(() => {
    setState((prev) => prev.sessions === sessions ? prev : { ...prev, sessions });
  }, [sessions]);

  useEffect(() => {
    const mapped = catalog.produtos.map((p) => ({
      id: String(p.id),
      name: p.nome,
      price: p.preco,
      available: !p.ocultar_no_pdv && (!p.controlar_estoque || p.estoque_atual > 0),
      unitBased: p.eh_item_por_unidade,
      stockControlled: p.controlar_estoque,
      stockQuantity: p.estoque_atual,
      category: inferCategoria(p.nome),
    }));
    setState((prev) => {
      const same =
        prev.products.length === mapped.length &&
        prev.products.every((p, i) => {
          const n = mapped[i];
          return n && p.id === n.id && p.name === n.name && p.price === n.price && p.available === n.available && p.unitBased === n.unitBased && p.stockControlled === n.stockControlled && p.stockQuantity === n.stockQuantity && p.category === n.category;
        });
      return same ? prev : { ...prev, products: mapped };
    });
  }, [catalog.produtos]);

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

  // Realtime publication on zelochat_orders is empty — refetch when entering
  // an order-consuming view so manager doesn't need F5 to see fresh data.
  useEffect(() => {
    if (activeView === 'kanban' || activeView === 'calendar') {
      void refreshOrders();
    }
  }, [activeView, refreshOrders]);

  useEffect(() => {
    if (state.sessions.length === 0) { setActiveSessionId(null); return; }
    if (activeSessionId && !state.sessions.some((s) => s.id === activeSessionId)) {
      setActiveSessionId(null);
    }
  }, [activeSessionId, setActiveSessionId, state.sessions]);

  useEffect(() => {
    if (!activeSessionId) return;
    void hydrateSession(activeSessionId);
    void markRead(activeSessionId);
    markBootStep('active-chat-hydrating');
  }, [activeSessionId, hydrateSession, markRead]);

  useEffect(() => {
    if (!activeSessionId) return;
    const active = state.sessions.find((s) => s.id === activeSessionId);
    if (!active?.messages?.length) return;
    window.requestAnimationFrame(() => markBootStep('active-chat-hydrated'));
  }, [activeSessionId, state.sessions]);

  // Use only profile pictures already persisted on the session row. Fetching a
  // WhatsApp picture per chat on every reload creates a noisy, slow request fan-out.
  useEffect(() => {
    if (!token || sessions.length === 0) return;
    const missing = sessions.filter((s) => !(s.id in profilePics));
    if (missing.length === 0) return;
    const updates: Record<string, string> = {};
    missing.forEach((s) => {
      // Se a sessão já tem a foto (vinda do banco), use-a. Senão, marca vazia.
      updates[s.id] = s.profilePicUrl || '';
    });
    setProfilePics((prev) => ({ ...prev, ...updates }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, token]);


  const syncConfigToServer = async (s: ZeloState, fingerprint: string) => {
    if (!token) return;
    try {
      const catalogHierarchy = catalog.categorias.map((cat) => {
        const prodsInCat = catalog.produtos.filter((p) => p.id_categoria === cat.id);
        const subs = catalog.subcategorias.filter((sub) => sub.id_categoria === cat.id);
        return {
          nome: cat.nome,
          subcategorias: subs.map((sub) => ({
            nome: sub.nome,
            produtos: prodsInCat
              .filter((p) => p.id_subcategoria === sub.id)
              .map((p) => ({
                name: p.nome,
                price: p.preco,
                available: !p.ocultar_no_pdv && (!p.controlar_estoque || p.estoque_atual > 0),
                stockControlled: p.controlar_estoque,
                stockQuantity: p.estoque_atual,
              })),
          })),
          produtosDireto: prodsInCat
            .filter((p) => p.id_subcategoria == null)
            .map((p) => ({
              name: p.nome,
              price: p.preco,
              available: !p.ocultar_no_pdv && (!p.controlar_estoque || p.estoque_atual > 0),
              stockControlled: p.controlar_estoque,
              stockQuantity: p.estoque_atual,
            })),
        };
      });
      const res = await fetch(apiUrl('/api/sync-config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          name: s.businessInfo.name,
          specialty: s.businessInfo.specialty,
          hours: `${s.businessInfo.openTime}–${s.businessInfo.closeTime}`,
          openTime: s.businessInfo.openTime,
          closeTime: s.businessInfo.closeTime,
          closedDays: s.businessInfo.closedDays,
          address: s.businessInfo.address,
          pixKey: s.businessInfo.pixKey,
          products: s.products,
          catalogHierarchy,
          blockedDates: s.blockedDates,
          dailyContext: s.dailyContext,
          aiInstructions: s.aiInstructions,
          deliveryConfig: s.deliveryConfig,
          pixReceiptConfig: s.pixReceiptConfig,
          managerPhone: s.businessInfo.managerPhone,
        }),
      });
      if (!res.ok) throw new Error(`sync-config returned ${res.status}`);
      lastSyncedConfigRef.current = fingerprint;
      // P1.34 — sucesso reseta o contador. Se o operador via o toast
      // anteriormente, mostramos um "voltou ao normal" pra fechar o ciclo.
      if (syncConfigToastShownRef.current) {
        toast.success('Configuração voltou a sincronizar.');
        syncConfigToastShownRef.current = false;
      }
      syncConfigFailCountRef.current = 0;
    } catch (err) {
      // P1.34 — falha transitória é OK (dev offline, deploy em curso).
      // Falha sustentada (>N consecutivas) significa que o AI tá rodando
      // com config stale — operador precisa saber. One-shot toast pra não
      // spammar, e re-disparamos só se voltar a falhar depois de uma fase
      // de sucesso.
      syncConfigFailCountRef.current += 1;
      if (
        syncConfigFailCountRef.current >= SYNC_CONFIG_FAIL_THRESHOLD &&
        !syncConfigToastShownRef.current
      ) {
        toast.error('Algumas configurações não estão salvando no servidor. Verifique sua conexão.');
        syncConfigToastShownRef.current = true;
      }
      console.warn('[AppShell] syncConfigToServer failed:', err);
    }
  };

  // Sync debounced — aguarda 600ms sem mudanças antes de enviar ao servidor
  useEffect(() => {
    hasSeenConfigSnapshotRef.current = false;
    lastSyncedConfigRef.current = null;
    syncConfigFailCountRef.current = 0;
    syncConfigToastShownRef.current = false;
  }, [token]);

  useEffect(() => {
    if (!token) return;
    if (!catalogReadyForConfigSync) return;

    const fingerprint = JSON.stringify({
      businessInfo: state.businessInfo,
      products: state.products,
      blockedDates: state.blockedDates,
      dailyContext: state.dailyContext,
      aiInstructions: state.aiInstructions,
      deliveryConfig: state.deliveryConfig,
      pixReceiptConfig: state.pixReceiptConfig,
      catalogCategorias: catalog.categorias,
      catalogSubcategorias: catalog.subcategorias,
    });

    if (!hasSeenConfigSnapshotRef.current) {
      hasSeenConfigSnapshotRef.current = true;
      lastSyncedConfigRef.current = fingerprint;
      return;
    }

    if (lastSyncedConfigRef.current === fingerprint) return;

    if (syncConfigTimerRef.current) clearTimeout(syncConfigTimerRef.current);
    syncConfigTimerRef.current = setTimeout(() => { void syncConfigToServer(state, fingerprint); }, 600);
    return () => { if (syncConfigTimerRef.current) clearTimeout(syncConfigTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, catalogReadyForConfigSync, state.businessInfo, state.products, state.blockedDates, state.dailyContext, state.aiInstructions, state.deliveryConfig, state.pixReceiptConfig, catalog.categorias, catalog.subcategorias]);

  // Count of conversations that have ANY unread message (WhatsApp-style: 1 dot
  // per chat, not a sum of message counts). The per-conversation badge in
  // ChatView still shows the per-chat message count.
  const unreadConversationsCount = useMemo(
    () => state.sessions.reduce((count, s) => count + ((s.unreadCount ?? 0) > 0 ? 1 : 0), 0),
    [state.sessions],
  );

  // Reload the open-escalation counter after the operator marks one resolved.
  // (lastEscalation already triggers a reload via the deps in useOpenEscalationCount.)

  // Sound + system notification feedback for escalation events. Throttling is
  // enforced inside useNotificationSound; tab-visibility check inside useNotifications.
  useEffect(() => {
    if (!lastEscalation) return;
    sound.play('alert');
    const session = state.sessions.find((s) => s.id === lastEscalation.sessionId);
    const customerName = session?.customerName || 'Cliente';
    notify(
      `🆘 Conversa escalada — ${customerName}`,
      lastEscalation.event.reasonText || 'Atendimento humano necessário',
      { tag: `escalation-${lastEscalation.event.id}`, forceShow: true },
    );
    // Don't auto-navigate — that would yank focus away from whatever the operator
    // is doing. The red badge in the nav + the pinned-to-top row + sound is enough.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEscalation?.event.id]);

  // Light bubble sound on every new INBOUND customer message (not for our own sends
  // and not for escalations — those play the alert sound separately above).
  const lastInboundMessageIdRef = useRef<string | null>(null);
  useEffect(() => {
    let newest: { id: string; sentAt: number } | null = null;
    for (const s of state.sessions) {
      if (s.status === 'escalated') continue;
      const last = s.messages?.[s.messages.length - 1];
      if (!last || last.role !== 'user') continue;
      const t = new Date(last.timestamp || 0).getTime();
      if (!newest || t > newest.sentAt) newest = { id: last.id, sentAt: t };
    }
    if (!newest) return;
    if (lastInboundMessageIdRef.current === null) {
      // First mount — establish baseline without playing.
      lastInboundMessageIdRef.current = newest.id;
      return;
    }
    if (newest.id !== lastInboundMessageIdRef.current) {
      lastInboundMessageIdRef.current = newest.id;
      // Don't play if the operator is already looking at this chat.
      const isLookingAt = activeSessionId && state.sessions.some(
        (s) => s.id === activeSessionId && s.messages?.some((m) => m.id === newest!.id),
      );
      if (!isLookingAt || !tabVisible) sound.play('bubble');
    }
  }, [state.sessions, activeSessionId, tabVisible, sound]);

  // P1.30 — `updateOrderStatus` (drag-and-drop in kanban + status PATCH from
  // chat) now ROLLS BACK the optimistic state on failure and surfaces a toast.
  // Previously the card stayed in the wrong column forever and the operator
  // didn't know the change hadn't actually persisted.
  const updateOrderStatus = useCallback((orderId: string, newStatus: Order['status']) => {
    const prevOrders = state.orders;
    setState((prev) => ({
      ...prev,
      orders: prev.orders.map((o) => o.id === orderId ? { ...o, status: newStatus } : o),
    }));
    void updateOrderStatusInSupabase(orderId, newStatus).catch((err) => {
      console.error('[App] updateOrderStatus Supabase failed:', err);
      setState((prev) => ({ ...prev, orders: prevOrders }));
      toast.error('Não consegui mover o pedido. Voltei pra coluna anterior.');
    });
  }, [state.orders, toast, updateOrderStatusInSupabase]);

  // P1.31 — order CRUD now reports failures to the operator instead of letting
  // the modal close silently while the row stays in DB. Successes get a
  // confirmation toast so the operator sees something happened.
  const handleAddOrder = useCallback(async (payload: Omit<Order, 'id' | 'createdAt'>) => {
    try {
      const order = await addOrderToSupabase(payload);
      setState((prev) => ({ ...prev, orders: [order, ...prev.orders] }));
      autoPrintOrder(order);
      toast.success('Pedido adicionado e enviado para impressão.');
    } catch (err) {
      console.error('[App] handleAddOrder failed:', err);
      toast.error('Não consegui adicionar o pedido. Tente de novo.');
      throw err; // let the modal show its own form error too
    }
  }, [addOrderToSupabase, autoPrintOrder, toast]);

  const handleEditOrder = useCallback(async (id: string, payload: Omit<Order, 'id' | 'createdAt'>) => {
    const prevOrders = state.orders;
    try {
      await updateOrderInSupabase(id, payload);
      setState((prev) => ({
        ...prev,
        orders: prev.orders.map((o) => o.id === id ? { ...o, ...payload } : o),
      }));
      toast.success('Pedido atualizado.');
    } catch (err) {
      console.error('[App] handleEditOrder failed:', err);
      setState((prev) => ({ ...prev, orders: prevOrders }));
      toast.error('Não consegui salvar as alterações.');
      throw err;
    }
  }, [state.orders, toast, updateOrderInSupabase]);

  const handleDeleteOrder = useCallback(async (id: string) => {
    const prevOrders = state.orders;
    setState((prev) => ({ ...prev, orders: prev.orders.filter((o) => o.id !== id) }));
    try {
      await deleteOrderInSupabase(id);
      toast.success('Pedido excluído.');
    } catch (err) {
      console.error('[App] handleDeleteOrder failed:', err);
      setState((prev) => ({ ...prev, orders: prevOrders }));
      toast.error('Não consegui excluir o pedido.');
      throw err;
    }
  }, [deleteOrderInSupabase, state.orders, toast]);

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    // Snapshot for rollback before optimistic removal
    const prevSessions = state.sessions;
    const prevActiveId = activeSessionId;

    setState((prev) => ({ ...prev, sessions: prev.sessions.filter((s) => s.id !== sessionId) }));
    if (activeSessionId === sessionId) setActiveSessionId(null);

    try {
      await deleteSession(sessionId);
      toast.success('Conversa excluída.');
    } catch (err) {
      // Rollback optimistic removal on failure
      setState((prev) => ({ ...prev, sessions: prevSessions }));
      setActiveSessionId(prevActiveId);
      console.error('[App] handleDeleteSession failed:', err);
      toast.error('Não consegui excluir a conversa. Tente de novo.');
    }
  }, [activeSessionId, deleteSession, state.sessions, toast]);

  const onDragEnd = useCallback((result: DropResult) => {
    if (!result.destination) return;
    updateOrderStatus(result.draggableId, result.destination.droppableId as Order['status']);
  }, [updateOrderStatus]);

  const handleDailyContextUpdate = useCallback((items: ZeloState['dailyContext']) => {
    setState((prev) => ({ ...prev, dailyContext: [...(prev.dailyContext ?? []), ...items] }));
  }, []);

  const handleResolveEscalation = useCallback(async (jid: string) => {
    await resolveEscalation(jid);
    await reloadOpenEscalationCount();
  }, [reloadOpenEscalationCount, resolveEscalation]);

  const handleNavigateToKanban = useCallback(() => {
    setActiveView('kanban');
  }, []);

  const handleOpenOrderFromChat = useCallback((request: OrderFocusRequest) => {
    pendingOrderFocusSeqRef.current += 1;
    setPendingOrderFocus({
      key: pendingOrderFocusSeqRef.current,
      request,
    });
    setActiveView('kanban');
  }, []);

  const handleDispatchSuccess = useCallback((orderId: string) => {
    updateOrderStatus(orderId, 'out_for_delivery');
  }, [updateOrderStatus]);

  const firstNameOnly = useMemo(() => state.profile.name.split(' ')[0], [state.profile.name]);

  // P2.6 — keep non-chat views insulated from WhatsApp session churn. Incoming
  // WS messages replace `state.sessions`; these memoized slices preserve prop
  // identity for views that don't consume conversations.
  const dashboardState = useMemo(
    () => ({ profile: state.profile }),
    [state.profile],
  );
  const productionState = useMemo(() => ({ orders: state.orders }), [state.orders]);
  const calendarState = useMemo(
    () => ({ orders: state.orders, blockedDates: state.blockedDates, businessInfo: state.businessInfo }),
    [state.blockedDates, state.businessInfo, state.orders],
  );
  const aiConfigsState = useMemo(
    () => ({
      aiInstructions: state.aiInstructions,
      blockedDates: state.blockedDates,
      dailyContext: state.dailyContext,
      managerHistory: state.managerHistory,
      pixReceiptConfig: state.pixReceiptConfig,
    }),
    [state.aiInstructions, state.blockedDates, state.dailyContext, state.managerHistory, state.pixReceiptConfig],
  );
  const settingsState = useMemo(
    () => ({
      aiInstructions: state.aiInstructions,
      blockedDates: state.blockedDates,
      businessInfo: state.businessInfo,
      deliveryConfig: state.deliveryConfig,
      drivers: state.drivers,
      quickResponses: state.quickResponses,
      triggers: state.triggers,
    }),
    [
      state.aiInstructions,
      state.blockedDates,
      state.businessInfo,
      state.deliveryConfig,
      state.drivers,
      state.quickResponses,
      state.triggers,
    ],
  );
  const profileState = useMemo(
    () => ({
      profile: state.profile,
      aiInstructions: state.aiInstructions,
      blockedDates: state.blockedDates,
      businessInfo: state.businessInfo,
      deliveryConfig: state.deliveryConfig,
      drivers: state.drivers,
      quickResponses: state.quickResponses,
      triggers: state.triggers,
    }),
    [
      state.profile,
      state.aiInstructions,
      state.blockedDates,
      state.businessInfo,
      state.deliveryConfig,
      state.drivers,
      state.quickResponses,
      state.triggers,
    ],
  );

  // Self-service account deletion grace period — banner to reactivate.
  const deletionScheduledAt = empresa?.deletion_scheduled_at ?? null;
  const deletionDaysLeft = deletionScheduledAt
    ? Math.max(0, Math.ceil((new Date(deletionScheduledAt).getTime() - Date.now()) / 86400000))
    : 0;
  const handleReactivateAccount = async () => {
    if (!token) return;
    setReactivatingAccount(true);
    try {
      await fetch(apiUrl('/api/account/reactivate'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      await refreshEmpresa?.();
    } catch {
      /* ignore — banner stays, user can retry */
    } finally {
      setReactivatingAccount(false);
    }
  };

  return (
    <div
      className="flex flex-col overflow-hidden bg-[var(--color-canvas)]"
      style={{ height: 'var(--vvh, 100vh)' }}
    >
      {/* ── Account deletion scheduled banner ──────────────────────── */}
      {deletionScheduledAt && (
        <div className="flex items-center justify-between gap-3 bg-amber-500 text-white px-4 py-2.5 text-[13px] font-medium flex-shrink-0 z-50">
          <span>
            🗑️ Sua conta será apagada em {deletionDaysLeft} {deletionDaysLeft === 1 ? 'dia' : 'dias'}. Nada foi apagado ainda.
          </span>
          <button
            onClick={handleReactivateAccount}
            disabled={reactivatingAccount}
            className="underline underline-offset-2 hover:no-underline whitespace-nowrap flex-shrink-0 disabled:opacity-60"
          >
            {reactivatingAccount ? 'Reativando…' : 'Reativar conta →'}
          </button>
        </div>
      )}

      {/* ── Subscription / WhatsApp banner ─────────────────────────── */}
      {token && !subscriptionLoading && !subscriptionActive ? (
        <div className="flex items-center justify-between gap-3 bg-[var(--color-brand-deep)] text-white px-4 py-2.5 text-[13px] font-medium flex-shrink-0 z-50">
          <span>🔒 Ative seu plano para conectar o WhatsApp e começar a atender pela IA.</span>
          <button
            onClick={() => setActiveView('settings')}
            className="underline underline-offset-2 hover:no-underline whitespace-nowrap flex-shrink-0"
          >
            Ver planos →
          </button>
        </div>
      ) : waConnected === false && subscriptionActive && (
        <div className="flex items-center justify-between gap-3 bg-red-500 text-white px-4 py-2.5 text-[13px] font-medium flex-shrink-0 z-50">
          <span>⚠️ WhatsApp desconectado — sua IA não está respondendo clientes.</span>
          <button
            onClick={() => setActiveView('settings')}
            className="underline underline-offset-2 hover:no-underline whitespace-nowrap flex-shrink-0"
          >
            Reconectar →
          </button>
        </div>
      )}

      {/* P1.33 — WS reconnect indicator. Only fires while subscription is
          active AND there's no higher-priority paywall/disconnect banner.
          The amber color signals "transient — wait" vs the red disconnect
          banner above which signals "click to fix". */}
      {token && subscriptionActive && waConnected !== false && !wsConnected && (
        <div className="flex items-center justify-center gap-2 bg-amber-500 text-white px-4 py-1.5 text-[12.5px] font-medium flex-shrink-0 z-40">
          <span className="inline-block w-2 h-2 rounded-full bg-white animate-pulse" />
          <span>Reconectando ao servidor — mensagens novas podem demorar uns segundos.</span>
        </div>
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* ── Sidebar (desktop only) ──────────────────────────────── */}
      <aside
        className={`bg-[var(--color-surface)] border-r border-[var(--color-line)] hidden md:flex flex-col py-3 flex-shrink-0 z-30 transition-[width] duration-200 ease-in-out overflow-hidden ${
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
            {primaryNavItems.map((item) => (
              <NavButton
                key={item.id}
                item={item}
                active={activeView === item.id}
                expanded={sidebarExpanded}
                badge={item.id === 'chat' ? (openEscalationCount > 0 ? openEscalationCount : unreadConversationsCount) : undefined}
                badgeTone={item.id === 'chat' && openEscalationCount > 0 ? 'alert' : 'unread'}
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
            {secondaryNavItems.map((item) => (
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

        {/* Bottom: novidades + settings + printer + profile */}
        <div className="mt-auto px-2 flex flex-col gap-0.5 flex-shrink-0 pt-2 border-t border-[var(--color-line)]">
          <NavButton
            item={{ id: 'novidades', icon: Sparkles, label: 'Novidades', description: 'O que mudou no sistema' }}
            active={activeView === 'novidades'}
            expanded={sidebarExpanded}
            onClick={() => setActiveView('novidades')}
          />
          <NavButton
            item={{ id: 'settings', icon: Settings, label: 'Configurações', description: 'Empresa e integrações' }}
            active={activeView === 'settings'}
            expanded={sidebarExpanded}
            onClick={() => setActiveView('settings')}
          />
          {!isGeneralMode && (
            <PrinterButton
              printer={printer}
              expanded={sidebarExpanded}
              testOrder={state.orders[0]}
            />
          )}

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
      <div className="relative flex flex-1 flex-col overflow-hidden pb-[64px] md:pb-0">
        <BackendOfflineBanner />
        {token && (
          <SoundUnlockBanner
            unlocked={sound.unlocked}
            onUnlock={sound.unlock}
            onRequestNotifications={requestNotificationPermission}
            notificationPermission={notificationPermission}
          />
        )}
        {token && !subscriptionLoading && !subscriptionActive
          && activeView !== 'settings' && activeView !== 'profile' && activeView !== 'novidades' ? (
          // Paywall gate: when subscription is inactive, every view except
          // Settings / Profile / Novidades shows this placeholder. Backend
          // /api/* endpoints already 402 on the same condition, so trying
          // to render the underlying views just produces a parade of error
          // toasts. See P0.16 in CODE_REVIEW.md.
          <div className="flex flex-1 items-center justify-center bg-[var(--color-canvas)] px-6">
            <div className="max-w-md w-full bg-[var(--color-surface)] border border-[var(--color-line)] rounded-2xl shadow-sm p-8 text-center">
              <div className="text-3xl mb-3">🔒</div>
              <h2 className="text-[20px] font-semibold text-[var(--color-ink)] mb-2">
                Ative seu plano para usar o ZeloChat
              </h2>
              <p className="text-[14px] text-[var(--color-ink-muted)] leading-relaxed mb-6">
                {isGeneralMode
                  ? `A IA e o WhatsApp ficam disponíveis assim que sua assinatura estiver ativa. R$${PRICING.chat.priceBRL}/mês, cancela quando quiser.`
                  : `A IA, o WhatsApp, o kanban e o catálogo ficam disponíveis assim que sua assinatura estiver ativa. R$${PRICING.chat.priceBRL}/mês, cancela quando quiser.`}
              </p>
              <button
                onClick={() => setActiveView('settings')}
                className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg bg-[var(--color-brand)] text-white text-[14px] font-medium hover:bg-[var(--color-brand-deep)] transition-colors"
              >
                Ver planos
              </button>
            </div>
          </div>
        ) : activeView === 'chat' ? (
          <MemoChatView
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
            deleteMessage={deleteMessage}
            updateSessionName={updateSessionName}
            hydrateSession={hydrateSession}
            loadOlderMessages={loadOlderMessages}
            refreshSessions={refreshSessions}
            loadMoreSessions={loadMoreSessions}
            hasMoreSessions={hasMoreSessions}
            loadingMoreSessions={loadingMoreSessions}
            onDeleteSession={handleDeleteSession}
            markManyRead={markManyRead}
            bulkArchive={bulkArchive}
            bulkDelete={bulkDelete}
            togglePin={togglePin}
            onDailyContextUpdate={handleDailyContextUpdate}
            onCreateManualOrder={handleAddOrder}
            resolveEscalation={handleResolveEscalation}
            escalateManually={escalateManually}
            acknowledgeEscalation={acknowledgeEscalation}
            onOpenOrder={handleOpenOrderFromChat}
            escalationRefetchKey={lastEscalation?.event.id ?? null}
            lastTagsUpdate={lastTagsUpdate}
            orders={state.orders}
            onUpdateOrderStatus={updateOrderStatus}
            empresaName={empresa?.nome_exibicao}
          />
        ) : (
          /* ── Other views (lazy-loaded) ──────────────────────────── */
          /* Suspense boundary is placed here, inside the paywall gate,
             so the fallback spinner only appears while the view chunk is
             being fetched — never on the initial app load (ChatView is
             eager) and never during auth/paywall resolution. */
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center bg-[var(--color-canvas)]">
                <div className="w-6 h-6 rounded-full border-2 border-[var(--color-brand)] border-t-transparent animate-spin" />
              </div>
            }
          >
            <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[var(--color-canvas)]">
              {activeView === 'dashboard' && !isGeneralMode && (
                <DashboardView state={dashboardState} setActiveView={setActiveView} token={token} />
              )}
              {activeView === 'kanban' && !isGeneralMode && (
                <DragDropContext onDragEnd={onDragEnd}>
                  <ProductionView
                    state={productionState}
                    onDragEnd={onDragEnd}
                    setActiveView={setActiveView}
                    onAddOrder={handleAddOrder}
                    onEditOrder={handleEditOrder}
                    onDeleteOrder={handleDeleteOrder}
                    onUpdateStatus={updateOrderStatus}
                    isAuthenticated={!!token}
                    focusedOrderRequest={pendingOrderFocus?.request ?? null}
                    focusedOrderRequestKey={pendingOrderFocus?.key ?? null}
                  />
                </DragDropContext>
              )}
              {activeView === 'calendar' && !isGeneralMode && (
                <CalendarView
                  state={calendarState}
                  setState={setState}
                  onNavigateToKanban={handleNavigateToKanban}
                />
              )}
              {activeView === 'catalog' && !isGeneralMode && (
                <CatalogView
                  isAuthenticated={!!session}
                  authLoading={authLoading}
                  loading={catalog.loading}
                  error={catalog.error}
                  categorias={catalog.categorias}
                  subcategorias={catalog.subcategorias}
                  produtos={catalog.produtos}
                  refresh={catalog.refresh}
                  createCategoria={catalog.createCategoria}
                  updateCategoria={catalog.updateCategoria}
                  deleteCategoria={catalog.deleteCategoria}
                  createSubcategoria={catalog.createSubcategoria}
                  updateSubcategoria={catalog.updateSubcategoria}
                  deleteSubcategoria={catalog.deleteSubcategoria}
                  createProduto={catalog.createProduto}
                  updateProduto={catalog.updateProduto}
                  deleteProduto={catalog.deleteProduto}
                />
              )}
              {activeView === 'ai-configs' && (
                <AIConfigsView
                  state={aiConfigsState}
                  setState={setState}
                  triggers={triggers}
                  triggersError={triggersError}
                  createTrigger={createTrigger}
                  updateTrigger={updateTriggerRequest}
                  deleteTrigger={deleteTriggerRequest}
                  quickResponses={quickResponses}
                  addQuickResponse={addQuickResponse}
                  updateQuickResponse={updateQuickResponse}
                  deleteQuickResponse={deleteQuickResponse}
                  saveAiInstructions={saveAiInstructions}
                  savePixReceiptConfig={savePixReceiptConfig}
                  token={token}
                  refreshEmpresa={refreshEmpresa}
                />
              )}
              {activeView === 'settings' && (
                <SettingsView
                  state={settingsState}
                  setState={setState}
                  empresa={empresa}
                  saveEmpresa={saveEmpresa}
                  isAuthenticated={!!token}
                  token={token}
                  zelochatMode={zelochatMode}
                />
              )}
              {activeView === 'profile' && (
                <ProfileView
                  state={profileState}
                  setState={setState}
                  empresa={empresa}
                  saveEmpresa={saveEmpresa}
                  token={token}
                />
              )}
              {activeView === 'drivers' && !isGeneralMode && (
                <DriversView
                  orders={state.orders}
                  drivers={drivers}
                  isAuthenticated={!!token}
                  loading={driversLoading}
                  error={driversError}
                  createDriver={createDriver}
                  updateDriver={updateDriver}
                  deleteDriver={deleteDriver}
                  token={token}
                  onDispatchSuccess={handleDispatchSuccess}
                />
              )}
              {activeView === 'novidades' && (
                <NovidadesView />
              )}
            </div>
          </Suspense>
        )}
      </div>

      {/* ── Bottom tab bar (mobile only) ──────────────────────────── */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 flex md:hidden h-[64px] items-stretch border-t border-[var(--color-line)] bg-[var(--color-surface)]">
        {primaryNavItems.map((item) => {
          const Icon = item.icon;
          const active = activeView === item.id;
          const isAlert = item.id === 'chat' && openEscalationCount > 0;
          const badge = item.id === 'chat' ? (isAlert ? openEscalationCount : unreadConversationsCount) : 0;
          return (
            <button
              key={item.id}
              onClick={() => { setActiveView(item.id); setMoreSheetOpen(false); }}
              className={`relative flex flex-1 flex-col items-center justify-center gap-1 transition-colors ${
                active ? 'text-[var(--color-brand)]' : 'text-[var(--color-ink-muted)]'
              }`}
            >
              <Icon className="h-5 w-5" strokeWidth={active ? 2.2 : 1.8} />
              <span className="text-[10.5px] font-medium leading-none">{item.label}</span>
              {badge > 0 && (
                <span className={`absolute top-1.5 left-1/2 ml-1 rounded-full min-w-[16px] h-[16px] px-1 flex items-center justify-center text-[9.5px] font-bold text-white ${
                  isAlert ? 'bg-[var(--color-alert)]' : 'bg-[#25D366]'
                }`}>
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </button>
          );
        })}
        <button
          onClick={() => setMoreSheetOpen(true)}
          className={`flex flex-1 flex-col items-center justify-center gap-1 transition-colors ${
            moreSheetOpen ? 'text-[var(--color-brand)]' : 'text-[var(--color-ink-muted)]'
          }`}
        >
          <MoreHorizontal className="h-5 w-5" strokeWidth={moreSheetOpen ? 2.2 : 1.8} />
          <span className="text-[10.5px] font-medium leading-none">Mais</span>
        </button>
      </nav>

      {/* ── "Mais" bottom sheet (mobile only) ─────────────────────── */}
      {moreSheetOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMoreSheetOpen(false)}
          />
          <div className="absolute bottom-0 left-0 right-0 rounded-t-2xl bg-[var(--color-surface)] shadow-[var(--shadow-card)] pb-6">
            <div className="mx-auto mt-2 mb-2 h-1 w-10 rounded-full bg-[var(--color-line)]" />
            <div className="px-2 py-1">
              {bottomSheetItems.map((item) => {
                const Icon = item.icon;
                const active = activeView === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => { setActiveView(item.id); setMoreSheetOpen(false); }}
                    className={`w-full flex items-center gap-3 rounded-xl px-3 py-3 transition-colors ${
                      active ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand)]' : 'text-[var(--color-ink)] hover:bg-[var(--color-surface-muted)]'
                    }`}
                  >
                    <Icon className="h-5 w-5 flex-shrink-0" strokeWidth={1.8} />
                    <div className="text-left">
                      <p className="text-[14px] font-medium leading-tight">{item.label}</p>
                      <p className="text-[11.5px] text-[var(--color-ink-faint)] leading-tight mt-0.5">{item.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      </div> {/* end flex-1 inner wrapper */}
    </div>
  );
}
