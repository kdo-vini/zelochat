import { memo } from 'react';
import type { CustomerSummary } from '../../services/customerApi';

interface Props {
  customer: CustomerSummary;
  selected: boolean;
  onSelect: (customer: CustomerSummary) => void;
}

const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });

function formatLastOrder(value: string | null): string {
  if (!value) return 'Nunca comprou';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Nunca comprou';
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  const relative = days <= 0 ? 'hoje' : days === 1 ? 'ontem' : `há ${days} dias`;
  return `Última compra ${dateFormatter.format(date)} · ${relative}`;
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
          <p className="flex items-center gap-2 truncate text-[14px] font-semibold text-[var(--color-ink)]">
            <span className="truncate">{customer.name || 'Sem nome'}</span>
            {customer.orderCount === 0 && <span className="shrink-0 rounded-full bg-[var(--color-surface-muted)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-ink-muted)]">Sem compra</span>}
          </p>
          <p className="mt-0.5 truncate text-[12px] text-[var(--color-ink-muted)]">{phone ? `WhatsApp ${phone}` : 'Sem WhatsApp'}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[13px] font-semibold text-[var(--color-ink)]">{customer.orderCount} pedido{customer.orderCount === 1 ? '' : 's'}</p>
          <p className="mt-0.5 text-[11px] text-[var(--color-ink-faint)]">{currencyFormatter.format(customer.totalValue)}</p>
        </div>
      </div>
      <div className="mt-1 text-[11px] text-[var(--color-ink-faint)]">{formatLastOrder(customer.lastOrderAt)}</div>
    </button>
  );
});
