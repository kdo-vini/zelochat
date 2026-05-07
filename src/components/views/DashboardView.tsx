import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  CalendarDays,
  Clock3,
  MessageCircle,
  RefreshCw,
  Timer,
  UserRound,
  Utensils,
} from 'lucide-react';
import type { DashboardAttentionItem, DashboardMetricValue, DashboardRange, ZeloState } from '../../types';
import { STATUS_LABELS } from '../../constants';
import { useDashboardOverview } from '../../hooks/useDashboardOverview';

type View = 'dashboard' | 'chat' | 'kanban' | 'calendar' | 'ai-configs' | 'settings' | 'profile' | 'drivers' | 'catalog';
type DashboardState = Pick<ZeloState, 'profile'>;

const currency = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

function formatDuration(ms: number | null): string {
  if (ms === null) return 'Sem amostra';
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes}min ${seconds}s` : `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes > 0 ? `${hours}h ${restMinutes}min` : `${hours}h`;
}

function metricHint(metric: DashboardMetricValue, periodLabel: string, fallback = 'medindo a partir de hoje') {
  if (!metric.samples) return fallback;
  return `${metric.samples} amostra${metric.samples === 1 ? '' : 's'} em ${periodLabel}`;
}

function localDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

const MetricCard = ({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  hint: string;
  icon: React.ElementType;
  tone?: 'neutral' | 'warning' | 'danger' | 'good';
}) => {
  const toneClass = {
    neutral: 'bg-[var(--color-surface-muted)] text-[var(--color-ink-soft)]',
    warning: 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]',
    danger: 'bg-[var(--color-alert-soft)] text-[var(--color-alert)]',
    good: 'bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]',
  }[tone];

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl px-4 py-4 min-h-[116px]">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold text-[var(--color-ink-muted)] uppercase tracking-wider leading-tight">
          {label}
        </p>
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${toneClass}`}>
          <Icon className="w-4 h-4" strokeWidth={2} />
        </span>
      </div>
      <p className="mt-3 text-[26px] font-semibold tracking-tight tabular-nums leading-none">
        {value}
      </p>
      <p className="mt-2 text-[11.5px] text-[var(--color-ink-faint)] leading-snug">
        {hint}
      </p>
    </div>
  );
};

const SectionHeader = ({ title, subtitle }: { title: string; subtitle: string }) => (
  <div>
    <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
    <p className="text-[12px] text-[var(--color-ink-muted)] mt-0.5">{subtitle}</p>
  </div>
);

const attentionToneClass: Record<DashboardAttentionItem['tone'], string> = {
  neutral: 'bg-[var(--color-surface-muted)] text-[var(--color-ink-soft)]',
  warning: 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]',
  danger: 'bg-[var(--color-alert-soft)] text-[var(--color-alert)]',
};

export const DashboardView = ({
  state,
  setActiveView,
  token,
}: {
  state: DashboardState;
  setActiveView: (v: View) => void;
  token: string | null;
}) => {
  const [range, setRange] = useState<DashboardRange>('today');
  const todayKey = localDateKey();
  const [customStart, setCustomStart] = useState(todayKey);
  const [customEnd, setCustomEnd] = useState(todayKey);
  const { overview, loading, error, reload } = useDashboardOverview(
    token,
    range,
    range === 'custom' ? { startDate: customStart, endDate: customEnd } : undefined,
  );

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Bom dia';
    if (h < 18) return 'Boa tarde';
    return 'Boa noite';
  })();
  const firstName = state.profile.name.split(' ')[0] || 'time';
  const periodLabel = overview?.periodLabel ?? (
    range === '30d'
      ? 'últimos 30 dias'
      : range === '7d'
        ? 'últimos 7 dias'
        : range === 'custom'
          ? `${customStart} a ${customEnd}`
          : 'últimas 24h'
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
      <div className="max-w-[1180px] mx-auto px-4 sm:px-6 lg:px-10 py-6 lg:py-10 space-y-7">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[13px] text-[var(--color-ink-muted)]">
              {greeting}, {firstName}
            </p>
            <h1 className="mt-1 text-[26px] font-semibold tracking-tight">
              Visão geral
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-0.5 flex-wrap">
              {([
                ['today', '24h'],
                ['7d', '7 dias'],
                ['30d', '30 dias'],
                ['custom', 'Período'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setRange(value)}
                  className={`h-8 px-3 rounded-md text-[12px] font-semibold transition-colors ${
                    range === value
                      ? 'bg-[var(--color-ink)] text-white'
                      : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {range === 'custom' && (
              <div className="flex items-center gap-1.5 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1">
                <CalendarDays className="w-4 h-4 text-[var(--color-ink-muted)]" />
                <input
                  type="date"
                  value={customStart}
                  max={customEnd}
                  onChange={(event) => setCustomStart(event.target.value)}
                  className="h-7 bg-transparent text-[12px] text-[var(--color-ink)] outline-none"
                  aria-label="Data inicial"
                />
                <span className="text-[11px] text-[var(--color-ink-faint)]">até</span>
                <input
                  type="date"
                  value={customEnd}
                  min={customStart}
                  onChange={(event) => setCustomEnd(event.target.value)}
                  className="h-7 bg-transparent text-[12px] text-[var(--color-ink)] outline-none"
                  aria-label="Data final"
                />
              </div>
            )}
            <button
              onClick={() => void reload()}
              disabled={loading}
              className="h-9 w-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] disabled:opacity-50 flex items-center justify-center"
              title="Atualizar"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </header>

        {error && !overview ? (
          <section className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl p-8 text-center">
            <div className="w-10 h-10 rounded-full mx-auto bg-[var(--color-alert-soft)] text-[var(--color-alert)] flex items-center justify-center">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <h2 className="mt-3 text-[16px] font-semibold">Não consegui carregar as métricas</h2>
            <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">{error}</p>
            <button
              onClick={() => void reload()}
              className="mt-4 px-4 py-2 rounded-lg bg-[var(--color-ink)] text-white text-[13px] font-semibold hover:bg-[var(--color-ink-soft)]"
            >
              Tentar novamente
            </button>
          </section>
        ) : !overview ? (
          <section className="h-[360px] flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-[13px] text-[var(--color-ink-muted)]">
              <div className="w-7 h-7 rounded-full border-2 border-[var(--color-brand)] border-t-transparent animate-spin" />
              Carregando métricas reais...
            </div>
          </section>
        ) : (
          <>
            <section className="space-y-3">
              <SectionHeader
                title="Agora"
                subtitle="Fila de atendimento e riscos operacionais em tempo real."
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
                <MetricCard
                  label="Clientes aguardando"
                  value={overview.now.waitingConversations}
                  hint="conversas com mensagem não lida"
                  icon={MessageCircle}
                  tone={overview.now.waitingConversations > 0 ? 'warning' : 'good'}
                />
                <MetricCard
                  label="Escalações abertas"
                  value={overview.now.openEscalations}
                  hint="precisam de humano"
                  icon={AlertTriangle}
                  tone={overview.now.openEscalations > 0 ? 'danger' : 'good'}
                />
                <MetricCard
                  label="No manual"
                  value={overview.now.manualConversations}
                  hint={`${overview.now.staleManualConversations} paradas há mais de 10min`}
                  icon={UserRound}
                  tone={overview.now.staleManualConversations > 0 ? 'warning' : 'neutral'}
                />
                <MetricCard
                  label="Com IA ativa"
                  value={overview.now.aiConversations}
                  hint="auto-resposta ligada"
                  icon={Bot}
                  tone="good"
                />
                <MetricCard
                  label="Pedidos em risco"
                  value={overview.orders.atRiskCount}
                  hint="vencidos ou próximos 30min"
                  icon={Clock3}
                  tone={overview.orders.atRiskCount > 0 ? 'warning' : 'good'}
                />
              </div>
            </section>

            <section className="space-y-3">
              <SectionHeader
                title="Velocidade"
                subtitle="Tempo de resposta medido com dados reais do atendimento."
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
                <MetricCard
                  label="Primeira resposta"
                  value={formatDuration(overview.speed.firstResponseMs.value)}
                  hint={metricHint(overview.speed.firstResponseMs, periodLabel, `sem amostra em ${periodLabel}`)}
                  icon={Timer}
                />
                <MetricCard
                  label="Resposta da IA"
                  value={formatDuration(overview.speed.aiResponseMs.value)}
                  hint={metricHint(overview.speed.aiResponseMs, periodLabel)}
                  icon={Bot}
                  tone="good"
                />
                <MetricCard
                  label="Resposta humana"
                  value={formatDuration(overview.speed.humanResponseMs.value)}
                  hint={metricHint(overview.speed.humanResponseMs, periodLabel)}
                  icon={UserRound}
                />
                <MetricCard
                  label="Humano assume"
                  value={formatDuration(overview.speed.escalationAckMs.value)}
                  hint={metricHint(overview.speed.escalationAckMs, periodLabel, `sem escalação assumida em ${periodLabel}`)}
                  icon={AlertTriangle}
                />
                <MetricCard
                  label="Escalação resolvida"
                  value={formatDuration(overview.speed.escalationResolveMs.value)}
                  hint={metricHint(overview.speed.escalationResolveMs, periodLabel, `sem escalação resolvida em ${periodLabel}`)}
                  icon={Clock3}
                />
              </div>
            </section>

            <section className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              <div className="lg:col-span-3 space-y-3">
                <SectionHeader
                  title="Pedidos"
                  subtitle="Resumo do período e próximos horários de hoje."
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                  <MetricCard
                    label="Pedidos no período"
                    value={overview.orders.count}
                    hint={`${overview.orders.pendingCount} pendente(s), ${overview.orders.preparingCount} em preparo`}
                    icon={Utensils}
                  />
                  <MetricCard
                    label="A faturar"
                    value={currency(overview.orders.revenue)}
                    hint={`pedidos em ${periodLabel}`}
                    icon={ArrowUpRight}
                    tone="good"
                  />
                  <MetricCard
                    label="Ticket médio"
                    value={overview.orders.averageTicket === null ? '—' : currency(overview.orders.averageTicket)}
                    hint={overview.orders.count > 0 ? 'média dos pedidos do período' : 'sem pedidos no período'}
                    icon={Timer}
                  />
                  <MetricCard
                    label="Próximos"
                    value={overview.orders.upcoming.length}
                    hint="ainda não entregues"
                    icon={Clock3}
                  />
                </div>

                <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-line)]">
                    <div>
                      <h3 className="text-[14px] font-semibold">Próximos horários</h3>
                      <p className="text-[12px] text-[var(--color-ink-muted)]">Pedidos de hoje que ainda merecem acompanhamento.</p>
                    </div>
                    <button
                      onClick={() => setActiveView('calendar')}
                      className="text-[12px] font-semibold text-[var(--color-brand-deep)] hover:underline inline-flex items-center gap-1"
                    >
                      Agenda <ArrowUpRight className="w-3 h-3" />
                    </button>
                  </div>
                  {overview.orders.upcoming.length === 0 ? (
                    <div className="px-5 py-8 text-center text-[13px] text-[var(--color-ink-muted)]">
                      Nenhum pedido pendente para hoje.
                    </div>
                  ) : (
                    <ul className="divide-y divide-[var(--color-line)]">
                      {overview.orders.upcoming.map((order) => (
                        <li key={order.id} className="flex items-center gap-3 px-5 py-3">
                          <div className="w-12 text-center flex-shrink-0">
                            <p className="text-[13px] font-semibold tabular-nums">{order.pickupTime}</p>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13.5px] font-semibold truncate">{order.customerName}</p>
                            <p className="text-[11.5px] text-[var(--color-ink-muted)] truncate">
                              {STATUS_LABELS[order.status]} · {currency(order.total)}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="lg:col-span-2 space-y-3">
                <SectionHeader
                  title="Atenção"
                  subtitle="Ações que mais ajudam agora."
                />
                <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl overflow-hidden">
                  {overview.attentionItems.length === 0 ? (
                    <div className="px-5 py-10 text-center">
                      <p className="text-[13px] text-[var(--color-ink-muted)]">
                        Tudo sob controle. Nada pedindo sua atenção agora.
                      </p>
                    </div>
                  ) : (
                    <ul className="divide-y divide-[var(--color-line)]">
                      {overview.attentionItems.map((item) => (
                        <li key={item.id} className="flex items-start gap-3 px-5 py-4">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${attentionToneClass[item.tone]}`}>
                            {item.type === 'ai_config'
                              ? <Bot className="w-4 h-4" />
                              : item.type === 'order_risk'
                                ? <Utensils className="w-4 h-4" />
                                : <AlertTriangle className="w-4 h-4" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13.5px] font-semibold truncate">{item.title}</p>
                            <p className="text-[12px] text-[var(--color-ink-muted)] leading-snug">{item.description}</p>
                            <button
                              onClick={() => setActiveView(item.action)}
                              className="mt-2 text-[12px] font-semibold text-[var(--color-brand-deep)] hover:underline inline-flex items-center gap-1"
                            >
                              Abrir <ArrowUpRight className="w-3 h-3" />
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl px-5 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-[14px] font-semibold">Cérebro IA</h3>
                      <p className="text-[12px] text-[var(--color-ink-muted)] mt-0.5">
                        {overview.aiHealth?.safeSummaryStatus === 'ready'
                          ? 'Configuração pronta para atender.'
                          : overview.aiHealth?.safeSummaryStatus === 'disabled'
                            ? 'IA desligada no momento.'
                            : overview.aiHealth?.safeSummaryStatus === 'scheduled_off'
                              ? 'IA agendada, fora da janela neste momento.'
                            : 'Há ajustes que podem melhorar as respostas.'}
                      </p>
                    </div>
                    <button
                      onClick={() => setActiveView('ai-configs')}
                      className="h-9 px-3 rounded-lg bg-[var(--color-ink)] text-white text-[12.5px] font-semibold hover:bg-[var(--color-ink-soft)]"
                    >
                      Revisar
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
};
