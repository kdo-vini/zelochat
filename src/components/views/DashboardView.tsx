import React, { useMemo } from 'react';
import { ArrowUpRight, AlertTriangle, Clock, MessageCircle } from 'lucide-react';
import { ZeloState, Order } from '../../types';
import { STATUS_LABELS } from '../../constants';

type View = 'dashboard' | 'chat' | 'kanban' | 'calendar' | 'ai-configs' | 'settings' | 'profile' | 'drivers' | 'catalog';

const STATUS_DOT: Record<Order['status'], string> = {
  pending: 'bg-[var(--color-warn)]',
  preparing: 'bg-[var(--color-brand)]',
  ready: 'bg-[var(--color-ink)]',
  out_for_delivery: 'bg-purple-500',
  delivered: 'bg-[var(--color-ink-faint)]',
};

const currency = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

const Metric = ({
  label, value, hint,
}: { label: string; value: string | number; hint?: string }) => (
  <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl px-5 py-4">
    <p className="text-[11.5px] font-medium text-[var(--color-ink-muted)] uppercase tracking-wider">
      {label}
    </p>
    <p className="mt-1.5 text-[26px] font-semibold tracking-tight tabular-nums leading-none">
      {value}
    </p>
    {hint && (
      <p className="mt-2 text-[11.5px] text-[var(--color-ink-faint)]">{hint}</p>
    )}
  </div>
);

type DashboardState = Pick<ZeloState, 'orders' | 'sessions' | 'profile'>;

export const DashboardView = ({
  state, setActiveView,
}: { state: DashboardState; setActiveView: (v: View) => void }) => {
  const today = new Date().toISOString().split('T')[0];

  const { todayOrders, todayRevenue, activeChats, aiReplies, alertSessions, pendingOrders } = useMemo(() => {
    const todayOrders = state.orders.filter(o => o.pickupDate === today);
    const todayRevenue = todayOrders.reduce((acc, o) => acc + o.total, 0);
    const activeChats = state.sessions.filter(s => s.status === 'active').length;
    const aiReplies = state.sessions.reduce(
      (acc, s) => acc + s.messages.filter(m => m.role === 'assistant').length, 0
    );
    const alertSessions = state.sessions.filter(s => s.alerts && s.alerts.length > 0);
    const pendingOrders = state.orders.filter(o => o.status === 'pending' || o.status === 'preparing');
    return { todayOrders, todayRevenue, activeChats, aiReplies, alertSessions, pendingOrders };
  }, [state.orders, state.sessions, today]);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Bom dia';
    if (h < 18) return 'Boa tarde';
    return 'Boa noite';
  })();

  const firstName = state.profile.name.split(' ')[0];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
      <div className="max-w-[1180px] mx-auto px-10 py-10 space-y-8">
        <header className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[13px] text-[var(--color-ink-muted)]">
              {greeting}, {firstName}
            </p>
            <h1 className="mt-1 text-[26px] font-semibold tracking-tight">
              Visão geral de hoje
            </h1>
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)] text-[12px] font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-brand)]" />
            Sistema online
          </div>
        </header>

        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Metric
            label="Pedidos hoje"
            value={todayOrders.length}
            hint={todayOrders.length === 0 ? 'Nenhum pedido agendado' : `${pendingOrders.length} em preparo`}
          />
          <Metric
            label="A faturar"
            value={currency(todayRevenue)}
            hint={todayOrders.length > 0 ? `Ticket médio ${currency(todayRevenue / todayOrders.length)}` : '—'}
          />
          <Metric
            label="Chats ativos"
            value={activeChats}
            hint={alertSessions.length > 0 ? `${alertSessions.length} com alerta` : 'Sem alertas'}
          />
          <Metric
            label="Respostas da IA"
            value={aiReplies}
            hint="Em todas as conversas"
          />
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-line)]">
              <div>
                <h3 className="text-[14px] font-semibold">Precisa da sua atenção</h3>
                <p className="text-[12px] text-[var(--color-ink-muted)]">
                  Conversas com alertas ou pedidos em espera
                </p>
              </div>
              <button
                onClick={() => setActiveView('chat')}
                className="text-[12px] font-semibold text-[var(--color-brand-deep)] hover:underline inline-flex items-center gap-1"
              >
                Ver atendimento <ArrowUpRight className="w-3 h-3" />
              </button>
            </div>

            {alertSessions.length === 0 && pendingOrders.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <p className="text-[13px] text-[var(--color-ink-muted)]">
                  Tudo sob controle. Nada pedindo sua atenção agora.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-[var(--color-line)]">
                {alertSessions.map(s => (
                  <li key={`alert-${s.id}`} className="flex items-center gap-3 px-5 py-3">
                    <div className="w-8 h-8 rounded-full bg-[var(--color-alert-soft)] text-[var(--color-alert)] flex items-center justify-center flex-shrink-0">
                      <AlertTriangle className="w-4 h-4" strokeWidth={2.2} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13.5px] font-semibold truncate">{s.customerName}</p>
                      <p className="text-[12px] text-[var(--color-ink-muted)] truncate">
                        {(s.alerts || []).join(' · ')}
                      </p>
                    </div>
                    <button
                      onClick={() => setActiveView('chat')}
                      className="text-[12px] font-semibold text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
                    >
                      Abrir →
                    </button>
                  </li>
                ))}
                {pendingOrders.slice(0, 4).map(o => (
                  <li key={`order-${o.id}`} className="flex items-center gap-3 px-5 py-3">
                    <div className="w-8 h-8 rounded-full bg-[var(--color-surface-muted)] text-[var(--color-ink-soft)] flex items-center justify-center flex-shrink-0 text-[12px] font-semibold">
                      {o.customerName.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13.5px] font-semibold truncate">
                        {o.customerName}
                      </p>
                      <p className="text-[12px] text-[var(--color-ink-muted)] truncate">
                        {o.items.map(i => `${i.quantity}× ${i.product}`).join(', ')}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[12.5px] font-semibold tabular-nums">{currency(o.total)}</p>
                      <div className="flex items-center justify-end gap-1.5 mt-0.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[o.status]}`} />
                        <span className="text-[11px] text-[var(--color-ink-muted)]">
                          {STATUS_LABELS[o.status]}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="lg:col-span-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-line)]">
              <div>
                <h3 className="text-[14px] font-semibold">Agenda de hoje</h3>
                <p className="text-[12px] text-[var(--color-ink-muted)]">
                  {todayOrders.length === 0
                    ? 'Dia sem retiradas programadas'
                    : `${todayOrders.length} ${todayOrders.length === 1 ? 'retirada' : 'retiradas'}`}
                </p>
              </div>
              <button
                onClick={() => setActiveView('calendar')}
                className="text-[12px] font-semibold text-[var(--color-brand-deep)] hover:underline inline-flex items-center gap-1"
              >
                Agenda <ArrowUpRight className="w-3 h-3" />
              </button>
            </div>

            {todayOrders.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <div className="w-10 h-10 rounded-full bg-[var(--color-surface-muted)] text-[var(--color-ink-faint)] flex items-center justify-center mx-auto mb-2">
                  <Clock className="w-4 h-4" />
                </div>
                <p className="text-[13px] text-[var(--color-ink-muted)]">
                  Sem retiradas para hoje.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-[var(--color-line)]">
                {todayOrders
                  .sort((a, b) => a.pickupTime.localeCompare(b.pickupTime))
                  .map(o => (
                    <li key={o.id} className="flex items-center gap-3 px-5 py-3">
                      <div className="w-12 text-center">
                        <p className="text-[13px] font-semibold tabular-nums">{o.pickupTime}</p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13.5px] font-semibold truncate">
                          {o.customerName}
                        </p>
                        <p className="text-[11.5px] text-[var(--color-ink-muted)] truncate">
                          {o.items.reduce((acc, i) => acc + i.quantity, 0)} itens · {currency(o.total)}
                        </p>
                      </div>
                      <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[o.status]}`} />
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </section>

        <section className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl p-5 flex items-start gap-4">
          <div className="w-9 h-9 rounded-lg bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)] flex items-center justify-center flex-shrink-0">
            <MessageCircle className="w-4 h-4" />
          </div>
          <div className="flex-1">
            <h3 className="text-[14px] font-semibold">Revisar respostas automáticas</h3>
            <p className="text-[12.5px] text-[var(--color-ink-muted)] mt-0.5">
              Ajuste o tom, cardápio e regras que a IA usa para responder no WhatsApp.
            </p>
          </div>
          <button
            onClick={() => setActiveView('ai-configs')}
            className="text-[12.5px] font-semibold px-3 py-1.5 rounded-md bg-[var(--color-ink)] text-white hover:bg-[var(--color-ink-soft)]"
          >
            Abrir Cérebro IA
          </button>
        </section>
      </div>
    </div>
  );
};
