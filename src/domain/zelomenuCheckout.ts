export type ZeloMenuCheckoutDetails = {
  customerName: string | null | undefined;
  customerPhone: string | null | undefined;
  fulfillmentType: 'pickup' | 'delivery';
  deliveryAddress: string | null | undefined;
  pickupDate: string | null | undefined;
  pickupTime: string | null | undefined;
};

export type ZeloMenuCheckoutField =
  | 'customerName'
  | 'customerPhone'
  | 'deliveryAddress'
  | 'pickupDate'
  | 'pickupTime';

export type ZeloMenuCheckoutErrors = Partial<Record<ZeloMenuCheckoutField, string>>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateZeloMenuCheckoutDetails(
  details: ZeloMenuCheckoutDetails,
): ZeloMenuCheckoutErrors {
  const errors: ZeloMenuCheckoutErrors = {};
  const phoneDigits = (details.customerPhone ?? '').replace(/\D/g, '');

  if (!(details.customerName ?? '').trim()) {
    errors.customerName = 'Informe seu nome.';
  }
  if (phoneDigits.length < 10 || phoneDigits.length > 11) {
    errors.customerPhone = 'Informe um WhatsApp válido com DDD.';
  }
  if (details.fulfillmentType === 'delivery' && !(details.deliveryAddress ?? '').trim()) {
    errors.deliveryAddress = 'Informe o endereço da entrega.';
  }
  if (!DATE_PATTERN.test((details.pickupDate ?? '').trim())) {
    errors.pickupDate = 'Informe a data.';
  }
  if (!TIME_PATTERN.test((details.pickupTime ?? '').trim())) {
    errors.pickupTime = 'Informe o horário.';
  }

  return errors;
}

export function firstZeloMenuCheckoutError(
  errors: ZeloMenuCheckoutErrors,
): string | null {
  return (
    errors.customerName
    ?? errors.customerPhone
    ?? errors.deliveryAddress
    ?? errors.pickupDate
    ?? errors.pickupTime
    ?? null
  );
}
