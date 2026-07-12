import { CANONICAL_ORDER_SELECT, canonicalRowToOrder, uiStatusToCanonicalAction, type CanonicalOrderRow } from '../src/domain/canonicalOrders.js';
import type { Order } from '../src/types.js';
import { getServiceSupabase } from './supabase.js';

export const LEGACY_CANONICAL_ORDER_SELECT = [
  'id', 'revision', 'status', 'total', 'observations', 'created_at',
  'customer_name:customer->>name', 'customer_phone:customer->>phone',
  'pickup_date:fulfillment->>pickupDate', 'pickup_time:fulfillment->>pickupTime',
  'delivery_address:fulfillment->>deliveryAddress', 'driver_id:fulfillment->>driverId',
  'payment_method:payment->>declaredMethod', 'pix_receipt_analysis:payment->pixReceiptAnalysis',
  'items:zelo_order_items(product:name,quantity,position)',
].join(', ');

export async function getCanonicalOrder(empresaId: string, orderId: string): Promise<Order | null> {
  const { data, error } = await getServiceSupabase().from('zelo_orders')
    .select(CANONICAL_ORDER_SELECT).eq('empresa_id', empresaId).eq('id', orderId).maybeSingle();
  if (error) throw error;
  return data ? canonicalRowToOrder(data as unknown as CanonicalOrderRow) : null;
}

export async function transitionCanonicalOrder(input: {
  empresaId: string;
  orderId: string;
  expectedRevision: number;
  status: Order['status'];
  actorId: string;
}): Promise<Order> {
  const supabase = getServiceSupabase();
  const { data: current, error: loadError } = await supabase.from('zelo_orders')
    .select('status, revision').eq('empresa_id', input.empresaId).eq('id', input.orderId).maybeSingle();
  if (loadError) throw loadError;
  if (!current) throw new Error('ORDER_NOT_FOUND');
  let revision = input.expectedRevision;
  if (input.status === 'preparing' && current.status === 'pending_review') {
    const { error: acceptError } = await supabase.rpc('transition_zelo_order', {
      p_order_id: input.orderId, p_expected_revision: revision, p_action: 'accept',
      p_actor_id: input.actorId, p_detail: { source: 'zelochat_kanban' },
    });
    if (acceptError) {
      if (acceptError.message.includes('REVISION_CONFLICT')) throw new Error('REVISION_CONFLICT');
      throw acceptError;
    }
    revision += 1;
  }
  const { error } = await supabase.rpc('transition_zelo_order', {
    p_order_id: input.orderId,
    p_expected_revision: revision,
    p_action: uiStatusToCanonicalAction(input.status),
    p_actor_id: input.actorId,
    p_detail: {},
  });
  if (error) {
    if (error.message.includes('REVISION_CONFLICT')) throw new Error('REVISION_CONFLICT');
    throw error;
  }
  const order = await getCanonicalOrder(input.empresaId, input.orderId);
  if (!order) throw new Error('ORDER_NOT_FOUND');
  return order;
}

export async function cancelCanonicalOrder(empresaId: string, orderId: string, expectedRevision: number, actorId: string): Promise<void> {
  const existing = await getCanonicalOrder(empresaId, orderId);
  if (!existing) throw new Error('ORDER_NOT_FOUND');
  const { error } = await getServiceSupabase().rpc('transition_zelo_order', {
    p_order_id: orderId, p_expected_revision: expectedRevision, p_action: 'cancel', p_actor_id: actorId,
    p_detail: { reason: 'operator_cancel' },
  });
  if (error) {
    if (error.message.includes('REVISION_CONFLICT')) throw new Error('REVISION_CONFLICT');
    throw error;
  }
}
