import { useEffect, useRef } from 'react';
import { CUSTOMER_BUYER_SCOPE_LABELS, CUSTOMER_SEGMENT_PRESETS, DEFAULT_CUSTOMER_SEGMENT, DEFAULT_CUSTOMER_SORT, type CustomerBuyerScope, type CustomerSegment } from '../../domain/customerSegment';
import { DEFAULT_CUSTOMER_FILTERS, type CustomerFilters } from '../../services/customerApi';

interface Props {
  filters: CustomerFilters;
  onChange: (filters: CustomerFilters) => void;
  onClose: () => void;
}

type LastPurchaseOption = 'any' | 'last7' | 'last30' | 'gone30' | 'gone90';

function lastPurchaseOption(segment: CustomerSegment): LastPurchaseOption {
  if (segment.minDaysSinceLastOrder === 90) return 'gone90';
  if (segment.minDaysSinceLastOrder === 30) return 'gone30';
  if (segment.maxDaysSinceLastOrder === 30) return 'last30';
  if (segment.maxDaysSinceLastOrder === 7) return 'last7';
  return 'any';
}

function applyLastPurchaseOption(segment: CustomerSegment, option: LastPurchaseOption): CustomerSegment {
  const { minDaysSinceLastOrder: _min, maxDaysSinceLastOrder: _max, ...rest } = segment;
  switch (option) {
    case 'last7': return { ...rest, maxDaysSinceLastOrder: 7 };
    case 'last30': return { ...rest, maxDaysSinceLastOrder: 30 };
    case 'gone30': return { ...rest, minDaysSinceLastOrder: 30 };
    case 'gone90': return { ...rest, minDaysSinceLastOrder: 90 };
    default: return rest;
  }
}

function segmentsEqual(a: CustomerSegment, b: CustomerSegment): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof CustomerSegment>;
  for (const key of keys) {
    const left = a[key];
    const right = b[key];
    if (Array.isArray(left) || Array.isArray(right)) {
      if (JSON.stringify([...(left as string[] ?? [])].sort()) !== JSON.stringify([...(right as string[] ?? [])].sort())) return false;
      continue;
    }
    if (left !== right) return false;
  }
  return true;
}

export function CustomerFiltersPanel({ filters, onChange, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKeyDown);
    return () => { document.removeEventListener('keydown', handleKeyDown); returnFocusRef.current?.focus(); };
  }, [onClose]);

  const segment: CustomerSegment = filters.segment ?? { ...DEFAULT_CUSTOMER_SEGMENT };
  const sort = filters.sort ?? DEFAULT_CUSTOMER_SORT;
  const updateSegment = (next: CustomerSegment) => onChange({ ...filters, segment: next });

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="customer-filters-title" className="fixed inset-x-0 bottom-16 z-20 max-h-[calc(100dvh-4rem)] w-full overflow-y-auto rounded-t-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4 shadow-lg md:absolute md:bottom-auto md:left-auto md:right-4 md:top-14 md:w-[320px] md:rounded-xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 id="customer-filters-title" className="text-[15px] font-semibold text-[var(--color-ink)]">Filtros</h2>
        <button ref={closeRef} type="button" onClick={onClose} className="min-h-[44px] rounded-lg px-3 text-[13px] text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)]">Fechar</button>
      </div>

      <h3 className="mb-2 text-[12px] font-medium text-[var(--color-ink-muted)]">Grupos prontos</h3>
      <div className="mb-5 flex flex-col gap-2">
        {CUSTOMER_SEGMENT_PRESETS.map((preset) => {
          const active = sort === preset.sort && segmentsEqual(segment, preset.segment);
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={active}
              onClick={() => { onChange({ ...filters, segment: { ...preset.segment }, sort: preset.sort }); onClose(); }}
              className={`min-h-[44px] rounded-lg border px-3 py-2 text-left transition-colors ${active ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)]' : 'border-[var(--color-line)] hover:bg-[var(--color-surface-muted)]'}`}
            >
              <span className="block text-[13px] font-semibold text-[var(--color-ink)]">{preset.label}</span>
              <span className="block text-[12px] text-[var(--color-ink-muted)]">{preset.description}</span>
            </button>
          );
        })}
      </div>

      <h3 className="mb-2 text-[12px] font-medium text-[var(--color-ink-muted)]">Ajustar</h3>
      <label className="mb-3 block text-[12px] font-medium text-[var(--color-ink-muted)]">
        Mostrar
        <select
          value={segment.buyers ?? 'buyers'}
          onChange={(event) => updateSegment({ ...segment, buyers: event.target.value as CustomerBuyerScope })}
          className="mt-1 min-h-[44px] w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-[14px] text-[var(--color-ink)]"
        >
          {(['buyers', 'contacts', 'all'] as const).map((scope) => <option key={scope} value={scope}>{CUSTOMER_BUYER_SCOPE_LABELS[scope]}</option>)}
        </select>
      </label>
      <label className="mb-3 block text-[12px] font-medium text-[var(--color-ink-muted)]">
        Mínimo de pedidos
        <input
          type="number"
          min={0}
          value={segment.minOrders ?? ''}
          onChange={(event) => {
            const raw = event.target.value;
            const { minOrders: _minOrders, ...rest } = segment;
            if (raw === '') { updateSegment(rest); return; }
            const parsed = Math.trunc(Number(raw));
            if (!Number.isFinite(parsed)) return;
            updateSegment({ ...rest, minOrders: Math.max(0, parsed) });
          }}
          placeholder="Qualquer quantidade"
          className="mt-1 min-h-[44px] w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-[14px] text-[var(--color-ink)]"
        />
      </label>
      <label className="mb-3 block text-[12px] font-medium text-[var(--color-ink-muted)]">
        Última compra
        <select
          value={lastPurchaseOption(segment)}
          onChange={(event) => updateSegment(applyLastPurchaseOption(segment, event.target.value as LastPurchaseOption))}
          className="mt-1 min-h-[44px] w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-[14px] text-[var(--color-ink)]"
        >
          <option value="any">Qualquer época</option>
          <option value="last7">Nos últimos 7 dias</option>
          <option value="last30">Nos últimos 30 dias</option>
          <option value="gone30">Sem comprar há mais de 30 dias</option>
          <option value="gone90">Sem comprar há mais de 90 dias</option>
        </select>
      </label>
      <label className="mb-3 flex min-h-[44px] items-center gap-3 text-[13px] text-[var(--color-ink)]">
        <input type="checkbox" checked={segment.hasWhatsApp === true} onChange={(event) => {
          const { hasWhatsApp: _hasWhatsApp, ...rest } = segment;
          updateSegment(event.target.checked ? { ...rest, hasWhatsApp: true } : rest);
        }} className="h-4 w-4" />
        Tem WhatsApp
      </label>
      <button type="button" onClick={() => onChange({ ...DEFAULT_CUSTOMER_FILTERS })} className="min-h-[44px] rounded-lg px-3 text-[13px] text-[var(--color-brand-deep)] hover:bg-[var(--color-brand-soft)]">Limpar filtros</button>
    </div>
  );
}
