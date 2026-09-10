import { useEffect, useState } from 'react';
import { CUSTOMER_SEGMENT_CHIPS, DEFAULT_CUSTOMER_SEGMENT, DEFAULT_CUSTOMER_SORT, segmentsEqual } from '../../domain/customerSegment.js';
import { DEFAULT_CUSTOMER_FILTERS, fetchSegmentCounts, type CustomerFilters, type CustomerSegmentCounts } from '../../services/customerApi.js';

interface Props {
  area: string;
  token: string | null;
  filters: CustomerFilters;
  onChange: (filters: CustomerFilters) => void;
  reloadKey?: number;
}

export function CustomerSegmentChips({ area, token, filters, onChange, reloadKey = 0 }: Props) {
  const [counts, setCounts] = useState<CustomerSegmentCounts | null>(null);

  useEffect(() => {
    if (area !== 'customers') return;
    let cancelled = false;
    setCounts(null);
    if (!token) return;
    void fetchSegmentCounts(token).then((next) => {
      if (!cancelled) setCounts(next);
    }).catch(() => {
      if (!cancelled) setCounts(null);
    });
    return () => { cancelled = true; };
  }, [area, reloadKey, token]);

  if (area !== 'customers') return null;

  const segment = filters.segment ?? DEFAULT_CUSTOMER_SEGMENT;
  const sort = filters.sort ?? DEFAULT_CUSTOMER_SORT;
  return (
    <div className="flex shrink-0 gap-2 overflow-x-auto border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2 md:px-6" aria-label="Segmentos de clientes">
      {CUSTOMER_SEGMENT_CHIPS.map((preset) => {
        const active = sort === preset.sort && segmentsEqual(segment, preset.segment);
        const count = counts?.[preset.id as keyof CustomerSegmentCounts];
        return (
          <button
            key={preset.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active
              ? { ...DEFAULT_CUSTOMER_FILTERS, segment: { ...DEFAULT_CUSTOMER_FILTERS.segment } }
              : { ...filters, segment: { ...preset.segment }, sort: preset.sort })}
            className={`inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-full border px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] ${active ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]' : 'border-[var(--color-line)] text-[var(--color-ink)] hover:bg-[var(--color-surface-muted)]'}`}
          >
            <span>{preset.label}</span>
            {count !== undefined && <span className="text-[var(--color-ink-muted)]">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
