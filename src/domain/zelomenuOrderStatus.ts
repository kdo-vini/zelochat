// ─── ZeloMenu order status → customer-facing timeline ───────────────────────
//
// Pure domain module: zero React / AI / server imports. Maps canonical
// zelo_orders.status values to the step-by-step timeline shown on the public
// order-confirmation page (ZeloMenuCartPage).

export type ZeloMenuOrderStep = {
  key: string;
  label: string;
};

export type ZeloMenuOrderStatusInfo = {
  /** All visible steps for this flow, in order. */
  steps: ZeloMenuOrderStep[];
  /** 0-based index into `steps` for the current status, or -1 for cancelled. */
  currentStepIndex: number;
  /** Whether the order has reached a terminal state (delivered/cancelled). */
  isTerminal: boolean;
  /** Whether the order was cancelled/rejected (distinct failure state). */
  isCancelled: boolean;
};

// Pickup orders skip the `out_for_delivery` step entirely, so `delivered`
// (and, if it ever shows up on a pickup order, `out_for_delivery` itself)
// must land one index earlier than on the delivery timeline — the two flows
// have different step counts, so a single shared index table doesn't work.
function statusStepIndex(status: string, isDelivery: boolean): number | undefined {
  switch (status) {
    case 'pending_payment':
    case 'pending_review': return 0;
    case 'accepted': return 1;
    case 'preparing': return 2;
    case 'ready': return 3;
    case 'out_for_delivery': return isDelivery ? 4 : 3;
    case 'delivered': return isDelivery ? 5 : 4;
    default: return undefined;
  }
}

/**
 * Build the customer-facing timeline for a ZeloMenu production order.
 *
 * @param status  The canonical `zelo_orders.status` value.
 * @param fulfillmentType  `'pickup'` or `'delivery'` — affects last-step labeling.
 */
export function buildZeloMenuOrderTimeline(
  status: string,
  fulfillmentType: 'pickup' | 'delivery',
): ZeloMenuOrderStatusInfo {
  const isDelivery = fulfillmentType === 'delivery';

  // Timline steps are fixed per fulfillment type. The `out_for_delivery` step
  // only appears for delivery; for pickup, `ready` → "Pronto para retirada"
  // and `delivered` → "Retirado".
  const steps: ZeloMenuOrderStep[] = [
    { key: 'received', label: 'Pedido recebido' },
    { key: 'accepted', label: 'Pedido confirmado pela loja' },
    { key: 'preparing', label: 'Em preparo' },
    { key: 'ready', label: isDelivery ? 'Pronto' : 'Pronto para retirada' },
  ];
  if (isDelivery) {
    steps.push({ key: 'out_for_delivery', label: 'Saiu para entrega' });
  }
  steps.push({ key: 'delivered', label: isDelivery ? 'Entregue' : 'Retirado' });

  // Terminal failure states — not a step, render separately.
  if (status === 'rejected' || status === 'cancelled') {
    return { steps, currentStepIndex: -1, isTerminal: true, isCancelled: true };
  }

  const rawIndex = statusStepIndex(status, isDelivery);
  const currentStepIndex = rawIndex !== undefined && rawIndex < steps.length ? rawIndex : 0;
  const isTerminal = status === 'delivered';
  return { steps, currentStepIndex, isTerminal, isCancelled: false };
}
