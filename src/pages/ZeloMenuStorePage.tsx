import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Loader2, Minus, Plus, ShoppingCart, Store } from 'lucide-react';
import {
  getPublicStore,
  startPublicOrder,
  type ZeloMenuCatalogGroup,
  type ZeloMenuCatalogProduct,
  type ZeloMenuPublicStoreResponse,
} from '../services/zelomenuApi';
import {
  resolveModifierSelections,
  type ZeloMenuModifierSelectionInput,
} from '../domain/zelomenuModifiers';
import { maskBrazilianPhone, normalizePhoneNumber } from '../domain/chat';
import { useToast } from '../contexts/ToastContext';

type SelectedItem = {
  key: string;
  productId: number;
  productName: string;
  quantity: number;
  selectedOptions: ZeloMenuModifierSelectionInput[];
  unitPrice: number;
};

function toBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function selectionSignature(selectedOptions: ZeloMenuModifierSelectionInput[]): string {
  return selectedOptions
    .map((group) => `${group.groupId}:${[...group.optionIds].sort().join(',')}`)
    .sort()
    .join('|') || 'plain';
}

function allProducts(catalog: ZeloMenuCatalogGroup[]): ZeloMenuCatalogProduct[] {
  const out: ZeloMenuCatalogProduct[] = [];
  for (const group of catalog) {
    out.push(...group.produtosDireto);
    for (const sub of group.subcategorias) out.push(...sub.produtos);
  }
  return out;
}

export default function ZeloMenuStorePage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [store, setStore] = useState<ZeloMenuPublicStoreResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, SelectedItem>>({});
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [picker, setPicker] = useState<{ product: ZeloMenuCatalogProduct; selections: Record<string, string[]> } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getPublicStore(slug);
        if (!active) return;
        setStore(data);
        document.title = data.business.name ? `${data.business.name} | Cardápio` : 'Cardápio';
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Não consegui carregar o cardápio.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      document.title = 'ZeloChat';
    };
  }, [slug]);

  const lines = useMemo(() => Object.values(items), [items]);
  const subtotal = useMemo(
    () => lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
    [lines],
  );
  const totalQty = useMemo(() => lines.reduce((sum, line) => sum + line.quantity, 0), [lines]);

  function addPlainProduct(product: ZeloMenuCatalogProduct) {
    const key = `${product.id}::plain`;
    setItems((prev) => {
      const existing = prev[key];
      return {
        ...prev,
        [key]: {
          key,
          productId: product.id,
          productName: product.name,
          quantity: (existing?.quantity ?? 0) + 1,
          selectedOptions: [],
          unitPrice: product.basePrice,
        },
      };
    });
  }

  function changeQty(key: string, delta: number) {
    setItems((prev) => {
      const existing = prev[key];
      if (!existing) return prev;
      const nextQty = existing.quantity + delta;
      if (nextQty <= 0) {
        const { [key]: _drop, ...rest } = prev;
        return rest;
      }
      return { ...prev, [key]: { ...existing, quantity: nextQty } };
    });
  }

  function onAddProduct(product: ZeloMenuCatalogProduct) {
    if (product.modifierGroups.length > 0) {
      setPicker({ product, selections: {} });
    } else {
      addPlainProduct(product);
    }
  }

  function confirmPicker() {
    if (!picker) return;
    const currentSelections = picker.selections;
    const selectedOptions: ZeloMenuModifierSelectionInput[] = Object.keys(currentSelections)
      .map((groupId) => ({ groupId, optionIds: currentSelections[groupId] ?? [] }))
      .filter((sel) => sel.optionIds.length > 0);
    const resolved = resolveModifierSelections(picker.product.modifierGroups, selectedOptions);
    if (!resolved.ok) return;
    const key = `${picker.product.id}::${selectionSignature(selectedOptions)}`;
    setItems((prev) => {
      const existing = prev[key];
      return {
        ...prev,
        [key]: {
          key,
          productId: picker.product.id,
          productName: picker.product.name,
          quantity: (existing?.quantity ?? 0) + 1,
          selectedOptions,
          unitPrice: Number((picker.product.basePrice + resolved.deltaTotal).toFixed(2)),
        },
      };
    });
    setPicker(null);
  }

  async function continueToCart() {
    if (lines.length === 0) return;
    const phoneDigits = normalizePhoneNumber(customerPhone).slice(0, 11);
    if (phoneDigits.length < 10) {
      toast.error('Informe um WhatsApp válido com DDD para a loja te encontrar.');
      return;
    }
    try {
      setSubmitting(true);
      const result = await startPublicOrder(slug, {
        customerName: customerName.trim() || null,
        customerPhone: phoneDigits,
        items: lines.map((line) => ({
          productId: line.productId,
          productName: line.productName,
          quantity: line.quantity,
          selectedOptions: line.selectedOptions,
        })),
      });
      navigate(result.path);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não consegui iniciar o pedido. Tente de novo.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-canvas)]">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--color-ink-muted)]" strokeWidth={1.8} />
      </div>
    );
  }

  if (error && !store) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-canvas)] px-6">
        <div className="max-w-sm rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-6 text-center">
          <AlertTriangle className="mx-auto mb-3 h-7 w-7 text-[var(--color-alert)]" strokeWidth={1.8} />
          <p className="text-[14px] text-[var(--color-ink)]">{error}</p>
        </div>
      </div>
    );
  }

  if (!store) return null;
  const products = allProducts(store.catalog);

  return (
    <div className="min-h-screen bg-[var(--color-canvas)] pb-32">
      <header className="border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-5">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-brand-soft)]">
            <Store className="h-5 w-5 text-[var(--color-brand-deep)]" strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-[18px] font-semibold text-[var(--color-ink)]">{store.business.name || 'Cardápio'}</h1>
            {store.business.address ? (
              <p className="truncate text-[12px] text-[var(--color-ink-muted)]">{store.business.address}</p>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-5">
        {store.catalog.length === 0 || products.length === 0 ? (
          <p className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-6 text-center text-[14px] text-[var(--color-ink-muted)]">
            Esta loja ainda não publicou itens no cardápio.
          </p>
        ) : (
          <div className="space-y-6">
            {store.catalog.map((group) => {
              const groupProducts: ZeloMenuCatalogProduct[] = [
                ...group.produtosDireto,
                ...group.subcategorias.flatMap((sub) => sub.produtos),
              ];
              if (groupProducts.length === 0) return null;
              return (
                <section key={group.nome} className="space-y-2">
                  <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{group.nome}</h2>
                  <div className="space-y-2">
                    {groupProducts.map((product) => (
                      <div key={product.id}>
                        <StoreProductRow product={product} onAdd={() => onAddProduct(product)} />
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {lines.length > 0 ? (
          <section className="mt-8 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
            <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-[var(--color-ink)]">
              <ShoppingCart className="h-4 w-4 text-[var(--color-ink-muted)]" strokeWidth={1.8} /> Seu pedido
            </h2>
            <div className="space-y-2">
              {lines.map((line) => (
                <div key={line.key} className="flex items-center justify-between gap-3 text-[14px]">
                  <span className="min-w-0 flex-1 truncate text-[var(--color-ink)]">{line.productName}</span>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => changeQty(line.key, -1)} className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-line)]"><Minus className="h-3.5 w-3.5" /></button>
                    <span className="w-5 text-center tabular-nums">{line.quantity}</span>
                    <button type="button" onClick={() => changeQty(line.key, 1)} className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-line)]"><Plus className="h-3.5 w-3.5" /></button>
                    <span className="w-20 text-right tabular-nums text-[var(--color-ink-soft)]">{toBRL(line.unitPrice * line.quantity)}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 grid gap-3 border-t border-[var(--color-line)] pt-4">
              <label className="space-y-1.5">
                <span className="text-[12px] font-medium text-[var(--color-ink-muted)]">Seu nome</span>
                <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="h-11 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-[14px]" placeholder="Como a loja te chama" />
              </label>
              <label className="space-y-1.5">
                <span className="text-[12px] font-medium text-[var(--color-ink-muted)]">WhatsApp (com DDD)</span>
                <input
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(maskBrazilianPhone(e.target.value))}
                  inputMode="tel"
                  className="h-11 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-[14px]"
                  placeholder="(XX) XXXXX-XXXX"
                />
              </label>
            </div>
          </section>
        ) : null}
      </main>

      {lines.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 border-t border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3">
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
            <div className="text-[13px] text-[var(--color-ink-soft)]">
              {totalQty} {totalQty === 1 ? 'item' : 'itens'} · <span className="font-semibold text-[var(--color-ink)]">{toBRL(subtotal)}</span>
            </div>
            <button
              type="button"
              onClick={() => void continueToCart()}
              disabled={submitting}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[var(--color-brand)] px-5 text-[14px] font-medium text-white disabled:cursor-not-allowed disabled:bg-[var(--color-line-strong)]"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} /> : null}
              Continuar
            </button>
          </div>
        </div>
      ) : null}

      {picker ? (
        <StoreModifierModal
          product={picker.product}
          selections={picker.selections}
          onClose={() => setPicker(null)}
          onToggle={(groupId, optionId) => {
            setPicker((cur) => {
              if (!cur) return cur;
              const group = cur.product.modifierGroups.find((g) => g.id === groupId);
              if (!group) return cur;
              const current = cur.selections[groupId] ?? [];
              const has = current.includes(optionId);
              let next: string[];
              if (has) next = current.filter((id) => id !== optionId);
              else if (group.maxSelections === 1) next = [optionId];
              else next = [...current, optionId];
              return { ...cur, selections: { ...cur.selections, [groupId]: next } };
            });
          }}
          onConfirm={confirmPicker}
        />
      ) : null}
    </div>
  );
}

function StoreProductRow({ product, onAdd }: { product: ZeloMenuCatalogProduct; onAdd: () => void }) {
  return (
    <div className="grid gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="flex min-w-0 gap-3">
        {product.photoUrl ? (
          <img src={product.photoUrl} alt={product.name} loading="lazy" className="h-14 w-14 shrink-0 rounded-md object-cover" />
        ) : null}
        <div className="min-w-0">
          <p className="truncate text-[14px] font-medium text-[var(--color-ink)]">{product.name}</p>
          {product.description ? (
            <p className="mt-0.5 line-clamp-2 text-[12px] leading-4 text-[var(--color-ink-muted)]">{product.description}</p>
          ) : null}
          <p className="mt-0.5 text-[12px] text-[var(--color-ink-muted)]">A partir de {toBRL(product.basePrice)}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="inline-flex h-9 items-center justify-center gap-1 rounded-lg bg-[var(--color-ink)] px-4 text-[13px] font-medium text-white sm:w-auto"
      >
        <Plus className="h-4 w-4" strokeWidth={2} /> Adicionar
      </button>
    </div>
  );
}

function StoreModifierModal({
  product,
  selections,
  onClose,
  onToggle,
  onConfirm,
}: {
  product: ZeloMenuCatalogProduct;
  selections: Record<string, string[]>;
  onClose: () => void;
  onToggle: (groupId: string, optionId: string) => void;
  onConfirm: () => void;
}) {
  const selectedOptions = Object.entries(selections)
    .map(([groupId, optionIds]) => ({ groupId, optionIds }))
    .filter((sel) => sel.optionIds.length > 0);
  const resolution = resolveModifierSelections(product.modifierGroups, selectedOptions);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 py-6 sm:items-center">
      <div className="w-full max-w-2xl rounded-2xl bg-[var(--color-surface)] shadow-2xl">
        <div className="border-b border-[var(--color-line)] px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[18px] font-semibold text-[var(--color-ink)]">{product.name}</h3>
              <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">Escolha as opções antes de adicionar.</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-[13px] font-medium text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-muted)]">Fechar</button>
          </div>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-4 py-4">
          {product.modifierGroups.map((group) => {
            const selectedIds = selections[group.id] ?? [];
            return (
              <section key={group.id} className="rounded-xl border border-[var(--color-line)] p-3">
                <div className="mb-3">
                  <p className="text-[14px] font-semibold text-[var(--color-ink)]">{group.name}</p>
                  <p className="text-[12px] text-[var(--color-ink-muted)]">
                    {group.minSelections > 0 ? `Escolha pelo menos ${group.minSelections}.` : 'Opcional.'}
                    {group.maxSelections != null ? ` Máximo ${group.maxSelections}.` : ''}
                  </p>
                </div>
                <div className="space-y-2">
                  {group.options.filter((option) => option.active).map((option) => (
                    <label key={option.id} className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-[var(--color-line)] px-3 py-2.5">
                      <div className="flex items-center gap-3">
                        <input
                          type={group.maxSelections === 1 ? 'radio' : 'checkbox'}
                          name={group.id}
                          checked={selectedIds.includes(option.id)}
                          onChange={() => onToggle(group.id, option.id)}
                          className="h-4 w-4"
                        />
                        <span className="text-[13px] text-[var(--color-ink)]">{option.name}</span>
                      </div>
                      <span className="text-[12px] font-medium text-[var(--color-ink-soft)]">
                        {option.priceDelta > 0 ? `+ ${toBRL(option.priceDelta)}` : 'sem custo extra'}
                      </span>
                    </label>
                  ))}
                </div>
              </section>
            );
          })}
          {resolution.ok === false ? (
            <div className="rounded-lg border border-[var(--color-alert)] bg-[var(--color-alert-soft)] px-3 py-3 text-[13px] text-[var(--color-alert)]">{resolution.message}</div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--color-line)] px-4 py-4">
          <div className="text-[13px] text-[var(--color-ink-soft)]">
            {resolution.ok ? `Preço: ${toBRL(product.basePrice + resolution.deltaTotal)}` : 'Revise as escolhas'}
          </div>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!resolution.ok}
            className="inline-flex h-10 items-center rounded-lg bg-[var(--color-ink)] px-4 text-[13px] font-medium text-white disabled:cursor-not-allowed disabled:bg-[var(--color-line-strong)]"
          >
            Adicionar
          </button>
        </div>
      </div>
    </div>
  );
}
