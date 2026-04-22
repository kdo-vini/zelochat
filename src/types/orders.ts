export interface Order {
  id: string;
  customerName: string;
  customerPhone: string;
  items: { product: string; quantity: number }[];
  pickupDate: string; // YYYY-MM-DD
  pickupTime: string; // HH:MM
  deliveryAddress?: string;
  driverId?: string;
  status: 'pending' | 'preparing' | 'ready' | 'delivered';
  total: number;
  createdAt: string;
}

export type OrderStatus = Order['status'];

// Draft collected from conversation before creating an Order
export interface OrderDraft {
  product?: string;
  quantity?: number;
  pickupDate?: string;
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
}

export interface OrderDraftErrors {
  missingFields: (keyof OrderDraft)[];
  isValid: boolean;
}
