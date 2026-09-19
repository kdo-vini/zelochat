import { normalizeComparableText } from './pixReceipt.js';
import { roundCurrency } from './zelomenuDelivery.js';

export type ManualDeliveryNeighborhood = { name: string; fee: number };

export type ManualDeliveryQuote = {
  type: 'pickup' | 'delivery';
  deliveryAddress: string | null;
  neighborhood: string;
  deliveryFee: number;
};

function explicitFee(value: unknown): number | null {
  if (value == null || value === '') return null;
  const fee = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  if (!Number.isFinite(fee) || fee < 0) return null;
  return roundCurrency(fee);
}

/**
 * Manual "Novo pedido" used to write `fulfillment.address` and `deliveryFee: 0`.
 * The board, printer and WhatsApp "pronto" path read `deliveryAddress`.
 * Quote the fee from an explicit operator value, a single neighborhood table,
 * or a neighborhood name contained in the typed address.
 */
export function quoteManualDelivery(input: {
  deliveryAddress?: string | null;
  deliveryFee?: unknown;
  neighborhoods?: ManualDeliveryNeighborhood[];
}): ManualDeliveryQuote {
  const deliveryAddress = typeof input.deliveryAddress === 'string' ? input.deliveryAddress.trim() : '';
  if (!deliveryAddress) {
    return { type: 'pickup', deliveryAddress: null, neighborhood: '', deliveryFee: 0 };
  }

  const neighborhoods = Array.isArray(input.neighborhoods) ? input.neighborhoods : [];
  const typedFee = explicitFee(input.deliveryFee);
  if (typedFee != null) {
    return { type: 'delivery', deliveryAddress, neighborhood: '', deliveryFee: typedFee };
  }

  if (neighborhoods.length === 1) {
    const only = neighborhoods[0];
    return {
      type: 'delivery',
      deliveryAddress,
      neighborhood: only.name,
      deliveryFee: roundCurrency(Number(only.fee) || 0),
    };
  }

  const haystack = normalizeComparableText(deliveryAddress);
  const match = neighborhoods.find((item) => {
    const name = normalizeComparableText(item.name);
    return name.length > 0 && haystack.includes(name);
  });
  if (match) {
    return {
      type: 'delivery',
      deliveryAddress,
      neighborhood: match.name,
      deliveryFee: roundCurrency(Number(match.fee) || 0),
    };
  }

  return { type: 'delivery', deliveryAddress, neighborhood: '', deliveryFee: 0 };
}

export function manualFulfillmentSnapshot(quote: ManualDeliveryQuote, pickupDate: string, pickupTime: string) {
  return {
    type: quote.type,
    pickupDate,
    pickupTime,
    ...(quote.type === 'delivery' ? {
      deliveryAddress: quote.deliveryAddress,
      address: quote.deliveryAddress,
      neighborhood: quote.neighborhood,
      deliveryNeighborhood: quote.neighborhood,
    } : {}),
  };
}
