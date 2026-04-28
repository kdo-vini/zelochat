import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { X, Phone, MapPin, Clock, StickyNote } from 'lucide-react';
import { ZeloState, Order } from '../../types';
import { STATUS_LABELS } from '../../constants';
import { format, parseISO, isToday } from 'date-fns';
import { ptBR } from 'date-fns/locale';

type View = 'dashboard' | 'chat' | 'kanban' | 'calendar' | 'ai-configs' | 'settings' | 'profile' | 'drivers' | 'catalog';

const COLUMNS: Order['status'][] = ['pending', 'preparing', 'ready', 'out_for_delivery', 'delivered'];

const COLUMN_STYLE: Record<Order['status'], { header: string; dot: string }> = {
  pending:          { header: 'text-[var(--color-warn)]',     dot: 'bg-[var(--color-warn)]' },
  preparing:        { header: 'text-[var(--color-brand)]',    dot: 'bg-[var(--color-brand)]' },
  ready:            { header: 'text-[var(--color-ink-soft)]', dot: 'bg-[var(--color-ink-soft)]' },
  out_for_delivery: { header: 'text-purple-600',              dot: 'bg-purple-500' },
  delivered:        { header: 'text-[var(--color-ink-faint)]', dot: 'bg-[var(--color-ink-faint)]' },
};

const currency = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

export const KanbanView = ({
  state, onDragEnd, setActiveView,
}: { state: ZeloState; onDragEnd: (r: DropResult) => void; setActiveView: (v: View) => void }) => {
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const todayOrders = state.orders.filter(o => isToday(parseISO(o.pickupDate)));

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="px-8 py-5 bg-[var(--color-surface)] border-b border-[var(--color-line)] flex-shrink-0">
        <h1 className="text-[22px] font-semibold tracking-tight">Produção</h1>
        <p className="text-[13px] text-[var(--color-ink-muted)]">Arraste os pedidos para avançar o status.</p>
      </div>

      <div className="flex-1 overflow-hidden relative">
          <div className="h-full flex gap-4 overflow-x-auto p-6 custom-scrollbar">
            {COLUMNS.map(col => {
              const orders = todayOrders.filter(o => o.status === col);
              const style = COLUMN_STYLE[col];
              return (
                <Droppable key={col} droppableId={col}>
                  {(provided, snapshot) => (
                    <div
                      {...provided.droppableProps}
                      ref={provided.innerRef}
                      className={`w-[300px] flex-shrink-0 flex flex-col rounded-xl border transition-colors ${
                        snapshot.isDraggingOver
                          ? 'bg-[var(--color-brand-soft)] border-[var(--color-brand)]/30'
                          : 'bg-[var(--color-surface-muted)] border-[var(--color-line)]'
                      }`}
                    >
                      <div className="px-4 py-3 flex items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-surface)] rounded-t-xl">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${style.dot}`} />
                          <h3 className={`text-[13px] font-semibold uppercase tracking-wide ${style.header}`}>
                            {STATUS_LABELS[col]}
                          </h3>
                        </div>
                        <span className="text-[12px] font-semibold text-[var(--color-ink-faint)] tabular-nums">
                          {orders.length}
                        </span>
                      </div>

                      <div className="flex-1 p-3 space-y-2.5 overflow-y-auto custom-scrollbar">
                        {orders.map((order, index) => (
                          <React.Fragment key={order.id}>
                          <Draggable draggableId={order.id} index={index}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                onClick={() => setSelectedOrder(order)}
                                className={`bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl p-4 cursor-pointer transition-all ${
                                  snapshot.isDragging
                                    ? 'shadow-[var(--shadow-pop)] rotate-[0.8deg]'
                                    : 'shadow-[var(--shadow-card)] hover:border-[var(--color-brand)]/30'
                                }`}
                              >
                                <p className="text-[14px] font-semibold mb-2">{order.customerName}</p>
                                <div className="space-y-1 mb-3">
                                  {order.items.map((item, i) => (
                                    <p key={i} className="text-[12.5px] text-[var(--color-ink-muted)] flex items-center gap-2">
                                      <span className="w-1 h-1 rounded-full bg-[var(--color-ink-faint)] flex-shrink-0" />
                                      {item.quantity}× {item.product}
                                    </p>
                                  ))}
                                  {order.observations && (
                                    <p className="text-[11.5px] text-amber-700 flex items-center gap-1 mt-1.5" title={order.observations}>
                                      <StickyNote className="w-3 h-3 flex-shrink-0" strokeWidth={1.8} />
                                      <span className="line-clamp-1">{order.observations}</span>
                                    </p>
                                  )}
                                </div>
                                <div className="flex items-center justify-between pt-2.5 border-t border-[var(--color-line)]">
                                  <div className="flex items-center gap-1 text-[12px] text-[var(--color-ink-muted)]">
                                    <Clock className="w-3 h-3" strokeWidth={1.8} />
                                    {order.pickupTime || '—'}
                                  </div>
                                  <span className="text-[13px] font-semibold tabular-nums">{currency(order.total)}</span>
                                </div>
                              </div>
                            )}
                          </Draggable>
                          </React.Fragment>
                        ))}
                        {provided.placeholder}
                        {orders.length === 0 && (
                          <div className="py-8 text-center text-[12.5px] text-[var(--color-ink-faint)]">
                            Nenhum pedido
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </Droppable>
              );
            })}
          </div>
          {todayOrders.length === 0 && (
            <div className="absolute inset-6 flex items-center justify-center rounded-xl border border-dashed border-[var(--color-line)] bg-[var(--color-surface)]/90 text-center">
              <div>
                <p className="text-[14px] font-semibold text-[var(--color-ink-soft)]">Nenhum pedido para hoje</p>
                <p className="mt-1 text-[12.5px] text-[var(--color-ink-muted)]">
                  Pedidos agendados para outros dias não aparecem aqui.
                </p>
              </div>
            </div>
          )}
      </div>

      <AnimatePresence>
        {selectedOrder && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/25 z-40"
              onClick={() => setSelectedOrder(null)}
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 340, damping: 32 }}
              className="fixed right-0 top-0 h-full w-full max-w-sm bg-[var(--color-surface)] shadow-[var(--shadow-pop)] z-50 flex flex-col"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-line)]">
                <h3 className="text-[15px] font-semibold">Detalhes do pedido</h3>
                <button
                  onClick={() => setSelectedOrder(null)}
                  className="p-1.5 rounded-md hover:bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar">
                <div className={`inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-full ${
                  COLUMN_STYLE[selectedOrder.status].header
                } bg-[var(--color-surface-muted)]`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${COLUMN_STYLE[selectedOrder.status].dot}`} />
                  {STATUS_LABELS[selectedOrder.status]}
                </div>

                <section>
                  <p className="text-[11.5px] font-semibold text-[var(--color-ink-faint)] uppercase tracking-wider mb-2">Cliente</p>
                  <p className="text-[14px] font-semibold">{selectedOrder.customerName}</p>
                  {selectedOrder.customerPhone && (
                    <div className="flex items-center gap-1.5 text-[12.5px] text-[var(--color-ink-muted)] mt-1">
                      <Phone className="w-3.5 h-3.5" strokeWidth={1.8} />
                      {selectedOrder.customerPhone}
                    </div>
                  )}
                </section>

                <section>
                  <p className="text-[11.5px] font-semibold text-[var(--color-ink-faint)] uppercase tracking-wider mb-2">Retirada</p>
                  <p className="text-[13.5px]">
                    {format(parseISO(selectedOrder.pickupDate), "dd 'de' MMMM", { locale: ptBR })}
                    {' às '}
                    <span className="font-semibold">{selectedOrder.pickupTime}</span>
                  </p>
                </section>

                <section>
                  <p className="text-[11.5px] font-semibold text-[var(--color-ink-faint)] uppercase tracking-wider mb-2">Itens</p>
                  <ul className="space-y-2">
                    {selectedOrder.items.map((item, i) => (
                      <li key={i} className="flex items-center justify-between text-[13.5px]">
                        <span className="flex items-center gap-2 text-[var(--color-ink-soft)]">
                          <span className="w-1 h-1 rounded-full bg-[var(--color-brand)]" />
                          {item.product}
                        </span>
                        <span className="font-medium text-[var(--color-ink-muted)]">×{item.quantity}</span>
                      </li>
                    ))}
                  </ul>
                </section>

                {selectedOrder.deliveryAddress && (
                  <section>
                    <p className="text-[11.5px] font-semibold text-[var(--color-ink-faint)] uppercase tracking-wider mb-2">Entrega</p>
                    <div className="flex items-start gap-2 text-[13px] text-[var(--color-ink-muted)]">
                      <MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" strokeWidth={1.8} />
                      {selectedOrder.deliveryAddress}
                    </div>
                  </section>
                )}

                {selectedOrder.observations && (
                  <section className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                    <div className="flex items-start gap-2">
                      <StickyNote className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-amber-600" strokeWidth={1.8} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11.5px] font-semibold uppercase tracking-wider text-amber-700 mb-1">Observação do cliente</p>
                        <p className="text-[13px] text-amber-900 leading-snug whitespace-pre-wrap break-words">{selectedOrder.observations}</p>
                      </div>
                    </div>
                  </section>
                )}

                <section className="bg-[var(--color-brand-soft)] rounded-xl px-4 py-3 flex justify-between items-center">
                  <span className="text-[13px] font-medium text-[var(--color-brand-deep)]">Total</span>
                  <span className="text-[16px] font-bold text-[var(--color-brand-deep)] tabular-nums">
                    {currency(selectedOrder.total)}
                  </span>
                </section>

                {selectedOrder.status === 'ready' && (
                  <button
                    onClick={() => { setSelectedOrder(null); setActiveView('drivers'); }}
                    className="w-full bg-[var(--color-ink)] text-white py-2.5 rounded-lg text-[13.5px] font-semibold hover:bg-[var(--color-ink-soft)] transition-colors"
                  >
                    Despachar motoboy
                  </button>
                )}
              </div>

              <div className="p-5 border-t border-[var(--color-line)]">
                <button
                  onClick={() => setSelectedOrder(null)}
                  className="w-full bg-[var(--color-surface-muted)] text-[var(--color-ink-soft)] py-2.5 rounded-lg text-[13.5px] font-semibold hover:bg-[var(--color-line)] transition-colors"
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
