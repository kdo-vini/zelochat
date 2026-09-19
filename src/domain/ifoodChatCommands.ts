export type IfoodChatFulfillment = {
  type?: string | null;
  deliveredBy?: string | null;
};

export type IfoodChatOrder = {
  source?: string | null;
  status?: string | null;
  fulfillment?: IfoodChatFulfillment | null;
  deliveryCode?: string | null;
};

function deliveredBy(order: IfoodChatOrder): string {
  return String(order.fulfillment?.deliveredBy || '').trim().toUpperCase();
}

function isMerchantDelivery(order: IfoodChatOrder): boolean {
  const type = String(order.fulfillment?.type || '').trim().toLowerCase();
  return type === 'delivery' && deliveredBy(order) === 'MERCHANT';
}

export function isIfoodChatOrder(order: IfoodChatOrder | null | undefined): boolean {
  return order?.source === 'ifood';
}

/**
 * Maps a ZeloChat kanban action onto the iFood command matrix used by the PDV.
 * Returns null when the move is not a provider command (caller should refuse
 * rather than hitting `transition_zelo_order`, which the DB rejects).
 */
export function ifoodIntentForChatAction(order: IfoodChatOrder, requestedUiStatus: string): string | null {
  if (!isIfoodChatOrder(order)) return null;
  const current = String(order.status || '');
  const requested = String(requestedUiStatus || '');

  if (current === 'pending_review') {
    if (requested === 'pending' || requested === 'preparing' || requested === 'accepted') return 'confirm';
    return null;
  }
  if (current === 'accepted' && requested === 'preparing') return 'start_preparation';
  if (current === 'preparing') {
    if (requested === 'ready' || requested === 'out_for_delivery') {
      return isMerchantDelivery(order) ? 'dispatch' : 'ready_to_pickup';
    }
    return null;
  }
  if (current === 'ready') {
    if (requested === 'out_for_delivery' && isMerchantDelivery(order)) return 'dispatch';
    if (requested === 'delivered' && !isMerchantDelivery(order)) return 'ready_to_pickup';
    return null;
  }
  if (current === 'out_for_delivery' && requested === 'delivered' && isMerchantDelivery(order)) {
    return 'verify_delivery_code';
  }
  return null;
}

export function ifoodCommandPayload(intent: string, extra: { deliveryCode?: string | null } = {}): Record<string, string> {
  if (intent !== 'verify_delivery_code') return {};
  const code = typeof extra.deliveryCode === 'string' ? extra.deliveryCode.trim() : '';
  return code ? { code } : {};
}
