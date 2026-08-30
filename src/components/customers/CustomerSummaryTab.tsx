import { useState } from 'react';
import type {
  CustomerDetail,
  CustomerOrderingContextSnapshot,
  CustomerOrderingOverridesPatch,
} from '../../services/customerApi';

interface CustomerSummaryTabProps {
  customer: CustomerDetail;
  canManage?: boolean;
  onUpdateOrderingOverrides?: (patch: CustomerOrderingOverridesPatch) => Promise<void>;
}

const originLabels = {
  fixed: 'Fixado',
  last_order: 'Último pedido',
  derived: 'Calculado',
  none: null,
} as const;

type OverrideKey = keyof CustomerOrderingOverridesPatch;

function OriginBadge({ source }: { source: keyof typeof originLabels }) {
  const label = originLabels[source];
  return label ? <span className="rounded-full bg-[var(--color-surface-muted)] px-2 py-1 text-[11px] font-medium text-[var(--color-ink-muted)]">{label}</span> : null;
}

function HabitCard({
  label,
  value,
  source,
  overrideKey,
  overrideValue,
  actionLabel,
  canManage,
  saving,
  onChange,
}: {
  label: string;
  value: string;
  source: keyof typeof originLabels;
  overrideKey: OverrideKey;
  overrideValue: Exclude<CustomerOrderingOverridesPatch[OverrideKey], null | undefined>;
  actionLabel: string;
  canManage: boolean;
  saving: boolean;
  onChange: (key: OverrideKey, value: CustomerOrderingOverridesPatch[OverrideKey]) => Promise<void>;
}) {
  return <div className="rounded-xl border border-[var(--color-line)] p-3">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-[12px] text-[var(--color-ink-faint)]">{label}</p>
        <p className="mt-1 break-words text-[13px] font-medium text-[var(--color-ink)]">{value}</p>
      </div>
      <OriginBadge source={source} />
    </div>
    {canManage && value !== 'Não identificado' && <button
      type="button"
      disabled={saving}
      aria-label={source === 'fixed' ? `Remover padrão de ${actionLabel}` : `Fixar ${actionLabel} como padrão`}
      onClick={() => void onChange(overrideKey, source === 'fixed' ? null : overrideValue)}
      className="mt-3 min-h-[44px] rounded-lg px-2 text-left text-[12px] font-medium text-[var(--color-brand-deep)] disabled:opacity-50"
    >{source === 'fixed' ? 'Remover padrão' : 'Fixar como padrão'}</button>}
  </div>;
}

function OrderingHabits({
  context,
  canManage,
  onUpdate,
}: {
  context: CustomerOrderingContextSnapshot;
  canManage: boolean;
  onUpdate?: (patch: CustomerOrderingOverridesPatch) => Promise<void>;
}) {
  const [saving, setSaving] = useState<OverrideKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const update = async (key: OverrideKey, value: CustomerOrderingOverridesPatch[OverrideKey]) => {
    if (!onUpdate) return;
    setSaving(key);
    setError(null);
    try {
      await onUpdate({ [key]: value });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar este padrão.');
    } finally {
      setSaving(null);
    }
  };
  const typeValue = context.fulfillmentType.value === 'delivery'
    ? 'Entrega'
    : context.fulfillmentType.value === 'pickup' ? 'Retirada' : 'Não identificado';
  const address = context.deliveryAddress.value;
  const addressOverride = address ? {
    address: address.address,
    neighborhood: address.neighborhood,
    complement: address.complement,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    reference: address.reference,
  } : undefined;
  return <section aria-labelledby="customer-ordering-habits-title" className="space-y-3">
    <div>
      <h3 id="customer-ordering-habits-title" className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Hábitos de pedido</h3>
      <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-ink-muted)]">Use estes dados como apoio no atendimento. Itens frequentes nunca são adicionados ao pedido automaticamente.</p>
    </div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <HabitCard label="Tipo de atendimento" value={typeValue} source={context.fulfillmentType.source} overrideKey="fulfillmentType" overrideValue={context.fulfillmentType.value ?? 'delivery'} actionLabel="tipo de atendimento" canManage={canManage} saving={saving === 'fulfillmentType'} onChange={update} />
      <HabitCard label="Endereço de entrega" value={address?.display ?? 'Não identificado'} source={context.deliveryAddress.source} overrideKey="deliveryAddress" overrideValue={addressOverride ?? { address: '' }} actionLabel="endereço de entrega" canManage={canManage} saving={saving === 'deliveryAddress'} onChange={update} />
      <HabitCard label="Forma de pagamento" value={context.paymentMethod.value ?? 'Não identificado'} source={context.paymentMethod.source} overrideKey="paymentMethod" overrideValue={context.paymentMethod.value ?? ''} actionLabel="forma de pagamento" canManage={canManage} saving={saving === 'paymentMethod'} onChange={update} />
      <HabitCard label="Horário habitual" value={context.habitualTime.value?.label ?? 'Não identificado'} source={context.habitualTime.source} overrideKey="habitualTime" overrideValue={context.habitualTime.value?.label ?? ''} actionLabel="horário habitual" canManage={canManage} saving={saving === 'habitualTime'} onChange={update} />
    </div>
    <div className="rounded-xl border border-[var(--color-line)] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] text-[var(--color-ink-faint)]">Frequência</p>
        <OriginBadge source={context.medianRecurrenceDays.source} />
      </div>
      <p className="mt-1 text-[13px] font-medium text-[var(--color-ink)]">{context.medianRecurrenceDays.value == null ? 'Ainda sem histórico suficiente' : `Em média, a cada ${context.medianRecurrenceDays.value} dias`}</p>
    </div>
    <div className="rounded-xl border border-[var(--color-line)] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-[var(--color-ink)]">Itens frequentes</p>
        <OriginBadge source={context.frequentItems.source} />
      </div>
      {context.frequentItems.value.length
        ? <ul className="mt-2 space-y-2">{context.frequentItems.value.map((item) => <li key={item.productId} className="flex justify-between gap-3 text-[13px]"><span className="text-[var(--color-ink)]">{item.name}</span><span className="shrink-0 text-[var(--color-ink-muted)]">em {item.orderFrequency} pedidos</span></li>)}</ul>
        : <p className="mt-2 text-[13px] text-[var(--color-ink-muted)]">Ainda sem itens recorrentes.</p>}
    </div>
    {error && <p role="alert" className="text-[12px] text-[var(--color-alert)]">{error}</p>}
  </section>;
}

export function CustomerSummaryTab({ customer, canManage = false, onUpdateOrderingOverrides }: CustomerSummaryTabProps) {
  return <div className="space-y-4 p-4">
    <section><h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Dados confirmados</h3><dl className="grid grid-cols-2 gap-3 text-[13px]"><div><dt className="text-[var(--color-ink-faint)]">Nome</dt><dd className="font-medium text-[var(--color-ink)]">{customer.name || 'Sem nome'}</dd></div><div><dt className="text-[var(--color-ink-faint)]">WhatsApp</dt><dd className="font-medium text-[var(--color-ink)]">{customer.whatsapp || 'Sem WhatsApp'}</dd></div><div><dt className="text-[var(--color-ink-faint)]">Origem</dt><dd className="font-medium text-[var(--color-ink)]">{customer.origin || 'Não informado'}</dd></div><div><dt className="text-[var(--color-ink-faint)]">Pedidos</dt><dd className="font-medium text-[var(--color-ink)]">{customer.orderCount}</dd></div></dl></section>
    <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-muted)] p-3"><h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Resumo automático</h3><p className="text-[13px] leading-relaxed text-[var(--color-ink-muted)]">{customer.automaticSummary || 'Ainda não há resumo automático.'}</p></section>
    <OrderingHabits context={customer.orderingContext} canManage={canManage} onUpdate={onUpdateOrderingOverrides} />
    <section><h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Tags</h3><p className="text-[13px] text-[var(--color-ink)]">{customer.tags.length ? customer.tags.join(', ') : 'Nenhuma tag'}</p></section>
  </div>;
}
