import { getServiceSupabase } from '../supabase.js';
import type { CustomerSource } from './contract.js';

export type CustomerIdentityStatus = 'linked' | 'created' | 'conflict' | 'incomplete' | 'failed';

export interface CustomerIdentityResult {
  status: CustomerIdentityStatus;
  pessoaId: string | null;
  candidatePersonIds?: string[];
  reason?: string | null;
}

export interface ExistingCustomerCandidate {
  pessoaId: string;
  /** Present only for the legacy `pessoas.contato` fallback. */
  contact?: string | null;
}

export interface CustomerIdentityRepository {
  findExistingByPhone?(input: {
    ownerUserId: string;
    phone: string;
  }): Promise<ExistingCustomerCandidate[]>;
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
      ? status : status === 'invalid' ? 'incomplete' : 'failed';
  const pessoaId = row?.pessoaId ?? row?.pessoa_id;
  return {
    status: normalizedStatus,
    pessoaId: typeof pessoaId === 'string' ? pessoaId : null,
    candidatePersonIds: Array.isArray(row?.candidate_person_ids)
      ? row.candidate_person_ids.filter((id): id is string => typeof id === 'string') : [],
    reason: typeof row?.reason === 'string' ? row.reason : null,
  };
}

/** The only adapter allowed to decide identity/merge. PDV owns this RPC. */
export const supabaseCustomerIdentityRepository: CustomerIdentityRepository = {
  async findExistingByPhone(input) {
    const supabase = getServiceSupabase();
    const { data: identityRows, error: identityError } = await supabase
      .from('pessoa_identities')
      .select('pessoa_id')
      .eq('id_usuario', input.ownerUserId)
      .eq('kind', 'phone')
      .eq('value_normalized', input.phone)
      .limit(50);

    if (identityError) throw identityError;

    const identityCandidates = (identityRows ?? [])
      .map((row) => row?.pessoa_id)
      .filter((pessoaId): pessoaId is string => typeof pessoaId === 'string');
    if (identityCandidates.length) {
      return [...new Set(identityCandidates)].map((pessoaId) => ({ pessoaId }));
    }

    // Legacy PDV fichas may predate the identity table and store formatted
    // contacts. The caller re-runs the existing JS normalizer on these rows.
    const suffix = input.phone.slice(-8);
    const suffixPattern = `%${suffix.split('').join('%')}`;
    const { data: legacyRows, error: legacyError } = await supabase
      .from('pessoas')
      .select('id, contato')
      .eq('id_usuario', input.ownerUserId)
      .ilike('contato', suffixPattern)
      .limit(100);

    if (legacyError) throw legacyError;

    return (legacyRows ?? [])
      .filter((row) => typeof row?.id === 'string')
      .map((row) => ({ pessoaId: row.id as string, contact: row.contato ?? null }));
  },
  async ensureFromWhatsApp(input) {
    // FIX 2026-09-04: the PDV-owned RPC accepts three arguments and returns
    // pessoaId. Extra JID/source arguments made every enrichment miss its RPC.
    const { data, error } = await getServiceSupabase().rpc('ensure_customer_from_whatsapp', {
      p_owner_user_id: input.ownerUserId,
      p_phone: input.phone,
      p_observed_name: input.observedName ?? null,
    });
    if (error) throw error;
    return resultFromRpc(data);
  },
  async recordConflict(input) {
    const { error } = await getServiceSupabase().rpc('record_zelochat_person_match_conflict', {
      p_empresa_id: input.empresaId,
      p_owner_user_id: input.ownerUserId,
      p_phone: input.phone,
      p_whatsapp_jid: input.jid,
      p_candidate_person_ids: input.candidatePersonIds,
      p_reason: input.reason,
    });
    if (error) throw error;
  },
};
