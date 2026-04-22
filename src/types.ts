export interface Product {
  id: string;
  name: string;
  price: number;
  available: boolean;
  category: 'salgado' | 'doce' | 'bebida';
}

export interface ChatSession {
  id: string;
  customerName: string;
  customerPhone: string;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
  messages: ChatMessage[];
  status: 'active' | 'archived';
  alerts?: string[];
}

export interface Order {
  id: string;
  customerName: string;
  customerPhone: string;
  items: { product: string; quantity: number }[];
  pickupDate: string; // YYYY-MM-DD
  pickupTime: string; // HH:MM
  deliveryAddress?: string; // Optional delivery address
  driverId?: string; // Assigned motoboy
  status: 'pending' | 'preparing' | 'ready' | 'delivered';
  total: number;
  createdAt: string;
}

export interface QuickResponse {
  id: string;
  trigger: string;
  response: string;
}

export interface DeliveryDriver {
  id: string;
  name: string;
  phone: string;
  status: 'available' | 'busy' | 'offline';
}

export interface ZeloState {
  products: Product[];
  blockedDates: { date: string, reason: string }[];
  orders: Order[];
  sessions: ChatSession[];
  aiInstructions: string;
  quickResponses: QuickResponse[];
  dailyContext: { id: string, text: string }[];
  alertTriggers: { id: string, name: string, active: boolean }[];
  managerHistory: ChatMessage[];
  drivers: DeliveryDriver[];
  businessInfo: {
    name: string;
    hours: string;
    closedDays: string[];
    specialty: string;
    address: string;
    phone: string;
    pixKey: string;
  };
  profile: {
    name: string;
    email: string;
    role: string;
    avatar: string;
    notifications: boolean;
    darkMode: boolean;
  };
}

export type MessageRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
}
