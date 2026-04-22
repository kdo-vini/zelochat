import { OrderStatus } from '../../types/orders';

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['preparing'],
  preparing: ['ready'],
  ready: ['delivered'],
  delivered: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextStatus(current: OrderStatus): OrderStatus | null {
  const options = TRANSITIONS[current];
  return options.length > 0 ? options[0] : null;
}
