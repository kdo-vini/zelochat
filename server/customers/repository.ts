import { getServiceSupabase } from '../supabase.js';
import type { CustomerSource } from './contract.js';

export type CustomerIdentityStatus = 'linked' | 'created' | 'conflict' | 'incomplete' | 'failed';

export interface CustomerIdentityResult {
  status: CustomerIdentityStatus;
  pessoaId: string | null;
  candidatePersonIds?: string[];
  reason?: string | null;
}

export interface CustomerIdentityRepository {
  ensureFromWhatsApp(input: {
    ownerUserId: string;
    phone: string;
    jid: string;
    observedName?: string | null;
    source: CustomerSource;
  }): Promise<CustomerIdentityResult>;
  recordConflict?(input: {
    empresaId: string;
    ownerUserId: string;
    phone: string | null;
    jid: string;
    candidatePersonIds: string[];
    reason: string;
  }): Promise<void>;
}

function resultFromRpc(value: unknown): CustomerIdentityResult {
  const row = (Array.isArray(value) ? value[0] : value) as Record<string, unknown> | null;
  const status = row?.status;
  const normalizedStatus: CustomerIdentityStatus =
    status === 'linked' || status === 'created' || status === 'conflict' || status === 'incomplete'
      ? status : 'failed';
  return {
    status: normalizedStatus,
    pessoaId: typeof row?.pessoa_id === 'string' ? row.pessoa_id : null,
    candidatePersonIds: Array.isArray(row?.candidate_person_ids)
      ? row.candidate_person_ids.filter((id): id is string => typeof id === 'string') : [],
    reason: typeof row?.reason === 'string' ? row.reason : null,
  };
}

/** The only adapter allowed to decide identity/merge. PDV owns this RPC. */
export const supabaseCustomerIdentityRepository: CustomerIdentityRepository = {
  async ensureFromWhatsApp(input) {
    const { data, error } = await getServiceSupabase().rpc('ensure_customer_from_whatsapp', {
      p_owner_user_id: input.ownerUserId,
      p_phone: input.phone,
      p_jid: input.jid,
      p_observed_name: input.observedName ?? null,
      p_source: input.source,
    });
    if (error) throw error;
    return resultFromRpc(data);
  },
  async recordConflict(input) {
    const client = getServiceSupabase();
    let lookup = client.from('zelochat_person_match_conflicts').select('id').eq('empresa_id', input.empresaId).eq('id_usuario', input.ownerUserId).eq('state', 'open').limit(1);
    if (input.phone) lookup = lookup.eq('phone', input.phone);
    else lookup = lookup.eq('whatsapp_jid', input.jid);
    const { data: existing, error: lookupError } = await lookup.maybeSingle();
    if (lookupError) throw lookupError;
    const payload = {
      empresa_id: input.empresaId,
      id_usuario: input.ownerUserId,
      phone: input.phone,
      whatsapp_jid: input.jid,
      candidate_person_ids: input.candidatePersonIds,
      reason: input.reason,
      updated_at: new Date().toISOString(),
    };
    const { error } = existing?.id
      ? await client.from('zelochat_person_match_conflicts').update(payload).eq('id', existing.id)
      : await client.from('zelochat_person_match_conflicts').insert(payload);
    if (error) throw error;
  },
};
