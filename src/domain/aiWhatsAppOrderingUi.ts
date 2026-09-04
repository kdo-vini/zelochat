/**
 * Copy shown to the operator for the global WhatsApp ordering capability.
 *
 * The server exposes whether the integration is configured. Backend wiring
 * itself must never leak into the product UI.
 */
export interface AiWhatsAppOrderingUiState {
  enabled: boolean;
  title: string;
  description: string;
  badge: string;
}

export function describeAiWhatsAppOrdering(
  integrationConfigured: boolean,
): AiWhatsAppOrderingUiState {
  if (integrationConfigured) {
    return {
      enabled: true,
      title: 'IA monta pedidos pelo WhatsApp',
      description: 'A IA consulta o cardápio, monta o carrinho e pede a confirmação do cliente na própria conversa.',
      badge: 'Ativo',
    };
  }

  return {
    enabled: false,
    title: 'Pedidos pelo WhatsApp desativados',
    description: 'A IA continua respondendo dúvidas, mas não monta nem confirma pedidos pelo WhatsApp.',
    badge: 'Desativado',
  };
}
