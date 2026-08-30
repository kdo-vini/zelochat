import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceSupabase } from '../supabase.js';
import {
  createCustomerOrderingContext,
  type CustomerOrderingContextAdapter,
  type CustomerOrderingOrderRow,
} from './orderingContext.js';

export const CUSTOMER_ORDERING_CONTEXT_SELECT = [
  'id',
  'empresa_id',
  'pessoa_id',
  'status',
  'created_at',
  'closed_at',
  'fulfillment',
  'payment',
  'subtotal',
  'delivery_fee',
  'discount',
  'total',
  'observations',
  'customer',
  'zelo_order_items(id,product_id,name,unit_price,quantity,subtotal,modifiers,position)',
].join(',');

type SupabaseProvider = () => SupabaseClient;

/**
 * Production adapter for ordering context. Order history is read exclusively
 * from the canonical `zelo_orders` aggregate and its `zelo_order_items`
 * relation; relationship metadata is read separately for fixed preferences.
 */
export function createSupabaseCustomerOrderingContextAdapter(
  getClient: SupabaseProvider = getServiceSupabase,
): CustomerOrderingContextAdapter {
  return {
    async listCommittedOrders(input) {
      const { data, error } = await getClient()
        .from('zelo_orders')
        .select(CUSTOMER_ORDERING_CONTEXT_SELECT)
        .eq('empresa_id', input.empresaId)
        .eq('pessoa_id', input.pessoaId)
        .in('status', [...input.statuses])
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(Math.min(input.limit, 20));
      if (error) throw error;
      return (data ?? []) as unknown as CustomerOrderingOrderRow[];
    },

    async getOrderingOverrides(input) {
      const { data, error } = await getClient()
        .from('zelochat_customer_relationships')
        .select('ordering_overrides')
        .eq('empresa_id', input.empresaId)
        .eq('pessoa_id', input.pessoaId)
        .maybeSingle();
      if (error) throw error;
      return data?.ordering_overrides ?? {};
    },

    async patchOrderingOverridesAtomically(input) {
      const { data, error } = await getClient().rpc('patch_zelochat_customer_ordering_overrides', {
        p_empresa_id: input.empresaId,
        p_owner_user_id: input.ownerUserId,
        p_pessoa_id: input.pessoaId,
        p_patch: input.patch,
      });
      if (error) throw error;
      return data;
    },
  };
}

export const CustomerOrderingContext = createCustomerOrderingContext(
  createSupabaseCustomerOrderingContextAdapter(),
);
