import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpDown,
  CheckCircle2,
  Clock3,
  Loader2,
  MapPin,
  Minus,
  Package2,
  Phone,
  Plus,
  RefreshCw,
  ShoppingCart,
  Store,
  Wallet,
} from 'lucide-react';
import {
  confirmPublicCart,
  getPublicCart,
  updatePublicCart,
  type ZeloMenuCartItem,
  type ZeloMenuCatalogGroup,
  type ZeloMenuCatalogProduct,
  type ZeloMenuPublicCartResponse,
} from '../services/zelomenuApi';

type DraftState = {
  customerName: string;
  customerPhone: string;
  items: Array<{ productName: string; quantity: number; notes: string }>;
  fulfillmentType: 'pickup' | 'delivery';
  pickupDate: string;
  pickupTime: string;
  deliveryAddress: string;
  deliveryNeighborhood: string;
  paymentMethod: string;
  observations: string;
};

const PAYMENT_OPTIONS = ['Pix', 'Dinheiro', 'Cartão na entrega', 'Cartão na retirada', 'Outro'] as const;

function toBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDateTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildDraftFromPayload(payload: ZeloMenuPublicCartResponse): DraftState {
  return {
    customerName: payload.session.customer.name ?? '',
    customerPhone: payload.session.customer.phone ?? '',
    items: payload.session.cart.items.map((item) => ({
      productName: item.productName,
      quantity: item.quantity,
      notes: item.notes ?? '',
    })),
    fulfillmentType: payload.session.fulfillment.type,
    pickupDate: payload.session.fulfillment.pickupDate ?? '',
    pickupTime: payload.session.fulfillment.pickupTime ?? '',
    deliveryAddress: payload.session.fulfillment.deliveryAddress ?? '',
    deliveryNeighborhood: payload.session.fulfillment.deliveryNeighborhood ?? '',
    paymentMethod: payload.session.payment.declaredMethod ?? '',
    observations: payload.session.cart.observations ?? '',
  };
}

function catalogProductMap(groups: ZeloMenuCatalogGroup[]): Map<string, ZeloMenuCatalogProduct> {
  const next = new Map<string, ZeloMenuCatalogProduct>();
  for (const group of groups) {
    for (const product of group.produtosDireto) {
      next.set(product.name, product);
    }
    for (const subcategory of group.subcategorias) {
      for (const product of subcategory.produtos) {
        next.set(product.name, product);
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
    const product = products.get(item.productName);
    if (!product) return [];
    const quantity = Math.max(0, Math.floor(Number(item.quantity) || 0));
    if (quantity === 0) return [];
    const lineTotal = quantity * Number(product.price || 0);
    return [{
      productName: product.name,
      quantity,
      unitPrice: product.price,
      lineTotal,
      notes: item.notes || null,
    }];
  });
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const deliveryFee = draft.fulfillmentType === 'delivery'
    ? neighborhoods.find((item) => item.name === draft.deliveryNeighborhood)?.fee ?? 0
    : 0;
  return {
    items,
    subtotal,
    deliveryFee,
    total: subtotal + deliveryFee,
  };
}

function isKnownPaymentMethod(value: string): boolean {
  return PAYMENT_OPTIONS.some((option) => option === value);
}

export default function ZeloMenuCartPage() {
  const { token = '' } = useParams();
  const [payload, setPayload] = useState<ZeloMenuPublicCartResponse | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inlineMessage, setInlineMessage] = useState<string | null>(null);

  const load = async (mode: 'initial' | 'refresh' = 'initial') => {
    try {
      setError(null);
      setInlineMessage(null);
      if (mode === 'initial') setLoading(true);
      else setRefreshing(true);
      const next = await getPublicCart(token);
      setPayload(next);
      setDraft(buildDraftFromPayload(next));
      document.title = next.business.name ? `${next.business.name} | Revisar pedido` : 'Revisar pedido';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não consegui carregar o carrinho.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
    return () => {
      document.title = 'ZeloChat';
    };
  }, [token]);

  const estimated = useMemo(() => {
    if (!payload || !draft) return null;
    return estimateDraftTotals(draft, payload.catalog, payload.business.deliveryNeighborhoods);
  }, [payload, draft]);

  const hasUnsavedChanges = useMemo(() => {
    if (!payload || !draft) return false;
    return JSON.stringify(draft) !== JSON.stringify(buildDraftFromPayload(payload));
  }, [payload, draft]);

  const isStale = payload?.link.tokenStatus === 'stale';
  const isOpen = payload?.session.state === 'cart_open';
  const isConfirmed = payload?.session.state === 'confirmed_waiting_review' || payload?.session.state === 'confirmed_waiting_payment';
  const isWaitingPayment = payload?.session.state === 'confirmed_waiting_payment';
  const paymentSelection = draft?.paymentMethod && isKnownPaymentMethod(draft.paymentMethod)
    ? draft.paymentMethod
    : draft?.paymentMethod
      ? 'Outro'
      : '';
  const revalidationIssues = payload?.revalidation.issues ?? [];
  const canConfirm = isOpen && !isStale && !hasUnsavedChanges && revalidationIssues.length === 0 && (draft?.items.length ?? 0) > 0;

  const saveDraft = async () => {
    if (!draft || !isOpen) return;
    try {
      setSaving(true);
      setError(null);
      setInlineMessage(null);
      const next = await updatePublicCart(token, {
        customerName: draft.customerName || null,
        items: draft.items.map((item) => ({
          productName: item.productName,
          quantity: item.quantity,
          notes: item.notes || null,
        })),
        fulfillment: {
          type: draft.fulfillmentType,
          pickupDate: draft.pickupDate || null,
          pickupTime: draft.pickupTime || null,
          deliveryAddress: draft.fulfillmentType === 'delivery' ? (draft.deliveryAddress || null) : null,
          deliveryNeighborhood: draft.fulfillmentType === 'delivery' ? (draft.deliveryNeighborhood || null) : null,
        },
        paymentMethod: draft.paymentMethod || null,
        observations: draft.observations || null,
      });
      setPayload(next);
      setDraft(buildDraftFromPayload(next));
      setInlineMessage('Carrinho atualizado.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não consegui atualizar o carrinho.');
    } finally {
      setSaving(false);
    }
  };

  const confirmCart = async () => {
    if (!draft || !payload) return;
    try {
      setConfirming(true);
      setError(null);
      setInlineMessage(null);
      const next = await confirmPublicCart(token);
      setPayload(next);
      setDraft(buildDraftFromPayload(next));
      setInlineMessage(next.confirmation.confirmed
        ? next.confirmation.alreadyConfirmed
          ? 'Este pedido já estava confirmado.'
          : 'Pedido confirmado. A loja recebeu o resumo no WhatsApp.'
        : 'Revise os avisos do carrinho antes de confirmar.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não consegui confirmar o pedido.');
    } finally {
      setConfirming(false);
    }
  };

  const changeItemQuantity = (productName: string, nextQuantity: number) => {
    if (!isOpen) return;
    setDraft((current) => {
      if (!current) return current;
      const normalizedQuantity = Math.max(0, Math.floor(nextQuantity));
      const existing = current.items.find((item) => item.productName === productName);
      if (!existing && normalizedQuantity === 0) return current;
      const items = existing
        ? current.items
          .map((item) => item.productName === productName ? { ...item, quantity: normalizedQuantity } : item)
          .filter((item) => item.quantity > 0)
        : [...current.items, { productName, quantity: normalizedQuantity, notes: '' }];
      return { ...current, items };
    });
    setInlineMessage(null);
  };

  const updateField = <K extends keyof DraftState>(key: K, value: DraftState[K]) => {
    if (!isOpen) return;
    setDraft((current) => current ? { ...current, [key]: value } : current);
    setInlineMessage(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-canvas)] text-[var(--color-ink)]">
        <div className="mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--color-brand)]" strokeWidth={1.8} />
          <p className="mt-4 text-[14px] text-[var(--color-ink-muted)]">Carregando seu carrinho…</p>
        </div>
      </div>
    );
  }

  if (error && !payload) {
    return (
      <div className="min-h-screen bg-[var(--color-canvas)] text-[var(--color-ink)]">
        <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 text-center">
          <div className="rounded-full bg-[var(--color-alert-soft)] p-4 text-[var(--color-alert)]">
            <AlertTriangle className="h-8 w-8" strokeWidth={1.8} />
          </div>
          <h1 className="mt-5 text-[22px] font-semibold">Não consegui abrir este carrinho</h1>
          <p className="mt-2 max-w-xl text-[14px] text-[var(--color-ink-muted)]">{error}</p>
          <button
            type="button"
            onClick={() => void load('initial')}
            className="mt-6 inline-flex h-11 items-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 text-[14px] font-medium text-white"
          >
            <RefreshCw className="h-4 w-4" strokeWidth={1.8} />
            Tentar de novo
          </button>
        </div>
      </div>
    );
  }

  if (!payload || !draft || !estimated) return null;

  return (
    <div className="min-h-screen bg-[var(--color-canvas)] text-[var(--color-ink)]">
      <div className="border-b border-[var(--color-line)] bg-[var(--color-surface)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[12px] font-medium text-[var(--color-ink-muted)]">
                <Store className="h-3.5 w-3.5" strokeWidth={1.8} />
                {payload.business.name || 'Loja'}
              </div>
              <h1 className="mt-1 text-[22px] font-semibold">Revisar pedido</h1>
              <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
                Pedido iniciado pelo WhatsApp.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex h-9 items-center rounded-full px-3 text-[12px] font-medium ${
                isStale
                  ? 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]'
                  : 'bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]'
              }`}>
                {isStale ? 'Link desatualizado' : 'Link ativo'}
              </span>
              <button
                type="button"
                onClick={() => void load('refresh')}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-[13px] font-medium text-[var(--color-ink-soft)]"
              >
                {refreshing ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} /> : <RefreshCw className="h-4 w-4" strokeWidth={1.8} />}
                Revalidar
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 text-[12px] text-[var(--color-ink-muted)]">
            {payload.business.address ? (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" strokeWidth={1.8} />
                {payload.business.address}
              </span>
            ) : null}
            {payload.session.customer.phone ? (
              <span className="inline-flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5" strokeWidth={1.8} />
                {payload.session.customer.phone}
              </span>
            ) : null}
            {payload.revalidation.checkedAt ? (
              <span className="inline-flex items-center gap-1.5">
                <Clock3 className="h-3.5 w-3.5" strokeWidth={1.8} />
                Revalidado em {formatDateTime(payload.revalidation.checkedAt)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-8">
        <div className="space-y-6">
          {isStale ? (
            <section className="rounded-lg border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-4 py-3">
              <div className="flex gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-warn)]" strokeWidth={1.8} />
                <div>
                  <p className="text-[14px] font-medium text-[var(--color-ink)]">Este link ficou desatualizado.</p>
                  <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">
                    Você ainda pode revisar o pedido, mas para salvar novas alterações vai precisar pedir um link novo no WhatsApp.
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          {isConfirmed ? (
            <section className="rounded-lg border border-[var(--color-brand)] bg-[var(--color-brand-soft)] px-4 py-3">
              <div className="flex gap-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-brand)]" strokeWidth={1.8} />
                <div>
                  <p className="text-[14px] font-medium text-[var(--color-ink)]">
                    Pedido confirmado pelo cardápio.
                  </p>
                  <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">
                    {isWaitingPayment
                      ? 'Agora envie o comprovante do Pix pelo WhatsApp para a loja conferir.'
                      : 'A loja vai conferir o pedido e chamar você pelo WhatsApp.'}
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          {revalidationIssues.length > 0 ? (
            <section className="rounded-lg border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-4 py-3">
              <div className="flex gap-3">
                <ArrowUpDown className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-warn)]" strokeWidth={1.8} />
                <div>
                  <p className="text-[14px] font-medium text-[var(--color-ink)]">Seu carrinho precisa de revisão.</p>
                  <ul className="mt-2 space-y-1 text-[13px] text-[var(--color-ink-soft)]">
                    {revalidationIssues.map((issue, index) => (
                      <li key={`${issue.code}-${index}`}>{issue.message}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          ) : null}

          <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]">
            <div className="border-b border-[var(--color-line)] px-4 py-4">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-4 w-4 text-[var(--color-ink-muted)]" strokeWidth={1.8} />
                <h2 className="text-[15px] font-semibold">Carrinho</h2>
              </div>
            </div>
            <div className="p-4">
              {draft.items.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--color-line)] bg-[var(--color-surface-muted)] px-4 py-6 text-center">
                  <p className="text-[14px] font-medium text-[var(--color-ink-soft)]">Seu carrinho está vazio.</p>
                  <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">Escolha os itens abaixo para montar o pedido.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {estimated.items.map((item) => (
                    <div key={item.productName} className="grid gap-3 rounded-lg border border-[var(--color-line)] px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-medium">{item.productName}</p>
                        <p className="mt-0.5 text-[12px] text-[var(--color-ink-muted)]">
                          {toBRL(item.unitPrice)} cada
                        </p>
                      </div>
                      <div className="flex items-center justify-between gap-3 sm:justify-end">
                        <div className="inline-flex h-9 items-center rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]">
                          <button
                            type="button"
                            onClick={() => changeItemQuantity(item.productName, item.quantity - 1)}
                            className="inline-flex h-9 w-9 items-center justify-center text-[var(--color-ink-soft)]"
                            aria-label={`Diminuir ${item.productName}`}
                          >
                            <Minus className="h-4 w-4" strokeWidth={1.8} />
                          </button>
                          <span className="inline-flex min-w-10 justify-center px-2 text-[13px] font-medium tabular-nums">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => changeItemQuantity(item.productName, item.quantity + 1)}
                            className="inline-flex h-9 w-9 items-center justify-center text-[var(--color-ink-soft)]"
                            aria-label={`Aumentar ${item.productName}`}
                          >
                            <Plus className="h-4 w-4" strokeWidth={1.8} />
                          </button>
                        </div>
                        <span className="text-[13px] font-semibold tabular-nums">{toBRL(item.lineTotal)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]">
            <div className="border-b border-[var(--color-line)] px-4 py-4">
              <div className="flex items-center gap-2">
                <Package2 className="h-4 w-4 text-[var(--color-ink-muted)]" strokeWidth={1.8} />
                <h2 className="text-[15px] font-semibold">Cardápio</h2>
              </div>
            </div>
            <div className="space-y-5 p-4">
              {payload.catalog.length === 0 ? (
                <p className="text-[13px] text-[var(--color-ink-muted)]">Nenhum item disponível no momento.</p>
              ) : payload.catalog.map((group) => (
                <section key={group.nome} className="space-y-3">
                  <div>
                    <h3 className="text-[14px] font-semibold">{group.nome}</h3>
                  </div>

                  {group.produtosDireto.length > 0 ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      {group.produtosDireto.map((product) => (
                        <div key={`${group.nome}-${product.name}`}>
                          <ProductRow
                            product={product}
                            quantity={draft.items.find((item) => item.productName === product.name)?.quantity ?? 0}
                            onAdd={() => changeItemQuantity(product.name, (draft.items.find((item) => item.productName === product.name)?.quantity ?? 0) + 1)}
                          />
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {group.subcategorias.map((subcategory) => (
                    <div key={`${group.nome}-${subcategory.nome}`} className="space-y-3">
                      <div className="text-[12px] font-medium uppercase tracking-[0.04em] text-[var(--color-ink-muted)]">
                        {subcategory.nome}
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        {subcategory.produtos.map((product) => (
                          <div key={`${group.nome}-${subcategory.nome}-${product.name}`}>
                            <ProductRow
                              product={product}
                              quantity={draft.items.find((item) => item.productName === product.name)?.quantity ?? 0}
                              onAdd={() => changeItemQuantity(product.name, (draft.items.find((item) => item.productName === product.name)?.quantity ?? 0) + 1)}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]">
            <div className="border-b border-[var(--color-line)] px-4 py-4">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-[var(--color-ink-muted)]" strokeWidth={1.8} />
                <h2 className="text-[15px] font-semibold">Entrega ou retirada</h2>
              </div>
            </div>
            <div className="grid gap-4 p-4 md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-[12px] font-medium text-[var(--color-ink-muted)]">Modo</span>
                <select
                  value={draft.fulfillmentType}
                  onChange={(event) => updateField('fulfillmentType', event.target.value === 'delivery' ? 'delivery' : 'pickup')}
                  disabled={!isOpen}
                  className="h-11 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-[14px]"
                >
                  <option value="pickup">Retirada</option>
                  <option value="delivery" disabled={!payload.business.deliveryEnabled}>Entrega</option>
                </select>
              </label>

              <label className="space-y-1.5">
                <span className="text-[12px] font-medium text-[var(--color-ink-muted)]">Nome</span>
                <input
                  value={draft.customerName}
                  onChange={(event) => updateField('customerName', event.target.value)}
                  readOnly={!isOpen}
                  className="h-11 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-[14px]"
                  placeholder="Seu nome"
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-[12px] font-medium text-[var(--color-ink-muted)]">Data</span>
                <input
                  type="date"
                  value={draft.pickupDate}
                  onChange={(event) => updateField('pickupDate', event.target.value)}
                  readOnly={!isOpen}
                  className="h-11 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-[14px]"
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-[12px] font-medium text-[var(--color-ink-muted)]">Horário</span>
                <input
                  type="time"
                  value={draft.pickupTime}
                  onChange={(event) => updateField('pickupTime', event.target.value)}
                  readOnly={!isOpen}
                  className="h-11 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-[14px]"
                />
              </label>

              <label className="space-y-1.5 md:col-span-2">
                <span className="text-[12px] font-medium text-[var(--color-ink-muted)]">WhatsApp</span>
                <input
                  value={draft.customerPhone}
                  readOnly
                  className="h-11 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-muted)] px-3 text-[14px] text-[var(--color-ink-muted)]"
                />
              </label>

              {draft.fulfillmentType === 'delivery' ? (
                <>
                  <label className="space-y-1.5">
                    <span className="text-[12px] font-medium text-[var(--color-ink-muted)]">Bairro</span>
                    <select
                      value={draft.deliveryNeighborhood}
                      onChange={(event) => updateField('deliveryNeighborhood', event.target.value)}
                      disabled={!isOpen}
                      className="h-11 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-[14px]"
                    >
                      <option value="">Selecione</option>
                      {payload.business.deliveryNeighborhoods.map((item) => (
                        <option key={item.name} value={item.name}>
                          {item.name} • {toBRL(item.fee)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1.5 md:col-span-2">
                    <span className="text-[12px] font-medium text-[var(--color-ink-muted)]">Endereço</span>
                    <input
                      value={draft.deliveryAddress}
                      onChange={(event) => updateField('deliveryAddress', event.target.value)}
                      readOnly={!isOpen}
                      className="h-11 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-[14px]"
                      placeholder="Rua, número e complemento"
                    />
                  </label>
                </>
              ) : null}
            </div>
          </section>

          <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]">
            <div className="border-b border-[var(--color-line)] px-4 py-4">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-[var(--color-ink-muted)]" strokeWidth={1.8} />
                <h2 className="text-[15px] font-semibold">Pagamento e observações</h2>
              </div>
            </div>
            <div className="grid gap-4 p-4 md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-[12px] font-medium text-[var(--color-ink-muted)]">Forma de pagamento</span>
                <select
                  value={paymentSelection}
                  onChange={(event) => {
                    const next = event.target.value;
                    updateField('paymentMethod', next === 'Outro' ? '' : next);
                  }}
                  disabled={!isOpen}
                  className="h-11 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-[14px]"
                >
                  <option value="">Selecione</option>
                  {PAYMENT_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>

              {paymentSelection === 'Outro' ? (
                <label className="space-y-1.5">
                  <span className="text-[12px] font-medium text-[var(--color-ink-muted)]">Detalhe do pagamento</span>
                  <input
                    value={draft.paymentMethod}
                    onChange={(event) => updateField('paymentMethod', event.target.value)}
                    readOnly={!isOpen}
                    className="h-11 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-[14px]"
                    placeholder="Ex.: Vale alimentação"
                  />
                </label>
              ) : null}

              <label className="space-y-1.5 md:col-span-2">
                <span className="text-[12px] font-medium text-[var(--color-ink-muted)]">Observações</span>
                <textarea
                  value={draft.observations}
                  onChange={(event) => updateField('observations', event.target.value)}
                  readOnly={!isOpen}
                  rows={4}
                  className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-3 text-[14px]"
                  placeholder="Ex.: sem cebola, deixar na portaria, troco para 100"
                />
              </label>

              {payload.business.pixEnabled && /pix/i.test(draft.paymentMethod) ? (
                <div className="rounded-lg border border-[var(--color-brand)] bg-[var(--color-brand-soft)] px-3 py-3 md:col-span-2">
                  <p className="text-[13px] text-[var(--color-ink-soft)]">
                    Se o pagamento for no Pix, o comprovante será conferido no WhatsApp antes da confirmação.
                  </p>
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]">
            <div className="border-b border-[var(--color-line)] px-4 py-4">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-4 w-4 text-[var(--color-ink-muted)]" strokeWidth={1.8} />
                <h2 className="text-[15px] font-semibold">Resumo</h2>
              </div>
            </div>
            <div className="space-y-4 p-4">
              <div className="space-y-2 text-[13px] text-[var(--color-ink-soft)]">
                <div className="flex items-center justify-between">
                  <span>Itens</span>
                  <span className="tabular-nums">{toBRL(estimated.subtotal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Entrega</span>
                  <span className="tabular-nums">{toBRL(estimated.deliveryFee)}</span>
                </div>
                <div className="flex items-center justify-between border-t border-[var(--color-line)] pt-3 text-[15px] font-semibold text-[var(--color-ink)]">
                  <span>Total</span>
                  <span className="tabular-nums">{toBRL(estimated.total)}</span>
                </div>
              </div>

              <div className="space-y-2 text-[12px] text-[var(--color-ink-muted)]">
                <p>{draft.fulfillmentType === 'delivery' ? 'Entrega' : 'Retirada'}{draft.pickupDate ? ` em ${draft.pickupDate}` : ''}{draft.pickupTime ? ` às ${draft.pickupTime}` : ''}</p>
                {draft.fulfillmentType === 'delivery' && draft.deliveryNeighborhood ? (
                  <p>{draft.deliveryNeighborhood}</p>
                ) : null}
              </div>

              {error ? (
                <div className="rounded-lg border border-[var(--color-alert)] bg-[var(--color-alert-soft)] px-3 py-3 text-[13px] text-[var(--color-alert)]">
                  {error}
                </div>
              ) : null}

              {inlineMessage ? (
                <div className="rounded-lg border border-[var(--color-brand)] bg-[var(--color-brand-soft)] px-3 py-3 text-[13px] text-[var(--color-brand-deep)]">
                  {inlineMessage}
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => void saveDraft()}
                disabled={saving || isStale || !isOpen || !hasUnsavedChanges}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 text-[14px] font-medium text-white disabled:cursor-not-allowed disabled:bg-[var(--color-line-strong)]"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} /> : <RefreshCw className="h-4 w-4" strokeWidth={1.8} />}
                {saving ? 'Salvando…' : !isOpen ? 'Pedido fechado' : hasUnsavedChanges ? 'Atualizar carrinho' : 'Carrinho atualizado'}
              </button>

              <button
                type="button"
                onClick={() => void confirmCart()}
                disabled={confirming || !canConfirm}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-ink)] px-4 text-[14px] font-medium text-white disabled:cursor-not-allowed disabled:bg-[var(--color-line-strong)]"
              >
                {confirming ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} /> : <CheckCircle2 className="h-4 w-4" strokeWidth={1.8} />}
                {confirming ? 'Confirmando…' : isConfirmed ? 'Pedido confirmado' : hasUnsavedChanges ? 'Atualize antes de confirmar' : 'Confirmar pedido'}
              </button>
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}

function ProductRow({
  product,
  quantity,
  onAdd,
}: {
  product: ZeloMenuCatalogProduct;
  quantity: number;
  onAdd: () => void;
}) {
  return (
    <div className="grid gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <p className="truncate text-[14px] font-medium">{product.name}</p>
        <p className="mt-0.5 text-[12px] text-[var(--color-ink-muted)]">
          {toBRL(product.price)}
          {product.stockControlled && typeof product.stockQuantity === 'number'
            ? ` • estoque ${product.stockQuantity}`
            : ''}
        </p>
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-muted)] px-3 text-[13px] font-medium text-[var(--color-ink-soft)]"
      >
        <Plus className="h-4 w-4" strokeWidth={1.8} />
        {quantity > 0 ? `Adicionar mais (${quantity})` : 'Adicionar'}
      </button>
    </div>
  );
}
