import { Dispatch } from 'react';
import { AppAction } from '../state/rootReducer';
import { OrderStatus } from '../types/orders';
import { canTransition } from '../domain/orders/lifecycle';

export function changeOrderStatus(
  orderId: string,
  currentStatus: OrderStatus,
  newStatus: OrderStatus,
  dispatch: Dispatch<AppAction>
): boolean {
  if (!canTransition(currentStatus, newStatus)) {
    console.warn(`Invalid transition: ${currentStatus} → ${newStatus}`);
    return false;
  }
  dispatch({ type: 'orders/updateStatus', payload: { id: orderId, status: newStatus } });
  return true;
}

export function forceOrderStatus(
  orderId: string,
  newStatus: OrderStatus,
  dispatch: Dispatch<AppAction>
): void {
  // Used by drag-and-drop in Kanban — bypasses transition validation
  dispatch({ type: 'orders/updateStatus', payload: { id: orderId, status: newStatus } });
}

export function assignDriverToOrder(
  orderId: string,
  driverId: string,
  dispatch: Dispatch<AppAction>
): void {
  dispatch({ type: 'orders/assignDriver', payload: { orderId, driverId } });
  dispatch({ type: 'orders/setDriverStatus', payload: { id: driverId, status: 'busy' } });
}
