import { IfoodChannelBadge } from '../components/IfoodChannelBadge';
import type { Order } from '../types';

const MOCK_IFOOD: Order = {
  id: 'mock-ifood-1',
  customerName: 'Rafa (mock)',
  customerPhone: '0800 000 0000',
  items: [
    { product: 'X-Burger', quantity: 1 },
    { product: 'Coca 350ml', quantity: 1 },
  ],
  pickupDate: '2026-09-19',
  pickupTime: '12:30',
  deliveryAddress: 'Av. Júlio Prestes, 930 — Hotel Esplanada',
  source: 'ifood',
  ifoodDisplayId: '7421',
  status: 'pending',
  requiresAcceptance: true,
  total: 32.9,
  createdAt: new Date().toISOString(),
  paymentMethod: 'Pix',
};

export default function IfoodBadgePreviewPage() {
  return (
    <main className="min-h-screen bg-[var(--color-canvas)] text-[var(--color-ink)] p-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-faint)] mb-1">
        Preview local · não entra em produção
      </p>
      <h1 className="text-[22px] font-semibold mb-1">Canal iFood na Produção</h1>
      <p className="text-[13.5px] text-[var(--color-ink-muted)] mb-6 max-w-xl">
        Círculo com o logo + pill de texto, como na fila e no Kanban.
      </p>

      <div className="grid gap-4 max-w-sm">
        <article className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3.5 shadow-[var(--shadow-card)]">
          <p className="text-[13.5px] font-semibold leading-tight truncate">{MOCK_IFOOD.customerName}</p>
          <div className="mt-1">
            <IfoodChannelBadge displayId={MOCK_IFOOD.ifoodDisplayId} />
          </div>
          <p className="mt-2 text-[12px] text-[var(--color-ink-muted)]">
            1× X-Burger, 1× Coca 350ml
          </p>
          <div className="mt-2 flex items-center justify-between pt-2 border-t border-[var(--color-line)]">
            <span className="text-[11px] font-semibold text-[var(--color-warn)]">Aguardando aceite</span>
            <span className="text-[12.5px] font-semibold tabular-nums">R$ 32,90</span>
          </div>
        </article>
      </div>
    </main>
  );
}
