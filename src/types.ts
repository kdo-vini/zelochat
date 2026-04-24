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
  autoReply?: boolean;
  profilePicUrl?: string;
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

export type TriggerKind = 'notify_manager' | 'escalate_human';

export interface Trigger {
  id: string;
  empresaId: string;
  kind: TriggerKind;
  name: string;
  conditionDescription: string;
  naturalInput: string;
  active: boolean;
  createdAt: string;
}

export interface ZeloState {
  products: Product[];
  blockedDates: { date: string, reason: string }[];
  orders: Order[];
  sessions: ChatSession[];
  aiInstructions: string;
  quickResponses: QuickResponse[];
  dailyContext: { id: string, text: string }[];
  triggers: Trigger[];
  managerHistory: ChatMessage[];
  drivers: DeliveryDriver[];
  businessInfo: {
    name: string;
    openTime: string;  // HH:MM, e.g. "09:00"
    closeTime: string; // HH:MM, e.g. "18:00"
    closedDays: string[];
    specialty: string;
    address: string;
    phone: string;
    pixKey: string;
    managerPhone: string;
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

export type ChatAttachmentType = 'image' | 'document' | 'audio' | 'video';

export type MessageStatus = 'sent' | 'delivered' | 'read';

export interface ChatAttachment {
  type: ChatAttachmentType;
  mimeType: string;
  fileName: string;
  dataUrl?: string;
  sizeBytes?: number;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  preview: string;
  timestamp: string;
  kind: 'text' | ChatAttachmentType;
  attachment?: ChatAttachment;
  status?: MessageStatus;
}
