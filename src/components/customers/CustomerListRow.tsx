import { memo } from 'react';
import type { CustomerSummary } from '../../services/customerApi';

interface Props {
  customer: CustomerSummary;
  selected: boolean;
  onSelect: (customer: CustomerSummary) => void;
}

function formatDate(value: string | null): string {
  if (!value) return 'Sem atividade';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Sem atividade' : date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

export const CustomerListRow = memo(function CustomerListRow({ customer, selected, onSelect }: Props) {
  const phone = customer.whatsapp || customer.phone;
  return (
    <button
      type="button"
      onClick={() => onSelect(customer)}
      aria-pressed={selected}
      className={`w-full min-h-[64px] border-b border-[var(--color-line)] px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand)] ${selected ? 'bg-[var(--color-brand-soft)]' : 'hover:bg-[var(--color-surface-muted)]'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-[var(--color-ink)]">{customer.name || 'Sem nome'}</p>
          <p className="mt-0.5 truncate text-[12px] text-[var(--color-ink-muted)]">{phone ? `WhatsApp ${phone}` : 'Sem WhatsApp'}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[12px] font-medium text-[var(--color-ink)]">R$ {customer.totalValue.toFixed(2).replace('.', ',')}</p>
          <p className="mt-0.5 text-[11px] text-[var(--color-ink-faint)]">{customer.orderCount} pedido{customer.orderCount === 1 ? '' : 's'}</p>
        </div>
      </div>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-[var(--color-ink-faint)]">
        <span>{formatDate(customer.lastActivityAt)}</span>
        <span aria-hidden="true">·</span>
        <span>{customer.activityState === 'active' ? 'Ativo' : customer.activityState === 'inactive' ? 'Inativo' : 'Sem histórico'}</span>
      </div>
    </button>
  );
});
