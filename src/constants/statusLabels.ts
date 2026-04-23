import { OrderStatus } from '../types/orders';

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pendente',
  preparing: 'Preparando',
  ready: 'Pronto',
  delivered: 'Entregue',
};

export const STATUS_COLORS: Record<OrderStatus, string> = {
  pending: 'bg-orange-100 text-orange-600',
  preparing: 'bg-blue-100 text-blue-600',
  ready: 'bg-green-100 text-green-600',
  delivered: 'bg-gray-100 text-gray-600',
};
