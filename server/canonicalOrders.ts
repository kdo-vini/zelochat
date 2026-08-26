import { randomUUID } from 'node:crypto';
import { CANONICAL_ORDER_SELECT, canonicalRowToOrder, uiStatusToCanonicalAction, type CanonicalOrderRow } from '../src/domain/canonicalOrders.js';
import { getOrderTransitionErrorMessage } from '../src/domain/orderTransitionError.js';
import type { Order } from '../src/types.js';
import { getEmpresaUserId, getServiceSupabase } from './supabase.js';
import { resolveCustomerForOrder } from './customers/identity.js';

export const LEGACY_CANONICAL_ORDER_SELECT = [
  'id', 'source', 'revision', 'status', 'total', 'observations', 'created_at',
  'customer_name:customer->>name', 'customer_phone:customer->>phone',
  'pickup_date:fulfillment->>pickupDate', 'pickup_time:fulfillment->>pickupTime',
  'delivery_address:fulfillment->>deliveryAddress', 'driver_id:fulfillment->>driverId',
  'fulfillment_type:fulfillment->>type',
  'payment_method:payment->>declaredMethod', 'pix_receipt_analysis:payment->pixReceiptAnalysis',
  'items:zelo_order_items(product:name,quantity,position,modifiers)',
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
      if (getOrderTransitionErrorMessage(acceptError).includes('REVISION_CONFLICT')) throw new Error('REVISION_CONFLICT');
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
    if (getOrderTransitionErrorMessage(error).includes('REVISION_CONFLICT')) throw new Error('REVISION_CONFLICT');
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
    if (getOrderTransitionErrorMessage(error).includes('REVISION_CONFLICT')) throw new Error('REVISION_CONFLICT');
    throw error;
  }
}

export type AutoAcceptCanonicalOrderResult = {
  accepted: boolean;
  manualReviewRequired: boolean;
};

/**
 * Completes the second half of ZeloMenu auto-accept for orders that were held
 * for Pix receipt validation. The service-role RPC gives the AI the same
 * transactional authority as the operator; failures are returned explicitly
 * so the caller cannot tell the customer that the order entered production
 * when it did not.
 */
export async function autoAcceptCanonicalOrderIfConfigured(empresaId: string, orderId: string, source?: string): Promise<AutoAcceptCanonicalOrderResult> {
  if (source !== 'zelomenu') return { accepted: false, manualReviewRequired: false };
  const supabase = getServiceSupabase();
  const { data: profile, error: profileError } = await supabase
    .from('empresa_perfil')
    .select('zelomenu_auto_accept_orders')
    .eq('id', empresaId)
    .maybeSingle();
  if (profileError) {
    // The setting migration may lag behind an app deploy. Keep the safe manual
    // review behavior until the column exists instead of breaking payment ack.
    console.warn('[ZeloChat] auto-accept preference unavailable:', profileError.message);
    return { accepted: false, manualReviewRequired: true };
  }
  if (profile?.zelomenu_auto_accept_orders !== true) return { accepted: false, manualReviewRequired: false };

  const { data: current, error: currentError } = await supabase
    .from('zelo_orders')
    .select('status, revision')
    .eq('empresa_id', empresaId)
    .eq('id', orderId)
    .maybeSingle();
  if (currentError || !current) return { accepted: false, manualReviewRequired: true };
  if (current.status === 'accepted') return { accepted: true, manualReviewRequired: false };
  if (current.status !== 'pending_review') return { accepted: false, manualReviewRequired: true };

  const { error: acceptError } = await supabase.rpc('accept_zelo_order', {
    p_order_id: orderId,
    p_expected_revision: Number(current.revision),
    p_actor_id: null,
  });
  if (acceptError) {
    console.error('[ZeloChat] auto-accept after Pix approval failed:', acceptError);
    return { accepted: false, manualReviewRequired: true };
  }
  return { accepted: true, manualReviewRequired: false };
}

export interface ManualOrderInput {
  empresaId: string;
  customerName: string;
  customerPhone: string;
  items: Array<{ product: string; quantity: number; unitPrice: number }>;
  pickupDate: string;
  pickupTime: string;
  deliveryAddress?: string;
  paymentMethod?: string;
  observations?: string;
  idempotencyKey?: string;
}

/**
 * Creates a manual order by calling the canonical create_zelo_order RPC.
 * p_session_id is null (no ZeloMenu cart session) and source is 'manual'.
 * The RPC re-validates totals and raises PRODUCT_NOT_FOUND / TOTAL_MISMATCH
 * on mismatch — callers should surface these as user-friendly errors.
 */
export async function createManualZeloOrder(input: ManualOrderInput): Promise<Order> {
  const supabase = getServiceSupabase();
  // Prefer the caller-supplied key (stable across retries of the same submit
  // attempt) so a lost response + manual resubmit doesn't create a duplicate
  // order — create_zelo_order dedupes on (empresa_id, idempotency_key).
  const idempotencyKey = input.idempotencyKey?.trim() || randomUUID();

  // Compute line totals and subtotal
  const cartItems = input.items.map((it, idx) => {
    const lineTotal = Math.round(it.unitPrice * it.quantity * 100) / 100;
    return {
      productName: it.product,
      unitPrice: it.unitPrice,
      quantity: it.quantity,
      lineTotal,
      position: idx,
    };
  });
  const subtotal = Math.round(cartItems.reduce((sum, it) => sum + it.lineTotal, 0) * 100) / 100;

  const fulfillmentType = input.deliveryAddress?.trim() ? 'delivery' : 'pickup';
  let pessoaId: string | null = null;
  const ownerUserId = await getEmpresaUserId(input.empresaId);
  if (ownerUserId) {
    const identity = await resolveCustomerForOrder({ empresaId: input.empresaId, ownerUserId, phone: input.customerPhone, observedName: input.customerName });
    pessoaId = identity.status === 'linked' || identity.status === 'created' ? identity.pessoaId : null;
  }

  const snapshots = {
    empresaId: input.empresaId,
    source: 'manual',
    customer: {
      name: input.customerName,
      phone: input.customerPhone,
    },
    fulfillment: {
      type: fulfillmentType,
      pickupDate: input.pickupDate,
      pickupTime: input.pickupTime,
      ...(fulfillmentType === 'delivery' ? {
        address: input.deliveryAddress!.trim(),
        neighborhood: '',
      } : {}),
    },
    payment: {
      declaredMethod: input.paymentMethod || null,
    },
    cart: {
      items: cartItems,
      observations: input.observations || null,
    },
    pricing: {
      subtotal,
      deliveryFee: 0,
      discount: 0,
    },
  };

  const { data, error } = await supabase.rpc('create_zelo_order', {
    p_session_id: null,
    p_expected_revision: 0,
    p_idempotency_key: idempotencyKey,
    p_snapshots: snapshots,
    p_pessoa_id: pessoaId,
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('PRODUCT_NOT_FOUND')) throw new Error('Produto não encontrado no cardápio.');
    if (msg.includes('TOTAL_MISMATCH')) throw new Error('O total não confere com a soma dos itens.');
    throw error;
  }

  const result = data as { orderId?: string } | null;
  const orderId = result?.orderId;
  if (!orderId) throw new Error('Pedido criado, mas não foi possível identificá-lo.');

  // Re-fetch to return the full Order shape used by the frontend
  const order = await getCanonicalOrder(input.empresaId, orderId);
  if (!order) throw new Error('Pedido criado, mas não foi possível carregá-lo.');
  return order;
}
