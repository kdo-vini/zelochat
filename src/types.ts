export interface Product {
  id: string;
  name: string;
  price: number;
  available: boolean;
  unitBased?: boolean;
  stockControlled?: boolean;
  stockQuantity?: number;
  category: 'salgado' | 'doce' | 'bebida';
}

export type SessionStatus = 'active' | 'escalated' | 'resolved' | 'archived';

export interface Tag {
  id: string;
  empresaId: string;
  name: string;
  color: string;
  aiInstructions: string | null;
  autoApplyCondition: string | null;
  createdAt: string;
}

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
  pinned?: boolean;
  customerProfile?: string | null;
  tags?: Tag[];
  hasMoreMessages?: boolean;
}

export type ChatListFilter = 'all' | 'unread' | 'active' | 'escalated' | 'resolved' | 'archived';

export interface ChatSessionsQuery {
  limit?: number;
  cursor?: string | null;
  status?: ChatListFilter;
  q?: string;
  tagId?: string | null;
}

export interface ChatSessionsPage {
  sessions: ChatSession[];
  nextCursor: string | null;
  hasMore: boolean;
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

export type DashboardRange = 'today' | '7d' | '30d' | 'custom';

export interface DashboardMetricValue {
  value: number | null;
  samples?: number;
}

export interface DashboardAttentionItem {
  id: string;
  type: 'waiting_chat' | 'open_escalation' | 'stale_manual' | 'order_risk' | 'ai_config';
  title: string;
  description: string;
  action: 'chat' | 'kanban' | 'calendar' | 'ai-configs';
  tone: 'neutral' | 'warning' | 'danger';
}

export interface DashboardUpcomingOrder {
  id: string;
  customerName: string;
  pickupTime: string;
  status: Order['status'];
  total: number;
}

export interface DashboardOverview {
  range: DashboardRange;
  generatedAt: string;
  periodLabel: string;
  startDate: string;
  endDate: string;
  now: {
    waitingConversations: number;
    openEscalations: number;
    manualConversations: number;
    aiConversations: number;
    staleManualConversations: number;
  };
  speed: {
    firstResponseMs: DashboardMetricValue;
    aiResponseMs: DashboardMetricValue;
    humanResponseMs: DashboardMetricValue;
    escalationAckMs: DashboardMetricValue;
    escalationResolveMs: DashboardMetricValue;
  };
  orders: {
    count: number;
    revenue: number;
    averageTicket: number | null;
    pendingCount: number;
    preparingCount: number;
    atRiskCount: number;
    upcoming: DashboardUpcomingOrder[];
  };
  aiHealth: {
    catalogLoaded: boolean;
    operatingHoursConfigured: boolean;
    deliveryConfigConfigured: boolean;
    managerPhonePresent: boolean;
    pixPresent: boolean;
    aiEnabled: boolean;
    aiMode: 'always_on' | 'always_off' | 'scheduled';
    aiEffectiveEnabledNow: boolean;
    blockedDatesCount: number;
    safeSummaryStatus: 'ready' | 'disabled' | 'scheduled_off' | 'needs_configuration';
  } | null;
  attentionItems: DashboardAttentionItem[];
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
  pixReceiptApproved?: boolean;
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

export type TriggerKind = 'notify_manager' | 'escalate_human' | 'redirect_contact';

export interface Trigger {
  id: string;
  empresaId: string;
  kind: TriggerKind;
  name: string;
  conditionDescription: string;
  naturalInput: string;
  active: boolean;
  redirectPhone?: string | null;
  redirectMessage?: string | null;
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

export type PixReceiptFallback = 'ask_retry' | 'escalate_human';

export interface PixReceiptConfig {
  available: boolean;
  enabled: boolean;
  beneficiaryNames: string[];
  valueTolerance: number;
  maxAgeHours: number;
  fallback: PixReceiptFallback;
  minConfidence: number;
}

export interface ZeloState {
  products: Product[];
  blockedDates: { date: string, reason: string }[];
  orders: Order[];
  sessions: ChatSession[];
  aiInstructions: string;
  deliveryConfig: DeliveryConfig | null;
  pixReceiptConfig: PixReceiptConfig;
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
    timezone: string;
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

export type ChatAttachmentType = 'image' | 'document' | 'audio' | 'video' | 'sticker';

export type MessageStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface ChatAttachment {
  type: ChatAttachmentType;
  mimeType: string;
  fileName: string;
  dataUrl?: string;
  sizeBytes?: number;
  durationSeconds?: number;
}

export type AudioTranscriptStatus = 'pending' | 'done' | 'failed';

export interface MessageReaction {
  emoji: string;
  fromMe: boolean;
}

export interface ChatMessage {
  id: string;
  waMessageId?: string | null;
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
  reactions?: MessageReaction[];
  quotedWaId?: string;
  quotedFromMe?: boolean;
  quotedPreview?: string;
}
