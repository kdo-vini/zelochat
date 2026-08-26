import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingCustomerContractError } from './contract.js';

export async function createCanonicalOrderWithOptionalPerson(
  supabase: SupabaseClient,
  args: { p_session_id: string | null; p_expected_revision: number; p_idempotency_key: string; p_snapshots: unknown; p_pessoa_id: string | null },
) {
  const first = await supabase.rpc('create_zelo_order', args);
  if (!first.error || !isMissingCustomerContractError(first.error)) return first;
  // Pre-Gate-A compatibility: retry only when the database proves the new
  // argument is absent. Real validation/constraint errors are never swallowed.
  const { p_pessoa_id: _ignored, ...legacyArgs } = args;
  return supabase.rpc('create_zelo_order', legacyArgs);
}
