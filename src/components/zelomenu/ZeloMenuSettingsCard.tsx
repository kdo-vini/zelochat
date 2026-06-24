import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, GripVertical, Loader2, Search, Sparkles, Star, Store, X } from 'lucide-react';
import { Reorder } from 'motion/react';
import { generateZeloMenuWelcome, getZeloMenuSettings, updateZeloMenuSettings, type ZeloMenuStoreSettings } from '../../services/waApi';
import { SectionCard } from '../shared/SectionCard';

const MAX_WELCOME = 400;

export function ZeloMenuSettingsCard({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [settings, setSettings] = useState<ZeloMenuStoreSettings | null>(null);
  // local draft state
  const [welcomeText, setWelcomeText] = useState('');
  const [featuredEnabled, setFeaturedEnabled] = useState(false);
  const [featuredIds, setFeaturedIds] = useState<number[]>([]);
  const [categoryOrder, setCategoryOrder] = useState<string[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const s = await getZeloMenuSettings(token);
        if (!active) return;
        setSettings(s);
        setWelcomeText(s.welcomeText ?? '');
        setFeaturedEnabled(s.featuredEnabled);
        setFeaturedIds(s.featuredProductIds);
        // Reconcilia a ordem salva com o catálogo atual: descarta categorias que
        // não existem mais (renomeadas/excluídas no PDV) e anexa as novas no fim,
        // pra lista de arrastar sempre refletir o cardápio de verdade.
        {
          const saved = s.categoryOrder.filter((c) => s.availableCategories.includes(c));
          const missing = s.availableCategories.filter((c) => !saved.includes(c));
          setCategoryOrder([...saved, ...missing]);
        }
      } catch {
        // silencioso — card mostra spinner e some
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [token]);

  // Close product picker when clicking outside
  useEffect(() => {
    if (!productPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setProductPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [productPickerOpen]);

  function toggleProduct(id: number) {
    setFeaturedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function generateWelcome() {
    if (!settings) return;
    try {
      setGenerating(true);
      setError(null);
      const text = await generateZeloMenuWelcome(token, {
        companyName: settings.companyName,
        companySpecialty: settings.companySpecialty,
        categories: settings.availableCategories,
      });
      setWelcomeText(text.slice(0, MAX_WELCOME));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não consegui gerar o texto. Tente de novo.');
    } finally {
      setGenerating(false);
    }
  }

  async function save() {
    try {
      setSaving(true);
      setError(null);
      await updateZeloMenuSettings(token, {
        welcomeText: welcomeText.trim() || null,
        featuredEnabled,
        featuredProductIds: featuredIds,
        categoryOrder,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não consegui salvar. Tente de novo.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;
  if (!settings) return null;

  const filteredProducts = productSearch.trim()
    ? settings.availableProducts.filter((p) =>
        p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
        p.categoryName.toLowerCase().includes(productSearch.toLowerCase()),
      )
    : settings.availableProducts;

  return (
    <SectionCard icon={Store} title="Cardápio digital">
      <div className="space-y-6">

        {/* ── Welcome text ── */}
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">Texto de boas-vindas</p>
            <button
              type="button"
              onClick={() => void generateWelcome()}
              disabled={generating}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-semibold text-[var(--color-brand-deep)] hover:bg-[var(--color-brand-soft)] disabled:opacity-50"
              style={{ transition: 'background 0.15s' }}
            >
              {generating
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                : <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />}
              {generating ? 'Gerando…' : 'Gerar com IA'}
            </button>
          </div>
          <textarea
            value={welcomeText}
            onChange={(e) => setWelcomeText(e.target.value.slice(0, MAX_WELCOME))}
            placeholder="Uma frase de boas-vindas para seus clientes…"
            rows={3}
            className="w-full resize-none rounded-xl border border-[var(--color-line)] bg-[var(--color-canvas)] px-4 py-3 text-[13px] leading-relaxed text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-muted)] focus:border-[var(--color-brand)]"
            style={{ transition: 'border-color 0.15s' }}
          />
          <p className="mt-1 text-right text-[11px] text-[var(--color-ink-muted)]">
            {welcomeText.length}/{MAX_WELCOME}
          </p>
        </div>

        {/* ── Featured products ── */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-[13px] font-semibold text-[var(--color-ink)]">Seção de Destaques</p>
              <p className="text-[12px] text-[var(--color-ink-muted)]">Aparece no topo do cardápio, antes das categorias</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={featuredEnabled}
              onClick={() => setFeaturedEnabled((v) => !v)}
              className="relative h-6 w-11 rounded-full transition-colors"
              style={{ background: featuredEnabled ? 'var(--color-brand)' : 'var(--color-line-strong)' }}
            >
              <span
                className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
                style={{ transform: featuredEnabled ? 'translateX(20px)' : 'translateX(2px)' }}
              />
            </button>
          </div>

          {featuredEnabled ? (
            <div className="space-y-2">
              {/* Product picker trigger */}
              <div className="relative" ref={pickerRef}>
                <button
                  type="button"
                  onClick={() => setProductPickerOpen((v) => !v)}
                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-canvas)] px-4 py-3 text-left"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Star className="h-4 w-4 shrink-0 text-[var(--color-brand-deep)]" strokeWidth={1.8} />
                    <span className="truncate text-[13px] text-[var(--color-ink)]">
                      {featuredIds.length === 0
                        ? 'Selecionar produtos…'
                        : `${featuredIds.length} produto${featuredIds.length !== 1 ? 's' : ''} selecionado${featuredIds.length !== 1 ? 's' : ''}`}
                    </span>
                  </div>
                  <ChevronDown
                    className="h-4 w-4 shrink-0 text-[var(--color-ink-muted)] transition-transform"
                    style={{ transform: productPickerOpen ? 'rotate(180deg)' : '' }}
                    strokeWidth={2}
                  />
                </button>

                {productPickerOpen ? (
                  <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-lg">
                    {/* Search */}
                    <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-3 py-2">
                      <Search className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-muted)]" strokeWidth={2} />
                      <input
                        autoFocus
                        value={productSearch}
                        onChange={(e) => setProductSearch(e.target.value)}
                        placeholder="Buscar produto…"
                        className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--color-ink-muted)]"
                      />
                      {productSearch ? (
                        <button type="button" onClick={() => setProductSearch('')}>
                          <X className="h-3.5 w-3.5 text-[var(--color-ink-muted)]" strokeWidth={2} />
                        </button>
                      ) : null}
                    </div>
                    {/* List */}
                    <div className="max-h-52 overflow-y-auto">
                      {filteredProducts.length === 0 ? (
                        <p className="px-4 py-3 text-[13px] text-[var(--color-ink-muted)]">Nenhum produto encontrado</p>
                      ) : (
                        filteredProducts.map((p) => {
                          const checked = featuredIds.includes(p.id);
                          return (
                            <label
                              key={p.id}
                              className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-[var(--color-canvas)]"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleProduct(p.id)}
                                className="h-4 w-4 accent-[var(--color-brand)]"
                              />
                              <span className="min-w-0 flex-1 text-[13px] text-[var(--color-ink)]">{p.name}</span>
                              <span className="shrink-0 text-[11px] text-[var(--color-ink-muted)]">{p.categoryName}</span>
                            </label>
                          );
                        })
                      )}
                    </div>
                    <div className="border-t border-[var(--color-line)] px-4 py-2">
                      <button
                        type="button"
                        onClick={() => setProductPickerOpen(false)}
                        className="text-[12px] font-medium text-[var(--color-brand-deep)]"
                      >
                        Fechar
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Selected pills */}
              {featuredIds.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {featuredIds.map((id) => {
                    const name = settings.availableProducts.find((p) => p.id === id)?.name;
                    if (!name) return null;
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 rounded-full bg-[var(--color-brand-soft)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-brand-deep)]"
                      >
                        {name}
                        <button
                          type="button"
                          onClick={() => toggleProduct(id)}
                          aria-label={`Remover ${name}`}
                        >
                          <X className="h-3 w-3" strokeWidth={2.5} />
                        </button>
                      </span>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* ── Category order ── */}
        {categoryOrder.length > 1 ? (
          <div>
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">Ordem das categorias</p>
            <p className="mb-3 text-[12px] text-[var(--color-ink-muted)]">Arraste para reorganizar como as categorias aparecem no cardápio.</p>
            <Reorder.Group
              axis="y"
              values={categoryOrder}
              onReorder={setCategoryOrder}
              className="space-y-2"
            >
              {categoryOrder.map((cat) => (
                <Reorder.Item
                  key={cat}
                  value={cat}
                  className="flex cursor-grab items-center gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 active:cursor-grabbing"
                  whileDrag={{ scale: 1.02, boxShadow: '0 4px 16px rgba(0,0,0,0.10)' }}
                >
                  <GripVertical className="h-4 w-4 shrink-0 text-[var(--color-ink-muted)]" strokeWidth={1.8} />
                  <span className="text-[13px] font-medium text-[var(--color-ink)]">{cat}</span>
                </Reorder.Item>
              ))}
            </Reorder.Group>
          </div>
        ) : null}

        {/* ── Save ── */}
        {error ? (
          <p className="text-[12.5px] text-[var(--color-alert)]">{error}</p>
        ) : null}

        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[14px] font-semibold text-white disabled:opacity-50"
          style={{ background: 'var(--color-brand)' }}
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
          ) : saved ? (
            <Check className="h-4 w-4" strokeWidth={2.5} />
          ) : null}
          {saving ? 'Salvando…' : saved ? 'Salvo!' : 'Salvar configurações'}
        </button>
      </div>
    </SectionCard>
  );
}
