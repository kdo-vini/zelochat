import { useEffect, useState } from 'react';
import { Filter, Plus, Search, UserRound } from 'lucide-react';
import { useCustomers } from '../../hooks/useCustomers';
import { countActiveCustomerFilters, createCustomer, DEFAULT_CUSTOMER_FILTERS, type CustomerFilters, type CustomerPatch, type CustomerSummary } from '../../services/customerApi';
import { CUSTOMER_SORT_KEYS, CUSTOMER_SORT_LABELS, describeCustomerSegment, isCustomerSortKey } from '../../domain/customerSegment';
import { CustomerFiltersPanel } from '../customers/CustomerFiltersPanel';
import { CustomerList } from '../customers/CustomerList';
import { CustomerDetail } from '../customers/CustomerDetail';
import { CustomerCreateDialog } from '../customers/CustomerCreateDialog';
import type { CustomerMessagePermission } from '../../domain/customerMessages';
import { CampaignsTab } from '../customers/CampaignsTab';
import { AutomationsTab } from '../customers/AutomationsTab';

interface Props { token: string | null; onOpenAtendimento?: (sessionId: string) => void; customerPermissions?: CustomerMessagePermission & { campaignsEnabled?: boolean; automationsEnabled?: boolean }; canManageCustomers?: boolean; }

export function CustomersView({ token, onOpenAtendimento, customerPermissions = { pessoasVisualizar: false, clientesComunicar: false }, canManageCustomers = false }: Props) {
  const [filters, setFilters] = useState<CustomerFilters>(DEFAULT_CUSTOMER_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selected, setSelected] = useState<CustomerSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const [area, setArea] = useState<'customers' | 'campaigns' | 'automations'>('customers');
  const { customers, loading, loadingMore, error, hasMore, total, refresh, loadMore } = useCustomers(token, filters);
  const activeFilterCount = countActiveCustomerFilters(filters);
  const campaignsEnabled = customerPermissions.campaignsEnabled === true;
  const automationsEnabled = customerPermissions.automationsEnabled === true;
  useEffect(() => { if (area === 'campaigns' && !campaignsEnabled) setArea('customers'); if (area === 'automations' && !automationsEnabled) setArea('customers'); }, [area, campaignsEnabled, automationsEnabled]);
  const sort = filters.sort ?? 'orders';
  const segmentDescription = filters.segment ? describeCustomerSegment(filters.segment) : '';
  const customerSubtitle = total == null ? null : `${total} cliente${total === 1 ? '' : 's'}${segmentDescription ? ` · ${segmentDescription}` : ''}`;
  const [lastKnownSubtitle, setLastKnownSubtitle] = useState<string | null>(null);
  useEffect(() => { if (customerSubtitle) setLastKnownSubtitle(customerSubtitle); }, [customerSubtitle]);
  const subtitle = area === 'campaigns' ? 'Segmentos e relacionamento'
    : area === 'automations' ? 'Jornadas de relacionamento'
    : customerSubtitle ?? lastKnownSubtitle ?? 'Cadastro e relacionamento';

  return (
    <section className="relative flex min-h-0 flex-1 flex-col bg-[var(--color-canvas)]" aria-label="Clientes">
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 md:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <UserRound className="h-5 w-5 shrink-0 text-[var(--color-brand)]" aria-hidden="true" />
          <div><h1 className="text-[18px] font-semibold text-[var(--color-ink)]">Clientes</h1><p className="text-[12px] text-[var(--color-ink-faint)]">{subtitle}</p></div>
        </div>
        <nav className="order-2 flex rounded-lg bg-[var(--color-surface-muted)] p-1" aria-label="Área de clientes">
          <button type="button" onClick={() => setArea('customers')} aria-current={area === 'customers' ? 'page' : undefined} className={`min-h-[44px] rounded-md px-3 text-[12px] ${area === 'customers' ? 'bg-[var(--color-surface)] font-semibold text-[var(--color-ink)] shadow-sm' : 'text-[var(--color-ink-muted)]'}`}>Clientes</button>
          {campaignsEnabled && <button type="button" onClick={() => setArea('campaigns')} aria-current={area === 'campaigns' ? 'page' : undefined} className={`min-h-[44px] rounded-md px-3 text-[12px] ${area === 'campaigns' ? 'bg-[var(--color-surface)] font-semibold text-[var(--color-ink)] shadow-sm' : 'text-[var(--color-ink-muted)]'}`}>Campanhas</button>}
          {automationsEnabled && <button type="button" onClick={() => setArea('automations')} aria-current={area === 'automations' ? 'page' : undefined} className={`min-h-[44px] rounded-md px-3 text-[12px] ${area === 'automations' ? 'bg-[var(--color-surface)] font-semibold text-[var(--color-ink)] shadow-sm' : 'text-[var(--color-ink-muted)]'}`}>Automações</button>}
        </nav>
        {area !== 'customers' ? null : <>
        <label className="order-3 flex min-h-[44px] w-full items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 md:order-none md:w-[240px]">
          <Search className="h-4 w-4 shrink-0 text-[var(--color-ink-faint)]" aria-hidden="true" />
          <span className="sr-only">Buscar clientes</span>
          <input value={filters.search ?? ''} onChange={(event) => setFilters((previous) => ({ ...previous, search: event.target.value }))} placeholder="Buscar clientes" className="min-w-0 flex-1 bg-transparent text-[14px] text-[var(--color-ink)] outline-none" />
        </label>
        <label className="order-3 flex min-h-[44px] items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-[13px] text-[var(--color-ink)] md:order-none">
          <span className="sr-only">Ordenar por</span>
          <select
            value={sort}
            onChange={(event) => {
              const next = event.target.value;
              if (isCustomerSortKey(next)) setFilters((previous) => ({ ...previous, sort: next }));
            }}
            className="bg-transparent text-[13px] text-[var(--color-ink)] outline-none"
          >
            {CUSTOMER_SORT_KEYS.map((key) => <option key={key} value={key}>{CUSTOMER_SORT_LABELS[key]}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => setFilterOpen((open) => !open)} aria-expanded={filterOpen} aria-haspopup="dialog" className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[var(--color-line)] px-3 text-[13px] font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-muted)]"><Filter className="h-4 w-4" aria-hidden="true" />Filtros{activeFilterCount ? ` (${activeFilterCount})` : ''}</button>
        {canManageCustomers && <button type="button" onClick={() => setCreating(true)} className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[var(--color-brand)] px-3 text-[13px] font-medium text-white"><Plus className="h-4 w-4" aria-hidden="true" />Novo cliente</button>}</>}
      </header>
      {area === 'campaigns' && campaignsEnabled ? <CampaignsTab token={token} canCommunicate={customerPermissions.clientesComunicar} /> : area === 'automations' && automationsEnabled ? <AutomationsTab token={token} canCommunicate={customerPermissions.clientesComunicar} /> : <>
      {filterOpen && <><div className="fixed inset-0 z-10 bg-black/30 md:hidden" onClick={() => setFilterOpen(false)} aria-hidden="true" /><CustomerFiltersPanel filters={filters} onChange={setFilters} onClose={() => setFilterOpen(false)} /></>}
      {error && <div role="alert" className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-[13px] text-[var(--color-alert)]"><span>{error}</span><button type="button" onClick={() => void refresh()} className="min-h-[44px] rounded-lg px-3 font-medium text-[var(--color-brand-deep)]">Tentar novamente</button></div>}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className={`${selected ? 'hidden md:flex' : 'flex'} min-h-0 w-full flex-1 flex-col border-r border-[var(--color-line)] bg-[var(--color-surface)] md:max-w-[440px]`}><CustomerList customers={customers} selectedId={selected?.id ?? null} onSelect={setSelected} loading={loading} loadingMore={loadingMore} hasMore={hasMore} onLoadMore={() => void loadMore()} filters={filters} onChangeFilters={setFilters} /></div>
        <aside className={`${selected ? 'flex' : 'hidden md:flex'} min-h-0 min-w-0 flex-1 flex-col bg-[var(--color-canvas)]`}>{selected ? <CustomerDetail token={token} summary={selected} onBack={() => setSelected(null)} permissions={customerPermissions} primaryJid={null} canManage={canManageCustomers} onOpenAtendimento={onOpenAtendimento} /> : <div className="flex flex-1 items-center justify-center p-8 text-center"><p className="text-[13px] text-[var(--color-ink-muted)]">Selecione um cliente para ver a ficha.</p></div>}</aside>
      </div>
      {creating && <CustomerCreateDialog onClose={() => setCreating(false)} onCreate={async (patch) => { if (!token) return; await createCustomer(token, patch); setCreating(false); await refresh(); }} />}</>}
    </section>
  );
}
