import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Loader2, Minus, Plus, Search, ShoppingBag, X } from 'lucide-react';
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
  return (
    selectedOptions
      .map((g) => `${g.groupId}:${[...g.optionIds].sort().join(',')}`)
      .sort()
      .join('|') || 'plain'
  );
}

function allGroupProducts(group: ZeloMenuCatalogGroup): ZeloMenuCatalogProduct[] {
  return [...group.produtosDireto, ...group.subcategorias.flatMap((s) => s.produtos)];
}

function groupHasPhotos(group: ZeloMenuCatalogGroup): boolean {
  return allGroupProducts(group).some((p) => p.photoUrl);
}

function getFeaturedProducts(catalog: ZeloMenuCatalogGroup[], ids: number[]): ZeloMenuCatalogProduct[] {
  const idSet = new Set(ids);
  const all = catalog.flatMap((g) => [...g.produtosDireto, ...g.subcategorias.flatMap((s) => s.produtos)]);
  const byId = new Map(all.map((p) => [p.id, p]));
  return ids.map((id) => byId.get(id)).filter((p): p is ZeloMenuCatalogProduct => p != null && p.available !== false);
}

function storeInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();
}

function getProductQty(productId: number, items: Record<string, SelectedItem>): number {
  return Object.values(items)
    .filter((it) => it.productId === productId)
    .reduce((s, it) => s + it.quantity, 0);
}

// ─── Cart persistence ──────────────────────────────────────────────────────────
// Guarda o carrinho no localStorage do cliente por slug, com validade de 12h,
// pra que voltar da tela de carrinho (ou recarregar a página) não perca os itens.

const CART_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas

type PersistedCart = {
  items: Record<string, SelectedItem>;
};

function cartStorageKey(slug: string): string {
  return `zelomenu_cart_${slug}`;
}

function loadPersistedCart(slug: string): PersistedCart {
  const empty: PersistedCart = { items: {} };
  if (!slug) return empty;
  try {
    const raw = localStorage.getItem(cartStorageKey(slug));
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as { savedAt?: number } & Partial<PersistedCart>;
    if (!parsed.savedAt || Date.now() - parsed.savedAt > CART_TTL_MS) {
      localStorage.removeItem(cartStorageKey(slug));
      return empty;
    }
    return {
      items: parsed.items ?? {},
    };
  } catch {
    return empty;
  }
}

function persistCart(slug: string, cart: PersistedCart): void {
  if (!slug) return;
  try {
    const hasContent = Object.keys(cart.items).length > 0;
    if (!hasContent) {
      localStorage.removeItem(cartStorageKey(slug));
      return;
    }
    localStorage.setItem(cartStorageKey(slug), JSON.stringify({ ...cart, savedAt: Date.now() }));
  } catch {
    // localStorage indisponível (modo privado/cota) — ignora, carrinho só não persiste
  }
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ZeloMenuStorePage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [store, setStore] = useState<ZeloMenuPublicStoreResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Carrinho restaurado do localStorage (validade 12h) — sobrevive a voltar/recarregar.
  const restored = useMemo(() => loadPersistedCart(slug), [slug]);
  const [items, setItems] = useState<Record<string, SelectedItem>>(restored.items);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [unitPicker, setUnitPicker] = useState<ZeloMenuCatalogProduct | null>(null);
  const [picker, setPicker] = useState<{
    product: ZeloMenuCatalogProduct;
    selections: Record<string, string[]>;
  } | null>(null);

  const tabsRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  // ── Load store ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getPublicStore(slug);
        if (!active) return;
        setStore(data);
        document.title = data.business.name ? `${data.business.name} | Cardápio` : 'Cardápio';
        if (data.catalog.length > 0) setActiveCategory(data.catalog[0].nome);
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

  // ── Persiste o carrinho no localStorage a cada mudança ──────────────────────
  useEffect(() => {
    persistCart(slug, { items });
  }, [slug, items]);

  // ── Category tracking via IntersectionObserver ──────────────────────────────
  useEffect(() => {
    if (!store) return;
    const refs = sectionRefs.current;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          const cat = (visible[0].target as HTMLElement).dataset.category ?? '';
          if (cat) setActiveCategory(cat);
        }
      },
      { threshold: 0.15, rootMargin: '-100px 0px -45% 0px' },
    );
    for (const el of Object.values(refs) as Array<HTMLElement | null>) {
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [store]);

  // ── Scroll active tab into view ─────────────────────────────────────────────
  useEffect(() => {
    const tabs = tabsRef.current;
    if (!tabs || !activeCategory) return;
    for (const btn of tabs.querySelectorAll('[data-tab]')) {
      if ((btn as HTMLElement).dataset.tab === activeCategory) {
        btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        break;
      }
    }
  }, [activeCategory]);

  // ── Cart helpers ────────────────────────────────────────────────────────────
  function addPlainProduct(product: ZeloMenuCatalogProduct, qty = 1) {
    const key = `${product.id}::plain`;
    setItems((prev) => ({
      ...prev,
      [key]: {
        key,
        productId: product.id,
        productName: product.name,
        quantity: qty,
        selectedOptions: [],
        unitPrice: product.basePrice,
      },
    }));
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

  function setQty(key: string, qty: number) {
    setItems((prev) => {
      const existing = prev[key];
      if (!existing) return prev;
      if (qty <= 0) {
        const { [key]: _drop, ...rest } = prev;
        return rest;
      }
      return { ...prev, [key]: { ...existing, quantity: qty } };
    });
  }

  function onAddProduct(product: ZeloMenuCatalogProduct) {
    if (product.modifierGroups.length > 0) {
      setPicker({ product, selections: {} });
    } else if (product.unitBased) {
      setUnitPicker(product);
    } else {
      addPlainProduct(product);
    }
  }

  function confirmPicker() {
    if (!picker) return;
    const selectedOptions = Object.keys(picker.selections)
      .map((groupId) => ({ groupId, optionIds: picker.selections[groupId] ?? [] }))
      .filter((sel) => sel.optionIds.length > 0);
    const resolved = resolveModifierSelections(picker.product.modifierGroups, selectedOptions);
    if (!resolved.ok) return;
    const key = `${picker.product.id}::${selectionSignature(selectedOptions)}`;
    setItems((prev) => ({
      ...prev,
      [key]: {
        key,
        productId: picker.product.id,
        productName: picker.product.name,
        quantity: (prev[key]?.quantity ?? 0) + 1,
        selectedOptions,
        unitPrice: Number((picker.product.basePrice + resolved.deltaTotal).toFixed(2)),
      },
    }));
    setPicker(null);
  }

  function scrollToCategory(name: string) {
    const el = sectionRefs.current[name];
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY - 148;
      window.scrollTo({ top, behavior: 'smooth' });
    }
    setActiveCategory(name);
  }

  async function continueToCart() {
    try {
      setSubmitting(true);
      const result = await startPublicOrder(slug, {
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

  // ── Derived state ───────────────────────────────────────────────────────────
  const lines = useMemo(() => Object.values(items), [items]);
  const subtotal = useMemo(() => lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0), [lines]);
  const totalQty = useMemo(() => lines.reduce((s, l) => s + l.quantity, 0), [lines]);

  const filteredCatalog = useMemo(() => {
    if (!store) return [];
    if (!searchQuery.trim()) return store.catalog;
    const q = searchQuery
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
    const filterProds = (prods: ZeloMenuCatalogProduct[]) =>
      prods.filter((p) => {
        const n = p.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        const d = (p.description ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        return n.includes(q) || d.includes(q);
      });
    return store.catalog
      .map((group) => ({
        ...group,
        produtosDireto: filterProds(group.produtosDireto),
        subcategorias: group.subcategorias
          .map((sub) => ({ ...sub, produtos: filterProds(sub.produtos) }))
          .filter((sub) => sub.produtos.length > 0),
      }))
      .filter((g) => g.produtosDireto.length > 0 || g.subcategorias.length > 0);
  }, [store, searchQuery]);

  // ── Loading / error states ──────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[var(--color-canvas)]">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--color-brand)]" strokeWidth={1.8} />
        <p className="text-[13px] text-[var(--color-ink-muted)]">Carregando cardápio…</p>
      </div>
    );
  }

  if (error && !store) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-canvas)] px-6">
        <div className="max-w-sm rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-alert-soft)]">
            <AlertTriangle className="h-6 w-6 text-[var(--color-alert)]" strokeWidth={1.8} />
          </div>
          <h2 className="text-[16px] font-semibold text-[var(--color-ink)]">Cardápio indisponível</h2>
          <p className="mt-1 text-[14px] text-[var(--color-ink-muted)]">{error}</p>
        </div>
      </div>
    );
  }

  if (!store) return null;

  const visibleCategories = store.catalog.filter((g) => allGroupProducts(g).length > 0);
  const businessHours = store.business.businessHours;
  const outsideBusinessHours = businessHours?.configured === true && businessHours.openNow === false;

  return (
    <div className="min-h-screen bg-[var(--color-canvas)]" style={{ paddingBottom: 'max(7rem, calc(7rem + env(safe-area-inset-bottom)))' }}>

      {/* ── Sticky header ──────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-[var(--color-line)] bg-[var(--color-surface)]">
        <div className="mx-auto max-w-2xl">

          {/* Store identity row */}
          <div className="flex items-center gap-3 px-4 pt-4 pb-3">
            {store.business.logoUrl ? (
              <img
                src={store.business.logoUrl}
                alt={store.business.name || 'Logo'}
                className="h-12 w-12 shrink-0 rounded-xl object-cover"
              />
            ) : (
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-[16px] font-bold text-white"
                style={{ background: 'linear-gradient(135deg, #0b9778, #07745c)' }}
                aria-hidden="true"
              >
                {store.business.name ? storeInitials(store.business.name) : '🍴'}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[17px] font-bold leading-tight text-[var(--color-ink)]">
                {store.business.name || 'Cardápio'}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {store.business.address ? (
                  <p className="truncate text-[11px] text-[var(--color-ink-muted)]">{store.business.address}</p>
                ) : null}
                {store.business.deliveryEnabled ? (
                  <span className="shrink-0 rounded-full bg-[var(--color-brand-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-brand-deep)]">
                    Entrega
                  </span>
                ) : null}
                {store.business.pixEnabled ? (
                  <span className="shrink-0 rounded-full bg-[var(--color-canvas)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
                    Pix
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {/* Search bar */}
          <div className="px-4 pb-2.5">
            <div className="flex h-10 items-center gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 focus-within:border-[var(--color-brand)]" style={{ transition: 'border-color 0.15s' }}>
              <Search className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-muted)]" strokeWidth={2} />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar no cardápio…"
                className="flex-1 bg-transparent text-[13px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] outline-none"
              />
              {searchQuery ? (
                <button type="button" onClick={() => setSearchQuery('')} className="shrink-0 rounded p-0.5">
                  <X className="h-3.5 w-3.5 text-[var(--color-ink-muted)]" strokeWidth={2} />
                </button>
              ) : null}
            </div>
          </div>

          {/* Category pill tabs */}
          {!searchQuery && visibleCategories.length > 1 ? (
            <div
              ref={tabsRef}
              className="flex gap-1.5 overflow-x-auto px-4 pb-3"
              style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' } as CSSProperties}
            >
              {visibleCategories.map((group) => (
                <button
                  key={group.nome}
                  type="button"
                  data-tab={group.nome}
                  onClick={() => scrollToCategory(group.nome)}
                  className="shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[12px] font-semibold"
                  style={{
                    background: activeCategory === group.nome ? 'var(--color-brand)' : 'var(--color-canvas)',
                    color: activeCategory === group.nome ? '#fff' : 'var(--color-ink-soft)',
                    transition: 'background 0.2s, color 0.2s',
                  }}
                >
                  {group.nome}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      {/* ── Catalog body ──────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-2xl px-4 py-5">

        {outsideBusinessHours ? (
          <section className="mb-5 rounded-2xl border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-4 py-3">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warn)]" strokeWidth={2} />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-[var(--color-ink)]">
                  Fora do horário de atendimento
                </p>
                <p className="mt-0.5 text-[12px] leading-5 text-[var(--color-ink-soft)]">
                  Você pode montar o pedido agora e agendar para um horário disponível
                  {businessHours?.label ? ` (${businessHours.label}).` : '.'}
                </p>
              </div>
            </div>
          </section>
        ) : null}

        {/* Welcome text */}
        {!searchQuery && store.business.welcomeText ? (
          <p className="mb-5 text-[14px] leading-relaxed text-[var(--color-ink-soft)]">
            {store.business.welcomeText}
          </p>
        ) : null}

        {/* Featured section */}
        {!searchQuery && store.business.featuredEnabled && (store.business.featuredProductIds ?? []).length > 0 ? (() => {
          const featured = getFeaturedProducts(store.catalog, store.business.featuredProductIds ?? []);
          if (featured.length === 0) return null;
          return (
            <div className="mb-8">
              <h2 className="mb-3 text-[15px] font-bold text-[var(--color-ink)]">Destaques</h2>
              <div className="grid grid-cols-2 gap-3">
                {featured.map((p) => (
                  <div key={`featured-${p.id}`}>
                    <PhotoCard product={p} items={items} onAdd={() => onAddProduct(p)} onChangeQty={changeQty} onSetQty={setQty} />
                  </div>
                ))}
              </div>
            </div>
          );
        })() : null}

        {filteredCatalog.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <Search className="mb-3 h-10 w-10 text-[var(--color-line-strong)]" strokeWidth={1.5} />
            <p className="text-[15px] font-semibold text-[var(--color-ink-soft)]">Nenhum item encontrado</p>
            <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">Tente um termo diferente</p>
          </div>
        ) : (
          <div className="space-y-8">
            {filteredCatalog.map((group) => {
              const hasPhotos = groupHasPhotos(group);
              if (allGroupProducts(group).length === 0) return null;
              return (
                <section
                  key={group.nome}
                  data-category={group.nome}
                  ref={(el) => { sectionRefs.current[group.nome] = el; }}
                >
                  <h2 className="mb-3 text-[15px] font-bold text-[var(--color-ink)]">{group.nome}</h2>

                  {group.produtosDireto.length > 0 ? (
                    <ProductGrid
                      products={group.produtosDireto}
                      hasPhotos={hasPhotos}
                      items={items}
                      onAdd={onAddProduct}
                      onChangeQty={changeQty}
                      onSetQty={setQty}
                    />
                  ) : null}

                  {group.subcategorias.map((sub) =>
                    sub.produtos.length > 0 ? (
                      <div key={sub.nome} className="mt-4">
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                          {sub.nome}
                        </p>
                        <ProductGrid
                          products={sub.produtos}
                          hasPhotos={hasPhotos}
                          items={items}
                          onAdd={onAddProduct}
                          onChangeQty={changeQty}
                          onSetQty={setQty}
                        />
                      </div>
                    ) : null,
                  )}
                </section>
              );
            })}
          </div>
        )}
      </main>

      {/* ── Floating cart bar ────────────────────────────────────────────── */}
      {lines.length > 0 ? (
        <div
          className="fixed inset-x-0 bottom-0 z-30 px-4"
          style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
        >
          <div className="mx-auto max-w-2xl">
            <button
              type="button"
              onClick={() => void continueToCart()}
              disabled={submitting}
              className="flex w-full items-center justify-between rounded-2xl px-5 py-4 text-white shadow-2xl disabled:cursor-wait disabled:opacity-70"
              style={{ background: 'var(--color-brand)' }}
            >
              <div className="flex items-center gap-3">
                <span
                  className="flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[11px] font-bold"
                  style={{ background: 'rgba(255,255,255,0.22)' }}
                >
                  {totalQty}
                </span>
                <span className="flex items-center gap-2 text-[14px] font-semibold">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} /> : null}
                  {submitting ? 'Abrindo pedido…' : 'Continuar pedido'}
                </span>
              </div>
              <span className="text-[15px] font-bold">{toBRL(subtotal)}</span>
            </button>
          </div>
        </div>
      ) : null}

      {/* ── Unit quantity modal ──────────────────────────────────────────── */}
      {unitPicker ? (
        <UnitPickerModal
          product={unitPicker}
          currentQty={getProductQty(unitPicker.id, items)}
          onClose={() => setUnitPicker(null)}
          onConfirm={(qty) => {
            addPlainProduct(unitPicker, qty);
            setUnitPicker(null);
          }}
        />
      ) : null}

      {/* ── Modifier picker modal ─────────────────────────────────────────── */}
      {picker ? (
        <ModifierModal
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

// ─── ProductGrid ──────────────────────────────────────────────────────────────

function ProductGrid({
  products,
  hasPhotos,
  items,
  onAdd,
  onChangeQty,
  onSetQty,
}: {
  products: ZeloMenuCatalogProduct[];
  hasPhotos: boolean;
  items: Record<string, SelectedItem>;
  onAdd: (p: ZeloMenuCatalogProduct) => void;
  onChangeQty: (key: string, delta: number) => void;
  onSetQty: (key: string, qty: number) => void;
}) {
  if (hasPhotos) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {products.map((p) => (
          <div key={p.id}>
            <PhotoCard product={p} items={items} onAdd={() => onAdd(p)} onChangeQty={onChangeQty} onSetQty={onSetQty} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)]">
      {products.map((p, i) => (
        <div key={p.id}>
          <ListRow
            product={p}
            items={items}
            onAdd={() => onAdd(p)}
            onChangeQty={onChangeQty}
            onSetQty={onSetQty}
            divider={i < products.length - 1}
          />
        </div>
      ))}
    </div>
  );
}

// ─── PhotoCard ────────────────────────────────────────────────────────────────

function PhotoCard({
  product,
  items,
  onAdd,
  onChangeQty,
  onSetQty,
}: {
  product: ZeloMenuCatalogProduct;
  items: Record<string, SelectedItem>;
  onAdd: () => void;
  onChangeQty: (key: string, delta: number) => void;
  onSetQty: (key: string, qty: number) => void;
}) {
  const qty = getProductQty(product.id, items);
  const plainKey = `${product.id}::plain`;
  const hasModifiers = product.modifierGroups.length > 0;
  const isUnit = product.unitBased === true;

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)]">
      {/* Photo */}
      <div className="relative" style={{ aspectRatio: '1 / 1' }}>
        {product.photoUrl ? (
          <img
            src={product.photoUrl}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center"
            style={{ background: 'var(--color-canvas)' }}
          >
            <ShoppingBag className="h-8 w-8 text-[var(--color-line-strong)]" strokeWidth={1.5} />
          </div>
        )}
        {qty > 0 ? (
          <span
            className="absolute right-2 top-2 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
            style={{ background: 'var(--color-brand)' }}
          >
            {qty}
          </span>
        ) : null}
      </div>

      {/* Info + action */}
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-[var(--color-ink)]">
          {product.name}
        </p>
        {product.description ? (
          <p className="line-clamp-2 text-[11px] leading-snug text-[var(--color-ink-muted)]">
            {product.description}
          </p>
        ) : null}
        <div className="mt-auto flex items-center justify-between pt-2">
          <p className="text-[13px] font-bold" style={{ color: 'var(--color-brand-deep)' }}>
            {toBRL(product.basePrice)}
          </p>
          {qty > 0 && !hasModifiers ? (
            isUnit ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onSetQty(plainKey, 0)}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--color-line)]"
                  aria-label="Remover"
                >
                  <X className="h-3 w-3" strokeWidth={2.5} />
                </button>
                <button
                  type="button"
                  onClick={onAdd}
                  className="flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-[12px] font-bold text-white"
                  style={{ background: 'var(--color-brand)' }}
                  aria-label={`Editar quantidade de ${product.name}`}
                >
                  {qty}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onChangeQty(plainKey, -1)}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--color-line)]"
                  aria-label="Diminuir"
                >
                  <Minus className="h-3 w-3" strokeWidth={2.5} />
                </button>
                <span className="w-4 text-center text-[13px] font-bold">{qty}</span>
                <button
                  type="button"
                  onClick={() => onChangeQty(plainKey, 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-white"
                  style={{ background: 'var(--color-brand)' }}
                  aria-label="Aumentar"
                >
                  <Plus className="h-3 w-3" strokeWidth={2.5} />
                </button>
              </div>
            )
          ) : (
            <button
              type="button"
              onClick={onAdd}
              className="flex h-8 w-8 items-center justify-center rounded-full text-white"
              style={{ background: 'var(--color-brand)', transition: 'transform 0.1s', WebkitTapHighlightColor: 'transparent' } as CSSProperties}
              onMouseDown={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.92)'; }}
              onMouseUp={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
              aria-label={`Adicionar ${product.name}`}
            >
              <Plus className="h-4 w-4" strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── ListRow ──────────────────────────────────────────────────────────────────

function ListRow({
  product,
  items,
  onAdd,
  onChangeQty,
  onSetQty,
  divider,
}: {
  product: ZeloMenuCatalogProduct;
  items: Record<string, SelectedItem>;
  onAdd: () => void;
  onChangeQty: (key: string, delta: number) => void;
  onSetQty: (key: string, qty: number) => void;
  divider: boolean;
}) {
  const qty = getProductQty(product.id, items);
  const plainKey = `${product.id}::plain`;
  const hasModifiers = product.modifierGroups.length > 0;
  const isUnit = product.unitBased === true;

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 ${divider ? 'border-b border-[var(--color-line)]' : ''}`}
    >
      {product.photoUrl ? (
        <img
          src={product.photoUrl}
          alt={product.name}
          loading="lazy"
          className="h-16 w-16 shrink-0 rounded-xl object-cover"
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold text-[var(--color-ink)]">{product.name}</p>
        {product.description ? (
          <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-[var(--color-ink-muted)]">
            {product.description}
          </p>
        ) : null}
        <p className="mt-1 text-[13px] font-bold" style={{ color: 'var(--color-brand-deep)' }}>
          {toBRL(product.basePrice)}
        </p>
      </div>
      <div className="shrink-0">
        {qty > 0 && !hasModifiers ? (
          isUnit ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onSetQty(plainKey, 0)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-line)]"
                aria-label="Remover"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={onAdd}
                className="flex h-8 min-w-8 items-center justify-center rounded-full px-2.5 text-[13px] font-bold text-white"
                style={{ background: 'var(--color-brand)' }}
                aria-label={`Editar quantidade de ${product.name}`}
              >
                {qty}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onChangeQty(plainKey, -1)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-line)]"
                aria-label="Diminuir"
              >
                <Minus className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
              <span className="w-5 text-center text-[14px] font-bold tabular-nums">{qty}</span>
              <button
                type="button"
                onClick={() => onChangeQty(plainKey, 1)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-white"
                style={{ background: 'var(--color-brand)' }}
                aria-label="Aumentar"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </div>
          )
        ) : (
          <button
            type="button"
            onClick={onAdd}
            className="flex h-9 w-9 items-center justify-center rounded-full text-white"
            style={{ background: 'var(--color-brand)', transition: 'transform 0.1s', WebkitTapHighlightColor: 'transparent' } as CSSProperties}
            onMouseDown={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.92)'; }}
            onMouseUp={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
            aria-label={`Adicionar ${product.name}`}
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── UnitPickerModal ──────────────────────────────────────────────────────────
// Abre antes de adicionar produto por unidade ao carrinho — igual ao ZeloPDV:
// o cliente digita a quantidade e confirma, sem passar pelo carrinho com qty=1.

function UnitPickerModal({
  product,
  currentQty,
  onClose,
  onConfirm,
}: {
  product: ZeloMenuCatalogProduct;
  currentQty: number;
  onClose: () => void;
  onConfirm: (qty: number) => void;
}) {
  const [draft, setDraft] = useState(currentQty > 0 ? String(currentQty) : '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  function confirm() {
    const n = parseInt(draft, 10);
    if (!isNaN(n) && n > 0) onConfirm(n);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50">
      <div className="w-full max-w-2xl rounded-t-3xl bg-[var(--color-surface)] shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-line)] px-5 py-4">
          <div>
            <h3 className="text-[17px] font-bold text-[var(--color-ink)]">{product.name}</h3>
            <p className="mt-0.5 text-[13px] text-[var(--color-ink-muted)]">Quantas unidades?</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-canvas)]">
            <X className="h-4 w-4 text-[var(--color-ink-soft)]" strokeWidth={2} />
          </button>
        </div>
        <div className="px-5 py-6" style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>
          <div className="mb-5 flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => setDraft((v) => String(Math.max(1, (parseInt(v, 10) || 0) - 1)))}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--color-line)]"
              aria-label="Diminuir"
            >
              <Minus className="h-4 w-4" strokeWidth={2.5} />
            </button>
            <input
              ref={inputRef}
              type="number"
              inputMode="numeric"
              min={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => { if (e.key === 'Enter') confirm(); }}
              className="h-14 w-24 rounded-xl border border-[var(--color-line)] bg-[var(--color-canvas)] text-center text-[22px] font-bold tabular-nums outline-none focus:border-[var(--color-brand)]"
              style={{ transition: 'border-color 0.15s' }}
              aria-label="Quantidade"
            />
            <button
              type="button"
              onClick={() => setDraft((v) => String((parseInt(v, 10) || 0) + 1))}
              className="flex h-11 w-11 items-center justify-center rounded-full text-white"
              style={{ background: 'var(--color-brand)' }}
              aria-label="Aumentar"
            >
              <Plus className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[14px] font-bold text-[var(--color-ink)]">
              {!isNaN(parseInt(draft, 10)) && parseInt(draft, 10) > 0
                ? toBRL(product.basePrice * parseInt(draft, 10))
                : '—'}
            </p>
            <button
              type="button"
              onClick={confirm}
              disabled={isNaN(parseInt(draft, 10)) || parseInt(draft, 10) < 1}
              className="inline-flex h-11 items-center gap-2 rounded-xl px-6 text-[14px] font-bold text-white disabled:opacity-40"
              style={{ background: 'var(--color-brand)' }}
            >
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              {currentQty > 0 ? 'Atualizar' : 'Adicionar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ModifierModal ────────────────────────────────────────────────────────────

function ModifierModal({
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
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const selectedOptions = Object.entries(selections)
    .map(([groupId, optionIds]) => ({ groupId, optionIds }))
    .filter((sel) => sel.optionIds.length > 0);
  const resolution = resolveModifierSelections(product.modifierGroups, selectedOptions);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50">
      <div className="w-full max-w-2xl rounded-t-3xl bg-[var(--color-surface)] shadow-2xl" style={{ maxHeight: '92vh' }}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-line)] px-5 py-4">
          <div>
            <h3 className="text-[17px] font-bold text-[var(--color-ink)]">{product.name}</h3>
            <p className="mt-0.5 text-[13px] text-[var(--color-ink-muted)]">Escolha as opções antes de adicionar</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-canvas)]"
          >
            <X className="h-4 w-4 text-[var(--color-ink-soft)]" strokeWidth={2} />
          </button>
        </div>

        {/* Options */}
        <div className="space-y-4 overflow-y-auto px-5 py-4" style={{ maxHeight: 'calc(92vh - 160px)' }}>
          {product.modifierGroups.map((group) => {
            const selectedIds = selections[group.id] ?? [];
            return (
              <section key={group.id}>
                <div className="mb-2.5">
                  <p className="text-[14px] font-bold text-[var(--color-ink)]">{group.name}</p>
                  <p className="text-[12px] text-[var(--color-ink-muted)]">
                    {group.minSelections > 0
                      ? `Obrigatório · mínimo ${group.minSelections}`
                      : 'Opcional'}
                    {group.maxSelections != null ? ` · máximo ${group.maxSelections}` : ''}
                  </p>
                </div>
                <div className="space-y-2">
                  {group.options.filter((o) => o.active).map((option) => {
                    const checked = selectedIds.includes(option.id);
                    return (
                      <label
                        key={option.id}
                        className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-4 py-3"
                        style={{
                          borderColor: checked ? 'var(--color-brand)' : 'var(--color-line)',
                          background: checked ? 'var(--color-brand-soft)' : 'var(--color-surface)',
                          transition: 'border-color 0.15s, background 0.15s',
                        }}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type={group.maxSelections === 1 ? 'radio' : 'checkbox'}
                            name={group.id}
                            checked={checked}
                            onChange={() => onToggle(group.id, option.id)}
                            className="h-4 w-4 accent-[var(--color-brand)]"
                          />
                          <span className="text-[14px] text-[var(--color-ink)]">{option.name}</span>
                        </div>
                        <span className="text-[13px] font-semibold text-[var(--color-ink-soft)]">
                          {option.priceDelta > 0 ? `+ ${toBRL(option.priceDelta)}` : 'incluso'}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </section>
            );
          })}

          {resolution.ok === false ? (
            <div className="rounded-xl border border-[var(--color-alert)] bg-[var(--color-alert-soft)] px-4 py-3 text-[13px] text-[var(--color-alert)]">
              {resolution.message}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-[var(--color-line)] px-5 py-4" style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
          <p className="text-[14px] font-bold text-[var(--color-ink)]">
            {resolution.ok ? toBRL(product.basePrice + resolution.deltaTotal) : '—'}
          </p>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!resolution.ok}
            className="inline-flex h-11 items-center gap-2 rounded-xl px-6 text-[14px] font-bold text-white disabled:opacity-40"
            style={{ background: 'var(--color-brand)' }}
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            Adicionar
          </button>
        </div>
      </div>
    </div>
  );
}
