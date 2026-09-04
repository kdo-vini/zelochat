/**
 * Copy shown to the operator for the global WhatsApp ordering capability.
 *
 * The server exposes two independent facts — backend wiring itself must
 * never leak into the product UI:
 *   - `integrationConfigured`: the private ZeloMenu integration is set up
 *     for the fleet at all.
 *   - `enabledForThisStore`: this specific empresa has been explicitly
 *     turned on for the guided-ordering flow (PR 1.1/1.3's
 *     `ai_hybrid_ordering_enabled`, default off — an operator/Eng decision,
 *     never a self-service toggle).
 * A store can have the integration configured but the flow not yet turned
 * on for it — the copy must say so plainly, never imply the AI is already
 * placing orders there.
 */
export interface AiWhatsAppOrderingUiState {
  enabled: boolean;
  title: string;
  description: string;
  badge: string;
}

export function describeAiWhatsAppOrdering(
  integrationConfigured: boolean,
  enabledForThisStore: boolean,
): AiWhatsAppOrderingUiState {
  if (integrationConfigured && enabledForThisStore) {
    return {
      enabled: true,
      title: 'IA monta pedidos pelo WhatsApp',
      description: 'A IA consulta o cardápio, monta o carrinho e pede a confirmação do cliente na própria conversa.',
      badge: 'Ativo',
    };
  }

  if (integrationConfigured) {
    return {
      enabled: false,
      title: 'Pedidos guiados pelo WhatsApp ainda não foram ativados aqui',
      description: 'A IA continua respondendo dúvidas normalmente. Esse recurso está pronto, mas precisa ser ativado para esta loja antes de entrar em uso.',
      badge: 'Não ativado',
    };
  }

  return {
    enabled: false,
    title: 'Pedidos pelo WhatsApp desativados',
    description: 'A IA continua respondendo dúvidas, mas não monta nem confirma pedidos pelo WhatsApp.',
    badge: 'Desativado',
  };
}
