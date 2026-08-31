export type WhatsAppConnectivity = boolean | null;

/**
 * Converts the provider's connection status into the value consumed by the
 * global alert. Unknown or malformed responses deliberately preserve the last
 * known state instead of creating a false disconnect warning.
 */
export function toWhatsAppConnectivity(status: unknown): WhatsAppConnectivity {
  if (status === 'connected') return true;
  if (status === 'qr' || status === 'connecting' || status === 'disconnected') return false;
  return null;
}
