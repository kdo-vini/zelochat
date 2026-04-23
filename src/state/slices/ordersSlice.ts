import { Order, OrderStatus } from '../../types/orders';
import { DeliveryDriver } from '../../types/state';

export interface OrdersState {
  orders: Order[];
  drivers: DeliveryDriver[];
}

export type OrdersAction =
  | { type: 'orders/addOrder'; payload: Order }
  | { type: 'orders/updateStatus'; payload: { id: string; status: OrderStatus } }
  | { type: 'orders/assignDriver'; payload: { orderId: string; driverId: string } }
  | { type: 'orders/addDriver'; payload: DeliveryDriver }
  | { type: 'orders/updateDriver'; payload: DeliveryDriver }
  | { type: 'orders/removeDriver'; payload: { id: string } }
  | { type: 'orders/setDriverStatus'; payload: { id: string; status: DeliveryDriver['status'] } };

export function ordersReducer(state: OrdersState, action: OrdersAction): OrdersState {
  switch (action.type) {
    case 'orders/addOrder':
      return { ...state, orders: [...state.orders, action.payload] };
    case 'orders/updateStatus':
      return {
        ...state,
        orders: state.orders.map(o =>
          o.id === action.payload.id ? { ...o, status: action.payload.status } : o
        ),
      };
    case 'orders/assignDriver':
      return {
        ...state,
        orders: state.orders.map(o =>
          o.id === action.payload.orderId ? { ...o, driverId: action.payload.driverId } : o
        ),
      };
    case 'orders/addDriver':
      return { ...state, drivers: [...state.drivers, action.payload] };
    case 'orders/updateDriver':
      return {
        ...state,
        drivers: state.drivers.map(d => d.id === action.payload.id ? action.payload : d),
      };
    case 'orders/removeDriver':
      return { ...state, drivers: state.drivers.filter(d => d.id !== action.payload.id) };
    case 'orders/setDriverStatus':
      return {
        ...state,
        drivers: state.drivers.map(d =>
          d.id === action.payload.id ? { ...d, status: action.payload.status } : d
        ),
      };
    default:
      return state;
  }
}
