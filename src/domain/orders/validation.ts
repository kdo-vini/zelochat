import { OrderDraft, OrderDraftErrors } from '../../types/orders';

const REQUIRED_FIELDS: (keyof OrderDraft)[] = [
  'product',
  'quantity',
  'pickupDate',
  'customerName',
  'customerPhone',
];

export function validateOrderDraft(draft: OrderDraft): OrderDraftErrors {
  const missingFields = REQUIRED_FIELDS.filter(field => {
    const value = draft[field];
    return value === undefined || value === null || value === '';
  });

  return {
    missingFields: missingFields as (keyof OrderDraft)[],
    isValid: missingFields.length === 0,
  };
}

// Builds a prompt fragment telling the AI which fields are still missing
export function buildMissingFieldsPrompt(draft: OrderDraft): string {
  const { missingFields } = validateOrderDraft(draft);
  if (missingFields.length === 0) return '';

  const labels: Record<keyof OrderDraft, string> = {
    product: 'produto desejado',
    quantity: 'quantidade',
    pickupDate: 'data de retirada',
    customerName: 'nome do cliente',
    customerPhone: 'telefone',
    deliveryAddress: 'endereço de entrega',
  };

  const missing = missingFields.map(f => labels[f]).join(', ');
  return `CAMPOS AINDA PENDENTES NA ENCOMENDA: ${missing}. NÃO confirme o pedido sem coletar todos esses dados.`;
}
