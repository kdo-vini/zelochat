const ORDER_STATUS_LABELS: Readonly<Record<string, string>> = {
  pending_payment: 'Aguardando pagamento',
  pending_review: 'Em análise',
  accepted: 'Aceito',
  preparing: 'Em preparo',
  ready: 'Pronto',
  out_for_delivery: 'Saiu para entrega',
  delivered: 'Entregue',
  rejected: 'Recusado',
  cancelled: 'Cancelado',
};

export function orderStatusLabel(status: string): string {
  const label = ORDER_STATUS_LABELS[status];
  return typeof label === 'string' ? label : 'Status não identificado';
}
