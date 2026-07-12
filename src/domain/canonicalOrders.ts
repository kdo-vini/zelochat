import type { Order } from '../types.js';

export const CANONICAL_ORDER_SELECT = [
  'id',
  'empresa_id',
  'source',
  'status',
  'revision',
  'customer',
  'fulfillment',
  'payment',
  'observations',
  'total',
  'created_at',
  'zelo_order_items(id, name, quantity, unit_price, subtotal, position)',
].join(', ');

export type CanonicalOrderRow = Record<string, unknown> & {
  id: string;
  status: string;
  revision: number;
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function canonicalStatusToUi(status: string): Order['status'] {
  switch (status) {
    case 'preparing': return 'preparing';
    case 'ready': return 'ready';
    case 'out_for_delivery': return 'out_for_delivery';
    case 'delivered':
    case 'closed': return 'delivered';
    default: return 'pending';
  }
}

export function canonicalRowToOrder(row: CanonicalOrderRow): Order {
  const customer = objectValue(row.customer);
  const fulfillment = objectValue(row.fulfillment);
  const payment = objectValue(row.payment);
  const rawItems = Array.isArray(row.zelo_order_items) ? row.zelo_order_items : [];
  const items = rawItems
    .map((raw) => objectValue(raw))
    .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
    .map((item) => ({
      product: String(item.name ?? 'Item'),
      quantity: Number(item.quantity ?? 0),
    }));

  return {
    id: row.id,
    revision: Number(row.revision ?? 0),
    customerName: String(customer.name ?? 'Cliente'),
    customerPhone: String(customer.phone ?? ''),
    items,
    pickupDate: String(fulfillment.pickupDate ?? fulfillment.pickup_date ?? ''),
    pickupTime: String(fulfillment.pickupTime ?? fulfillment.pickup_time ?? ''),
    deliveryAddress: String(fulfillment.deliveryAddress ?? fulfillment.delivery_address ?? '') || undefined,
    driverId: String(fulfillment.driverId ?? fulfillment.driver_id ?? '') || undefined,
    paymentMethod: String(payment.declaredMethod ?? payment.method ?? '') || undefined,
    observations: typeof row.observations === 'string' ? row.observations : undefined,
    status: canonicalStatusToUi(String(row.status ?? 'pending_review')),
    total: Number(row.total ?? 0),
    createdAt: String(row.created_at ?? ''),
    pixReceiptApproved: payment.pixReceiptApproved === true,
  };
}

export function uiStatusToCanonicalAction(status: Order['status']): string {
  switch (status) {
    case 'pending': return 'accept';
    case 'preparing': return 'start_preparing';
    case 'ready': return 'mark_ready';
    case 'out_for_delivery': return 'dispatch';
    case 'delivered': return 'deliver';
  }
}
