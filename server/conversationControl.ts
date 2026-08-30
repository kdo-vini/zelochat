export type ConversationMode = 'ai' | 'human';

export type TakeoverSource =
  | 'zelochat_operator'
  | 'native_whatsapp'
  | 'explicit_manual_toggle'
  | 'escalation';

export interface ConversationControlSnapshot {
  conversationControlId: string;
  mode: ConversationMode;
  epoch: string;
  remoteJids: string[];
  changedAt: string;
}

export interface AiTurnPermit {
  empresaId: string;
  conversationControlId: string;
  remoteJid: string;
  epoch: string;
  triggerMessageId: string;
}

interface RpcError {
  message?: string;
  code?: string;
  details?: string;
}

type RpcResult = { data: unknown; error: RpcError | null };
type RpcClient = (name: string, args: Record<string, unknown>) => Promise<RpcResult>;

interface ConversationControlDependencies {
  rpc?: RpcClient;
  resolveFamilyJids?: (params: { empresaId: string; remoteJid: string }) => Promise<string[]>;
  cancelPendingReply?: (empresaId: string, remoteJid: string) => void | Promise<void>;
}

export interface ConversationControl {
  beginAiTurn(params: {
    empresaId: string;
    remoteJid: string;
    inboundMessageId: string;
  }): Promise<AiTurnPermit | null>;
  claimHumanTakeover(params: {
    empresaId: string;
    remoteJid: string;
    actorUserId: string | null;
    source: TakeoverSource;
    sourceMessageId?: string | null;
  }): Promise<ConversationControlSnapshot>;
  resumeAiConversation(params: {
    empresaId: string;
    remoteJid: string;
    actorUserId: string;
  }): Promise<ConversationControlSnapshot>;
  ensureConversationControl(params: {
    empresaId: string;
    remoteJid: string;
  }): Promise<ConversationControlSnapshot>;
  isAiPermitCurrent(permit: AiTurnPermit): Promise<boolean>;
}

function rpcErrorMessage(error: RpcError): string {
  return error.message || error.code || 'RPC failed';
}

function firstRow(data: unknown): unknown {
  return Array.isArray(data) ? data[0] : data;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid conversation control RPC response');
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint') return value.toString();
  throw new Error(`Invalid conversation control RPC response: ${field}`);
}

function redactRemoteJidForLog(remoteJid: string): string {
  const [rawUser, suffix] = remoteJid.split('@', 2);
  const digits = rawUser.replace(/\D/g, '');
  const redactedUser = digits.length > 4
    ? `${digits.slice(0, 2)}***${digits.slice(-2)}`
    : rawUser
      ? '***'
      : '<empty>';
  return suffix ? `${redactedUser}@${suffix}` : redactedUser;
}

function normalizeSnapshot(data: unknown): ConversationControlSnapshot {
  const row = asRecord(firstRow(data));
  const mode = row.mode;
  if (mode !== 'ai' && mode !== 'human') {
    throw new Error('Invalid conversation control RPC response: mode');
  }
  const rawRemoteJids = row.remoteJids ?? row.remote_jids;
  return {
    conversationControlId: stringValue(
      row.conversationControlId ?? row.conversation_control_id,
      'conversationControlId',
    ),
    mode,
    epoch: stringValue(row.epoch, 'epoch'),
    remoteJids: Array.isArray(rawRemoteJids)
      ? rawRemoteJids.filter((jid): jid is string => typeof jid === 'string')
      : [],
    changedAt: stringValue(row.changedAt ?? row.changed_at, 'changedAt'),
  };
}

function normalizeBoolean(data: unknown): boolean {
  if (typeof data === 'boolean') return data;
  const row = firstRow(data);
  if (typeof row === 'boolean') return row;
  if (row && typeof row === 'object' && !Array.isArray(row)) {
    const values = Object.values(row as Record<string, unknown>);
    if (typeof values[0] === 'boolean') return values[0];
  }
  return false;
}

async function snapshotFromRpc(
  rpc: RpcClient,
  name: string,
  args: Record<string, unknown>,
): Promise<ConversationControlSnapshot> {
  const { data, error } = await rpc(name, args);
  if (error) throw new Error(rpcErrorMessage(error));
  return normalizeSnapshot(data);
}

async function withResolvedFamilyJids(
  snapshot: ConversationControlSnapshot,
  params: { empresaId: string; remoteJid: string },
  resolveFamilyJids?: ConversationControlDependencies['resolveFamilyJids'],
): Promise<ConversationControlSnapshot> {
  const remoteJids = snapshot.remoteJids.length
    ? snapshot.remoteJids
    : await resolveFamilyJids?.(params) ?? [params.remoteJid];
  return { ...snapshot, remoteJids: [...new Set(remoteJids)] };
}

async function cancelFamilyPendingReplies(
  snapshot: ConversationControlSnapshot,
  empresaId: string,
  fallbackRemoteJid: string,
  cancelPendingReply?: ConversationControlDependencies['cancelPendingReply'],
): Promise<void> {
  const cancel = cancelPendingReply ?? (() => undefined);
  const remoteJids = snapshot.remoteJids.length ? snapshot.remoteJids : [fallbackRemoteJid];
  for (const remoteJid of remoteJids) {
    try {
      await cancel(empresaId, remoteJid);
    } catch (error) {
      console.warn('[conversation-control] failed to cancel pending reply', {
        empresaId,
        remoteJid: redactRemoteJidForLog(remoteJid),
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  }
}

export function createConversationControl(
  dependencies: ConversationControlDependencies = {},
): ConversationControl {
  const rpc = dependencies.rpc ?? (async (name, args) => {
    const { getServiceSupabase } = await import('./supabase.js');
    const { data, error } = await getServiceSupabase().rpc(name, args);
    return { data, error };
  });

  return {
    async beginAiTurn(params) {
      try {
        const snapshot = await snapshotFromRpc(rpc, 'advance_zelochat_ai_epoch_for_inbound', {
          p_empresa_id: params.empresaId,
          p_remote_jid: params.remoteJid,
          p_message_id: params.inboundMessageId,
        });
        if (snapshot.mode !== 'ai') return null;
        return {
          empresaId: params.empresaId,
          conversationControlId: snapshot.conversationControlId,
          remoteJid: params.remoteJid,
          epoch: snapshot.epoch,
          triggerMessageId: params.inboundMessageId,
        };
      } catch (error) {
        console.warn('[conversation-control] AI turn not permitted', {
          empresaId: params.empresaId,
          remoteJid: redactRemoteJidForLog(params.remoteJid),
          error: error instanceof Error ? error.message : 'unknown',
        });
        return null;
      }
    },

    async claimHumanTakeover(params) {
      const snapshot = await withResolvedFamilyJids(
        await snapshotFromRpc(rpc, 'pause_zelochat_ai_for_human', {
          p_empresa_id: params.empresaId,
          p_remote_jid: params.remoteJid,
          p_actor_user_id: params.actorUserId,
          p_source: params.source,
          p_message_id: params.sourceMessageId ?? null,
        }),
        params,
        dependencies.resolveFamilyJids,
      );
      await cancelFamilyPendingReplies(
        snapshot,
        params.empresaId,
        params.remoteJid,
        dependencies.cancelPendingReply,
      );
      return snapshot;
    },

    async resumeAiConversation(params) {
      return withResolvedFamilyJids(
        await snapshotFromRpc(rpc, 'resume_zelochat_ai', {
          p_empresa_id: params.empresaId,
          p_remote_jid: params.remoteJid,
          p_actor_user_id: params.actorUserId,
        }),
        params,
        dependencies.resolveFamilyJids,
      );
    },

    async ensureConversationControl(params) {
      return withResolvedFamilyJids(
        await snapshotFromRpc(rpc, 'ensure_zelochat_conversation_control', {
          p_empresa_id: params.empresaId,
          p_remote_jid: params.remoteJid,
        }),
        params,
        dependencies.resolveFamilyJids,
      );
    },

    async isAiPermitCurrent(permit) {
      try {
        const { data, error } = await rpc('check_zelochat_ai_epoch', {
          p_empresa_id: permit.empresaId,
          p_remote_jid: permit.remoteJid,
          p_expected_epoch: permit.epoch,
        });
        if (error) throw new Error(rpcErrorMessage(error));
        return normalizeBoolean(data);
      } catch (error) {
        console.warn('[conversation-control] AI permit check failed closed', {
          empresaId: permit.empresaId,
          remoteJid: redactRemoteJidForLog(permit.remoteJid),
          error: error instanceof Error ? error.message : 'unknown',
        });
        return false;
      }
    },
  };
}

const defaultControl = createConversationControl({
  cancelPendingReply: async (empresaId, remoteJid) => {
    const { cancelPendingReply } = await import('./replyDebouncer.js');
    cancelPendingReply(empresaId, remoteJid);
  },
  resolveFamilyJids: async ({ empresaId, remoteJid }) => {
    const { fetchSessionFamilyJids } = await import('./messageHandler.js');
    return fetchSessionFamilyJids(empresaId, remoteJid);
  },
});

export const beginAiTurn = defaultControl.beginAiTurn;
export const claimHumanTakeover = defaultControl.claimHumanTakeover;
export const resumeAiConversation = defaultControl.resumeAiConversation;
export const ensureConversationControl = defaultControl.ensureConversationControl;
export const isAiPermitCurrent = defaultControl.isAiPermitCurrent;
