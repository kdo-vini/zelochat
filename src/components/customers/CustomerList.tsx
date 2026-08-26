import type { CustomerSummary } from '../../services/customerApi';
import { CustomerListRow } from './CustomerListRow';

interface Props {
  customers: CustomerSummary[];
  selectedId: string | null;
  onSelect: (customer: CustomerSummary) => void;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
}

export function CustomerList({ customers, selectedId, onSelect, loading, loadingMore, hasMore, onLoadMore }: Props) {
  if (loading) return <div role="status" className="flex flex-1 items-center justify-center p-8 text-[13px] text-[var(--color-ink-muted)]">Carregando clientes…</div>;
  if (customers.length === 0) return <div className="flex flex-1 items-center justify-center p-8 text-center text-[13px] text-[var(--color-ink-muted)]">Nenhum cliente encontrado.<br />Tente ajustar a busca ou os filtros.</div>;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" aria-label="Lista de clientes">
      {customers.map((customer) => <CustomerListRow key={customer.id} customer={customer} selected={selectedId === customer.id} onSelect={onSelect} />)}
      {hasMore && <button type="button" onClick={onLoadMore} disabled={loadingMore} className="m-3 min-h-[44px] w-[calc(100%-1.5rem)] rounded-lg border border-[var(--color-line)] text-[13px] text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)]">{loadingMore ? 'Carregando…' : 'Carregar mais'}</button>}
    </div>
  );
}
