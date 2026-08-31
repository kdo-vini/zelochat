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
export type ConversationMode = 'ai' | 'human';
export type TakeoverSource =
  | 'zelochat_operator'
  | 'native_whatsapp'
  | 'explicit_manual_toggle'
  | 'escalation';

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
  remoteJid?: string;
  customerName: string;
  customerPhone: string;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
  messages: ChatMessage[];
  status: SessionStatus;
  alerts?: string[];
  autoReply?: boolean;
  /** Durable conversation mode. `autoReply` remains a derived compatibility projection. */
  conversationMode?: ConversationMode;
  /** Postgres bigint transported losslessly as a string. */
  conversationEpoch?: string;
  takeoverSource?: TakeoverSource | null;
  takeoverAt?: string | null;
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

export type CustomerActivityState = 'active' | 'inactive' | 'never';

export interface CustomerSummary {
  id: string;
  name: string;
  phone: string | null;
  hasWhatsApp: boolean;
  lastActivityAt: string | null;
  activityState: CustomerActivityState;
  totalOrders: number;
  totalValue: number;
  tags: Array<Tag | string>;
  /** Canonical CRM aliases used by the customer API adapter. */
  whatsapp?: string | null;
  orderCount?: number;
  openBalance?: number | null;
}

export type CustomerOrderingContextSource = 'fixed' | 'last_order' | 'derived' | 'none';

export interface CustomerOrderingContextField<T> {
  value: T | null;
  source: CustomerOrderingContextSource;
}

export interface CustomerOrderingAddress {
  address: string;
  neighborhood: string | null;
  complement: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  reference: string | null;
  display: string;
}

export interface CustomerOrderingHabitualTime {
  minutes: number;
  label: string;
}

export interface CustomerOrderingFrequentItem {
  productId: string;
  name: string;
  orderFrequency: number;
  totalQuantity: number;
}

export interface CustomerOrderingModifierOption {
  id: string;
  name: string;
  priceDelta: number;
  quantity: number;
}

export interface CustomerOrderingModifierGroup {
  id: string;
  name: string;
  kind: 'adicional' | 'variacao';
  options: CustomerOrderingModifierOption[];
}

export interface CustomerOrderingLastOrderItem {
  id: string;
  productId: string | null;
  name: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
  position: number;
  modifiers: CustomerOrderingModifierGroup[];
}

export interface CustomerOrderingLastOrder {
  id: string;
  status: 'accepted' | 'preparing' | 'ready' | 'out_for_delivery' | 'delivered';
  createdAt: string;
  closedAt: string | null;
  customer: Record<string, unknown>;
  fulfillment: Record<string, unknown> & {
    type: 'delivery' | 'pickup' | null;
    asap: boolean | null;
    pickupDate: string | null;
    pickupTime: string | null;
    address: CustomerOrderingAddress | null;
  };
  payment: Record<string, unknown> & {
    declaredMethod: string | null;
    pixReceiptRequired: boolean;
    pixReceiptApproved: boolean;
  };
  totals: {
    subtotal: number;
    deliveryFee: number;
    discount: number;
    total: number;
  };
  observations: string | null;
  items: CustomerOrderingLastOrderItem[];
}

export interface CustomerOrderingOverrides {
  fulfillmentType?: 'delivery' | 'pickup';
  deliveryAddress?: Pick<CustomerOrderingAddress, 'address'> & Partial<Omit<CustomerOrderingAddress, 'address' | 'display'>>;
  paymentMethod?: string;
  habitualTime?: string;
}

export interface CustomerOrderingContextSnapshot {
  fulfillmentType: CustomerOrderingContextField<'delivery' | 'pickup'>;
  deliveryAddress: CustomerOrderingContextField<CustomerOrderingAddress>;
  paymentMethod: CustomerOrderingContextField<string>;
  habitualTime: CustomerOrderingContextField<CustomerOrderingHabitualTime>;
  medianRecurrenceDays: CustomerOrderingContextField<number>;
  frequentItems: CustomerOrderingContextField<CustomerOrderingFrequentItem[]>;
  lastOrder: CustomerOrderingContextField<CustomerOrderingLastOrder>;
  overrides: CustomerOrderingOverrides;
}

export interface CustomerDetail extends CustomerSummary {
  aniversario: {
    day: number;
    month: number;
    year: number | null;
  } | null;
  internalNotes: string | null;
  aiSummary: string | null;
  whatsappBlockedAt: string | null;
  whatsappBlockReason: string | null;
  lastManualContactAt: string | null;
  sessions: ChatSession[];
  birthday?: { day: number; month: number; year: number | null } | null;
  notes?: string | null;
  automaticSummary?: string | null;
  relationship?: { blocked: boolean; blockReason: string | null; optedOut?: boolean; campaigns: number; automations: number };
  orders?: Array<{ id: string; createdAt: string; status: string; total: number }>;
  primaryJid?: string | null;
  orderingContext?: CustomerOrderingContextSnapshot;
}

export interface CustomerFilters {
  q?: string;
  activityState?: CustomerActivityState;
  hasPhone?: boolean;
  tagId?: string;
  tagIds?: string[];
  birthdayMonth?: number;
  vip?: boolean;
  birthdayOnly?: boolean;
  origin?: string;
  tags?: string[];
  cursor?: string | null;
  limit?: number;
}

export type CustomerTimelineEvent =
  | {
      kind: 'message';
      id: string;
      occurredAt: string;
      sessionId: string;
      direction: 'inbound' | 'outbound';
      preview: string;
    }
  | {
      kind: 'order';
      id: string;
      occurredAt: string;
      status: 'pending_payment' | 'pending_review' | 'accepted' | 'preparing' | 'ready' | 'out_for_delivery' | 'delivered' | 'rejected' | 'cancelled';
      total: number;
    }
  | {
      kind: 'relationship';
      id: string;
      occurredAt: string;
      action: 'created' | 'updated' | 'blocked' | 'unblocked' | 'tagged' | 'untagged';
      actorId: string | null;
    };

export type CustomerTimelineEntry = CustomerTimelineEvent;

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
  /** Canonical pessoa link; snapshots below remain authoritative for display. */
  personId?: string;
  revision?: number;
  customerName: string;
  customerPhone: string;
  items: OrderItem[];
  pickupDate: string; // YYYY-MM-DD
  pickupTime: string; // HH:MM
  deliveryAddress?: string; // Optional delivery address (presence implies delivery, not pickup)
  driverId?: string; // Assigned motoboy
  paymentMethod?: string; // e.g. "Pix", "Dinheiro", "Cartão"
  observations?: string; // Free-form note from the customer (or operator) — "sem cebola", "ponto bem passado", etc.
  status: 'pending' | 'preparing' | 'ready' | 'out_for_delivery' | 'delivered';
  /** Canonical ZeloMenu order is waiting for the store's accept/reject decision. */
  requiresAcceptance?: boolean;
  total: number;
  createdAt: string;
  /** Stamped by the canonical engine (zelo_orders.closed_at) when the order was
   *  finalized (delivered/closed). Used to age delivered cards off the Produção
   *  board. Absent for active orders and for legacy imports. */
  closedAt?: string;
  pixReceiptApproved?: boolean;
}

export interface OrderItemModifierGroup {
  groupName: string;
  optionNames: string[];
}

export interface OrderItem {
  /** Existing display value kept for Kanban, chat and legacy callers. */
  product: string;
  /** Base product name, present when the item came from ZeloMenu. */
  productName?: string;
  /** Structured selections used by semantic renderers such as the printer. */
  modifierGroups?: OrderItemModifierGroup[];
  quantity: number;
  unitPrice?: number;
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

type PixReceiptFallback = 'ask_retry' | 'escalate_human';

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

export type MessageStatus =
  | 'preparing'
  | 'queued'
  | 'sending'
  | 'dispatch_started'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'failed_before_dispatch'
  | 'delivery_uncertain'
  | 'cancelled';

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
  /** Durable outbound classification, when this message was sent by the server. */
  outboundOrigin?: import('./domain/outbound.js').OutboundOrigin;
  /** Detailed outbound lifecycle; kept separate from the legacy UI status. */
  outboundState?: import('./domain/outbound.js').OutboundState;
  outboundJobId?: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
  audio_transcript?: string | null;
  audio_transcript_status?: AudioTranscriptStatus | null;
  reactions?: MessageReaction[];
  quotedWaId?: string;
  quotedFromMe?: boolean;
  quotedPreview?: string;
}
