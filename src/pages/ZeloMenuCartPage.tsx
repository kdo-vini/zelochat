import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Banknote,
  Bike,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronLeft,
  CreditCard,
  Loader2,
  MessageCircle,
  Minus,
  Plus,
  QrCode,
  RefreshCw,
  ShoppingBag,
  ShoppingCart,
  Trash2,
  Wallet,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  confirmPublicCart,
  getPublicCart,
  updatePublicCart,
  type ZeloMenuCatalogGroup,
  type ZeloMenuCatalogProduct,
  type ZeloMenuCartRevalidationIssue,
  type ZeloMenuPublicCartResponse,
  type ZeloMenuUpdateCartPayload,
} from '../services/zelomenuApi';
import {
  formatModifierAwareCartItem,
  resolveModifierSelections,
  type ZeloMenuModifierSelectionInput,
  type ZeloMenuSelectedModifierGroup,
} from '../domain/zelomenuModifiers';
import { resolveDeliveryFeeForNeighborhood } from '../domain/zelomenuDelivery';
import {
  firstZeloMenuCheckoutError,
  validateZeloMenuCheckoutDetails,
} from '../domain/zelomenuCheckout';
import { syncZeloMenuStoreCartCache } from '../domain/zelomenuStoreCartCache';
import { maskBrazilianPhone, normalizePhoneNumber } from '../domain/chat';
import { buildZeloMenuOrderTimeline } from '../domain/zelomenuOrderStatus';
import { useToast } from '../contexts/ToastContext';

type DraftState = {
  customerName: string;
  customerPhone: string;
  items: Array<{
    productId: number | null;
    productName: string;
    quantity: number;
    notes: string;
    selectedOptions: ZeloMenuModifierSelectionInput[];
    selectedModifiers: ZeloMenuSelectedModifierGroup[];
    baseUnitPrice: number;
    modifierDeltaTotal: number;
  }>;
  fulfillmentType: 'pickup' | 'delivery';
  pickupDate: string;
  pickupTime: string;
  deliveryAddress: string;
  deliveryNeighborhood: string;
  paymentMethod: string;
  observations: string;
};

const PAYMENT_OPTIONS = ['Pix', 'Dinheiro', 'Cartão de débito', 'Cartão de crédito', 'Outro'] as const;

function toBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Data de hoje no fuso BR como 'yyyy-mm-dd' (formato de value do <input type=date>).
function todayISOdate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// Hora atual no fuso BR como 'HH:mm' (formato de value do <input type=time>).
// Usada no atalho "Pra já" para preencher um horário concreto automaticamente.
function nowTimeBR(): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
}

function buildDraftFromPayload(payload: ZeloMenuPublicCartResponse): DraftState {
  return {
    customerName: payload.session.customer.name ?? '',
    customerPhone: maskBrazilianPhone(payload.session.customer.phone ?? ''),
    items: payload.session.cart.items.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      notes: item.notes ?? '',
      selectedOptions: item.selectedModifiers.map((group) => ({
        groupId: group.groupId,
        optionIds: group.selectedOptions.map((option) => option.optionId),
      })),
      selectedModifiers: item.selectedModifiers,
      baseUnitPrice: item.baseUnitPrice,
      modifierDeltaTotal: item.modifierDeltaTotal,
    })),
    fulfillmentType: payload.session.fulfillment.type,
    pickupDate: payload.session.fulfillment.pickupDate ?? todayISOdate(),
    pickupTime: payload.session.fulfillment.pickupTime ?? nowTimeBR(),
    deliveryAddress: payload.session.fulfillment.deliveryAddress ?? '',
    deliveryNeighborhood: payload.session.fulfillment.deliveryNeighborhood ?? '',
    paymentMethod: payload.session.payment.declaredMethod ?? '',
    observations: payload.session.cart.observations ?? '',
  };
}

function catalogProductMap(groups: ZeloMenuCatalogGroup[]): Map<number, ZeloMenuCatalogProduct> {
  const next = new Map<number, ZeloMenuCatalogProduct>();
  for (const group of groups) {
    for (const product of group.produtosDireto) {
      next.set(product.id, product);
    }
    for (const subcategory of group.subcategorias) {
      for (const product of subcategory.produtos) {
        next.set(product.id, product);
      }
    }
  }
  return next;
}

function estimateDraftTotals(
  draft: DraftState,
  catalog: ZeloMenuCatalogGroup[],
  neighborhoods: Array<{ name: string; fee: number }>,
) {
  const products = catalogProductMap(catalog);
  const items = draft.items.flatMap((item) => {
    const product = item.productId != null ? products.get(item.productId) : null;
    const quantity = Math.max(0, Math.floor(Number(item.quantity) || 0));
    if (quantity === 0) return [];
    let unitPrice = item.baseUnitPrice + item.modifierDeltaTotal;
    let selectedModifiers = item.selectedModifiers;
    if (product) {
      const resolved = resolveModifierSelections(product.modifierGroups, item.selectedOptions);
      if (resolved.ok) {
        unitPrice = Number((product.basePrice + resolved.deltaTotal).toFixed(2));
        selectedModifiers = resolved.selectedGroups;
      }
    }
    const lineTotal = quantity * Number(unitPrice || 0);
    return [{
      productId: item.productId,
      productName: product?.name ?? item.productName,
      selectedModifiers,
      quantity,
      unitPrice,
      lineTotal,
      notes: item.notes || null,
    }];
  });
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  // Mesma função pura que o servidor usa ao revalidar (FONTE ÚNICA, node-free):
  // o total exibido aqui nunca diverge do total confirmado pelo backend.
  const { fee: deliveryFee, toConfirm: deliveryFeeToConfirm } = resolveDeliveryFeeForNeighborhood({
    type: draft.fulfillmentType,
    neighborhood: draft.fulfillmentType === 'delivery' ? draft.deliveryNeighborhood : null,
    neighborhoods,
  });
  return {
    items,
    subtotal,
    deliveryFee,
    deliveryFeeToConfirm,
    total: subtotal + deliveryFee,
  };
}

function isKnownPaymentMethod(value: string): boolean {
  return PAYMENT_OPTIONS.some((option) => option === value);
}

function draftItemKey(item: DraftState['items'][number]): string {
  const idPart = item.productId ?? item.productName;
  const selections = item.selectedOptions
    .map((group) => `${group.groupId}:${[...group.optionIds].sort().join(',')}`)
    .sort()
    .join('|');
  return `${idPart}::${selections || 'plain'}`;
}

function selectedOptionsFromSelectedModifiers(
  selectedModifiers: ZeloMenuSelectedModifierGroup[],
): ZeloMenuModifierSelectionInput[] {
  return selectedModifiers.map((group) => ({
    groupId: group.groupId,
    optionIds: group.selectedOptions.map((option) => option.optionId),
  }));
}

function estimatedItemKey(
  item: {
    productId: number | null;
    productName: string;
    quantity: number;
    notes?: string | null;
    selectedModifiers: ZeloMenuSelectedModifierGroup[];
    unitPrice: number;
  },
): string {
  return draftItemKey({
    productId: item.productId,
    productName: item.productName,
    quantity: item.quantity,
    notes: item.notes ?? '',
    selectedOptions: selectedOptionsFromSelectedModifiers(item.selectedModifiers),
    selectedModifiers: item.selectedModifiers,
    baseUnitPrice: item.unitPrice,
    modifierDeltaTotal: 0,
  });
}

function revalidationSignature(issues: ZeloMenuCartRevalidationIssue[]): string {
  return issues
    .map((issue) => `${issue.code}:${issue.message}`)
    .join('|');
}

function buildRevalidationToastMessage(issues: ZeloMenuCartRevalidationIssue[]): string {
  const priceIssue = issues.find((issue) => issue.code === 'price_changed');
  if (priceIssue) {
    return `${priceIssue.message} Confira o novo total e toque em Confirmar pedido novamente.`;
  }
  const [firstIssue] = issues;
  const detail = firstIssue?.message ? ` ${firstIssue.message}` : '';
  const suffix = issues.length > 1 ? ` Há mais ${issues.length - 1} ajuste(s) no carrinho.` : '';
  return `Seu carrinho precisa de revisão.${detail}${suffix}`;
}

function buildCartUpdatePayload(
  draft: DraftState,
  scheduleMode: 'asap' | 'scheduled',
): ZeloMenuUpdateCartPayload {
  const pickupDate = scheduleMode === 'asap' ? todayISOdate() : draft.pickupDate;
  const pickupTime = scheduleMode === 'asap' ? nowTimeBR() : draft.pickupTime;
  return {
    customerName: draft.customerName || null,
    customerPhone: normalizePhoneNumber(draft.customerPhone).slice(0, 11) || null,
    items: draft.items.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      notes: item.notes || null,
      selectedOptions: item.selectedOptions,
    })),
    fulfillment: {
      type: draft.fulfillmentType,
      asap: scheduleMode === 'asap',
      pickupDate: pickupDate || null,
      pickupTime: pickupTime || null,
      deliveryAddress: draft.fulfillmentType === 'delivery' ? (draft.deliveryAddress || null) : null,
      deliveryNeighborhood: draft.fulfillmentType === 'delivery' ? (draft.deliveryNeighborhood || null) : null,
    },
    paymentMethod: draft.paymentMethod || null,
    observations: draft.observations || null,
  };
}

function syncStoreCacheFromResponse(response: ZeloMenuPublicCartResponse): void {
  const slug = typeof response.session.metadata.slug === 'string'
    ? response.session.metadata.slug
    : null;
  syncZeloMenuStoreCartCache({
    slug,
    state: response.session.state,
    items: response.session.cart.items,
  });
}

export default function ZeloMenuCartPage() {
  const { token = '' } = useParams();
  const toast = useToast();
  const [payload, setPayload] = useState<ZeloMenuPublicCartResponse | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [scheduleMode, setScheduleMode] = useState<'asap' | 'scheduled'>('asap');
  const [showErrors, setShowErrors] = useState(false);
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>({});
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const revalidationToastShownRef = useRef('');
  const autosaveReadyRef = useRef(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveVersionRef = useRef(0);
  const latestAutosaveRef = useRef<ZeloMenuUpdateCartPayload | null>(null);
  const loadRequestRef = useRef(0);

  const load = async (mode: 'initial' | 'refresh' = 'initial') => {
    const requestId = ++loadRequestRef.current;
    try {
      setError(null);
      if (mode === 'initial') setLoading(true);
      else setRefreshing(true);
      const next = await getPublicCart(token);
      if (requestId !== loadRequestRef.current) return;
      if (mode === 'refresh') revalidationToastShownRef.current = '';
      setPayload(next);
      setDraft(buildDraftFromPayload(next));
      document.title = next.business.name ? `${next.business.name} | Revisar pedido` : 'Revisar pedido';
    } catch (err) {
      if (requestId !== loadRequestRef.current) return;
      const message = err instanceof Error ? err.message : 'Não consegui carregar o carrinho.';
      if (mode === 'initial' || !payload) {
        setError(message);
      } else {
        toast.error(message);
      }
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    autosaveReadyRef.current = false;
    latestAutosaveRef.current = null;
    saveVersionRef.current += 1;
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    setPayload(null);
    setDraft(null);
    setSaveStatus('idle');
    void load();
    return () => {
      loadRequestRef.current += 1;
      saveVersionRef.current += 1;
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
      document.title = 'ZeloChat';
    };
  }, [token]);

  // "Pra já" vs "Agendar (encomenda)": deriva o modo inicial da pendência carregada.
  // Tem horário marcado OU data diferente de hoje => é encomenda agendada.
  useEffect(() => {
    if (!payload) return;
    const f = payload.session.fulfillment;
    const scheduled = f.asap === true
      ? false
      : Boolean(f.pickupTime) || (Boolean(f.pickupDate) && f.pickupDate !== todayISOdate());
    setScheduleMode(scheduled ? 'scheduled' : 'asap');
  }, [payload]);

  const estimated = useMemo(() => {
    if (!payload || !draft) return null;
    return estimateDraftTotals(draft, payload.catalog, payload.business.deliveryNeighborhoods);
  }, [payload, draft]);

  const isStale = payload?.link.tokenStatus === 'stale';
  const isOpen = payload?.session.state === 'cart_open';
  const isPublicOrder = payload?.session.context === 'public_order';
  const isConfirmed = payload?.session.state === 'confirmed_waiting_review' || payload?.session.state === 'confirmed_waiting_payment';
  const isWaitingPayment = payload?.session.state === 'confirmed_waiting_payment';
  const paymentSelection = draft?.paymentMethod && isKnownPaymentMethod(draft.paymentMethod)
    ? draft.paymentMethod
    : draft?.paymentMethod
      ? 'Outro'
      : '';
  const revalidationIssues = payload?.revalidation.issues ?? [];
  const revalidationIssueSignature = revalidationSignature(revalidationIssues);
  const canConfirm = isOpen && !isStale && (draft?.items.length ?? 0) > 0;
  const effectivePickupDate = scheduleMode === 'asap' ? todayISOdate() : (draft?.pickupDate ?? '');
  const effectivePickupTime = scheduleMode === 'asap' ? nowTimeBR() : (draft?.pickupTime ?? '');
  const detailErrors = draft && isPublicOrder
    ? validateZeloMenuCheckoutDetails({
      customerName: draft.customerName,
      customerPhone: draft.customerPhone,
      fulfillmentType: draft.fulfillmentType,
      deliveryAddress: draft.deliveryAddress,
      pickupDate: effectivePickupDate,
      pickupTime: effectivePickupTime,
    })
    : {};

  const validateDetails = (): string | null => firstZeloMenuCheckoutError(detailErrors);
  const autosavePayload = useMemo(
    () => draft ? buildCartUpdatePayload(draft, scheduleMode) : null,
    [draft, scheduleMode],
  );
  const autosaveSignature = useMemo(
    () => autosavePayload ? JSON.stringify(autosavePayload) : '',
    [autosavePayload],
  );

  const orderTimelineInfo = useMemo(() => {
    if (!payload?.productionOrder) return null;
    return buildZeloMenuOrderTimeline(
      payload.productionOrder.status,
      payload.session.fulfillment.type,
    );
  }, [payload?.productionOrder?.status, payload?.productionOrder?.id, payload?.session.fulfillment.type]);

  const enqueueAutosave = useCallback((nextPayload: ZeloMenuUpdateCartPayload): Promise<void> => {
    const version = ++saveVersionRef.current;
    setSaveStatus('saving');
    const queued = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const updated = await updatePublicCart(token, nextPayload);
        syncStoreCacheFromResponse(updated);
        if (version !== saveVersionRef.current) return;
        setPayload(updated);
        setSaveStatus('saved');
      })
      .catch(() => {
        if (version === saveVersionRef.current) setSaveStatus('error');
      });
    saveQueueRef.current = queued;
    return queued;
  }, [token]);

  const flushPendingAutosave = useCallback((): Promise<void> => {
    const latest = latestAutosaveRef.current;
    if (latest && autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
      return enqueueAutosave(latest);
    }
    return saveQueueRef.current.catch(() => undefined);
  }, [enqueueAutosave]);

  useEffect(() => {
    latestAutosaveRef.current = autosavePayload;
    if (!autosavePayload || !isOpen || isStale) return;
    if (!autosaveReadyRef.current) {
      autosaveReadyRef.current = true;
      return;
    }

    setSaveStatus('saving');
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      void enqueueAutosave(autosavePayload);
    }, 650);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [autosavePayload, autosaveSignature, enqueueAutosave, isOpen, isStale]);

  useEffect(() => {
    const flushAutosave = () => {
      if (document.visibilityState !== 'hidden') return;
      void flushPendingAutosave();
    };
    document.addEventListener('visibilitychange', flushAutosave);
    return () => document.removeEventListener('visibilitychange', flushAutosave);
  }, [flushPendingAutosave]);

  useEffect(() => {
    if (!revalidationIssueSignature) {
      revalidationToastShownRef.current = '';
      return;
    }
    if (revalidationToastShownRef.current === revalidationIssueSignature) return;
    revalidationToastShownRef.current = revalidationIssueSignature;
    toast.error(buildRevalidationToastMessage(revalidationIssues));
  }, [revalidationIssueSignature, revalidationIssues, toast]);

  // ── Live order-tracking polling ──────────────────────────────────────────
  // Polls GET /public-api/zelomenu/cart/:token while the order is live.
  // Pauses when the tab is hidden, stops entirely on terminal states.
  useEffect(() => {
    if (!isConfirmed) return;

    let mounted = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const stopPolling = () => {
      if (timer) { clearInterval(timer); timer = null; }
    };

    const poll = async () => {
      try {
        const next = await getPublicCart(token);
        if (!mounted) return;
        setPayload(next);
        setDraft(buildDraftFromPayload(next));
        // Stop polling when the order reaches a terminal (delivered/cancelled)
        if (next.productionOrder) {
          const info = buildZeloMenuOrderTimeline(
            next.productionOrder.status,
            next.session.fulfillment.type,
          );
          if (info.isTerminal) stopPolling();
        }
      } catch {
        // background polling errors are silent
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void poll();
        startPolling();
      } else {
        stopPolling();
      }
    };

    const startPolling = () => {
      stopPolling();
      timer = setInterval(poll, 8000);
    };

    startPolling();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      mounted = false;
      stopPolling();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [isConfirmed, token]);

  const confirmCart = async () => {
    if (!draft || !payload || !isOpen || isStale) return;
    const validationError = validateDetails();
    if (validationError) {
      setShowErrors(true);
      setStep(1);
      toast.error(validationError);
      return;
    }
    try {
      setConfirming(true);
      setError(null);
      await flushPendingAutosave();
      const updated = await updatePublicCart(token, buildCartUpdatePayload(draft, scheduleMode));
      syncStoreCacheFromResponse(updated);

      const updateIssues = updated.revalidation.issues ?? [];
      if (updateIssues.length > 0) {
        const signature = revalidationSignature(updateIssues);
        revalidationToastShownRef.current = signature;
        setPayload(updated);
        setDraft(buildDraftFromPayload(updated));
        toast.error(buildRevalidationToastMessage(updateIssues));
        return;
      }

      const next = await confirmPublicCart(token);
      syncStoreCacheFromResponse(next);
      const finalIssues = next.revalidation.issues ?? [];
      if (!next.confirmation.confirmed && finalIssues.length > 0) {
        const signature = revalidationSignature(finalIssues);
        revalidationToastShownRef.current = signature;
        toast.error(buildRevalidationToastMessage(finalIssues));
      }
      setPayload(next);
      setDraft(buildDraftFromPayload(next));
      if (next.confirmation.confirmed) {
        toast.success(
          next.confirmation.alreadyConfirmed
            ? 'Este pedido já estava confirmado.'
            : 'Pedido confirmado. A loja recebeu o resumo no WhatsApp.',
        );
      } else if (finalIssues.length > 0) {
        // Toast específico já foi exibido acima.
      } else {
        toast.info('Revise os avisos do carrinho antes de confirmar.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não consegui confirmar o pedido.');
    } finally {
      setConfirming(false);
    }
  };

  const changeItemQuantity = (itemKey: string, nextQuantity: number) => {
    if (!isOpen) return;
    setQuantityDrafts((current) => {
      if (!(itemKey in current)) return current;
      const { [itemKey]: _removed, ...rest } = current;
      return rest;
    });
    setDraft((current) => {
      if (!current) return current;
      const normalizedQuantity = Math.max(0, Math.floor(nextQuantity));
      const existing = current.items.find((item) => draftItemKey(item) === itemKey);
      if (!existing && normalizedQuantity === 0) return current;
      const items = existing
        ? current.items
          .map((item) => draftItemKey(item) === itemKey ? { ...item, quantity: normalizedQuantity } : item)
          .filter((item) => item.quantity > 0)
        : current.items;
      return { ...current, items };
    });
  };

  const editItemQuantity = (itemKey: string, rawValue: string) => {
    if (!isOpen) return;
    const digits = rawValue.replace(/\D/g, '').slice(0, 4);
    setQuantityDrafts((current) => ({ ...current, [itemKey]: digits }));
    if (!digits) return;
    const quantity = Number.parseInt(digits, 10);
    if (quantity >= 1) {
      setDraft((current) => current ? {
        ...current,
        items: current.items.map((item) =>
          draftItemKey(item) === itemKey ? { ...item, quantity } : item),
      } : current);
    }
  };

  const finishEditingItemQuantity = (itemKey: string) => {
    setQuantityDrafts((current) => {
      if (!(itemKey in current)) return current;
      const { [itemKey]: _removed, ...rest } = current;
      return rest;
    });
  };

  const updateField = <K extends keyof DraftState>(key: K, value: DraftState[K]) => {
    if (!isOpen) return;
    setDraft((current) => current ? {
      ...current,
      [key]: key === 'customerPhone'
        ? maskBrazilianPhone(String(value ?? '')) as DraftState[K]
        : value,
    } : current);
  };

  const goNext = () => {
    if (step === 1) {
      const validationError = validateDetails();
      if (validationError) {
        setShowErrors(true);
        toast.error(validationError);
        return;
      }
    }
    if (step < 2) {
      setShowErrors(false);
      setStep((s) => Math.min(2, s + 1));
    } else {
      void confirmCart();
    }
  };

  const goBack = async () => {
    if (step > 0) setStep((s) => Math.max(0, s - 1));
    else {
      await flushPendingAutosave();
      window.history.back();
    }
  };

  const enableAsap = () => {
    setScheduleMode('asap');
    updateField('pickupTime', nowTimeBR());
    updateField('pickupDate', todayISOdate());
  };

  const enableScheduled = () => {
    if (scheduleMode === 'asap') {
      updateField('pickupDate', '');
      updateField('pickupTime', '');
    }
    setScheduleMode('scheduled');
  };

  const paymentIcon = (opt: string) => {
    if (opt === 'Pix') return <QrCode className="h-4 w-4" strokeWidth={1.8} />;
    if (opt === 'Dinheiro') return <Banknote className="h-4 w-4" strokeWidth={1.8} />;
    if (opt.startsWith('Cartão')) return <CreditCard className="h-4 w-4" strokeWidth={1.8} />;
    return <Wallet className="h-4 w-4" strokeWidth={1.8} />;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--zm-canvas)] text-[var(--zm-ink)]">
        <div className="mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--zm-brand)]" strokeWidth={1.8} />
          <p className="mt-4 text-[14px] text-[var(--zm-ink-soft)]">Carregando seu carrinho…</p>
        </div>
      </div>
    );
  }

  if (error && !payload) {
    return (
      <div className="min-h-screen bg-[var(--zm-canvas)] text-[var(--zm-ink)]">
        <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 text-center">
          <div className="rounded-full bg-[var(--color-alert-soft)] p-4 text-[var(--color-alert)]">
            <AlertTriangle className="h-8 w-8" strokeWidth={1.8} />
          </div>
          <h1 className="mt-5 text-[22px] font-semibold">Não consegui abrir este carrinho</h1>
          <p className="mt-2 max-w-xl text-[14px] text-[var(--zm-ink-soft)]">{error}</p>
          <button
            type="button"
            onClick={() => void load('initial')}
            className="mt-6 inline-flex h-11 items-center gap-2 rounded-lg bg-[var(--zm-brand)] px-4 text-[14px] font-medium text-white"
          >
            <RefreshCw className="h-4 w-4" strokeWidth={1.8} />
            Tentar de novo
          </button>
        </div>
      </div>
    );
  }

  if (!payload || !draft || !estimated) return null;

  const STEP_TITLES = ['Sua sacola', 'Entrega ou retirada', 'Revisar e confirmar'] as const;
  const isDelivery = draft.fulfillmentType === 'delivery';
  const deliveryEnabled = payload.business.deliveryEnabled;
  const fee = estimated.deliveryFee;
  const feeToConfirm = estimated.deliveryFeeToConfirm;
  const stepLabel1 = isDelivery ? 'Entrega' : 'Retirada';
  const itemCount = estimated.items.reduce((sum, item) => sum + item.quantity, 0);

  const footValue = step === 0
    ? toBRL(estimated.subtotal)
    : feeToConfirm
      ? `${toBRL(estimated.subtotal)} + entrega`
      : toBRL(estimated.total);

  let footSub = '';
  if (step > 0) {
    if (!isDelivery) footSub = 'Retirada · sem taxa';
    else if (feeToConfirm) footSub = '+ entrega a confirmar';
    else if (fee === 0) footSub = 'Entrega grátis';
    else footSub = `inclui ${toBRL(fee)} de entrega`;
  }

  const ctaLabel = step < 2 ? 'Continuar' : confirming ? 'Confirmando…' : 'Confirmar pedido';
  const ctaDisabled = step === 0
    ? draft.items.length === 0
    : step === 2
      ? (!canConfirm || confirming)
      : false;

  const prettyDate = effectivePickupDate ? effectivePickupDate.split('-').reverse().join('/') : '';
  const whenLabel = scheduleMode === 'asap'
    ? 'o quanto antes'
    : [prettyDate || null, effectivePickupTime || null].filter(Boolean).join(' às ') || 'a combinar';
  const summaryMeta = `${isDelivery ? 'Entrega' : 'Retirada'} · ${whenLabel}${isDelivery && draft.deliveryNeighborhood ? ` · ${draft.deliveryNeighborhood}` : ''}`;

  const inputCls = 'h-11 w-full rounded-lg border border-[var(--zm-line)] bg-[var(--zm-surface)] px-3 text-[14px] text-[var(--zm-ink)] outline-none transition-colors focus:border-[var(--zm-brand)]';
  const invalidInputCls = 'border-[var(--color-alert)] focus:border-[var(--color-alert)]';
  const labelCls = 'text-[11.5px] font-semibold text-[var(--zm-ink-soft)]';
  const requiredMark = <span className="text-[var(--color-alert)]" aria-hidden="true">*</span>;
  const fieldError = (message: string | undefined) => showErrors && message
    ? <span role="alert" className="text-[11px] text-[var(--color-alert)]">{message}</span>
    : null;
  const segCls = (active: boolean) =>
    `flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'bg-[var(--zm-surface)] text-[var(--zm-ink)] shadow-sm' : 'text-[var(--zm-ink-soft)]'}`;
  const iconBtnCls = 'flex h-9 w-9 flex-none items-center justify-center rounded-full bg-[var(--zm-surface-muted)] text-[var(--zm-ink)] transition active:scale-90';

  // The mascot is the confirmation moment's signature — shown while the order
  // is alive (waiting to materialize, or progressing through the timeline).
  // Not shown on the cancelled state: a cheerful chef next to "pedido
  // cancelado" would read as tone-deaf.
  const showMascot = isConfirmed && !orderTimelineInfo?.isCancelled;

  return (
    <div className="zelomenu-theme flex min-h-[100dvh] justify-center bg-[var(--zm-canvas)] text-[var(--zm-ink)] sm:items-center sm:p-6">
      <div
        className={`flex h-[100dvh] w-full max-w-[460px] flex-col overflow-hidden bg-[var(--zm-surface)] sm:h-[min(780px,92dvh)] sm:rounded-[28px] sm:border sm:border-[var(--zm-line)] sm:shadow-[0_30px_70px_-30px_rgba(16,20,24,0.35)] ${showMascot ? 'sm:max-w-[860px] sm:flex-row' : ''}`}
      >
        {isConfirmed ? (
          showMascot ? (
            <>
              {/* Desktop: mascot fills the left panel — the soft-lavender
                      --zm-brand-soft background now extends the artwork's own
                      lilac backdrop seamlessly. */}
              <div className="hidden flex-none overflow-hidden bg-[var(--zm-brand-soft)] sm:block sm:w-[42%]">
                <img
                  src="/zelomenu-mascot-chef.png"
                  alt="Mascote do ZeloMenu, um robô cozinheiro segurando um celular com o cardápio"
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="flex h-full flex-1 flex-col overflow-hidden">
                <div className="flex flex-1 flex-col items-center overflow-y-auto px-7 py-6 text-center">
                  <div className="relative mb-3 h-20 w-20 overflow-hidden rounded-full shadow-[0_8px_20px_-8px_rgba(16,20,24,0.35)] sm:hidden">
                    {/* The source art is a square hero shot with the character
                        off-center (bottom-left) and brand chrome (notification
                        card, icons) filling the rest of the frame — cover/fit
                        can't crop a same-aspect-ratio image, so this zooms via
                        an oversized absolutely-positioned image instead. */}
                    <img
                      src="/zelomenu-mascot-chef.png"
                      alt=""
                      aria-hidden="true"
                      className="absolute -left-[25px] -top-[28px] h-[170px] w-[170px] max-w-none"
                    />
                  </div>
                  {!payload.productionOrder ? (
                    <>
                      <h2 className="text-[20px] font-semibold tracking-tight">Pedido confirmado!</h2>
                      <p className="mt-1.5 max-w-[280px] text-[13.5px] leading-relaxed text-[var(--zm-ink-soft)]">
                        {isWaitingPayment
                          ? 'Agora envie o comprovante do Pix no WhatsApp para a loja conferir e preparar.'
                          : 'A loja recebeu seu pedido e vai te chamar no WhatsApp para acertar os detalhes.'}
                      </p>
                    </>
                  ) : (
                    <>
                      {/* Live order-tracking timeline */}
                      <h2 className="text-[20px] font-semibold tracking-tight">Acompanhe seu pedido</h2>
                      {orderTimelineInfo && (
                        <div className="mt-6 w-full max-w-[240px] text-left">
                          {orderTimelineInfo.steps.map((step, index) => {
                            const isCompleted = index < orderTimelineInfo.currentStepIndex;
                            const isActive = index === orderTimelineInfo.currentStepIndex;
                            const isLast = index === orderTimelineInfo.steps.length - 1;
                            return (
                              <div key={step.key} className="flex items-start gap-3">
                                <div className="flex flex-col items-center">
                                  <div
                                    className={`flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full border-2 transition-colors ${
                                      isCompleted
                                        ? 'border-[var(--zm-accent)] bg-[var(--zm-accent)]'
                                        : isActive
                                          ? 'border-[var(--zm-brand)] bg-[var(--zm-brand)]'
                                          : 'border-[var(--zm-line-strong)] bg-transparent'
                                    }`}
                                  >
                                    {isCompleted ? (
                                      <Check className="h-3 w-3 text-white" strokeWidth={3} />
                                    ) : isActive ? (
                                      <div className="h-[6px] w-[6px] rounded-full bg-white" />
                                    ) : null}
                                  </div>
                                  {!isLast && (
                                    <div
                                      className={`mt-[3px] h-5 w-px ${
                                        isCompleted ? 'bg-[var(--zm-accent)]' : 'bg-[var(--zm-line)]'
                                      }`}
                                    />
                                  )}
                                </div>
                                <div className={`flex-1 ${isLast ? 'pb-0' : 'pb-4'}`}>
                                  <span
                                    className={`text-[13px] leading-snug ${
                                      isActive
                                        ? 'font-semibold text-[var(--zm-ink)]'
                                        : isCompleted
                                          ? 'text-[var(--zm-ink)]'
                                          : 'text-[var(--zm-ink-soft)]'
                                    }`}
                                  >
                                    {step.label}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}

                  <div className="mt-6 w-full max-w-[300px] rounded-2xl border border-[var(--zm-line)] bg-[var(--zm-surface)] p-4 text-left">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] text-[var(--zm-ink-soft)]">{itemCount} {itemCount === 1 ? 'item' : 'itens'}</span>
                      <span className="text-[14px] font-semibold tabular-nums text-[var(--zm-ink)]">
                        {feeToConfirm ? `${toBRL(estimated.subtotal)} + entrega` : toBRL(estimated.total)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[12px] text-[var(--zm-ink-soft)]">{summaryMeta}</p>
                  </div>

                  <span className="mt-5 inline-flex items-center gap-2 rounded-full bg-[var(--zm-brand-soft)] px-3.5 py-2 text-[12px] font-semibold text-[var(--zm-brand-deep)]">
                    <MessageCircle className="h-3.5 w-3.5" strokeWidth={2} />
                    Acompanhe pelo WhatsApp
                  </span>
                </div>
              </div>
            </>
          ) : (
          <div className="flex h-full flex-col">
            <div className="flex flex-1 flex-col items-center overflow-y-auto px-7 py-6 text-center">
              {/* Terminal cancelled state — no mascot here, see showMascot above */}
              <div className="mb-3 flex h-[78px] w-[78px] items-center justify-center rounded-full bg-[var(--color-alert-soft)] text-[var(--color-alert)]">
                <XCircle className="h-10 w-10" strokeWidth={1.8} />
              </div>
              <h2 className="text-[20px] font-semibold tracking-tight">Pedido cancelado</h2>
              <p className="mt-1.5 max-w-[300px] text-[13.5px] leading-relaxed text-[var(--zm-ink-soft)]">
                A loja não pôde seguir com esse pedido. Fale com a loja pelo WhatsApp para mais detalhes.
              </p>

              {/* Order summary card */}
              <div className="mt-6 w-full max-w-[300px] rounded-2xl border border-[var(--zm-line)] bg-[var(--zm-surface)] p-4 text-left">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] text-[var(--zm-ink-soft)]">{itemCount} {itemCount === 1 ? 'item' : 'itens'}</span>
                  <span className="text-[14px] font-semibold tabular-nums text-[var(--zm-ink)]">
                    {feeToConfirm ? `${toBRL(estimated.subtotal)} + entrega` : toBRL(estimated.total)}
                  </span>
                </div>
                <p className="mt-1.5 text-[12px] text-[var(--zm-ink-soft)]">{summaryMeta}</p>
              </div>

              <span className="mt-5 inline-flex items-center gap-2 rounded-full bg-[var(--zm-brand-soft)] px-3.5 py-2 text-[12px] font-semibold text-[var(--zm-brand-deep)]">
                <MessageCircle className="h-3.5 w-3.5" strokeWidth={2} />
                Acompanhe pelo WhatsApp
              </span>
            </div>
          </div>
          )
        ) : (
          <div className="flex h-full flex-col">
            {/* header */}
            <div className="flex-none border-b border-[var(--zm-line)] bg-[var(--zm-surface)] px-3 pb-3 pt-3">
              <div className="flex items-center gap-2">
                <button type="button" onClick={goBack} aria-label={step === 0 ? 'Fechar' : 'Voltar'} className={iconBtnCls}>
                  {step === 0
                    ? <X className="h-5 w-5" strokeWidth={1.9} />
                    : <ChevronLeft className="h-5 w-5" strokeWidth={1.9} />}
                </button>
                <div className="min-w-0 flex-1 text-center">
                  <p className="truncate text-[15px] font-semibold leading-tight">{STEP_TITLES[step]}</p>
                  {payload.business.name ? (
                    <p className="truncate text-[11.5px] text-[var(--zm-ink-soft)]">{payload.business.name}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => void flushPendingAutosave().then(() => load('refresh'))}
                  aria-label="Revalidar"
                  className={iconBtnCls}
                >
                  {refreshing
                    ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
                    : <RefreshCw className="h-4 w-4" strokeWidth={1.8} />}
                </button>
              </div>

              {/* stepper */}
              <div className="mt-3 flex gap-2">
                {[
                  { n: '1', label: 'Sacola' },
                  { n: '2', label: stepLabel1 },
                  { n: '3', label: 'Confirmar' },
                ].map((s, i) => {
                  const status = i < step ? 'done' : i === step ? 'active' : 'todo';
                  return (
                    <div key={s.n} className="min-w-0 flex-1">
                      <div className={`mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold ${
                        status === 'todo'
                          ? 'text-[var(--zm-ink-soft)/50]'
                          : status === 'active'
                            ? 'text-[var(--zm-ink)]'
                            : 'text-[var(--zm-brand-deep)]'
                      }`}>
                        <span className={`flex h-4 w-4 flex-none items-center justify-center rounded-full text-[9px] font-bold text-white ${
                          status === 'active'
                            ? 'bg-[var(--zm-ink)]'
                            : status === 'done'
                              ? 'bg-[var(--zm-brand)]'
                              : 'bg-[var(--zm-line-strong)]'
                        }`}>{s.n}</span>
                        <span className="truncate">{s.label}</span>
                      </div>
                      <div className="h-[3px] overflow-hidden rounded-full bg-[var(--zm-line)]">
                        <div
                          className="h-full rounded-full bg-[var(--zm-brand)] transition-[width] duration-[420ms] ease-out motion-reduce:transition-none"
                          style={{ width: status === 'todo' ? '0%' : '100%' }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* link desatualizado */}
            {isStale ? (
              <div className="flex-none border-b border-[var(--color-warn-soft)] bg-[var(--color-warn-soft)] px-4 py-2.5">
                <div className="flex gap-2">
                  <AlertTriangle className="mt-px h-4 w-4 flex-none text-[var(--color-warn)]" strokeWidth={1.8} />
                  <p className="text-[12px] leading-snug text-[var(--zm-ink-soft)]">
                    Este link ficou desatualizado. Você ainda pode revisar, mas para salvar mudanças peça um link novo no WhatsApp.
                  </p>
                </div>
              </div>
            ) : null}

            {/* viewport — trilho que desliza entre os passos */}
            <div className="relative flex-1 overflow-hidden">
              <div
                className="flex h-full w-[300%] transition-transform duration-[440ms] ease-[cubic-bezier(.22,.61,.36,1)] motion-reduce:transition-none"
                style={{ transform: `translateX(-${step * (100 / 3)}%)` }}
              >
                {/* PASSO 1 — sacola */}
                <section inert={step !== 0} className="h-full w-1/3 overflow-y-auto">
                  <div className="flex flex-col gap-3.5 p-4">
                    <div className="flex items-center gap-2 text-[13px] font-semibold">
                      <ShoppingCart className="h-4 w-4 text-[var(--zm-ink-soft)]" strokeWidth={1.8} />
                      Itens do pedido
                    </div>
                    {draft.items.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-[var(--zm-line)] bg-[var(--zm-surface-muted)] px-4 py-7 text-center">
                        <p className="text-[14px] font-medium text-[var(--zm-ink-soft)]">Seu carrinho está vazio.</p>
                        <p className="mt-1 text-[13px] text-[var(--zm-ink-soft)]">Volte ao cardápio para escolher os itens.</p>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2.5">
                        {estimated.items.map((item) => {
                          const key = estimatedItemKey(item);
                          const label = formatModifierAwareCartItem(item);
                          return (
                            <div key={key} className="flex items-center gap-3 rounded-xl border border-[var(--zm-line)] bg-[var(--zm-surface)] p-2.5">
                              <div className="flex min-w-0 flex-1 flex-col">
                                <p className="truncate text-[13.5px] font-semibold leading-tight">{label}</p>
                                <p className="mt-0.5 text-[11.5px] tabular-nums text-[var(--zm-ink-soft)]">{toBRL(item.unitPrice)} cada</p>
                              </div>
                              <div className="inline-flex h-9 flex-none items-center rounded-lg border border-[var(--zm-line)] bg-[var(--zm-surface)]">
                                <button
                                  type="button"
                                  onClick={() => changeItemQuantity(key, item.quantity - 1)}
                                  className={`flex h-9 w-9 items-center justify-center transition-transform active:scale-90 ${item.quantity <= 1 ? 'text-[var(--color-alert)]' : 'text-[var(--zm-ink-soft)]'}`}
                                  aria-label={`Diminuir ${label}`}
                                >
                                  {item.quantity <= 1
                                    ? <Trash2 className="h-4 w-4" strokeWidth={1.8} />
                                    : <Minus className="h-4 w-4" strokeWidth={1.8} />}
                                </button>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  aria-label={`Quantidade de ${label}`}
                                  value={quantityDrafts[key] ?? String(item.quantity)}
                                  onFocus={(event) => event.currentTarget.select()}
                                  onChange={(event) => editItemQuantity(key, event.target.value)}
                                  onBlur={() => finishEditingItemQuantity(key)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') event.currentTarget.blur();
                                  }}
                                  readOnly={!isOpen}
                                  className="h-9 w-9 border-x border-[var(--zm-line)] bg-transparent px-0 text-center text-[13px] font-semibold tabular-nums text-[var(--zm-ink)] outline-none focus:bg-[var(--zm-surface-muted)] focus:ring-2 focus:ring-inset focus:ring-[var(--zm-brand)]"
                                />
                                <button
                                  type="button"
                                  onClick={() => changeItemQuantity(key, item.quantity + 1)}
                                  className="flex h-9 w-9 items-center justify-center text-[var(--zm-ink-soft)] transition-transform active:scale-90"
                                  aria-label={`Aumentar ${label}`}
                                >
                                  <Plus className="h-4 w-4" strokeWidth={1.8} />
                                </button>
                              </div>
                              <span className="w-[58px] flex-none text-right text-[13px] font-semibold tabular-nums">{toBRL(item.lineTotal)}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </section>

                {/* PASSO 2 — entrega/retirada (adaptativo) */}
                <section inert={step !== 1} className="h-full w-1/3 overflow-y-auto">
                  <div className="flex flex-col p-4">
                    <div className="flex flex-col gap-2">
                      <span className={labelCls}>Como você quer receber?</span>
                      <div className="flex gap-1 rounded-xl border border-[var(--zm-line)] bg-[var(--zm-surface-muted)] p-1">
                        <button
                          type="button"
                          disabled={!isOpen || !deliveryEnabled}
                          onClick={() => updateField('fulfillmentType', 'delivery')}
                          aria-pressed={isDelivery}
                          className={segCls(isDelivery)}
                        >
                          <Bike className="h-4 w-4" strokeWidth={1.8} />
                          Entrega
                        </button>
                        <button
                          type="button"
                          disabled={!isOpen}
                          onClick={() => updateField('fulfillmentType', 'pickup')}
                          aria-pressed={!isDelivery}
                          className={segCls(!isDelivery)}
                        >
                          <ShoppingBag className="h-4 w-4" strokeWidth={1.8} />
                          Retirada
                        </button>
                      </div>
                      {!deliveryEnabled ? (
                        <span className="text-[11px] text-[var(--zm-ink-soft)]">Esta loja está só com retirada no momento.</span>
                      ) : null}
                    </div>

                    <label className="mt-4 flex flex-col gap-1.5">
                      <span className={labelCls}>Seu nome {requiredMark}</span>
                      <input
                        value={draft.customerName}
                        onChange={(event) => updateField('customerName', event.target.value)}
                        readOnly={!isOpen}
                        required
                        aria-invalid={showErrors && Boolean(detailErrors.customerName)}
                        className={`${inputCls} ${showErrors && detailErrors.customerName ? invalidInputCls : ''}`}
                        placeholder="Como te chamamos"
                      />
                      {fieldError(detailErrors.customerName)}
                    </label>

                    <label className="mt-4 flex flex-col gap-1.5">
                      <span className={labelCls}>WhatsApp {requiredMark}</span>
                      <input
                        value={draft.customerPhone}
                        onChange={(event) => updateField('customerPhone', event.target.value)}
                        inputMode="tel"
                        readOnly={!isOpen || !isPublicOrder}
                        required
                        aria-invalid={showErrors && Boolean(detailErrors.customerPhone)}
                        className={`${inputCls} ${isPublicOrder ? '' : 'bg-[var(--zm-surface-muted)] text-[var(--zm-ink-soft)]'} ${showErrors && detailErrors.customerPhone ? invalidInputCls : ''}`}
                        placeholder="(XX) XXXXX-XXXX"
                      />
                      {fieldError(detailErrors.customerPhone)}
                    </label>

                    {/* endereço só aparece na entrega — colapsa suave na retirada */}
                    <div className={`grid transition-[grid-template-rows,opacity,margin-top] duration-[380ms] ease-[cubic-bezier(.22,.61,.36,1)] motion-reduce:transition-none ${isDelivery ? 'mt-4 grid-rows-[1fr] opacity-100' : 'mt-0 grid-rows-[0fr] opacity-0'}`}>
                      <div className="min-h-0 overflow-hidden">
                        <div className="flex flex-col gap-4">
                          <label className="flex flex-col gap-1.5">
                            <span className={labelCls}>Bairro</span>
                            <input
                              list="zelomenu-bairros"
                              value={draft.deliveryNeighborhood}
                              onChange={(event) => updateField('deliveryNeighborhood', event.target.value)}
                              readOnly={!isOpen}
                              className={inputCls}
                              placeholder="Selecione ou digite seu bairro"
                            />
                            <datalist id="zelomenu-bairros">
                              {payload.business.deliveryNeighborhoods.map((item) => (
                                <option key={item.name} value={item.name}>{`${item.name} • ${toBRL(item.fee)}`}</option>
                              ))}
                            </datalist>
                            {feeToConfirm ? (
                              <span className="text-[11px] leading-snug text-[var(--zm-ink-soft)]">
                                Bairro fora da tabela — a taxa de entrega será confirmada pela loja.
                              </span>
                            ) : null}
                          </label>

                          <label className="flex flex-col gap-1.5">
                            <span className={labelCls}>Endereço {requiredMark}</span>
                            <input
                              value={draft.deliveryAddress}
                              onChange={(event) => updateField('deliveryAddress', event.target.value)}
                              readOnly={!isOpen}
                              required
                              aria-invalid={showErrors && Boolean(detailErrors.deliveryAddress)}
                              className={`${inputCls} ${showErrors && detailErrors.deliveryAddress ? invalidInputCls : ''}`}
                              placeholder="Rua, número e complemento"
                            />
                            {fieldError(detailErrors.deliveryAddress)}
                          </label>
                        </div>
                      </div>
                    </div>

                    {/* quando — pra já (padrão) ou agendar encomenda */}
                    <div className="mt-4 flex flex-col gap-2">
                      <span className={labelCls}>Quando?</span>
                      <div className="flex gap-1 rounded-xl border border-[var(--zm-line)] bg-[var(--zm-surface-muted)] p-1">
                        <button type="button" disabled={!isOpen} onClick={enableAsap} aria-pressed={scheduleMode === 'asap'} className={segCls(scheduleMode === 'asap')}>
                          <Zap className="h-4 w-4" strokeWidth={1.8} />
                          Pra já
                        </button>
                        <button type="button" disabled={!isOpen} onClick={enableScheduled} aria-pressed={scheduleMode === 'scheduled'} className={segCls(scheduleMode === 'scheduled')}>
                          <CalendarClock className="h-4 w-4" strokeWidth={1.8} />
                          Agendar
                        </button>
                      </div>
                      {scheduleMode === 'asap' ? (
                        <p className="text-[11.5px] leading-snug text-[var(--zm-ink-soft)]">
                          {isDelivery ? 'Entrega o quanto antes.' : 'Retirada o quanto antes.'} Data e horário serão preenchidos automaticamente. É uma encomenda para outro momento? Toque em <span className="font-semibold text-[var(--zm-ink-soft)]">Agendar</span>.
                        </p>
                      ) : (
                        <div className="grid grid-cols-2 gap-3">
                          <label className="flex flex-col gap-1.5">
                            <span className={labelCls}>{isDelivery ? 'Data da entrega' : 'Data da retirada'} {requiredMark}</span>
                            <input
                              type="date"
                              lang="pt-BR"
                              value={draft.pickupDate}
                              onChange={(event) => updateField('pickupDate', event.target.value)}
                              readOnly={!isOpen}
                              required
                              aria-invalid={showErrors && Boolean(detailErrors.pickupDate)}
                              className={`${inputCls} ${showErrors && detailErrors.pickupDate ? invalidInputCls : ''}`}
                            />
                            {fieldError(detailErrors.pickupDate)}
                          </label>
                          <label className="flex flex-col gap-1.5">
                            <span className={labelCls}>Horário {requiredMark}</span>
                            <input
                              type="time"
                              lang="pt-BR"
                              value={draft.pickupTime}
                              onChange={(event) => updateField('pickupTime', event.target.value)}
                              readOnly={!isOpen}
                              required
                              aria-invalid={showErrors && Boolean(detailErrors.pickupTime)}
                              className={`${inputCls} ${showErrors && detailErrors.pickupTime ? invalidInputCls : ''}`}
                            />
                            {fieldError(detailErrors.pickupTime)}
                          </label>
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                {/* PASSO 3 — pagamento + confirmação */}
                <section inert={step !== 2} className="h-full w-1/3 overflow-y-auto">
                  <div className="flex flex-col gap-4 p-4">
                    <div className="flex items-center gap-2 text-[13px] font-semibold">
                      <Wallet className="h-4 w-4 text-[var(--zm-ink-soft)]" strokeWidth={1.8} />
                      Forma de pagamento
                    </div>
                    <div className="flex flex-col gap-2">
                      {PAYMENT_OPTIONS.map((opt) => {
                        const selected = paymentSelection === opt;
                        return (
                          <button
                            key={opt}
                            type="button"
                            disabled={!isOpen}
                            onClick={() => updateField('paymentMethod', opt === 'Outro' ? '' : opt)}
                            aria-pressed={selected}
                            className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${selected ? 'border-[var(--zm-brand)] bg-[var(--zm-brand-soft)]' : 'border-[var(--zm-line)] bg-[var(--zm-surface)]'}`}
                          >
                            <span className={`flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full border-2 ${selected ? 'border-[var(--zm-brand)]' : 'border-[var(--zm-line-strong)]'}`}>
                              {selected ? <span className="h-2 w-2 rounded-full bg-[var(--zm-brand)]" /> : null}
                            </span>
                            <span className={selected ? 'text-[var(--zm-brand-deep)]' : 'text-[var(--zm-ink-soft)]'}>{paymentIcon(opt)}</span>
                            <span className="text-[13.5px] font-semibold text-[var(--zm-ink)]">{opt}</span>
                          </button>
                        );
                      })}
                    </div>

                    {paymentSelection === 'Outro' ? (
                      <label className="flex flex-col gap-1.5">
                        <span className={labelCls}>Detalhe do pagamento</span>
                        <input
                          value={draft.paymentMethod}
                          onChange={(event) => updateField('paymentMethod', event.target.value)}
                          readOnly={!isOpen}
                          className={inputCls}
                          placeholder="Ex.: Vale alimentação"
                        />
                      </label>
                    ) : null}

                    {payload.business.pixEnabled && /pix/i.test(draft.paymentMethod) ? (
                      <div className="flex items-start gap-2 rounded-xl border border-[var(--zm-brand-soft)] bg-[var(--zm-brand-soft)] p-3 text-[12px] leading-relaxed text-[var(--zm-brand-deep)]">
                        <CheckCircle2 className="mt-px h-3.5 w-3.5 flex-none" strokeWidth={2} />
                        <span>O comprovante do Pix será conferido pela loja no WhatsApp antes de preparar.</span>
                      </div>
                    ) : null}

                    <label className="flex flex-col gap-1.5">
                      <span className={labelCls}>Observações (opcional)</span>
                      <textarea
                        value={draft.observations}
                        onChange={(event) => updateField('observations', event.target.value)}
                        readOnly={!isOpen}
                        rows={3}
                        className="w-full rounded-lg border border-[var(--zm-line)] bg-[var(--zm-surface)] px-3 py-3 text-[14px] text-[var(--zm-ink)] outline-none transition-colors focus:border-[var(--zm-brand)]"
                        placeholder="Ex.: sem cebola, troco para R$ 100, deixar na portaria"
                      />
                    </label>

                    <div className="flex items-center gap-2 text-[13px] font-semibold">
                      <ShoppingCart className="h-4 w-4 text-[var(--zm-ink-soft)]" strokeWidth={1.8} />
                      Resumo
                    </div>
                    <div className="flex flex-col gap-2.5 rounded-xl border border-[var(--zm-line)] bg-[var(--zm-surface)] p-3.5">
                      <div className="flex items-center justify-between text-[13px] text-[var(--zm-ink-soft)]">
                        <span>Itens</span>
                        <span className="tabular-nums">{toBRL(estimated.subtotal)}</span>
                      </div>
                      <div className="flex items-center justify-between text-[13px] text-[var(--zm-ink-soft)]">
                        <span>{isDelivery ? 'Entrega' : 'Retirada'}</span>
                        <span className="tabular-nums">
                          {isDelivery ? (feeToConfirm ? 'a confirmar' : toBRL(fee)) : 'sem taxa'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between border-t border-[var(--zm-line)] pt-2.5 text-[15px] font-bold text-[var(--zm-ink)]">
                        <span>Total</span>
                        <span className="tabular-nums">{feeToConfirm ? `${toBRL(estimated.subtotal)} +` : toBRL(estimated.total)}</span>
                      </div>
                      <p className="text-[11.5px] leading-relaxed text-[var(--zm-ink-soft)]">{summaryMeta}</p>
                    </div>
                  </div>
                </section>
              </div>
            </div>

            {/* footer — total ao vivo + CTA sempre visível */}
            <div className="flex-none border-t border-[var(--zm-line)] bg-[var(--zm-surface)] px-4 pb-5 pt-3">
              <div className="mb-2 flex min-h-4 justify-end" aria-live="polite">
                {saveStatus === 'saving' ? (
                  <span className="text-[10.5px] text-[var(--zm-ink-soft)]">Salvando alterações…</span>
                ) : saveStatus === 'saved' ? (
                  <span className="text-[10.5px] text-[var(--zm-brand-deep)]">Alterações salvas</span>
                ) : saveStatus === 'error' ? (
                  <button
                    type="button"
                    onClick={() => {
                      const latest = latestAutosaveRef.current;
                      if (latest) void enqueueAutosave(latest);
                    }}
                    className="text-[10.5px] font-semibold text-[var(--color-alert)] underline underline-offset-2"
                  >
                    Não foi possível salvar. Tentar novamente
                  </button>
                ) : null}
              </div>
              <div className="flex items-center gap-3">
                <div className="flex flex-col leading-tight">
                  <span className="text-[11px] font-semibold text-[var(--zm-ink-soft)]">{step === 0 ? 'Subtotal' : 'Total'}</span>
                  <span className="text-[19px] font-bold tabular-nums tracking-tight">{footValue}</span>
                  {footSub ? <span className="text-[10.5px] text-[var(--zm-ink-soft)/50]">{footSub}</span> : null}
                </div>
                <button
                  type="button"
                  onClick={goNext}
                  disabled={ctaDisabled}
                  className={`flex h-[50px] flex-1 items-center justify-center gap-2 rounded-2xl text-[14.5px] font-semibold text-white transition-transform active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-40 ${step === 2 ? 'bg-[var(--zm-brand)]' : 'bg-[var(--zm-ink)]'}`}
                >
                  {confirming && step === 2 ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} /> : null}
                  {ctaLabel}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
