import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import {
  X, Phone, MapPin, Clock, Plus, Package, ChevronRight,
  User, ShoppingBag, Pencil, Trash2, CreditCard, Truck, Store, Calendar, StickyNote,
} from 'lucide-react';
import { ZeloState, Order } from '../../types';
import { maskBrazilianPhone, maskTime24h } from '../../domain/chat';
import { STATUS_LABELS, STATUS_COLORS } from '../../constants';
import { format, parseISO, formatDistanceToNowStrict } from 'date-fns';
import { ptBR } from 'date-fns/locale';

type View = 'dashboard' | 'chat' | 'kanban' | 'calendar' | 'ai-configs' | 'settings' | 'profile' | 'drivers' | 'catalog';

const COLUMNS: Order['status'][] = ['pending', 'preparing', 'ready', 'out_for_delivery', 'delivered'];

const COLUMN_STYLE: Record<Order['status'], { header: string; dot: string; border: string }> = {
  pending:          { header: 'text-[var(--color-warn)]',       dot: 'bg-[var(--color-warn)]',       border: 'border-[var(--color-warn)]/20' },
  preparing:        { header: 'text-[var(--color-brand)]',      dot: 'bg-[var(--color-brand)]',      border: 'border-[var(--color-brand)]/20' },
  ready:            { header: 'text-emerald-600',               dot: 'bg-emerald-500',               border: 'border-emerald-200' },
  out_for_delivery: { header: 'text-purple-600',                dot: 'bg-purple-500',                border: 'border-purple-200' },
  delivered:        { header: 'text-[var(--color-ink-faint)]',  dot: 'bg-[var(--color-ink-faint)]',  border: 'border-[var(--color-line)]' },
};

const currency = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

const timeAgo = (iso: string) => {
  try {
    return formatDistanceToNowStrict(new Date(iso), { locale: ptBR, addSuffix: true });
  } catch { return ''; }
};

/* ─── Manual order modal ─────────────────────────────────────── */
interface OrderFormData {
  customerName: string;
  customerPhone: string;
  pickupDate: string;
  pickupTime: string;
  deliveryAddress: string;
  paymentMethod: string;
  observations: string;
  items: { product: string; quantity: number }[];
  total: string;
}

const brasiliaDateISO = () => {
  const [day, month, year] = new Date()
    .toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    .split('/');
  return `${year}-${month}-${day}`;
};

const brasiliaTimeHHMM = () =>
  new Date().toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

const isoToBR = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const makeEmptyForm = (): OrderFormData => ({
  customerName: '',
  customerPhone: '',
  pickupDate: brasiliaDateISO(),
  pickupTime: brasiliaTimeHHMM(),
  deliveryAddress: '',
  paymentMethod: '',
  observations: '',
  items: [{ product: '', quantity: 1 }],
  total: '',
});

const PAYMENT_OPTIONS = ['Pix', 'Dinheiro', 'Cartão'] as const;

function OrderModal({
  onClose,
  onSave,
  editOrder,
}: {
  onClose: () => void;
  onSave: (data: Omit<Order, 'id' | 'createdAt'>) => Promise<void>;
  editOrder?: Order;
}) {
  const initialForm = editOrder
    ? {
        customerName: editOrder.customerName,
        customerPhone: editOrder.customerPhone,
        pickupDate: editOrder.pickupDate,
        pickupTime: editOrder.pickupTime,
        deliveryAddress: editOrder.deliveryAddress ?? '',
        paymentMethod: editOrder.paymentMethod ?? '',
        observations: editOrder.observations ?? '',
        items: editOrder.items.length > 0 ? editOrder.items : [{ product: '', quantity: 1 }],
        total: editOrder.total > 0 ? String(editOrder.total).replace('.', ',') : '',
      }
    : makeEmptyForm();
  const [form, setForm] = useState<OrderFormData>(initialForm);
  const [dateDisplay, setDateDisplay] = useState(() => isoToBR(initialForm.pickupDate));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const setField = <K extends keyof OrderFormData>(k: K, v: OrderFormData[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const setItem = (i: number, field: 'product' | 'quantity', val: string | number) =>
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((it, idx) => idx === i ? { ...it, [field]: val } : it),
    }));

  const addItem = () =>
    setForm((prev) => ({ ...prev, items: [...prev.items, { product: '', quantity: 1 }] }));

  const removeItem = (i: number) =>
    setForm((prev) => ({ ...prev, items: prev.items.filter((_, idx) => idx !== i) }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!form.customerName.trim()) { setFormError('Nome do cliente obrigatório.'); return; }
    if (!form.pickupDate || !form.pickupTime) { setFormError('Data e hora obrigatórias.'); return; }
    const validItems = form.items.filter((it) => it.product.trim());
    if (validItems.length === 0) { setFormError('Adicione ao menos um item.'); return; }

    setSaving(true);
    try {
      await onSave({
        customerName:    form.customerName.trim(),
        customerPhone:   form.customerPhone.trim(),
        items:           validItems,
        pickupDate:      form.pickupDate,
        pickupTime:      form.pickupTime,
        deliveryAddress: form.deliveryAddress.trim() || undefined,
        paymentMethod:   form.paymentMethod.trim() || undefined,
        observations:    form.observations.trim() || undefined,
        status:          'pending',
        total:           parseFloat(form.total.replace(',', '.')) || 0,
      });
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erro ao salvar pedido.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
      >
        <div
          className="bg-[var(--color-surface)] rounded-2xl shadow-[var(--shadow-pop)] w-full max-w-md max-h-[90vh] flex flex-col pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-line)]">
            <div className="flex items-center gap-2">
              <ShoppingBag className="w-4 h-4 text-[var(--color-brand)]" strokeWidth={2} />
              <h3 className="text-[15px] font-semibold">{editOrder ? 'Editar pedido' : 'Novo pedido manual'}</h3>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-[12px] font-semibold text-[var(--color-ink-muted)] mb-1.5">
                  Nome do cliente *
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-ink-faint)]" strokeWidth={1.8} />
                  <input
                    type="text"
                    value={form.customerName}
                    onChange={(e) => setField('customerName', e.target.value)}
                    placeholder="Nome completo"
                    className="w-full pl-8 pr-3 py-2 text-[13.5px] bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg focus:outline-none focus:border-[var(--color-brand)] focus:ring-1 focus:ring-[var(--color-brand)]/20"
                  />
                </div>
              </div>

              <div className="col-span-2">
                <label className="block text-[12px] font-semibold text-[var(--color-ink-muted)] mb-1.5">
                  Telefone
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-ink-faint)]" strokeWidth={1.8} />
                  <input
                    type="tel"
                    value={form.customerPhone}
                    onChange={(e) => setField('customerPhone', maskBrazilianPhone(e.target.value))}
                    placeholder="(XX) XXXXX-XXXX"
                    className="w-full pl-8 pr-3 py-2 text-[13.5px] bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg focus:outline-none focus:border-[var(--color-brand)] focus:ring-1 focus:ring-[var(--color-brand)]/20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-[var(--color-ink-muted)] mb-1.5">
                  Data *
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="DD/MM/AAAA"
                  value={dateDisplay}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 8);
                    let display = digits;
                    if (digits.length > 4) display = `${digits.slice(0,2)}/${digits.slice(2,4)}/${digits.slice(4)}`;
                    else if (digits.length > 2) display = `${digits.slice(0,2)}/${digits.slice(2)}`;
                    setDateDisplay(display);
                    if (digits.length === 8) {
                      const [d, m, y] = [digits.slice(0,2), digits.slice(2,4), digits.slice(4,8)];
                      setField('pickupDate', `${y}-${m}-${d}`);
                    }
                  }}
                  className="w-full px-3 py-2 text-[13.5px] bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg focus:outline-none focus:border-[var(--color-brand)]"
                />
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-[var(--color-ink-muted)] mb-1.5">
                  Hora *
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.pickupTime}
                  onChange={(e) => {
                    const masked = maskTime24h(e.target.value);
                    if (masked.length === 5) {
                      const [h, m] = masked.split(':').map(Number);
                      if (h > 23 || m > 59) return;
                    }
                    setField('pickupTime', masked);
                  }}
                  placeholder="HH:MM"
                  maxLength={5}
                  className="w-full px-3 py-2 text-[13.5px] bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg focus:outline-none focus:border-[var(--color-brand)]"
                />
              </div>
            </div>

            {/* Items */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[12px] font-semibold text-[var(--color-ink-muted)]">
                  Itens *
                </label>
                <button
                  type="button"
                  onClick={addItem}
                  className="text-[11.5px] font-semibold text-[var(--color-brand)] hover:underline flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Adicionar
                </button>
              </div>
              <div className="space-y-2">
                {form.items.map((item, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={item.product}
                      onChange={(e) => setItem(i, 'product', e.target.value)}
                      placeholder="Produto"
                      className="flex-1 px-3 py-2 text-[13px] bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg focus:outline-none focus:border-[var(--color-brand)]"
                    />
                    <input
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(e) => setItem(i, 'quantity', parseInt(e.target.value) || 1)}
                      className="w-14 px-2 py-2 text-[13px] text-center bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg focus:outline-none focus:border-[var(--color-brand)]"
                    />
                    {form.items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItem(i)}
                        className="p-1.5 text-[var(--color-ink-faint)] hover:text-red-500 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Delivery address */}
            <div>
              <label className="block text-[12px] font-semibold text-[var(--color-ink-muted)] mb-1.5">
                Endereço de entrega (deixe vazio para retirada)
              </label>
              <div className="relative">
                <MapPin className="absolute left-3 top-3 w-3.5 h-3.5 text-[var(--color-ink-faint)]" strokeWidth={1.8} />
                <input
                  type="text"
                  value={form.deliveryAddress}
                  onChange={(e) => setField('deliveryAddress', e.target.value)}
                  placeholder="Rua, número, bairro"
                  className="w-full pl-8 pr-3 py-2 text-[13.5px] bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg focus:outline-none focus:border-[var(--color-brand)]"
                />
              </div>
            </div>

            {/* Payment method */}
            <div>
              <label className="block text-[12px] font-semibold text-[var(--color-ink-muted)] mb-1.5">
                Forma de pagamento
              </label>
              <div className="flex gap-1.5 flex-wrap">
                {PAYMENT_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setField('paymentMethod', form.paymentMethod === opt ? '' : opt)}
                    className={`px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border transition-colors ${
                      form.paymentMethod === opt
                        ? 'bg-[var(--color-brand)] text-white border-[var(--color-brand)]'
                        : 'bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)] border-[var(--color-line)] hover:border-[var(--color-brand)]/40'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
                <input
                  type="text"
                  value={PAYMENT_OPTIONS.includes(form.paymentMethod as typeof PAYMENT_OPTIONS[number]) ? '' : form.paymentMethod}
                  onChange={(e) => setField('paymentMethod', e.target.value)}
                  placeholder="Outro…"
                  className="flex-1 min-w-[100px] px-3 py-1.5 text-[12.5px] bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg focus:outline-none focus:border-[var(--color-brand)]"
                />
              </div>
            </div>

            {/* Observations */}
            <div>
              <label className="block text-[12px] font-semibold text-[var(--color-ink-muted)] mb-1.5">
                Observações (opcional)
              </label>
              <div className="relative">
                <StickyNote className="absolute left-3 top-3 w-3.5 h-3.5 text-[var(--color-ink-faint)]" strokeWidth={1.8} />
                <textarea
                  value={form.observations}
                  onChange={(e) => setField('observations', e.target.value.slice(0, 500))}
                  placeholder="Ex: sem cebola, ponto da carne, deixar na portaria…"
                  rows={3}
                  maxLength={500}
                  className="w-full pl-8 pr-3 py-2 text-[13.5px] bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg focus:outline-none focus:border-[var(--color-brand)] focus:ring-1 focus:ring-[var(--color-brand)]/20 resize-none"
                />
              </div>
            </div>

            {/* Total */}
            <div>
              <label className="block text-[12px] font-semibold text-[var(--color-ink-muted)] mb-1.5">
                Total (R$)
              </label>
              <input
                type="text"
                value={form.total}
                onChange={(e) => setField('total', e.target.value)}
                placeholder="0,00"
                className="w-full px-3 py-2 text-[13.5px] bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg focus:outline-none focus:border-[var(--color-brand)]"
              />
            </div>

            {formError && (
              <p className="text-[12.5px] text-red-500 font-medium">{formError}</p>
            )}
          </form>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-[var(--color-line)] flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg text-[13.5px] font-semibold bg-[var(--color-surface-muted)] text-[var(--color-ink-soft)] hover:bg-[var(--color-line)] transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={(e) => { void handleSubmit(e as unknown as React.FormEvent); }}
              disabled={saving}
              className="flex-1 py-2.5 rounded-lg text-[13.5px] font-semibold bg-[var(--color-brand)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? 'Salvando…' : editOrder ? 'Salvar alterações' : 'Salvar pedido'}
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );
}

/* ─── Order detail drawer ─────────────────────────────────────── */
function OrderDrawer({
  order,
  onClose,
  setActiveView,
  onEdit,
  onDelete,
  onUpdateStatus,
}: {
  order: Order;
  onClose: () => void;
  setActiveView: (v: View) => void;
  onEdit: () => void;
  onDelete: (id: string) => void;
  onUpdateStatus: (id: string, status: Order['status']) => void;
}) {
  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/25 z-40"
        onClick={onClose}
      />
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 340, damping: 32 }}
        className="fixed right-0 top-0 h-full w-full max-w-sm bg-[var(--color-surface)] shadow-[var(--shadow-pop)] z-50 flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-line)]">
          <h3 className="text-[15px] font-semibold">Detalhes do pedido</h3>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar">
          <div className="flex items-center gap-2 flex-wrap">
            <div className={`inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-full ${COLUMN_STYLE[order.status].header} bg-[var(--color-surface-muted)]`}>
              <span className={`w-1.5 h-1.5 rounded-full ${COLUMN_STYLE[order.status].dot}`} />
              {STATUS_LABELS[order.status]}
            </div>
            {order.deliveryAddress ? (
              <div className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-full bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]">
                <Truck className="w-3 h-3" strokeWidth={2} />
                Delivery
              </div>
            ) : (
              <div className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-full bg-[var(--color-surface-muted)] text-[var(--color-ink-soft)]">
                <Store className="w-3 h-3" strokeWidth={2} />
                Retirada
              </div>
            )}
          </div>

          <section>
            <p className="text-[11.5px] font-semibold text-[var(--color-ink-faint)] uppercase tracking-wider mb-2">Cliente</p>
            <p className="text-[14px] font-semibold">{order.customerName}</p>
            {order.customerPhone && (
              <div className="flex items-center gap-1.5 text-[12.5px] text-[var(--color-ink-muted)] mt-1">
                <Phone className="w-3.5 h-3.5" strokeWidth={1.8} />
                {order.customerPhone}
              </div>
            )}
          </section>

          <section>
            <p className="text-[11.5px] font-semibold text-[var(--color-ink-faint)] uppercase tracking-wider mb-2">
              {order.deliveryAddress ? 'Entrega agendada' : 'Retirada'}
            </p>
            <div className="flex items-center gap-1.5 text-[13.5px]">
              <Calendar className="w-3.5 h-3.5 text-[var(--color-ink-muted)]" strokeWidth={1.8} />
              <span>
                {format(parseISO(order.pickupDate), "dd 'de' MMMM", { locale: ptBR })}
                {' às '}
                <span className="font-semibold">{order.pickupTime}</span>
              </span>
            </div>
          </section>

          {order.deliveryAddress && (
            <section>
              <p className="text-[11.5px] font-semibold text-[var(--color-ink-faint)] uppercase tracking-wider mb-2">Endereço</p>
              <div className="flex items-start gap-2 text-[13px] text-[var(--color-ink-soft)] bg-[var(--color-surface-muted)] rounded-lg px-3 py-2">
                <MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-[var(--color-brand)]" strokeWidth={1.8} />
                <span className="leading-snug">{order.deliveryAddress}</span>
              </div>
            </section>
          )}

          <section>
            <p className="text-[11.5px] font-semibold text-[var(--color-ink-faint)] uppercase tracking-wider mb-2">Forma de pagamento</p>
            <div className="flex items-center gap-2 text-[13.5px] text-[var(--color-ink-soft)]">
              <CreditCard className="w-3.5 h-3.5 text-[var(--color-ink-muted)]" strokeWidth={1.8} />
              <span className="font-medium">{order.paymentMethod || 'Não informada'}</span>
            </div>
          </section>

          <section>
            <p className="text-[11.5px] font-semibold text-[var(--color-ink-faint)] uppercase tracking-wider mb-2">Itens</p>
            <ul className="space-y-2">
              {order.items.map((item, i) => (
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

          {order.observations && (
            <section className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <div className="flex items-start gap-2">
                <StickyNote className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-amber-600" strokeWidth={1.8} />
                <div className="min-w-0 flex-1">
                  <p className="text-[11.5px] font-semibold uppercase tracking-wider text-amber-700 mb-1">Observação do cliente</p>
                  <p className="text-[13px] text-amber-900 leading-snug whitespace-pre-wrap break-words">{order.observations}</p>
                </div>
              </div>
            </section>
          )}

          <section className="bg-[var(--color-brand-soft)] rounded-xl px-4 py-3 flex justify-between items-center">
            <span className="text-[13px] font-medium text-[var(--color-brand-deep)]">Total</span>
            <span className="text-[16px] font-bold text-[var(--color-brand-deep)] tabular-nums">
              {currency(order.total)}
            </span>
          </section>

          {order.status === 'pending' && (
            <button
              onClick={() => onUpdateStatus(order.id, 'preparing')}
              className="w-full bg-[var(--color-brand)] text-white py-2.5 rounded-lg text-[13.5px] font-semibold hover:opacity-90 transition-opacity"
            >
              Iniciar preparo
            </button>
          )}
          {order.status === 'preparing' && (
            <button
              onClick={() => onUpdateStatus(order.id, 'ready')}
              className="w-full bg-[var(--color-brand)] text-white py-2.5 rounded-lg text-[13.5px] font-semibold hover:opacity-90 transition-opacity"
            >
              Marcar como pronto
            </button>
          )}
          {order.status === 'ready' && (
            order.deliveryAddress ? (
              <button
                onClick={() => { onClose(); setActiveView('drivers'); }}
                className="w-full bg-[var(--color-ink)] text-white py-2.5 rounded-lg text-[13.5px] font-semibold hover:bg-[var(--color-ink-soft)] transition-colors"
              >
                Despachar motoboy
              </button>
            ) : (
              <button
                onClick={() => onUpdateStatus(order.id, 'delivered')}
                className="w-full bg-[var(--color-brand)] text-white py-2.5 rounded-lg text-[13.5px] font-semibold hover:opacity-90 transition-opacity"
              >
                Marcar como entregue
              </button>
            )
          )}
          {order.status === 'out_for_delivery' && (
            <button
              onClick={() => onUpdateStatus(order.id, 'delivered')}
              className="w-full bg-[var(--color-brand)] text-white py-2.5 rounded-lg text-[13.5px] font-semibold hover:opacity-90 transition-opacity"
            >
              Marcar como entregue
            </button>
          )}
          {order.status === 'delivered' && (
            <p className="text-center text-[12.5px] text-[var(--color-ink-faint)] py-1">
              Pedido finalizado
            </p>
          )}
        </div>

        <div className="p-5 border-t border-[var(--color-line)] space-y-2">
          <div className="flex gap-2">
            <button
              onClick={onEdit}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-[13.5px] font-semibold bg-[var(--color-surface-muted)] text-[var(--color-ink-soft)] hover:bg-[var(--color-line)] transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" strokeWidth={1.8} />
              Editar
            </button>
            <button
              onClick={() => {
                if (confirm(`Excluir pedido de ${order.customerName}?`)) {
                  onDelete(order.id);
                  onClose();
                }
              }}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-[13.5px] font-semibold bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" strokeWidth={1.8} />
              Excluir
            </button>
          </div>
          <button
            onClick={onClose}
            className="w-full bg-[var(--color-surface-muted)] text-[var(--color-ink-soft)] py-2.5 rounded-lg text-[13.5px] font-semibold hover:bg-[var(--color-line)] transition-colors"
          >
            Fechar
          </button>
        </div>
      </motion.div>
    </>
  );
}

/* ─── Order feed sidebar card ────────────────────────────────── */
function FeedCard({
  order,
  selected,
  onClick,
  scheduled = false,
}: {
  order: Order;
  selected: boolean;
  onClick: () => void;
  scheduled?: boolean;
}) {
  const style = COLUMN_STYLE[order.status];
  const isDelivery = !!order.deliveryAddress;
  // Scheduled orders: show pickup date+time prominently so the operator can plan the day.
  // Today's orders: show "x min atrás" since the planning concern is recency.
  const pickupBadge = (() => {
    try {
      return `${format(parseISO(order.pickupDate), 'dd/MM', { locale: ptBR })} • ${order.pickupTime}`;
    } catch { return order.pickupTime; }
  })();
  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      onClick={onClick}
      className={`w-full text-left rounded-xl border p-3.5 transition-all ${
        selected
          ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)]'
          : 'border-[var(--color-line)] bg-[var(--color-surface)] hover:border-[var(--color-brand)]/30'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold leading-tight truncate">{order.customerName}</p>
          <div className="flex items-center gap-1 mt-0.5 text-[10.5px] text-[var(--color-ink-faint)]">
            {isDelivery ? <Truck className="w-3 h-3" strokeWidth={1.8} /> : <Store className="w-3 h-3" strokeWidth={1.8} />}
            <span>{isDelivery ? 'Delivery' : 'Retirada'}</span>
          </div>
        </div>
        <ChevronRight className="w-3.5 h-3.5 text-[var(--color-ink-faint)] flex-shrink-0 mt-0.5" strokeWidth={2} />
      </div>
      <p className="text-[12px] text-[var(--color-ink-muted)] truncate mb-2">
        {order.items.map((it) => `${it.quantity}× ${it.product}`).join(', ')}
      </p>
      {order.observations && (
        <div className="flex items-center gap-1 mb-2 text-[11px] text-amber-700" title={order.observations}>
          <StickyNote className="w-3 h-3 flex-shrink-0" strokeWidth={1.8} />
          <span className="line-clamp-1">{order.observations}</span>
        </div>
      )}
      {scheduled && (
        <div className="flex items-center gap-1.5 mb-2 text-[11px] font-medium text-[var(--color-brand-deep)] bg-[var(--color-brand-soft)] rounded-md px-2 py-1">
          <Calendar className="w-3 h-3" strokeWidth={2} />
          <span>{pickupBadge}</span>
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${style.header} bg-[var(--color-surface-muted)]`}>
          <span className={`w-1 h-1 rounded-full ${style.dot}`} />
          {STATUS_LABELS[order.status]}
        </span>
        <span className="text-[11px] text-[var(--color-ink-faint)]">
          {scheduled ? pickupBadge : timeAgo(order.createdAt)}
        </span>
      </div>
    </motion.button>
  );
}

/* ─── Main ProductionView ─────────────────────────────────────── */
export const ProductionView = ({
  state,
  onDragEnd,
  setActiveView,
  onAddOrder,
  onEditOrder,
  onDeleteOrder,
  onUpdateStatus,
  isAuthenticated,
}: {
  state: ZeloState;
  onDragEnd: (r: DropResult) => void;
  setActiveView: (v: View) => void;
  onAddOrder: (payload: Omit<Order, 'id' | 'createdAt'>) => Promise<void>;
  onEditOrder: (id: string, payload: Omit<Order, 'id' | 'createdAt'>) => Promise<void>;
  onDeleteOrder: (id: string) => Promise<void>;
  onUpdateStatus: (id: string, status: Order['status']) => void;
  isAuthenticated: boolean;
}) => {
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [feedFilter, setFeedFilter] = useState<Order['status'] | 'all'>('all');

  const feedOrders = feedFilter === 'all'
    ? state.orders
    : state.orders.filter((o) => o.status === feedFilter);

  // Split the feed by pickup date relative to today (Brasília TZ to match how the date is stored).
  // "Hoje" = pickup_date <= today (today + any past dates not yet delivered/cleaned up).
  // "Agendados" = pickup_date > today.
  const todayKey = brasiliaDateISO();
  const todayOrders = feedOrders.filter((o) => (o.pickupDate || '') <= todayKey);
  const scheduledOrders = feedOrders.filter((o) => (o.pickupDate || '') > todayKey);

  // Look up the live order so the drawer reflects status changes from onUpdateStatus
  // (selectedOrder is a snapshot taken at click time and would otherwise go stale).
  const liveSelectedOrder = selectedOrder
    ? state.orders.find((o) => o.id === selectedOrder.id) ?? null
    : null;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 bg-[var(--color-surface)] border-b border-[var(--color-line)] flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight">Produção</h1>
          <p className="text-[12.5px] text-[var(--color-ink-muted)] mt-0.5">
            {state.orders.filter((o) => o.status !== 'delivered').length} pedidos ativos
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          disabled={!isAuthenticated}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[var(--color-brand)] text-white text-[13px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
          Novo pedido
        </button>
      </div>

      {/* Body: sidebar + kanban */}
      <div className="flex-1 min-h-0 flex overflow-hidden">

        {/* ── Left sidebar: order feed ──────────────────────────── */}
        <aside className="w-full md:w-[280px] md:flex-shrink-0 flex flex-col border-r border-[var(--color-line)] bg-[var(--color-surface)]">
          {/* Feed header + filter chips */}
          <div className="px-3 py-3 border-b border-[var(--color-line)] space-y-2 flex-shrink-0">
            <div className="flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5 text-[var(--color-ink-muted)]" strokeWidth={1.8} />
              <span className="text-[12px] font-semibold text-[var(--color-ink-muted)] uppercase tracking-wide">Fila de pedidos</span>
            </div>
            <div className="flex gap-1 flex-wrap">
              {(['all', 'pending', 'preparing', 'ready'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFeedFilter(f)}
                  className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-full transition-colors ${
                    feedFilter === f
                      ? 'bg-[var(--color-brand)] text-white'
                      : 'bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)] hover:bg-[var(--color-line)]'
                  }`}
                >
                  {f === 'all' ? 'Todos' : STATUS_LABELS[f]}
                </button>
              ))}
            </div>
          </div>

          {/* Scrollable feed */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
            <AnimatePresence initial={false}>
              {feedOrders.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="py-12 flex flex-col items-center gap-2 text-center"
                >
                  <Package className="w-7 h-7 text-[var(--color-ink-faint)]" strokeWidth={1.4} />
                  <p className="text-[12.5px] text-[var(--color-ink-faint)]">
                    Nenhum pedido ainda
                  </p>
                  <button
                    onClick={() => setShowAddModal(true)}
                    disabled={!isAuthenticated}
                    className="mt-1 text-[12px] font-semibold text-[var(--color-brand)] hover:underline disabled:opacity-40"
                  >
                    + Adicionar manualmente
                  </button>
                </motion.div>
              ) : (
                <>
                  <div>
                    <div className="flex items-center justify-between px-1 mb-1.5">
                      <span className="text-[10.5px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                        Hoje
                      </span>
                      <span className="text-[10.5px] font-semibold tabular-nums text-[var(--color-ink-faint)]">
                        {todayOrders.length}
                      </span>
                    </div>
                    {todayOrders.length === 0 ? (
                      <p className="text-[11.5px] text-[var(--color-ink-faint)] px-1 py-2">Sem pedidos para hoje.</p>
                    ) : (
                      <div className="space-y-2">
                        {todayOrders.map((order) => (
                          <React.Fragment key={order.id}>
                            <FeedCard
                              order={order}
                              selected={selectedOrder?.id === order.id}
                              onClick={() => { setSelectedOrder(order); }}
                            />
                          </React.Fragment>
                        ))}
                      </div>
                    )}
                  </div>

                  {scheduledOrders.length > 0 && (
                    <div className="pt-1">
                      <div className="flex items-center justify-between px-1 mb-1.5">
                        <span className="flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                          <Calendar className="w-3 h-3" strokeWidth={2} />
                          Agendados
                        </span>
                        <span className="text-[10.5px] font-semibold tabular-nums text-[var(--color-ink-faint)]">
                          {scheduledOrders.length}
                        </span>
                      </div>
                      <div className="space-y-2">
                        {scheduledOrders.map((order) => (
                          <React.Fragment key={order.id}>
                            <FeedCard
                              order={order}
                              selected={selectedOrder?.id === order.id}
                              onClick={() => { setSelectedOrder(order); }}
                              scheduled
                            />
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </AnimatePresence>
          </div>
        </aside>

        {/* ── Right: Kanban board (desktop only) ─────────────────── */}
        <div className="hidden md:block flex-1 min-w-0 overflow-hidden relative">
          <div className="h-full flex gap-3 overflow-x-auto p-4 custom-scrollbar">
            {COLUMNS.map((col) => {
              const colOrders = state.orders.filter((o) => o.status === col);
              const style = COLUMN_STYLE[col];
              return (
                <Droppable key={col} droppableId={col}>
                  {(provided, snapshot) => (
                    <div
                      {...provided.droppableProps}
                      ref={provided.innerRef}
                      className={`w-[260px] flex-shrink-0 flex flex-col rounded-xl border transition-colors ${
                        snapshot.isDraggingOver
                          ? 'bg-[var(--color-brand-soft)] border-[var(--color-brand)]/30'
                          : `bg-[var(--color-surface-muted)] ${style.border}`
                      }`}
                    >
                      <div className="px-3.5 py-2.5 flex items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-surface)] rounded-t-xl">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${style.dot}`} />
                          <h3 className={`text-[12px] font-semibold uppercase tracking-wide ${style.header}`}>
                            {STATUS_LABELS[col]}
                          </h3>
                        </div>
                        <span className="text-[11px] font-semibold text-[var(--color-ink-faint)] tabular-nums">
                          {colOrders.length}
                        </span>
                      </div>

                      <div className="flex-1 p-2.5 space-y-2 overflow-y-auto custom-scrollbar min-h-[80px]">
                        {colOrders.map((order, index) => (
                          <React.Fragment key={order.id}>
                            <Draggable draggableId={order.id} index={index}>
                              {(prov, snap) => (
                                <div
                                  ref={prov.innerRef}
                                  {...prov.draggableProps}
                                  {...prov.dragHandleProps}
                                  onClick={() => setSelectedOrder(order)}
                                  className={`bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl p-3.5 cursor-pointer transition-all ${
                                    snap.isDragging
                                      ? 'shadow-[var(--shadow-pop)] rotate-[0.8deg]'
                                      : 'shadow-[var(--shadow-card)] hover:border-[var(--color-brand)]/30'
                                  }`}
                                >
                                  <p className="text-[13px] font-semibold mb-1.5">{order.customerName}</p>
                                  <div className="space-y-0.5 mb-2.5">
                                    {order.items.slice(0, 2).map((item, i) => (
                                      <p key={i} className="text-[11.5px] text-[var(--color-ink-muted)] flex items-center gap-1.5">
                                        <span className="w-1 h-1 rounded-full bg-[var(--color-ink-faint)] flex-shrink-0" />
                                        {item.quantity}× {item.product}
                                      </p>
                                    ))}
                                    {order.items.length > 2 && (
                                      <p className="text-[11px] text-[var(--color-ink-faint)] pl-2.5">
                                        +{order.items.length - 2} itens
                                      </p>
                                    )}
                                    {order.observations && (
                                      <p className="text-[11px] text-amber-700 flex items-center gap-1 mt-1" title={order.observations}>
                                        <StickyNote className="w-3 h-3 flex-shrink-0" strokeWidth={1.8} />
                                        <span className="line-clamp-1">{order.observations}</span>
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex items-center justify-between pt-2 border-t border-[var(--color-line)]">
                                    <div className={`flex items-center gap-1 text-[11.5px] ${
                                      order.pickupDate > todayKey
                                        ? 'text-[var(--color-brand-deep)] font-semibold'
                                        : 'text-[var(--color-ink-muted)]'
                                    }`}>
                                      {order.pickupDate > todayKey ? (
                                        <Calendar className="w-3 h-3" strokeWidth={2} />
                                      ) : (
                                        <Clock className="w-3 h-3" strokeWidth={1.8} />
                                      )}
                                      {order.pickupDate > todayKey
                                        ? (() => {
                                            try { return `${format(parseISO(order.pickupDate), 'dd/MM', { locale: ptBR })} ${order.pickupTime}`; }
                                            catch { return order.pickupTime; }
                                          })()
                                        : order.pickupTime}
                                    </div>
                                    <span className="text-[12.5px] font-semibold tabular-nums">{currency(order.total)}</span>
                                  </div>
                                </div>
                              )}
                            </Draggable>
                          </React.Fragment>
                        ))}
                        {provided.placeholder}
                        {colOrders.length === 0 && (
                          <div className="py-6 text-center text-[11.5px] text-[var(--color-ink-faint)]">
                            Vazio
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </Droppable>
              );
            })}
          </div>
        </div>
      </div>

      {/* Drawers + modals */}
      <AnimatePresence>
        {liveSelectedOrder && !editingOrder && (
          <OrderDrawer
            order={liveSelectedOrder}
            onClose={() => { setSelectedOrder(null); }}
            setActiveView={setActiveView}
            onEdit={() => { setEditingOrder(liveSelectedOrder); setSelectedOrder(null); }}
            onDelete={async (id) => { await onDeleteOrder(id); }}
            onUpdateStatus={onUpdateStatus}
          />
        )}
        {showAddModal && (
          <OrderModal
            onClose={() => { setShowAddModal(false); }}
            onSave={onAddOrder}
          />
        )}
        {editingOrder && (
          <OrderModal
            editOrder={editingOrder}
            onClose={() => { setEditingOrder(null); }}
            onSave={async (payload) => {
              await onEditOrder(editingOrder.id, payload);
              setEditingOrder(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
};
