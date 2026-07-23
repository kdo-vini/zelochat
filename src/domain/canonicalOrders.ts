import type { Order } from '../types.js';
import { formatModifierAwareCartItem, type ZeloMenuSelectedModifierGroup } from './zelomenuModifiers.js';

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
  'zelo_order_items(id, name, quantity, unit_price, subtotal, position, modifiers)',
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

// `zelo_order_items.modifiers` is stored verbatim (see create_zelo_order RPC)
// from the same ZeloMenuSelectedModifierGroup[] shape the cart already uses —
// parsed defensively here since it round-trips through jsonb.
function parseItemModifiers(value: unknown): ZeloMenuSelectedModifierGroup[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((group) => {
    if (!group || typeof group !== 'object') return [];
    const typed = group as Record<string, unknown>;
    const groupId = typeof typed.groupId === 'string' ? typed.groupId : '';
    const groupName = typeof typed.groupName === 'string' ? typed.groupName : '';
    if (!groupId || !groupName) return [];
    const kind = typed.kind === 'variacao' ? 'variacao' : 'adicional';
    const selectedOptions = Array.isArray(typed.selectedOptions)
      ? typed.selectedOptions.flatMap((option) => {
        if (!option || typeof option !== 'object') return [];
        const candidate = option as Record<string, unknown>;
        const optionId = typeof candidate.optionId === 'string' ? candidate.optionId : '';
        const optionName = typeof candidate.optionName === 'string' ? candidate.optionName : '';
        const priceDelta = Number(candidate.priceDelta ?? 0);
        if (!optionId || !optionName || !Number.isFinite(priceDelta)) return [];
        return [{ optionId, optionName, priceDelta }];
      })
      : [];
    if (selectedOptions.length === 0) return [];
    return [{ groupId, groupName, kind, selectedOptions }];
  });
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
      product: formatModifierAwareCartItem({
        productName: String(item.name ?? 'Item'),
        selectedModifiers: parseItemModifiers(item.modifiers),
      }),
      quantity: Number(item.quantity ?? 0),
      ...(item.unit_price != null ? { unitPrice: Number(item.unit_price) } : {}),
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
    requiresAcceptance: String(row.status ?? 'pending_review') === 'pending_review',
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
