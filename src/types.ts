export interface Product {
  id: string;
  name: string;
  price: number;
  available: boolean;
  category: 'salgado' | 'doce' | 'bebida';
}

export type SessionStatus = 'active' | 'escalated' | 'resolved' | 'archived';

export interface ChatSession {
  id: string;
  customerName: string;
  customerPhone: string;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
  messages: ChatMessage[];
  status: SessionStatus;
  alerts?: string[];
  autoReply?: boolean;
  profilePicUrl?: string;
  escalatedAt?: string | null;
  acknowledgedAt?: string | null;
}

export type EscalationReasonCategory =
  | 'frustration'
  | 'complaint'
  | 'explicit_human_request'
  | 'repeated_ai_failure'
  | 'offensive_language'
  | 'manual'
  | 'custom';

export interface EscalationEvent {
  id: string;
  empresaId: string;
  sessionId: string;
  triggerId: string | null;
  triggerKind: 'escalate_human' | 'notify_manager';
  triggerName: string;
  reasonCategory: EscalationReasonCategory;
  reasonText: string;
  customerMessageExcerpt: string | null;
  triggeredAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export interface BuiltinTriggerInfo {
  id: string;
  kind: TriggerKind;
  name: string;
  conditionDescription: string;
  disabled: boolean;
}

export interface Order {
  id: string;
  customerName: string;
  customerPhone: string;
  items: { product: string; quantity: number }[];
  pickupDate: string; // YYYY-MM-DD
  pickupTime: string; // HH:MM
  deliveryAddress?: string; // Optional delivery address (presence implies delivery, not pickup)
  driverId?: string; // Assigned motoboy
  paymentMethod?: string; // e.g. "Pix", "Dinheiro", "Cartão"
  observations?: string; // Free-form note from the customer (or operator) — "sem cebola", "ponto bem passado", etc.
  status: 'pending' | 'preparing' | 'ready' | 'out_for_delivery' | 'delivered';
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

export interface DeliveryNeighborhood {
  name: string;
  fee: number;
}

export interface DeliveryConfig {
  enabled: boolean;
  neighborhoods: DeliveryNeighborhood[];
}

export interface ZeloState {
  products: Product[];
  blockedDates: { date: string, reason: string }[];
  orders: Order[];
  sessions: ChatSession[];
  aiInstructions: string;
  deliveryConfig: DeliveryConfig | null;
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

export type MessageRole = 'user' | 'assistant' | 'tool' | 'system';

export type ChatAttachmentType = 'image' | 'document' | 'audio' | 'video';

export type MessageStatus = 'sent' | 'delivered' | 'read';

export interface ChatAttachment {
  type: ChatAttachmentType;
  mimeType: string;
  fileName: string;
  dataUrl?: string;
  sizeBytes?: number;
}

export type AudioTranscriptStatus = 'pending' | 'done' | 'failed';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string | null;
  preview: string;
  timestamp: string;
  kind: 'text' | ChatAttachmentType;
  attachment?: ChatAttachment;
  status?: MessageStatus;
  tool_calls?: any[];
  tool_call_id?: string;
  audio_transcript?: string | null;
  audio_transcript_status?: AudioTranscriptStatus | null;
}
