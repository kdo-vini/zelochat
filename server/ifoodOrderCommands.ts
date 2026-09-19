import { ifoodCommandPayload, ifoodIntentForChatAction, isIfoodChatOrder } from '../src/domain/ifoodChatCommands.js';
import { getServiceSupabase } from './supabase.js';

export type IfoodEnqueueResult =
  | { kind: 'not_ifood' }
  | { kind: 'queued'; intent: string; commandStatus: string | null }
  | { kind: 'error'; message: string };

const OUTCOME_MESSAGES: Record<string, string> = {
  not_found: 'Pedido do iFood não encontrado.',
  revision_conflict: 'O pedido mudou. Atualize a lista e tente novamente.',
  connection_unavailable: 'A conexão com o iFood está pausada ou indisponível. Use o Gestor de Pedidos do iFood.',
  invalid_transition: 'Essa etapa ainda não vale para o pedido no iFood. Atualize a tela.',
  invalid_payload: 'Informe o código de entrega do cliente (app iFood ou localizador do comprovante).',
};

export async function enqueueIfoodCommandFromChat(input: {
  empresaId: string;
  orderId: string;
  expectedRevision: number;
  current: { source?: string | null; status?: string | null; fulfillment?: { type?: string | null; deliveredBy?: string | null } | null; deliveryCode?: string | null };
  requestedUiStatus: string;
  deliveryCode?: string | null;
}): Promise<IfoodEnqueueResult> {
  if (!isIfoodChatOrder(input.current)) return { kind: 'not_ifood' };

  const intent = ifoodIntentForChatAction(input.current, input.requestedUiStatus);
  if (!intent) {
    return {
      kind: 'error',
      message: 'Este pedido do iFood não avança por essa coluna. Confirme, prepare ou conclua na ordem do iFood.',
    };
  }

  const payload = ifoodCommandPayload(intent, {
    deliveryCode: input.deliveryCode || input.current.deliveryCode || '',
  });
  if (intent === 'verify_delivery_code' && !payload.code) {
    return { kind: 'error', message: OUTCOME_MESSAGES.invalid_payload };
  }

  const supabase = getServiceSupabase();
  const { data, error } = await supabase.rpc('enqueue_ifood_order_command_v1', {
    p_empresa_id: input.empresaId,
    p_zelo_order_id: input.orderId,
    p_intent: intent,
    p_expected_revision: input.expectedRevision,
    p_payload: payload,
    p_idempotency_key: `ifood:command:v1:${input.empresaId}:${input.orderId}:${intent}:${input.expectedRevision}`,
  }).single();

  if (error) {
    const message = error.message || '';
    if (message.includes('IFOOD_ORDER_REQUIRES_COMMAND')) {
      return { kind: 'error', message: 'Este pedido do iFood só avança pelo iFood.' };
    }
    throw error;
  }

  const outcome = data && typeof data === 'object' ? String((data as { outcome?: string }).outcome || '') : '';
  if (outcome === 'queued' || outcome === 'requeued' || outcome === 'duplicate') {
    return {
      kind: 'queued',
      intent,
      commandStatus: data && typeof data === 'object' ? String((data as { status?: string }).status || 'queued') : 'queued',
    };
  }
  return {
    kind: 'error',
    message: OUTCOME_MESSAGES[outcome] || 'Não consegui enviar essa ação ao iFood agora.',
  };
}

export function chatOrderFromDbRow(row: {
  source?: string | null;
  status?: string | null;
  fulfillment?: unknown;
}): Parameters<typeof ifoodIntentForChatAction>[0] {
  const fulfillment = row.fulfillment && typeof row.fulfillment === 'object' && !Array.isArray(row.fulfillment)
    ? row.fulfillment as { type?: string | null; deliveredBy?: string | null; ifood?: { deliveryCode?: string } }
    : {};
  return {
    source: row.source,
    status: row.status,
    fulfillment: { type: fulfillment.type, deliveredBy: fulfillment.deliveredBy },
    deliveryCode: fulfillment.ifood?.deliveryCode ?? null,
  };
}
