import { useEffect, useRef } from 'react';
import type { CustomerFilters } from '../../services/customerApi';

interface Props {
  filters: CustomerFilters;
  onChange: (filters: CustomerFilters) => void;
  onClose: () => void;
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
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="customer-filters-title" className="fixed inset-x-0 bottom-16 z-20 max-h-[calc(100dvh-4rem)] w-full overflow-y-auto rounded-t-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4 shadow-lg md:absolute md:bottom-auto md:left-auto md:right-4 md:top-14 md:w-[320px] md:rounded-xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 id="customer-filters-title" className="text-[15px] font-semibold text-[var(--color-ink)]">Filtros</h2>
        <button ref={closeRef} type="button" onClick={onClose} className="min-h-[44px] rounded-lg px-3 text-[13px] text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)]">Fechar</button>
      </div>
      <label className="mb-3 block text-[12px] font-medium text-[var(--color-ink-muted)]">
        Estado
        <select
          value={filters.status ?? 'all'}
          onChange={(event) => onChange({ ...filters, status: event.target.value as CustomerFilters['status'] })}
          className="mt-1 min-h-[44px] w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-[14px] text-[var(--color-ink)]"
        >
          <option value="all">Todos</option>
          <option value="active">Ativos</option>
          <option value="inactive">Inativos</option>
          <option value="never">Sem histórico</option>
        </select>
      </label>
      <label className="mb-3 flex min-h-[44px] items-center gap-3 text-[13px] text-[var(--color-ink)]">
        <input type="checkbox" checked={filters.hasWhatsApp === true} onChange={(event) => onChange({ ...filters, hasWhatsApp: event.target.checked ? true : undefined })} className="h-4 w-4" />
        Tem WhatsApp
      </label>
      <label className="mb-3 flex min-h-[44px] items-center gap-3 text-[13px] text-[var(--color-ink)]">
        <input type="checkbox" checked={filters.vip === true} onChange={(event) => onChange({ ...filters, vip: event.target.checked ? true : undefined })} className="h-4 w-4" />
        VIP
      </label>
      <label className="mb-3 flex min-h-[44px] items-center gap-3 text-[13px] text-[var(--color-ink)]">
        <input type="checkbox" checked={filters.birthdayOnly === true} onChange={(event) => onChange({ ...filters, birthdayOnly: event.target.checked ? true : undefined })} className="h-4 w-4" />
        Aniversariantes
      </label>
      <button type="button" onClick={() => onChange({})} className="min-h-[44px] rounded-lg px-3 text-[13px] text-[var(--color-brand-deep)] hover:bg-[var(--color-brand-soft)]">Limpar filtros</button>
    </div>
  );
}
