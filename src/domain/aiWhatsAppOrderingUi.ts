/**
 * Copy shown to the operator for the global WhatsApp ordering capability.
 *
 * The server deliberately exposes only whether the capability is live. The
 * rollout states (`shadow` and `active`) are operational details and must not
 * leak into the product UI.
 */
export interface AiWhatsAppOrderingUiState {
  enabled: boolean;
  title: string;
  description: string;
  badge: string;
}

export function describeAiWhatsAppOrdering(enabled: boolean): AiWhatsAppOrderingUiState {
  if (enabled) {
    return {
      enabled: true,
      title: 'IA monta pedidos pelo WhatsApp',
      description: 'A IA consulta o cardápio, monta o carrinho e pede a confirmação do cliente na própria conversa.',
      badge: 'Ativo globalmente',
    };
  }

  return {
    enabled: false,
    title: 'Pedidos pelo WhatsApp desativados',
    description: 'A IA continua respondendo dúvidas, mas não monta nem confirma pedidos pelo WhatsApp.',
    badge: 'Desativado',
  };
}
