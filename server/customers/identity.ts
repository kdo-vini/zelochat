import { supabaseCustomerIdentityRepository, type CustomerIdentityRepository, type CustomerIdentityResult } from './repository.js';
import type { CustomerSource } from './contract.js';

export function normalizeWhatsAppPhone(value: string | null | undefined): string | null {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return digits;
  return null;
}

export function isEligibleCustomerJid(jid: string | null | undefined): boolean {
  const value = String(jid ?? '').trim();
  return /^\d{10,15}@s\.whatsapp\.net$/.test(value);
}

export interface EnsureCustomerForSessionInput {
  empresaId: string;
  ownerUserId: string;
  jid: string;
  phone?: string | null;
  observedName?: string | null;
  source?: CustomerSource;
  /** Conversations may link to a ficha, but only orders may create one. */
  createIfMissing?: boolean;
  persistPessoaId?: (pessoaId: string | null) => Promise<void>;
}

export interface EnsureCustomerForSessionDependencies {
  repository?: CustomerIdentityRepository;
}

export async function ensureCustomerForSession(
  input: EnsureCustomerForSessionInput,
  dependencies: EnsureCustomerForSessionDependencies = {},
): Promise<CustomerIdentityResult> {
  const phone = normalizeWhatsAppPhone(input.phone ?? input.jid.split('@')[0]);
  if (!phone || !isEligibleCustomerJid(input.jid)) {
    const result: CustomerIdentityResult = { status: 'incomplete', pessoaId: null, reason: 'JID ou telefone inválido' };
    await input.persistPessoaId?.(null);
    return result;
  }
  try {
    const repository = dependencies.repository ?? supabaseCustomerIdentityRepository;
    if (input.createIfMissing === false) {
      if (!repository.findExistingByPhone) {
        throw new Error('customer identity lookup is unavailable');
      }

      const candidates = await repository.findExistingByPhone({ ownerUserId: input.ownerUserId, phone });
      const candidatePersonIds = [...new Set(candidates
        .filter((candidate) => candidate.contact === undefined || normalizeWhatsAppPhone(candidate.contact) === phone)
        .map((candidate) => candidate.pessoaId)
        .filter((pessoaId): pessoaId is string => typeof pessoaId === 'string' && pessoaId.length > 0))];

      if (candidatePersonIds.length === 0) {
        const result: CustomerIdentityResult = { status: 'incomplete', pessoaId: null };
        await input.persistPessoaId?.(null);
        return result;
      }

      if (candidatePersonIds.length > 1) {
        const result: CustomerIdentityResult = {
          status: 'conflict',
          pessoaId: null,
          candidatePersonIds,
          reason: 'Mais de uma pessoa corresponde ao telefone',
        };
        if (repository.recordConflict) {
          await repository.recordConflict({
            empresaId: input.empresaId,
            ownerUserId: input.ownerUserId,
            phone,
            jid: input.jid,
            candidatePersonIds,
            reason: result.reason,
          });
        }
        return result;
      }
    }

    const result = await repository.ensureFromWhatsApp({
      ownerUserId: input.ownerUserId,
      phone,
      jid: input.jid,
      observedName: input.observedName ?? null,
      source: input.source ?? 'whatsapp',
    });
    if (result.status === 'conflict' && repository.recordConflict) {
      await repository.recordConflict({
        empresaId: input.empresaId,
        ownerUserId: input.ownerUserId,
        phone,
        jid: input.jid,
        candidatePersonIds: result.candidatePersonIds ?? [],
        reason: result.reason ?? 'Mais de uma pessoa corresponde ao telefone',
      });
    }
    if (result.status === 'linked' || result.status === 'created') await input.persistPessoaId?.(result.pessoaId);
    return result;
  } catch (error) {
    // CRM is enrichment. A provider/database failure must never drop a message.
    console.error('[customers] identity resolution failed (message preserved):', error);
    const result: CustomerIdentityResult = { status: 'failed', pessoaId: null, reason: 'resolução indisponível' };
    await input.persistPessoaId?.(null);
    return result;
  }
}

export async function resolveCustomerForOrder(input: {
  empresaId: string;
  ownerUserId: string;
  phone?: string | null;
  jid?: string | null;
  observedName?: string | null;
  source?: CustomerSource;
}, dependencies: EnsureCustomerForSessionDependencies = {}): Promise<CustomerIdentityResult> {
  const jid = input.jid ?? `${String(input.phone ?? '').replace(/\D/g, '')}@s.whatsapp.net`;
  return ensureCustomerForSession({ ...input, jid, source: input.source ?? 'manual' }, dependencies);
}
