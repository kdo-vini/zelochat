import { Product, QuickResponse } from './catalog';
import { Order } from './orders';
import { ChatSession, ChatMessage } from './chat';
import { BlockedDate, BusinessInfo } from './calendar';
import { AlertTrigger } from './alerts';

export interface DeliveryDriver {
  id: string;
  name: string;
  phone: string;
  status: 'available' | 'busy' | 'offline';
}

export interface ZeloState {
  products: Product[];
  blockedDates: BlockedDate[];
  orders: Order[];
  sessions: ChatSession[];
  aiInstructions: string;
  quickResponses: QuickResponse[];
  dailyContext: { id: string; text: string }[];
  alertTriggers: AlertTrigger[];
  managerHistory: ChatMessage[];
  drivers: DeliveryDriver[];
  businessInfo: BusinessInfo;
  profile: {
    name: string;
    email: string;
    role: string;
    avatar: string;
    notifications: boolean;
    darkMode: boolean;
  };
}
