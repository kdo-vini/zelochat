import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  Calendar as CalendarIcon,
  Clock,
  MapPin,
  Phone,
  Plus,
  X,
} from 'lucide-react';
import { format, isToday, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { Order, ZeloState } from '../../types';
import { STATUS_COLORS, STATUS_LABELS } from '../../constants';

const currency = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

function groupOrdersByDate(orders: Order[]): { date: string; orders: Order[] }[] {
  const sorted = [...orders].sort((a, b) => {
    if (a.pickupDate !== b.pickupDate) return a.pickupDate.localeCompare(b.pickupDate);
    return a.pickupTime.localeCompare(b.pickupTime);
  });
  const map = new Map<string, Order[]>();
  for (const o of sorted) {
    const group = map.get(o.pickupDate) ?? [];
    group.push(o);
    map.set(o.pickupDate, group);
  }
  return Array.from(map.entries()).map(([date, orders]) => ({ date, orders }));
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
  const today = format(new Date(), 'yyyy-MM-dd');

  const [showBlockPanel, setShowBlockPanel] = useState(false);
  const [newBlockDate, setNewBlockDate] = useState('');
  const [newBlockReason, setNewBlockReason] = useState('');
  const [blockError, setBlockError] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const allGroups = groupOrdersByDate(state.orders);
  const upcomingGroups = allGroups.filter(g => g.date >= today);
  const pastGroups = allGroups.filter(g => g.date < today);

  const handleAddBlock = () => {
    if (!newBlockDate) { setBlockError('Selecione uma data.'); return; }
    if (!newBlockReason.trim()) { setBlockError('Informe o motivo.'); return; }
    if (state.blockedDates.some(b => b.date === newBlockDate)) {
      setBlockError('Esta data já está bloqueada.'); return;
    }
    setState(prev => ({
      ...prev,
      blockedDates: [...prev.blockedDates, { date: newBlockDate, reason: newBlockReason.trim() }],
    }));
    setNewBlockDate('');
    setNewBlockReason('');
    setBlockError('');
  };

  const handleRemoveBlock = (date: string) => {
    setState(prev => ({
      ...prev,
      blockedDates: prev.blockedDates.filter(b => b.date !== date),
    }));
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-8 py-5">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Agenda</h1>
          <p className="text-[13px] text-[var(--color-ink-muted)]">Pedidos por data e horário de retirada</p>
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

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Agenda list */}
        <div className="flex-1 overflow-y-auto px-8 py-6 custom-scrollbar space-y-6">
          {upcomingGroups.length === 0 && pastGroups.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <CalendarIcon className="mb-4 h-10 w-10 text-[var(--color-ink-faint)]" />
              <p className="text-[15px] font-semibold text-[var(--color-ink-soft)]">Nenhum pedido agendado</p>
              <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
                Pedidos com data de retirada aparecem aqui.
              </p>
            </div>
          )}

          {upcomingGroups.map(group => <DayGroup key={group.date} group={group} state={state} today={today} onSelectOrder={setSelectedOrder} />)}

          {pastGroups.length > 0 && (
            <>
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-[var(--color-line)]" />
                <span className="text-[11.5px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
                  Pedidos anteriores
                </span>
                <div className="h-px flex-1 bg-[var(--color-line)]" />
              </div>
              <div className="space-y-6 opacity-60">
                {pastGroups.map(group => <DayGroup key={group.date} group={group} state={state} today={today} onSelectOrder={setSelectedOrder} />)}
              </div>
            </>
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
                  {/* Existing blocked dates */}
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
                                {block.date === today && (
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

                  {/* Add new block */}
                  <div className="border-t border-[var(--color-line)] px-5 py-4 space-y-3">
                    <p className="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
                      Bloquear nova data
                    </p>
                    <input
                      type="date"
                      value={newBlockDate}
                      min={today}
                      onChange={e => { setNewBlockDate(e.target.value); setBlockError(''); }}
                      className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-muted)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/20"
                    />
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

const DayGroup: React.FC<{
  group: { date: string; orders: Order[] };
  state: ZeloState;
  today: string;
  onSelectOrder: (o: Order) => void;
}> = ({ group, state, today, onSelectOrder }) => {
  const dateObj = parseISO(group.date);
  const todayFlag = isToday(dateObj);
  const block = state.blockedDates.find(b => b.date === group.date);

  const dayLabel = format(dateObj, "EEEE, dd 'de' MMMM", { locale: ptBR });
  const capitalizedDay = dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1);

  return (
    <div>
      {/* Day header */}
      <div className="mb-3 flex items-center gap-3">
        <div className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${todayFlag ? 'bg-[var(--color-brand)]' : 'bg-[var(--color-ink-faint)]'}`} />
        <span className={`text-[13.5px] font-semibold ${todayFlag ? 'text-[var(--color-brand-deep)]' : 'text-[var(--color-ink-soft)]'}`}>
          {capitalizedDay}
        </span>
        {todayFlag && (
          <span className="rounded-full bg-[var(--color-brand)] px-2 py-0.5 text-[10px] font-bold text-white">
            HOJE
          </span>
        )}
      </div>

      {/* Blocked date warning */}
      {block && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-[var(--color-alert)]/20 bg-[var(--color-alert)]/8 px-3 py-2 text-[12.5px] text-[var(--color-alert)]">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={2} />
          Data bloqueada: {block.reason}
        </div>
      )}

      {/* Order cards */}
      <div className="space-y-2 pl-5">
        {group.orders.map(order => (
          <button
            key={order.id}
            onClick={() => onSelectOrder(order)}
            className="flex w-full items-center gap-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-left shadow-[var(--shadow-card)] transition-all hover:border-[var(--color-brand)]/30 hover:shadow-[var(--shadow-pop)]"
          >
            <div className="flex items-center gap-1.5 text-[13px] font-semibold tabular-nums text-[var(--color-ink-muted)]">
              <Clock className="h-3.5 w-3.5" strokeWidth={1.8} />
              {order.pickupTime}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13.5px] font-semibold truncate">{order.customerName}</p>
              <p className="text-[12px] text-[var(--color-ink-muted)] truncate">
                {order.items.map(i => `${i.quantity}× ${i.product}`).join(', ')}
              </p>
            </div>
            <span className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_COLORS[order.status]}`}>
              {STATUS_LABELS[order.status]}
            </span>
            <span className="flex-shrink-0 text-[13px] font-bold tabular-nums text-[var(--color-ink)]">
              {currency(order.total)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
