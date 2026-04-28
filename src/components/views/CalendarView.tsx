import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Phone,
  Plus,
  Printer,
  X,
} from 'lucide-react';
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { Order, ZeloState } from '../../types';
import { STATUS_COLORS, STATUS_LABELS } from '../../constants';

type CalendarMode = 'day' | 'week' | 'month';

const MODE_STORAGE_KEY = 'zelochat_calendar_mode';

const MODE_LABELS: Record<CalendarMode, string> = {
  day: 'Dia',
  week: 'Semana',
  month: 'Mês',
};

const currency = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

function ordersByDate(orders: Order[]): Map<string, Order[]> {
  const map = new Map<string, Order[]>();
  for (const o of orders) {
    const arr = map.get(o.pickupDate) ?? [];
    arr.push(o);
    map.set(o.pickupDate, arr);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => a.pickupTime.localeCompare(b.pickupTime));
  }
  return map;
}

function dateKey(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

export const CalendarView = ({
  state,
  setState,
  onNavigateToKanban,
}: {
  state: ZeloState;
  setState: React.Dispatch<React.SetStateAction<ZeloState>>;
  onNavigateToKanban: () => void;
}) => {
  const todayStr = format(new Date(), 'yyyy-MM-dd');

  const [mode, setMode] = useState<CalendarMode>(() => {
    try {
      const raw = localStorage.getItem(MODE_STORAGE_KEY);
      if (raw === 'day' || raw === 'week' || raw === 'month') return raw;
    } catch { /* ignore */ }
    return 'week';
  });
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [showBlockPanel, setShowBlockPanel] = useState(false);
  const [newBlockDay, setNewBlockDay] = useState('');
  const [newBlockMonth, setNewBlockMonth] = useState('');
  const [newBlockYear, setNewBlockYear] = useState('');
  const [newBlockReason, setNewBlockReason] = useState('');
  const [blockError, setBlockError] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const ordersMap = useMemo(() => ordersByDate(state.orders), [state.orders]);
  const blockedMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of state.blockedDates) m.set(b.date, b.reason);
    return m;
  }, [state.blockedDates]);

  const switchMode = (next: CalendarMode) => {
    setMode(next);
    try { localStorage.setItem(MODE_STORAGE_KEY, next); } catch { /* ignore */ }
  };

  const goPrev = () => {
    if (mode === 'day') setAnchor((d) => addDays(d, -1));
    else if (mode === 'week') setAnchor((d) => addWeeks(d, -1));
    else setAnchor((d) => addMonths(d, -1));
  };
  const goNext = () => {
    if (mode === 'day') setAnchor((d) => addDays(d, 1));
    else if (mode === 'week') setAnchor((d) => addWeeks(d, 1));
    else setAnchor((d) => addMonths(d, 1));
  };
  const goToday = () => setAnchor(new Date());

  const rangeLabel = useMemo(() => {
    if (mode === 'day') {
      const label = format(anchor, "EEEE, dd 'de' MMMM yyyy", { locale: ptBR });
      return label.charAt(0).toUpperCase() + label.slice(1);
    }
    if (mode === 'week') {
      const start = startOfWeek(anchor, { weekStartsOn: 0 });
      const end = endOfWeek(anchor, { weekStartsOn: 0 });
      const sameMonth = isSameMonth(start, end);
      if (sameMonth) {
        return `${format(start, 'dd')} – ${format(end, "dd 'de' MMMM yyyy", { locale: ptBR })}`;
      }
      return `${format(start, "dd 'de' MMM", { locale: ptBR })} – ${format(end, "dd 'de' MMM yyyy", { locale: ptBR })}`;
    }
    const label = format(anchor, "MMMM 'de' yyyy", { locale: ptBR });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }, [anchor, mode]);

  const handleAddBlock = () => {
    const d = parseInt(newBlockDay, 10);
    const m = parseInt(newBlockMonth, 10);
    const y = parseInt(newBlockYear, 10);
    if (!newBlockDay || !newBlockMonth || !newBlockYear || isNaN(d) || isNaN(m) || isNaN(y)
        || d < 1 || d > 31 || m < 1 || m > 12 || y < 2020) {
      setBlockError('Data inválida.'); return;
    }
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (!newBlockReason.trim()) { setBlockError('Informe o motivo.'); return; }
    if (state.blockedDates.some(b => b.date === iso)) {
      setBlockError('Esta data já está bloqueada.'); return;
    }
    setState(prev => ({
      ...prev,
      blockedDates: [...prev.blockedDates, { date: iso, reason: newBlockReason.trim() }],
    }));
    setNewBlockDay('');
    setNewBlockMonth('');
    setNewBlockYear('');
    setNewBlockReason('');
    setBlockError('');
  };

  const handleRemoveBlock = (date: string) => {
    setState(prev => ({
      ...prev,
      blockedDates: prev.blockedDates.filter(b => b.date !== date),
    }));
  };

  const handlePrintDay = () => {
    const key = dateKey(anchor);
    const orders = ordersMap.get(key) ?? [];
    if (orders.length === 0) {
      alert('Nenhum pedido para este dia.');
      return;
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const formattedDate = format(anchor, "dd/MM/yyyy", { locale: ptBR });
    const sortedOrders = [...orders].sort((a, b) => a.pickupTime.localeCompare(b.pickupTime));

    let html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Pedidos do Dia - ${formattedDate}</title>
          <style>
            @page { margin: 0; }
            body { 
              font-family: monospace; 
              font-size: 14px; 
              margin: 0; 
              padding: 10px;
              color: #000;
              width: 80mm; /* Printer width */
              line-height: 1.2;
            }
            .header { text-align: center; margin-bottom: 15px; border-bottom: 1px dashed #000; padding-bottom: 10px; }
            .header h2 { margin: 0 0 5px 0; font-size: 18px; }
            .header p { margin: 0; }
            .order { border-bottom: 1px dashed #000; padding-bottom: 10px; margin-bottom: 10px; }
            .time { font-weight: bold; font-size: 16px; margin-bottom: 5px; }
            .customer { font-size: 14px; margin-bottom: 5px; }
            .status { font-size: 12px; font-weight: bold; margin-bottom: 5px; }
            .items-title { font-weight: bold; margin-bottom: 3px; }
            .item { font-size: 14px; margin-left: 10px; }
            .delivery { font-size: 12px; margin-top: 5px; }
            .total { font-weight: bold; margin-top: 5px; text-align: right; font-size: 15px; }
            * { box-sizing: border-box; }
          </style>
        </head>
        <body>
          <div class="header">
            <h2>PEDIDOS DO DIA</h2>
            <p>${formattedDate}</p>
            <p>Total de pedidos: ${sortedOrders.length}</p>
          </div>
    `;

    sortedOrders.forEach(o => {
      html += `
        <div class="order">
          <div class="time">⏰ ${o.pickupTime}</div>
          <div class="customer">👤 ${o.customerName} ${o.customerPhone ? '<br>📞 ' + o.customerPhone : ''}</div>
          <div class="status">Status: ${STATUS_LABELS[o.status] || o.status}</div>
          <div class="items-title">Itens:</div>
      `;
      o.items.forEach(i => {
        html += `<div class="item">${i.quantity}x ${i.product}</div>`;
      });
      if (o.deliveryAddress) {
        html += `<div class="delivery">📍 Entrega: ${o.deliveryAddress}</div>`;
      }
      html += `
          <div class="total">Total: ${currency(o.total)}</div>
        </div>
      `;
    });

    html += `
          <div style="text-align: center; margin-top: 20px;">
            <p>Fim do relatório</p>
          </div>
          <script>
            window.onload = () => {
              window.print();
              setTimeout(() => window.close(), 500);
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-4 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-8 py-5">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Agenda</h1>
          <p className="text-[13px] text-[var(--color-ink-muted)]">Pedidos por data e horário de retirada</p>
        </div>

        <div className="flex items-center gap-2">
          {/* Mode toggle */}
          <div className="inline-flex rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-0.5">
            {(['day', 'week', 'month'] as CalendarMode[]).map((m) => (
              <button
                key={m}
                onClick={() => switchMode(m)}
                className={`px-3 h-8 rounded-md text-[12.5px] font-semibold transition-colors ${
                  mode === m
                    ? 'bg-[var(--color-ink)] text-white'
                    : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
                }`}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowBlockPanel(p => !p)}
            className={`flex h-9 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition-colors ${
              showBlockPanel
                ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]'
                : 'border-[var(--color-line)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-muted)]'
            }`}
          >
            <CalendarIcon className="h-4 w-4" />
            Datas bloqueadas
            {state.blockedDates.length > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-alert)] px-1 text-[10px] font-bold text-white">
                {state.blockedDates.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Sub-header: navigation + range label */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-surface)] px-8 py-3">
        <div className="flex items-center gap-2">
          <button
            onClick={goPrev}
            className="h-8 w-8 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)] flex items-center justify-center"
            aria-label="Anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={goNext}
            className="h-8 w-8 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)] flex items-center justify-center"
            aria-label="Próximo"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={goToday}
            className="h-8 px-3 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] text-[12.5px] font-semibold text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)]"
          >
            Hoje
          </button>
          <span className="ml-2 text-[14px] font-semibold text-[var(--color-ink)]">{rangeLabel}</span>
        </div>

        <div className="flex items-center gap-4">
          {mode === 'day' && (
            <button
              onClick={handlePrintDay}
              className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-[12.5px] font-semibold text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-muted)]"
              aria-label="Imprimir dia"
            >
              <Printer className="h-3.5 w-3.5" />
              Imprimir Dia
            </button>
          )}
          <span className="text-[12px] text-[var(--color-ink-faint)]">
            {state.orders.length} pedidos • {state.blockedDates.length} datas bloqueadas
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {mode === 'day' && (
            <DayView
              anchor={anchor}
              todayStr={todayStr}
              ordersMap={ordersMap}
              blockedMap={blockedMap}
              onSelectOrder={setSelectedOrder}
            />
          )}
          {mode === 'week' && (
            <WeekView
              anchor={anchor}
              todayStr={todayStr}
              ordersMap={ordersMap}
              blockedMap={blockedMap}
              onSelectOrder={setSelectedOrder}
              onSelectDay={(d) => { setAnchor(d); switchMode('day'); }}
            />
          )}
          {mode === 'month' && (
            <MonthView
              anchor={anchor}
              todayStr={todayStr}
              ordersMap={ordersMap}
              blockedMap={blockedMap}
              onSelectDay={(d) => { setAnchor(d); switchMode('day'); }}
            />
          )}
        </div>

        {/* Block panel */}
        <AnimatePresence>
          {showBlockPanel && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 320, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 340, damping: 32 }}
              className="flex-shrink-0 overflow-hidden border-l border-[var(--color-line)] bg-[var(--color-surface)]"
            >
              <div className="flex h-full w-80 flex-col">
                <div className="flex items-center justify-between border-b border-[var(--color-line)] px-5 py-4">
                  <h3 className="text-[14px] font-semibold">Datas bloqueadas</h3>
                  <button
                    onClick={() => setShowBlockPanel(false)}
                    className="rounded-md p-1.5 text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-muted)]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar">
                  {state.blockedDates.length === 0 ? (
                    <div className="px-5 py-8 text-center text-[13px] text-[var(--color-ink-faint)]">
                      Nenhuma data bloqueada.
                    </div>
                  ) : (
                    <ul className="divide-y divide-[var(--color-line)]">
                      {[...state.blockedDates]
                        .sort((a, b) => a.date.localeCompare(b.date))
                        .map(block => (
                          <li key={block.date} className="flex items-start justify-between gap-3 px-5 py-3.5">
                            <div className="min-w-0">
                              <p className="text-[13px] font-semibold">
                                {format(parseISO(block.date), "dd 'de' MMM", { locale: ptBR })}
                                {block.date === todayStr && (
                                  <span className="ml-2 rounded-full bg-[var(--color-warn)] px-1.5 py-0.5 text-[10px] font-bold text-white">
                                    HOJE
                                  </span>
                                )}
                              </p>
                              <p className="mt-0.5 truncate text-[12px] text-[var(--color-ink-muted)]">{block.reason}</p>
                            </div>
                            <button
                              onClick={() => handleRemoveBlock(block.date)}
                              className="mt-0.5 flex-shrink-0 rounded-md p-1 text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-alert)]"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </li>
                        ))}
                    </ul>
                  )}

                  <div className="border-t border-[var(--color-line)] px-5 py-4 space-y-3">
                    <p className="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
                      Bloquear nova data
                    </p>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={2}
                        placeholder="DD"
                        value={newBlockDay}
                        onChange={e => { setNewBlockDay(e.target.value.replace(/\D/g, '')); setBlockError(''); }}
                        className="w-14 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-muted)] px-2 py-2 text-[13px] text-center outline-none focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/20"
                      />
                      <span className="self-center text-[var(--color-ink-faint)]">/</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={2}
                        placeholder="MM"
                        value={newBlockMonth}
                        onChange={e => { setNewBlockMonth(e.target.value.replace(/\D/g, '')); setBlockError(''); }}
                        className="w-14 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-muted)] px-2 py-2 text-[13px] text-center outline-none focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/20"
                      />
                      <span className="self-center text-[var(--color-ink-faint)]">/</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={4}
                        placeholder="AAAA"
                        value={newBlockYear}
                        onChange={e => { setNewBlockYear(e.target.value.replace(/\D/g, '')); setBlockError(''); }}
                        className="flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-muted)] px-2 py-2 text-[13px] text-center outline-none focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/20"
                      />
                    </div>
                    <input
                      type="text"
                      placeholder="Motivo (ex: Feriado)"
                      value={newBlockReason}
                      onChange={e => { setNewBlockReason(e.target.value); setBlockError(''); }}
                      onKeyDown={e => e.key === 'Enter' && handleAddBlock()}
                      className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-muted)] px-3 py-2 text-[13px] outline-none placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/20"
                    />
                    {blockError && (
                      <p className="text-[12px] text-[var(--color-alert)]">{blockError}</p>
                    )}
                    <button
                      onClick={handleAddBlock}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--color-brand)] py-2 text-[13px] font-semibold text-white transition-colors hover:opacity-90"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Bloquear
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Order detail drawer */}
      <AnimatePresence>
        {selectedOrder && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/25"
              onClick={() => setSelectedOrder(null)}
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 340, damping: 32 }}
              className="fixed right-0 top-0 z-50 flex h-full w-full max-w-sm flex-col bg-[var(--color-surface)] shadow-[var(--shadow-pop)]"
            >
              <div className="flex items-center justify-between border-b border-[var(--color-line)] px-5 py-4">
                <h3 className="text-[15px] font-semibold">Detalhes do pedido</h3>
                <button
                  onClick={() => setSelectedOrder(null)}
                  className="rounded-md p-1.5 text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-muted)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 space-y-5 overflow-y-auto p-5 custom-scrollbar">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ${STATUS_COLORS[selectedOrder.status]}`}>
                  {STATUS_LABELS[selectedOrder.status]}
                </span>

                <section>
                  <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Cliente</p>
                  <p className="text-[14px] font-semibold">{selectedOrder.customerName}</p>
                  {selectedOrder.customerPhone && (
                    <div className="mt-1 flex items-center gap-1.5 text-[12.5px] text-[var(--color-ink-muted)]">
                      <Phone className="h-3.5 w-3.5" strokeWidth={1.8} />
                      {selectedOrder.customerPhone}
                    </div>
                  )}
                </section>

                <section>
                  <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Retirada</p>
                  <p className="text-[13.5px]">
                    {format(parseISO(selectedOrder.pickupDate), "dd 'de' MMMM", { locale: ptBR })}
                    {' às '}
                    <span className="font-semibold">{selectedOrder.pickupTime}</span>
                  </p>
                </section>

                <section>
                  <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Itens</p>
                  <ul className="space-y-2">
                    {selectedOrder.items.map((item, i) => (
                      <li key={i} className="flex items-center justify-between text-[13.5px]">
                        <span className="flex items-center gap-2 text-[var(--color-ink-soft)]">
                          <span className="h-1 w-1 rounded-full bg-[var(--color-brand)]" />
                          {item.product}
                        </span>
                        <span className="font-medium text-[var(--color-ink-muted)]">×{item.quantity}</span>
                      </li>
                    ))}
                  </ul>
                </section>

                {selectedOrder.deliveryAddress && (
                  <section>
                    <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Entrega</p>
                    <div className="flex items-start gap-2 text-[13px] text-[var(--color-ink-muted)]">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" strokeWidth={1.8} />
                      {selectedOrder.deliveryAddress}
                    </div>
                  </section>
                )}

                <section className="flex items-center justify-between rounded-xl bg-[var(--color-brand-soft)] px-4 py-3">
                  <span className="text-[13px] font-medium text-[var(--color-brand-deep)]">Total</span>
                  <span className="text-[16px] font-bold tabular-nums text-[var(--color-brand-deep)]">
                    {currency(selectedOrder.total)}
                  </span>
                </section>
              </div>

              <div className="space-y-2 border-t border-[var(--color-line)] p-5">
                <button
                  onClick={() => { setSelectedOrder(null); onNavigateToKanban(); }}
                  className="w-full rounded-lg bg-[var(--color-ink)] py-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[var(--color-ink-soft)]"
                >
                  Ver no Kanban
                </button>
                <button
                  onClick={() => setSelectedOrder(null)}
                  className="w-full rounded-lg bg-[var(--color-surface-muted)] py-2.5 text-[13.5px] font-semibold text-[var(--color-ink-soft)] transition-colors hover:bg-[var(--color-line)]"
                >
                  Fechar
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

/* ─── Views ──────────────────────────────────────────────────────── */

interface DayViewProps {
  anchor: Date;
  todayStr: string;
  ordersMap: Map<string, Order[]>;
  blockedMap: Map<string, string>;
  onSelectOrder: (o: Order) => void;
}

const DayView: React.FC<DayViewProps> = ({ anchor, todayStr, ordersMap, blockedMap, onSelectOrder }) => {
  const key = dateKey(anchor);
  const orders = ordersMap.get(key) ?? [];
  const blocked = blockedMap.get(key);
  const todayFlag = key === todayStr;

  return (
    <div className="px-8 py-6">
      {blocked && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-[var(--color-alert)]/20 bg-[var(--color-alert)]/8 px-3 py-2 text-[12.5px] text-[var(--color-alert)]">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={2} />
          Data bloqueada: {blocked}
        </div>
      )}

      {orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <CalendarIcon className="mb-4 h-10 w-10 text-[var(--color-ink-faint)]" />
          <p className="text-[15px] font-semibold text-[var(--color-ink-soft)]">
            {todayFlag ? 'Nenhum pedido para hoje' : 'Nenhum pedido neste dia'}
          </p>
          <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">Pedidos com esta data de retirada aparecem aqui.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {orders.map((order) => (
            <OrderRow key={order.id} order={order} onClick={() => onSelectOrder(order)} />
          ))}
        </div>
      )}
    </div>
  );
};

interface WeekViewProps {
  anchor: Date;
  todayStr: string;
  ordersMap: Map<string, Order[]>;
  blockedMap: Map<string, string>;
  onSelectOrder: (o: Order) => void;
  onSelectDay: (d: Date) => void;
}

const WeekView: React.FC<WeekViewProps> = ({ anchor, todayStr, ordersMap, blockedMap, onSelectOrder, onSelectDay }) => {
  const start = startOfWeek(anchor, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start, end: endOfWeek(anchor, { weekStartsOn: 0 }) });

  return (
    <div className="grid grid-cols-1 md:grid-cols-7 gap-0 border-t border-[var(--color-line)]">
      {days.map((d) => {
        const key = dateKey(d);
        const orders = ordersMap.get(key) ?? [];
        const blocked = blockedMap.get(key);
        const todayFlag = key === todayStr;
        const dayLabel = format(d, 'EEE', { locale: ptBR });

        return (
          <div
            key={key}
            className="min-h-[160px] border-b border-r border-[var(--color-line)] bg-[var(--color-surface)] flex flex-col"
          >
            <button
              onClick={() => onSelectDay(d)}
              className={`flex items-center justify-between px-3 py-2 border-b border-[var(--color-line)] text-left hover:bg-[var(--color-surface-muted)] transition-colors ${
                todayFlag ? 'bg-[var(--color-brand-soft)]' : ''
              }`}
            >
              <div>
                <p className="text-[10.5px] uppercase tracking-wider text-[var(--color-ink-faint)] font-semibold">
                  {dayLabel}
                </p>
                <p className={`text-[15px] font-bold tabular-nums ${
                  todayFlag ? 'text-[var(--color-brand-deep)]' : 'text-[var(--color-ink)]'
                }`}>
                  {format(d, 'dd')}
                </p>
              </div>
              {orders.length > 0 && (
                <span className="text-[10.5px] font-semibold rounded-full bg-[var(--color-ink)] text-white px-1.5 py-0.5">
                  {orders.length}
                </span>
              )}
            </button>
            <div className="flex-1 p-2 space-y-1.5 overflow-y-auto custom-scrollbar">
              {blocked && (
                <div className="flex items-center gap-1 rounded border border-[var(--color-alert)]/25 bg-[var(--color-alert)]/10 px-1.5 py-1 text-[10.5px] text-[var(--color-alert)]">
                  <AlertTriangle className="h-3 w-3 flex-shrink-0" strokeWidth={2} />
                  <span className="truncate">{blocked}</span>
                </div>
              )}
              {orders.length === 0 && !blocked && (
                <p className="text-[11px] text-[var(--color-ink-faint)] italic px-1">Sem pedidos</p>
              )}
              {orders.map((o) => (
                <button
                  key={o.id}
                  onClick={() => onSelectOrder(o)}
                  className="w-full text-left rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5 hover:border-[var(--color-brand)]/40 hover:shadow-sm transition-all"
                >
                  <div className="flex items-center gap-1 text-[10.5px] font-semibold tabular-nums text-[var(--color-ink-muted)]">
                    <Clock className="h-3 w-3" strokeWidth={1.8} />
                    {o.pickupTime}
                  </div>
                  <p className="text-[12px] font-semibold truncate">{o.customerName}</p>
                  <p className="text-[11px] text-[var(--color-ink-muted)] truncate">
                    {o.items.map((i) => `${i.quantity}× ${i.product}`).join(', ')}
                  </p>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

interface MonthViewProps {
  anchor: Date;
  todayStr: string;
  ordersMap: Map<string, Order[]>;
  blockedMap: Map<string, string>;
  onSelectDay: (d: Date) => void;
}

const MonthView: React.FC<MonthViewProps> = ({ anchor, todayStr, ordersMap, blockedMap, onSelectDay }) => {
  const monthStart = startOfMonth(anchor);
  const monthEnd = endOfMonth(anchor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const weekdayHeaders = eachDayOfInterval({
    start: startOfWeek(new Date(), { weekStartsOn: 0 }),
    end: endOfWeek(new Date(), { weekStartsOn: 0 }),
  });

  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-7 border-b border-[var(--color-line)] bg-[var(--color-surface-muted)]">
        {weekdayHeaders.map((d) => (
          <div key={format(d, 'i')} className="px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)] text-center">
            {format(d, 'EEE', { locale: ptBR })}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const key = dateKey(d);
          const orders = ordersMap.get(key) ?? [];
          const blocked = blockedMap.get(key);
          const todayFlag = key === todayStr;
          const inMonth = isSameMonth(d, anchor);
          return (
            <button
              key={key}
              onClick={() => onSelectDay(d)}
              className={`min-h-[110px] border-b border-r border-[var(--color-line)] p-2 text-left transition-colors ${
                inMonth ? 'bg-[var(--color-surface)]' : 'bg-[var(--color-surface-muted)]/40'
              } hover:bg-[var(--color-surface-muted)]`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className={`inline-flex items-center justify-center rounded-full w-6 h-6 text-[11.5px] font-semibold tabular-nums ${
                  todayFlag
                    ? 'bg-[var(--color-brand)] text-white'
                    : inMonth ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-faint)]'
                }`}>
                  {format(d, 'd')}
                </span>
                {orders.length > 0 && (
                  <span className="text-[9.5px] font-semibold rounded-full bg-[var(--color-ink)] text-white px-1.5 py-0.5">
                    {orders.length}
                  </span>
                )}
              </div>
              {blocked && (
                <div className="flex items-center gap-1 rounded border border-[var(--color-alert)]/25 bg-[var(--color-alert)]/10 px-1 py-0.5 text-[10px] text-[var(--color-alert)] mb-1">
                  <AlertTriangle className="h-2.5 w-2.5 flex-shrink-0" strokeWidth={2} />
                  <span className="truncate">{blocked}</span>
                </div>
              )}
              <div className="space-y-0.5">
                {orders.slice(0, 3).map((o) => (
                  <div
                    key={o.id}
                    className={`truncate text-[10.5px] px-1 py-0.5 rounded ${STATUS_COLORS[o.status]}`}
                    title={`${o.pickupTime} • ${o.customerName}`}
                  >
                    <span className="font-semibold tabular-nums">{o.pickupTime}</span>{' '}
                    <span className="font-medium">{o.customerName}</span>
                  </div>
                ))}
                {orders.length > 3 && (
                  <div className="text-[10px] text-[var(--color-ink-muted)] px-1">+ {orders.length - 3} mais</div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const OrderRow: React.FC<{ order: Order; onClick: () => void }> = ({ order, onClick }) => (
  <button
    onClick={onClick}
    className="flex w-full items-center gap-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-left shadow-[var(--shadow-card)] transition-all hover:border-[var(--color-brand)]/30 hover:shadow-[var(--shadow-pop)]"
  >
    <div className="flex items-center gap-1.5 text-[13px] font-semibold tabular-nums text-[var(--color-ink-muted)]">
      <Clock className="h-3.5 w-3.5" strokeWidth={1.8} />
      {order.pickupTime}
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-[13.5px] font-semibold truncate">{order.customerName}</p>
      <p className="text-[12px] text-[var(--color-ink-muted)] truncate">
        {order.items.map((i) => `${i.quantity}× ${i.product}`).join(', ')}
      </p>
    </div>
    <span className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_COLORS[order.status]}`}>
      {STATUS_LABELS[order.status]}
    </span>
    <span className="flex-shrink-0 text-[13px] font-bold tabular-nums text-[var(--color-ink)]">
      {currency(order.total)}
    </span>
  </button>
);

