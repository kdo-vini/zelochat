import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DropResult } from '@hello-pangea/dnd';
import { Sparkles, Settings, User as UserIcon } from 'lucide-react';
import { useDrivers } from './hooks/useDrivers';
import { useTriggers } from './hooks/useTriggers';
import { useOrders } from './hooks/useOrders';
import { useAutoPrint } from './hooks/useAutoPrint';
import { usePrinter } from './hooks/usePrinter';
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
import { normalizeZeloChatMode } from './domain/zelochatMode';
import type { OrderFocusRequest } from './domain/orderFocus';
import { Sidebar, NAV_PRIMARY, NAV_SECONDARY, RESTAURANT_ONLY_VIEWS, GENERAL_ALLOWED_VIEWS } from './components/Sidebar';
import type { View } from './components/Sidebar';
import { MainContent } from './components/MainContent';
import { MobileBottomNav } from './components/MobileBottomNav';
import { ChatView } from './components/views/ChatView';

/* ─── Nav definitions (in Sidebar.tsx) ──────────────────────────── */
const ACTIVE_SESSION_STORAGE_KEY = 'zelochat_active_session_id';
const BOOT_MARK_PREFIX = 'zelochat:boot';


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

/* ─── NavButton moved to Sidebar.tsx ────────────────────────────── */

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
  const {
    isActive: subscriptionActive,
    capabilities: subscriptionCapabilities,
    loading: subscriptionLoading,
    refresh: refreshSubscription,
  } = useSubscription(session);
  const { empresa, save: saveEmpresa, refresh: refreshEmpresa } = useEmpresaPerfil(session);
  const [reactivatingAccount, setReactivatingAccount] = useState(false);
  const zelochatMode = normalizeZeloChatMode(empresa?.zelochat_mode);
  const isGeneralMode = zelochatMode === 'general';
  const shouldLoadCatalog = !!session && !isGeneralMode && (
    deferredDataReady ||
    activeView === 'ai-configs'
  );
  // The order subscription must stay active in Atendimento too. A ZeloMenu
  // order can arrive there and needs to be printed before the store accepts it.
  const shouldLoadOrders = !!session && !isGeneralMode;
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
    retryFailedMessage,
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
  const { autoPrintOrder, reprintOrder } = useAutoPrint(printer, state.businessInfo.name || 'ZeloChat', toast);

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

  useEffect(() => { saveInitialState(state); }, [state.businessInfo, state.profile]);

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
          return n && o.id === n.id && o.status === n.status && o.requiresAcceptance === n.requiresAcceptance;
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
  }, [token, catalogReadyForConfigSync, state.businessInfo, state.products, state.blockedDates, state.aiInstructions, state.deliveryConfig, state.pixReceiptConfig, catalog.categorias, catalog.subcategorias]);

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
      orders: prev.orders.map((o) => o.id === orderId
        ? {
            ...o,
            status: newStatus,
            // Stamp closedAt on delivery so the Produção board's linger filter
            // (filterProductionBoardOrders) keeps the card visible for the
            // window instead of hiding it instantly — the server's real
            // closed_at is within ~2s and the sync effect treats same-status
            // rows as equal, so the optimistic timestamp is what sticks.
            ...(newStatus === 'delivered' && !o.closedAt ? { closedAt: new Date().toISOString() } : {}),
            ...((o.requiresAcceptance && (newStatus === 'pending' || newStatus === 'preparing'))
              ? { requiresAcceptance: false }
              : {}),
          }
        : o),
    }));
    void updateOrderStatusInSupabase(orderId, newStatus).catch((err) => {
      console.error('[App] updateOrderStatus Supabase failed:', err);
      setState((prev) => ({ ...prev, orders: prevOrders }));
      const detail = err instanceof Error ? err.message : '';
      const isFriendlyStatusError = detail === 'Pedido não encontrado.'
        || detail.startsWith('O pedido foi alterado em outra tela.')
        || detail.startsWith('O pedido não pode avançar a partir do estado atual.')
        || detail.startsWith('A quantidade de um item ultrapassa o estoque atual.')
        || detail.startsWith('Você não tem permissão para atualizar este pedido.');
      toast.error(isFriendlyStatusError
        ? detail + ' O pedido voltou para a coluna anterior.'
        : 'Não consegui mover o pedido. Voltei pra coluna anterior.');
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
      toast.success(printer.connected ? 'Pedido adicionado e enviado para impressão.' : 'Pedido adicionado.');
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
      pixReceiptConfig: state.pixReceiptConfig,
    }),
    [state.aiInstructions, state.blockedDates, state.pixReceiptConfig],
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
      pixReceiptConfig: state.pixReceiptConfig,
    }),
    [
      state.aiInstructions,
      state.blockedDates,
      state.businessInfo,
      state.deliveryConfig,
      state.drivers,
      state.quickResponses,
      state.triggers,
      state.pixReceiptConfig,
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
        <Sidebar
          activeView={activeView}
          expanded={sidebarExpanded}
          onToggle={() => setSidebarExpanded((v) => !v)}
          onNavigate={setActiveView}
          primaryNavItems={primaryNavItems}
          secondaryNavItems={secondaryNavItems}
          openEscalationCount={openEscalationCount}
          unreadConversationsCount={unreadConversationsCount}
          isGeneralMode={isGeneralMode}
          firstNameOnly={firstNameOnly}
          profileAvatar={state.profile.avatar}
          profileRole={state.profile.role}
          printer={printer}
          testOrder={state.orders[0]}
        />

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
      <MainContent
        activeView={activeView}
        token={token}
        isGeneralMode={isGeneralMode}
        subscriptionLoading={subscriptionLoading}
        subscriptionActive={subscriptionActive}
        setState={setState}
        setActiveView={setActiveView}
        chatView={<MemoChatView
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
            retryFailedMessage={retryFailedMessage}
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
            operatorName={state.profile.name}
          />
        }
        dashboardState={dashboardState}
        productionState={productionState}
        calendarState={calendarState}
        aiConfigsState={aiConfigsState}
        settingsState={settingsState}
        profileState={profileState}
        onDragEnd={onDragEnd}
        handleAddOrder={handleAddOrder}
        handleEditOrder={handleEditOrder}
        handleDeleteOrder={handleDeleteOrder}
        updateOrderStatus={updateOrderStatus}
        reprintOrder={reprintOrder}
        canPrint={printer.connected}
        pendingOrderFocus={pendingOrderFocus}
        handleNavigateToKanban={handleNavigateToKanban}
        triggers={triggers}
        triggersError={triggersError}
        createTrigger={createTrigger}
        updateTriggerRequest={updateTriggerRequest}
        deleteTriggerRequest={deleteTriggerRequest}
        quickResponses={quickResponses}
        addQuickResponse={addQuickResponse}
        updateQuickResponse={updateQuickResponse}
        deleteQuickResponse={deleteQuickResponse}
        saveAiInstructions={saveAiInstructions}
        empresa={empresa}
        saveEmpresa={saveEmpresa}
        zelochatMode={zelochatMode}
        drivers={drivers}
        driversLoading={driversLoading}
        driversError={driversError}
        createDriver={createDriver}
        updateDriver={updateDriver}
        deleteDriver={deleteDriver}
        onDispatchSuccess={handleDispatchSuccess}
        orders={state.orders}
      />

      <MobileBottomNav
        activeView={activeView}
        primaryNavItems={primaryNavItems}
        bottomSheetItems={bottomSheetItems}
        moreSheetOpen={moreSheetOpen}
        openEscalationCount={openEscalationCount}
        unreadConversationsCount={unreadConversationsCount}
        isGeneralMode={isGeneralMode}
        onNavigate={setActiveView}
        onToggleMore={() => setMoreSheetOpen(true)}
        onCloseMore={() => setMoreSheetOpen(false)}
      />

      </div> {/* end flex-1 inner wrapper */}
    </div>
    </div>
  );
}
