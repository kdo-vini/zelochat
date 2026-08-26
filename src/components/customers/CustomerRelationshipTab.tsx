import type { CustomerDetail } from '../../services/customerApi';

export function CustomerRelationshipTab({ customer }: { customer: CustomerDetail }) {
  const communicationState = customer.relationship.blocked
    ? `Bloqueado${customer.relationship.blockReason ? `: ${customer.relationship.blockReason}` : ''}`
    : customer.relationship.optedOut ? 'Opt-out ativo: não recebe campanhas ou automações' : 'Comunicação permitida';
  return <div className="space-y-3 p-4"><div className="rounded-xl border border-[var(--color-line)] p-3"><p className="text-[13px] font-medium text-[var(--color-ink)]">WhatsApp</p><p className="mt-1 text-[12px] text-[var(--color-ink-muted)]">{communicationState}</p></div><div className="grid grid-cols-2 gap-3 text-[13px]"><div className="rounded-xl bg-[var(--color-surface-muted)] p-3"><strong className="block text-[16px] text-[var(--color-ink)]">{customer.relationship.campaigns}</strong><span className="text-[11px] text-[var(--color-ink-faint)]">Campanhas recebidas</span></div><div className="rounded-xl bg-[var(--color-surface-muted)] p-3"><strong className="block text-[16px] text-[var(--color-ink)]">{customer.relationship.automations}</strong><span className="text-[11px] text-[var(--color-ink-faint)]">Automações</span></div></div></div>;
}
