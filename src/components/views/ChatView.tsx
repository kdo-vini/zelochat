import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Archive,
  ArrowLeft,
  Bot,
  Calendar,
  Check,
  CheckCheck,
  CheckSquare,
  CreditCard,
  FileText,
  ImagePlus,
  Info,
  Loader2,
  MapPin,
  MessageCircle,
  Mic,
  MicOff,
  MoreVertical,
  Paperclip,
  Pencil,
  Phone,
  Pin,
  PinOff,
  Plus,
  Search,
  Send,
  ShoppingBag,
  Square,
  StickyNote,
  Trash2,
  Upload,
  UserPlus,
  Video,
  X,
} from 'lucide-react';
import {
  formatLastMessageTime,
  formatDateSeparatorLabel,
  startOfDayKey,
  normalizePhoneNumber,
  maskBrazilianPhone,
  maskTime24h,
} from '../../domain/chat';
import { MessageDateSeparator } from './MessageDateSeparator';
import {
  getManualChatAssistSuggestion,
  getManualOrderDraftSuggestion,
  getOwnerResponse,
  type ManualOrderDraftSuggestion,
} from '../../services/openaiService';
import type { ChatAttachment, ChatMessage, ChatSession, Order, QuickResponse } from '../../types';
import { MessageBubble } from './MessageBubble';
import { EscaladoBadge } from '../shared/EscaladoBadge';
import { SlaTimer } from '../shared/SlaTimer';
import { EscalationLogCard } from '../shared/EscalationLogCard';
import { useEscalationEvents } from '../../hooks/useEscalationEvents';
import { ConfirmModal } from '../ConfirmModal';
import { ContactAvatar } from '../ContactAvatar';
import { Modal, useModalTitleId } from '../Modal';
import { getFriendlyErrorMessage } from '../../services/errorMessages';
import { sendContact } from '../../services/waApi';

/* ─── Utilities ───────────────────────────────────────────────── */

const CHAT_SESSION_ROW_HEIGHT = 73;
const CHAT_LIST_OVERSCAN = 8;
const CHAT_LIST_VIRTUALIZE_AFTER = 80;

function formatPhoneDisplay(phone: string): string {
  if (!phone) return phone;
  const digits = normalizePhoneNumber(phone);
  const local = digits.startsWith('55') ? digits.slice(2) : digits;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return phone;
}

function formatAttachmentSize(sizeBytes?: number): string {
  if (!sizeBytes) return 'Arquivo';
  if (sizeBytes < 1024 * 1024) return `${Math.max(sizeBytes / 1024, 1).toFixed(0)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') { resolve(reader.result); return; }
      reject(new Error('Não foi possível ler o arquivo.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Falha ao ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

type ManualOrderFormData = {
  customerName: string;
  customerPhone: string;
  pickupDate: string;
  pickupTime: string;
  deliveryAddress: string;
  paymentMethod: string;
  observations: string;
  items: { product: string; quantity: number }[];
  total: string;
};

const MANUAL_ORDER_PAYMENT_OPTIONS = ['Pix', 'Dinheiro', 'Cartão'] as const;

function getBrasiliaDateISO(): string {
  const [day, month, year] = new Date()
    .toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    .split('/');
  return `${year}-${month}-${day}`;
}

function getBrasiliaTimeHHMM(): string {
  return new Date().toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatIsoToBR(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function toPhoneInputValue(phone: string): string {
  const digits = normalizePhoneNumber(phone);
  const local = digits.startsWith('55') && (digits.length === 12 || digits.length === 13)
    ? digits.slice(2)
    : digits;
  return maskBrazilianPhone(local);
}

function toTotalInputValue(total: ManualOrderDraftSuggestion['total']): string {
  if (typeof total === 'number' && Number.isFinite(total) && total > 0) {
    return total.toFixed(2).replace('.', ',');
  }
  if (typeof total === 'string') {
    return total.trim();
  }
  return '';
}

function buildManualOrderFormDraft(
  draft: ManualOrderDraftSuggestion,
  session: ChatSession,
): ManualOrderFormData {
  const normalizedItems = Array.isArray(draft.items) && draft.items.length > 0
    ? draft.items.map((item) => ({
        product: item.product?.trim() || '',
        quantity: Number.isFinite(item.quantity) && (item.quantity as number) > 0
          ? Math.round(item.quantity as number)
          : 1,
      }))
    : [{ product: '', quantity: 1 }];

  const pickupDate = /^\d{4}-\d{2}-\d{2}$/.test(draft.pickupDate ?? '')
    ? (draft.pickupDate as string)
    : getBrasiliaDateISO();
  const pickupTime = /^\d{2}:\d{2}$/.test(draft.pickupTime ?? '')
    ? (draft.pickupTime as string)
    : getBrasiliaTimeHHMM();

  return {
    customerName: draft.customerName?.trim() || session.customerName || '',
    customerPhone: toPhoneInputValue(draft.customerPhone?.trim() || session.customerPhone || ''),
    pickupDate,
    pickupTime,
    deliveryAddress: draft.deliveryAddress?.trim() || '',
    paymentMethod: draft.paymentMethod?.trim() || '',
    observations: draft.observations?.trim() || '',
    items: normalizedItems,
    total: toTotalInputValue(draft.total),
  };
}

function ManualOrderDraftCard({
  draft,
  dateDisplay,
  saving,
  error,
  onClose,
  onSave,
  onFieldChange,
  onDateDisplayChange,
  onItemChange,
  onAddItem,
  onRemoveItem,
}: {
  draft: ManualOrderFormData;
  dateDisplay: string;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: () => void;
  onFieldChange: <K extends keyof ManualOrderFormData>(field: K, value: ManualOrderFormData[K]) => void;
  onDateDisplayChange: (value: string) => void;
  onItemChange: (index: number, field: 'product' | 'quantity', value: string | number) => void;
  onAddItem: () => void;
  onRemoveItem: (index: number) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      className="mb-3 overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)]/95 shadow-[var(--shadow-pop)]"
    >
      <div className="flex items-start justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]">
              <ShoppingBag className="h-4 w-4" strokeWidth={1.8} />
            </div>
            <div>
              <p className="text-[13px] font-semibold text-[var(--color-ink)]">Pedido sugerido pela IA</p>
              <p className="text-[11.5px] text-[var(--color-ink-muted)]">Revise e salve manualmente antes de lançar.</p>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="rounded-lg p-1.5 text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)] disabled:opacity-40"
          title="Fechar rascunho"
        >
          <X className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </div>

      <div className="max-h-[55vh] space-y-4 overflow-y-auto px-4 py-4 custom-scrollbar">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-[11.5px] font-semibold text-[var(--color-ink-muted)]">Nome do cliente</span>
            <input
              type="text"
              value={draft.customerName}
              onChange={(e) => onFieldChange('customerName', e.target.value)}
              placeholder="Nome completo"
              className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-muted)] px-3 py-2 text-[13px] outline-none transition-colors focus:border-[var(--color-brand)]"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[11.5px] font-semibold text-[var(--color-ink-muted)]">Telefone</span>
            <div className="relative">
              <Phone className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-ink-faint)]" strokeWidth={1.8} />
              <input
                type="tel"
                value={draft.customerPhone}
                onChange={(e) => onFieldChange('customerPhone', maskBrazilianPhone(e.target.value))}
                placeholder="(XX) XXXXX-XXXX"
                className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-muted)] py-2 pl-8 pr-3 text-[13px] outline-none transition-colors focus:border-[var(--color-brand)]"
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[11.5px] font-semibold text-[var(--color-ink-muted)]">Data</span>
            <div className="relative">
              <Calendar className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-ink-faint)]" strokeWidth={1.8} />
              <input
                type="text"
                inputMode="numeric"
                value={dateDisplay}
                onChange={(e) => onDateDisplayChange(e.target.value)}
                placeholder="DD/MM/AAAA"
                className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-muted)] py-2 pl-8 pr-3 text-[13px] outline-none transition-colors focus:border-[var(--color-brand)]"
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[11.5px] font-semibold text-[var(--color-ink-muted)]">Hora</span>
            <input
              type="text"
              inputMode="numeric"
              value={draft.pickupTime}
              onChange={(e) => onFieldChange('pickupTime', maskTime24h(e.target.value))}
              placeholder="HH:MM"
              maxLength={5}
              className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-muted)] px-3 py-2 text-[13px] outline-none transition-colors focus:border-[var(--color-brand)]"
            />
          </label>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11.5px] font-semibold text-[var(--color-ink-muted)]">Itens</span>
            <button
              type="button"
              onClick={onAddItem}
              className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--color-brand)] hover:underline"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              Adicionar item
            </button>
          </div>
          <div className="space-y-2">
            {draft.items.map((item, index) => (
              <div key={`${index}-${item.product}`} className="flex items-center gap-2">
                <input
                  type="text"
                  value={item.product}
                  onChange={(e) => onItemChange(index, 'product', e.target.value)}
                  placeholder="Produto"
                  className="flex-1 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-muted)] px-3 py-2 text-[13px] outline-none transition-colors focus:border-[var(--color-brand)]"
                />
                <input
                  type="number"
                  min={1}
                  value={item.quantity}
                  onChange={(e) => onItemChange(index, 'quantity', Number.parseInt(e.target.value, 10) || 1)}
                  className="w-16 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-muted)] px-2 py-2 text-center text-[13px] outline-none transition-colors focus:border-[var(--color-brand)]"
                />
                {draft.items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onRemoveItem(index)}
                    className="rounded-lg p-1.5 text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-red-500"
                    title="Remover item"
                  >
                    <X className="h-4 w-4" strokeWidth={1.8} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-[11.5px] font-semibold text-[var(--color-ink-muted)]">Endereço de entrega</span>
          <div className="relative">
            <MapPin className="pointer-events-none absolute left-3 top-3 h-3.5 w-3.5 text-[var(--color-ink-faint)]" strokeWidth={1.8} />
            <input
              type="text"
              value={draft.deliveryAddress}
              onChange={(e) => onFieldChange('deliveryAddress', e.target.value)}
              placeholder="Rua, número, bairro"
              className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-muted)] py-2 pl-8 pr-3 text-[13px] outline-none transition-colors focus:border-[var(--color-brand)]"
            />
          </div>
        </label>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_130px]">
          <div>
            <span className="mb-1.5 block text-[11.5px] font-semibold text-[var(--color-ink-muted)]">Pagamento</span>
            <div className="flex flex-wrap gap-1.5">
              {MANUAL_ORDER_PAYMENT_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => onFieldChange('paymentMethod', draft.paymentMethod === option ? '' : option)}
                  className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                    draft.paymentMethod === option
                      ? 'border-[var(--color-brand)] bg-[var(--color-brand)] text-white'
                      : 'border-[var(--color-line)] bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)] hover:border-[var(--color-brand)]/40'
                  }`}
                >
                  {option}
                </button>
              ))}
              <div className="relative min-w-[120px] flex-1">
                <CreditCard className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-ink-faint)]" strokeWidth={1.8} />
                <input
                  type="text"
                  value={MANUAL_ORDER_PAYMENT_OPTIONS.includes(draft.paymentMethod as typeof MANUAL_ORDER_PAYMENT_OPTIONS[number]) ? '' : draft.paymentMethod}
                  onChange={(e) => onFieldChange('paymentMethod', e.target.value)}
                  placeholder="Outro..."
                  className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-muted)] py-2 pl-8 pr-3 text-[13px] outline-none transition-colors focus:border-[var(--color-brand)]"
                />
              </div>
            </div>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-[11.5px] font-semibold text-[var(--color-ink-muted)]">Total (R$)</span>
            <input
              type="text"
              value={draft.total}
              onChange={(e) => onFieldChange('total', e.target.value)}
              placeholder="0,00"
              className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-muted)] px-3 py-2 text-[13px] outline-none transition-colors focus:border-[var(--color-brand)]"
            />
          </label>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-[11.5px] font-semibold text-[var(--color-ink-muted)]">Observações</span>
          <div className="relative">
            <StickyNote className="pointer-events-none absolute left-3 top-3 h-3.5 w-3.5 text-[var(--color-ink-faint)]" strokeWidth={1.8} />
            <textarea
              value={draft.observations}
              onChange={(e) => onFieldChange('observations', e.target.value.slice(0, 500))}
              rows={3}
              maxLength={500}
              placeholder="Ex: sem cebola, deixar na portaria..."
              className="w-full resize-none rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-muted)] py-2 pl-8 pr-3 text-[13px] outline-none transition-colors focus:border-[var(--color-brand)]"
            />
          </div>
        </label>

        {error && (
          <p className="text-[12.5px] font-medium text-red-500">{error}</p>
        )}
      </div>

      <div className="flex gap-2 border-t border-[var(--color-line)] px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="flex-1 rounded-xl bg-[var(--color-surface-muted)] px-3 py-2.5 text-[13px] font-semibold text-[var(--color-ink-soft)] transition-colors hover:bg-[var(--color-line)] disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="flex-1 rounded-xl bg-[var(--color-brand)] px-3 py-2.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Salvando...' : 'Salvar pedido'}
        </button>
      </div>
    </motion.div>
  );
}

/* ─── Props ───────────────────────────────────────────────────── */

export interface ChatViewProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  setActiveSessionId: (id: string | null) => void;
  quickResponses: QuickResponse[];
  chatLoading: boolean;
  chatError: string | null;
  token: string | null;
  authLoading: boolean;
  profilePics: Record<string, string>;
  send: (jid: string, payload: { text: string; attachment?: ChatAttachment }) => Promise<void>;
  toggleAutoReply: (jid: string, enabled: boolean) => Promise<void>;
  deleteMessage: (jid: string, message: ChatMessage) => Promise<void>;
  updateSessionName: (jid: string, name: string) => Promise<void>;
  hydrateSession: (jid: string) => Promise<void>;
  onDeleteSession: (id: string) => Promise<void>;
  markManyRead: (jids: string[]) => Promise<void>;
  bulkArchive: (jids: string[]) => Promise<void>;
  bulkDelete: (jids: string[]) => Promise<void>;
  togglePin: (jid: string) => Promise<void>;
  onDailyContextUpdate: (items: { id: string; text: string }[]) => void;
  onCreateManualOrder: (payload: Omit<Order, 'id' | 'createdAt'>) => Promise<void>;
  resolveEscalation: (jid: string) => Promise<void>;
  escalateManually: (jid: string, reason?: string) => Promise<void>;
  acknowledgeEscalation: (jid: string) => Promise<void>;
  /** Bumps when a new escalation event arrives so the sidebar log can refetch. */
  escalationRefetchKey?: string | number | null;
}

/* ─── Component ───────────────────────────────────────────────── */

export function ChatView({
  sessions,
  activeSessionId,
  setActiveSessionId,
  quickResponses,
  chatLoading,
  chatError,
  token,
  authLoading,
  profilePics,
  send,
  toggleAutoReply,
  deleteMessage,
  updateSessionName,
  hydrateSession,
  onDeleteSession,
  markManyRead,
  bulkArchive,
  bulkDelete,
  togglePin,
  onDailyContextUpdate,
  onCreateManualOrder,
  resolveEscalation,
  escalateManually,
  acknowledgeEscalation,
  escalationRefetchKey,
}: ChatViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [ownerInput, setOwnerInput] = useState('');
  const [chatActionError, setChatActionError] = useState<string | null>(null);

  type ChatListFilter = 'all' | 'unread' | 'active' | 'escalated' | 'resolved' | 'archived';
  const FILTER_STORAGE_KEY = 'zelochat:chatFilter';
  const [statusFilter, setStatusFilter] = useState<ChatListFilter>(() => {
    if (typeof window === 'undefined') return 'all';
    const stored = window.localStorage.getItem(FILTER_STORAGE_KEY);
    if (stored === 'unread' || stored === 'active' || stored === 'escalated'
        || stored === 'resolved' || stored === 'archived' || stored === 'all') {
      return stored;
    }
    return 'all';
  });
  useEffect(() => {
    try { window.localStorage.setItem(FILTER_STORAGE_KEY, statusFilter); } catch { /* ignore */ }
  }, [statusFilter]);

  const [listMenuOpen, setListMenuOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedJids, setSelectedJids] = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState<null | 'read' | 'archive' | 'delete'>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [markAllReadConfirm, setMarkAllReadConfirm] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<ChatAttachment | null>(null);
  const [attachmentLoading, setAttachmentLoading] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newChatPhone, setNewChatPhone] = useState('');
  const [newChatMessage, setNewChatMessage] = useState('');
  const [newChatLoading, setNewChatLoading] = useState(false);
  const [newChatError, setNewChatError] = useState<string | null>(null);
  const [deleteSessionPending, setDeleteSessionPending] = useState<{ id: string; name: string } | null>(null);
  const [deleteMessagePending, setDeleteMessagePending] = useState<ChatMessage | null>(null);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [aiAssistMenuOpen, setAiAssistMenuOpen] = useState(false);
  const [aiAssistLoading, setAiAssistLoading] = useState<'improve' | 'reply' | 'order' | null>(null);
  const [manualOrderDraft, setManualOrderDraft] = useState<ManualOrderFormData | null>(null);
  const [manualOrderDateDisplay, setManualOrderDateDisplay] = useState('');
  const [manualOrderSaving, setManualOrderSaving] = useState(false);
  const [manualOrderError, setManualOrderError] = useState<string | null>(null);
  const newChatTitleId = useModalTitleId();
  const contactModalTitleId = useModalTitleId();
  const chatListRef = useRef<HTMLDivElement>(null);
  const [chatListScrollTop, setChatListScrollTop] = useState(0);
  const [chatListViewportHeight, setChatListViewportHeight] = useState(0);

  const [isRecording, setIsRecording] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactOrg, setContactOrg] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Conversation list width — persisted so the operator's preferred layout survives reloads.
  // Bounds keep at least the avatar+name visible on the lower end and prevent the list from
  // crowding out the chat panel on the upper end.
  const LIST_WIDTH_KEY = 'zelochat:chatListWidth';
  const LIST_WIDTH_MIN = 240;
  const LIST_WIDTH_MAX = 520;
  const LIST_WIDTH_DEFAULT = 300;
  const [listWidth, setListWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return LIST_WIDTH_DEFAULT;
    const stored = Number(window.localStorage.getItem(LIST_WIDTH_KEY));
    if (!Number.isFinite(stored) || stored <= 0) return LIST_WIDTH_DEFAULT;
    return Math.min(LIST_WIDTH_MAX, Math.max(LIST_WIDTH_MIN, stored));
  });
  const isResizingRef = useRef(false);

  const handleListResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const startX = e.clientX;
    const startWidth = listWidth;

    const onMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = ev.clientX - startX;
      const next = Math.min(LIST_WIDTH_MAX, Math.max(LIST_WIDTH_MIN, startWidth + delta));
      setListWidth(next);
    };
    const onUp = () => {
      isResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      // Persist on release so we don't write 200× during the drag.
      setListWidth((current) => {
        try { window.localStorage.setItem(LIST_WIDTH_KEY, String(current)); } catch { /* ignore */ }
        return current;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const chatTextareaRef = useRef<HTMLTextAreaElement>(null);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const queryPhone = q ? normalizePhoneNumber(q) : '';

    const matched = sessions.filter((s) => {
      // Status filter — "Arquivadas" is the only view that exposes archived chats.
      // Every other filter hides them so the operator's main flow stays clean.
      if (statusFilter === 'archived') {
        if (s.status !== 'archived') return false;
      } else {
        if (s.status === 'archived') return false;
        if (statusFilter === 'unread' && (s.unreadCount ?? 0) <= 0) return false;
        if (statusFilter === 'active' && s.status !== 'active') return false;
        if (statusFilter === 'escalated' && s.status !== 'escalated') return false;
        if (statusFilter === 'resolved' && s.status !== 'resolved') return false;
      }

      if (!q) return true;
      const phone = normalizePhoneNumber(s.customerPhone);
      return (
        s.customerName.toLowerCase().includes(q) ||
        s.lastMessage.toLowerCase().includes(q) ||
        (!!queryPhone && phone.includes(queryPhone))
      );
    });

    // Pinned chats float to the top while preserving the upstream recency order.
    if (matched.length === 0) return matched;
    const pinned: ChatSession[] = [];
    const rest: ChatSession[] = [];
    for (const s of matched) {
      if (s.pinned) pinned.push(s);
      else rest.push(s);
    }
    return pinned.length > 0 ? [...pinned, ...rest] : matched;
  }, [sessions, searchQuery, statusFilter]);

  useEffect(() => {
    const el = chatListRef.current;
    if (!el) return;
    const updateHeight = () => setChatListViewportHeight(el.clientHeight);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setChatListScrollTop(0);
    chatListRef.current?.scrollTo({ top: 0 });
  }, [searchQuery, statusFilter]);

  // Selection helpers
  const toggleSelectJid = useCallback((jid: string) => {
    setSelectedJids((previous) => {
      const next = new Set(previous);
      if (next.has(jid)) next.delete(jid);
      else next.add(jid);
      return next;
    });
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedJids(new Set());
  }, []);

  const enterSelectionMode = useCallback((seedJid?: string) => {
    setSelectionMode(true);
    setListMenuOpen(false);
    if (seedJid) setSelectedJids(new Set([seedJid]));
  }, []);

  // Bulk actions — operate on selected jids and exit selection mode on success.
  const runBulkRead = useCallback(async () => {
    const jids: string[] = Array.from(selectedJids.values());
    if (jids.length === 0) return;
    setBulkActionLoading('read');
    setChatActionError(null);
    try {
      await markManyRead(jids);
      exitSelectionMode();
    } catch (err) {
      setChatActionError(getFriendlyErrorMessage(err) ?? 'Não foi possível marcar como lidas.');
    } finally {
      setBulkActionLoading(null);
    }
  }, [selectedJids, markManyRead, exitSelectionMode]);

  const runBulkArchive = useCallback(async () => {
    const jids: string[] = Array.from(selectedJids.values());
    if (jids.length === 0) return;
    setBulkActionLoading('archive');
    setChatActionError(null);
    try {
      await bulkArchive(jids);
      exitSelectionMode();
    } catch (err) {
      setChatActionError(getFriendlyErrorMessage(err) ?? 'Não foi possível arquivar.');
    } finally {
      setBulkActionLoading(null);
    }
  }, [selectedJids, bulkArchive, exitSelectionMode]);

  const runBulkDelete = useCallback(async () => {
    const jids: string[] = Array.from(selectedJids.values());
    if (jids.length === 0) return;
    setBulkActionLoading('delete');
    setChatActionError(null);
    try {
      await bulkDelete(jids);
      setBulkDeleteConfirm(false);
      exitSelectionMode();
    } catch (err) {
      setChatActionError(getFriendlyErrorMessage(err) ?? 'Não foi possível excluir.');
    } finally {
      setBulkActionLoading(null);
    }
  }, [selectedJids, bulkDelete, exitSelectionMode]);

  // "Marcar todas como lidas" — escopo é a lista filtrada/visivel.
  const visibleUnreadJids = useMemo(
    () => filteredSessions.filter((s) => (s.unreadCount ?? 0) > 0).map((s) => s.id),
    [filteredSessions],
  );

  const runMarkAllVisibleRead = useCallback(async () => {
    if (visibleUnreadJids.length === 0) return;
    setListMenuOpen(false);
    try {
      await markManyRead(visibleUnreadJids);
    } catch (err) {
      setChatActionError(getFriendlyErrorMessage(err) ?? 'Não foi possível marcar como lidas.');
    } finally {
      setMarkAllReadConfirm(false);
    }
  }, [visibleUnreadJids, markManyRead]);

  const handleTogglePin = useCallback(async (jid: string) => {
    try {
      await togglePin(jid);
    } catch (err) {
      setChatActionError(getFriendlyErrorMessage(err) ?? 'Não foi possível fixar a conversa.');
    }
  }, [togglePin]);

  const chatListWindow = useMemo(() => {
    const shouldVirtualize = filteredSessions.length > CHAT_LIST_VIRTUALIZE_AFTER;
    if (!shouldVirtualize) {
      return {
        sessions: filteredSessions,
        topPad: 0,
        bottomPad: 0,
      };
    }

    const viewport = chatListViewportHeight || 640;
    const start = Math.max(0, Math.floor(chatListScrollTop / CHAT_SESSION_ROW_HEIGHT) - CHAT_LIST_OVERSCAN);
    const visibleCount = Math.ceil(viewport / CHAT_SESSION_ROW_HEIGHT) + CHAT_LIST_OVERSCAN * 2;
    const end = Math.min(filteredSessions.length, start + visibleCount);

    return {
      sessions: filteredSessions.slice(start, end),
      topPad: start * CHAT_SESSION_ROW_HEIGHT,
      bottomPad: (filteredSessions.length - end) * CHAT_SESSION_ROW_HEIGHT,
    };
  }, [chatListScrollTop, chatListViewportHeight, filteredSessions]);

  const activeSessionMessages = useMemo(
    () => sessions.find((s) => s.id === activeSessionId)?.messages,
    [sessions, activeSessionId],
  );

  /* ─── Date separators ──────────────────────────────────────── */

  type ChatRenderItem =
    | { kind: 'separator'; key: string; label: string; dayKey: string }
    | { kind: 'message'; key: string; message: ChatMessage };

  const chatRenderItems = useMemo<ChatRenderItem[]>(() => {
    const items: ChatRenderItem[] = [];
    const messages = activeSession?.messages ?? [];
    let lastDayKey: string | null = null;
    for (const message of messages) {
      const dayKey = startOfDayKey(message.timestamp);
      if (dayKey !== lastDayKey) {
        items.push({
          kind: 'separator',
          key: `sep-${dayKey}`,
          dayKey,
          label: formatDateSeparatorLabel(message.timestamp),
        });
        lastDayKey = dayKey;
      }
      items.push({ kind: 'message', key: message.id, message });
    }
    return items;
  }, [activeSession?.messages]);

  // Sticky date pill state
  const [stickyLabel, setStickyLabel] = useState<string | null>(null);
  const [stickyVisible, setStickyVisible] = useState(false);
  const separatorRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const stickyHideTimerRef = useRef<number | null>(null);
  const rafPendingRef = useRef(false);

  const registerSeparator = useCallback((key: string, el: HTMLDivElement | null) => {
    if (el) separatorRefs.current.set(key, el);
    else separatorRefs.current.delete(key);
  }, []);

  const handleMessagesScroll = useCallback(() => {
    if (rafPendingRef.current) return;
    rafPendingRef.current = true;
    requestAnimationFrame(() => {
      rafPendingRef.current = false;
      const container = scrollRef.current;
      if (!container) return;
      const containerTop = container.getBoundingClientRect().top;
      const threshold = containerTop + 16;

      let bestTop = -Infinity;
      let bestLabel: string | null = null;

      separatorRefs.current.forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.top < threshold && rect.top > bestTop) {
          bestTop = rect.top;
          bestLabel = el.dataset.label ?? null;
        }
      });

      if (bestLabel) {
        setStickyLabel(bestLabel);
        setStickyVisible(true);
        if (stickyHideTimerRef.current !== null) {
          window.clearTimeout(stickyHideTimerRef.current);
        }
        stickyHideTimerRef.current = window.setTimeout(() => {
          setStickyVisible(false);
        }, 1500);
      } else {
        setStickyVisible(false);
      }
    });
  }, []);

  // Reset sticky state when active session changes
  useEffect(() => {
    separatorRefs.current.clear();
    setStickyLabel(null);
    setStickyVisible(false);
    if (stickyHideTimerRef.current !== null) {
      window.clearTimeout(stickyHideTimerRef.current);
      stickyHideTimerRef.current = null;
    }
  }, [activeSessionId]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (stickyHideTimerRef.current !== null) {
        window.clearTimeout(stickyHideTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setEditingName(false);
    setMobileDetailsOpen(false);
    setAiAssistMenuOpen(false);
    setDeleteMessagePending(null);
    setManualOrderDraft(null);
    setManualOrderDateDisplay('');
    setManualOrderSaving(false);
    setManualOrderError(null);
  }, [activeSessionId]);

  // Stamp acknowledged_at on the open escalation event the first time the
  // operator opens the escalated chat — used for SLA "time to acknowledge"
  // analytics and to mark the chat as "seen by operator" in the backend.
  useEffect(() => {
    if (activeSession?.status === 'escalated' && !activeSession.acknowledgedAt) {
      void acknowledgeEscalation(activeSession.id);
    }
  }, [activeSession?.id, activeSession?.status, activeSession?.acknowledgedAt, acknowledgeEscalation]);

  const { events: escalationEvents, loading: escalationsLoading } = useEscalationEvents(
    token,
    activeSession?.id ?? null,
    { refetchKey: escalationRefetchKey ?? activeSession?.escalatedAt ?? activeSession?.acknowledgedAt ?? null },
  );

  const [resolvingEscalation, setResolvingEscalation] = useState(false);
  const handleResolveEscalation = async () => {
    if (!activeSession) return;
    setResolvingEscalation(true);
    try {
      await resolveEscalation(activeSession.id);
    } catch (err) {
      setChatActionError(err instanceof Error ? err.message : 'Falha ao marcar como resolvido.');
    } finally {
      setResolvingEscalation(false);
    }
  };

  const handleManualEscalate = async () => {
    if (!activeSession) return;
    try {
      await escalateManually(activeSession.id);
    } catch (err) {
      setChatActionError(err instanceof Error ? err.message : 'Falha ao escalar conversa.');
    }
  };

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [activeSessionId, activeSessionMessages]);

  // Reset textarea height when ownerInput is cleared (e.g. after sending)
  useEffect(() => {
    if (!ownerInput && chatTextareaRef.current) {
      chatTextareaRef.current.style.height = 'auto';
    }
  }, [ownerInput]);

  /* ─── Handlers ──────────────────────────────────────────────── */

  const handleAttachmentSelect = async (
    event: React.ChangeEvent<HTMLInputElement>,
    type: ChatAttachment['type'],
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (type === 'video' && file.size > 50 * 1024 * 1024) {
      setChatActionError('Vídeo muito grande. O limite é 50 MB.');
      return;
    }
    setAttachmentLoading(true);
    setChatActionError(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setPendingAttachment({
        type,
        mimeType: file.type || (type === 'image' ? 'image/jpeg' : 'application/octet-stream'),
        fileName: file.name,
        sizeBytes: file.size,
        dataUrl,
      });
    } catch (error) {
      setChatActionError(error instanceof Error ? error.message : 'Não foi possível carregar o arquivo.');
    } finally {
      setAttachmentLoading(false);
    }
  };

  const handleDroppedFile = async (file: File, type: ChatAttachment['type']) => {
    if (type === 'video' && file.size > 50 * 1024 * 1024) {
      setChatActionError('Vídeo muito grande. O limite é 50 MB.');
      return;
    }
    setAttachmentLoading(true);
    setChatActionError(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setPendingAttachment({
        type,
        mimeType: file.type || (type === 'image' ? 'image/jpeg' : 'application/octet-stream'),
        fileName: file.name,
        sizeBytes: file.size,
        dataUrl,
      });
    } catch (error) {
      setChatActionError(error instanceof Error ? error.message : 'Não foi possível carregar o arquivo.');
    } finally {
      setAttachmentLoading(false);
    }
  };

  const handleSendContact = async () => {
    if (!activeSession || !contactName.trim() || !contactPhone.trim() || !token) return;
    setIsSending(true);
    setChatActionError(null);
    try {
      await sendContact(token, activeSession.id, {
        fullName: contactName.trim(),
        phoneNumber: contactPhone.trim(),
        organization: contactOrg.trim() || undefined,
      });
      setContactModalOpen(false);
      setContactName('');
      setContactPhone('');
      setContactOrg('');
    } catch (err) {
      setChatActionError(err instanceof Error ? err.message : 'Não foi possível enviar o contato.');
    } finally {
      setIsSending(false);
    }
  };

  const handleAutoReplyToggle = async (enabled: boolean) => {
    if (!activeSession) return;
    setChatActionError(null);
    try {
      await toggleAutoReply(activeSession.id, enabled);
    } catch (error) {
      setChatActionError(error instanceof Error ? error.message : 'Não foi possível atualizar o modo de atendimento.');
    }
  };

  const handleSaveCustomerName = async () => {
    if (!activeSession || !editNameValue.trim()) return;
    try {
      await updateSessionName(activeSession.id, editNameValue.trim());
      setEditingName(false);
    } catch (err) {
      setChatActionError(err instanceof Error ? err.message : 'Não foi possível salvar o nome.');
    }
  };

  const handleStartRecording = async () => {
    setChatActionError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        const dataUrl = await readFileAsDataUrl(new File([blob], `audio.${mimeType.split('/')[1].split(';')[0]}`, { type: mimeType }));
        setPendingAttachment({ type: 'audio', mimeType, fileName: `audio.${mimeType.split('/')[1].split(';')[0]}`, sizeBytes: blob.size, dataUrl });
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch {
      setChatActionError('Não foi possível acessar o microfone. Verifique as permissões do navegador.');
    }
  };

  const handleStopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  const handleOwnerSend = async () => {
    const text = ownerInput.trim();
    if (!text && !pendingAttachment) return;
    if (isSending) return;
    setChatActionError(null);

    if (!pendingAttachment && text.startsWith('/')) {
      const cmd = text.slice(1).toUpperCase();
      const qr = quickResponses.find((r) => r.trigger === cmd);
      if (qr) {
        if (!activeSessionId) { setChatActionError('Selecione uma conversa para enviar a resposta rápida.'); return; }
        setIsSending(true);
        try { await send(activeSessionId, { text: qr.response }); setOwnerInput(''); }
        catch (e) { setChatActionError(e instanceof Error ? e.message : 'Não foi possível enviar.'); }
        finally { setIsSending(false); }
        return;
      }
      try {
        const result = await getOwnerResponse(text.slice(1));
        const newCtx = (result as string[]).map((t) => ({ id: crypto.randomUUID(), text: t }));
        onDailyContextUpdate(newCtx);
        setOwnerInput('');
      } catch { setChatActionError('Não foi possível atualizar o contexto da IA agora.'); }
      return;
    }

    if (!activeSessionId) { setChatActionError('Selecione uma conversa para enviar uma mensagem.'); return; }
    setIsSending(true);
    try {
      await send(activeSessionId, { text, attachment: pendingAttachment ?? undefined });
      setOwnerInput('');
      setPendingAttachment(null);
    } catch (e) {
      setChatActionError(e instanceof Error ? e.message : 'Não foi possível enviar.');
    } finally {
      setIsSending(false);
    }
  };

  const handleDeleteMessage = async (message: ChatMessage) => {
    if (!message.waMessageId) {
      setChatActionError('Esta mensagem ainda nao pode ser apagada para todos.');
      return;
    }
    setDeleteMessagePending(message);
  };

  const handleConfirmDeleteMessage = async () => {
    const message = deleteMessagePending;
    if (!activeSession || !message) return;
    setDeletingMessageId(message.id);
    setChatActionError(null);
    try {
      await deleteMessage(activeSession.id, message);
      setDeleteMessagePending(null);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Nao foi possivel apagar a mensagem.';
      setChatActionError(messageText);
      throw new Error(messageText);
    } finally {
      setDeletingMessageId(null);
    }
  };

  const handleAiAssist = async (mode: 'improve' | 'reply') => {
    if (!activeSession) return;
    if (mode === 'improve' && !ownerInput.trim()) {
      setChatActionError('Digite uma mensagem primeiro para a IA melhorar o texto.');
      return;
    }

    setAiAssistMenuOpen(false);
    setAiAssistLoading(mode);
    setChatActionError(null);
    try {
      const suggestion = await getManualChatAssistSuggestion(activeSession.messages, {
        mode,
        draft: ownerInput,
        customerName: activeSession.customerName,
      });
      setOwnerInput(suggestion.trim());
    } catch (error) {
      setChatActionError(getFriendlyErrorMessage(error) || 'Não foi possível gerar a sugestão agora.');
    } finally {
      setAiAssistLoading(null);
    }
  };

  const handleManualOrderFieldChange = useCallback(<K extends keyof ManualOrderFormData>(field: K, value: ManualOrderFormData[K]) => {
    setManualOrderDraft((current) => current ? { ...current, [field]: value } : current);
    setManualOrderError(null);
  }, []);

  const handleManualOrderDateDisplayChange = useCallback((value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 8);
    let display = digits;
    if (digits.length > 4) display = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    else if (digits.length > 2) display = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    setManualOrderDateDisplay(display);
    setManualOrderDraft((current) => {
      if (!current) return current;
      if (digits.length !== 8) return current;
      const [day, month, year] = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)];
      return { ...current, pickupDate: `${year}-${month}-${day}` };
    });
    setManualOrderError(null);
  }, []);

  const handleManualOrderItemChange = useCallback((index: number, field: 'product' | 'quantity', value: string | number) => {
    setManualOrderDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        items: current.items.map((item, itemIndex) => (
          itemIndex === index
            ? {
                ...item,
                [field]: field === 'quantity'
                  ? Math.max(1, Number.isFinite(value) ? Number(value) : 1)
                  : String(value),
              }
            : item
        )),
      };
    });
    setManualOrderError(null);
  }, []);

  const handleAddManualOrderItem = useCallback(() => {
    setManualOrderDraft((current) => current ? { ...current, items: [...current.items, { product: '', quantity: 1 }] } : current);
    setManualOrderError(null);
  }, []);

  const handleRemoveManualOrderItem = useCallback((index: number) => {
    setManualOrderDraft((current) => {
      if (!current) return current;
      const nextItems = current.items.filter((_, itemIndex) => itemIndex !== index);
      return { ...current, items: nextItems.length > 0 ? nextItems : [{ product: '', quantity: 1 }] };
    });
    setManualOrderError(null);
  }, []);

  const handleAiOrderDraft = async () => {
    if (!activeSession) return;
    setAiAssistMenuOpen(false);
    setAiAssistLoading('order');
    setChatActionError(null);
    setManualOrderError(null);
    try {
      const draft = await getManualOrderDraftSuggestion(activeSession.messages, {
        customerName: activeSession.customerName,
        customerPhone: activeSession.customerPhone,
      });
      const nextDraft = buildManualOrderFormDraft(draft, activeSession);
      setManualOrderDraft(nextDraft);
      setManualOrderDateDisplay(formatIsoToBR(nextDraft.pickupDate));
    } catch (error) {
      setChatActionError(getFriendlyErrorMessage(error) || 'Não foi possível montar o pedido agora.');
    } finally {
      setAiAssistLoading(null);
    }
  };

  const handleSaveManualOrder = async () => {
    if (!manualOrderDraft) return;
    const validItems = manualOrderDraft.items.filter((item) => item.product.trim());
    if (!manualOrderDraft.customerName.trim()) {
      setManualOrderError('Nome do cliente obrigatório.');
      return;
    }
    if (!manualOrderDraft.pickupDate || !manualOrderDraft.pickupTime || manualOrderDraft.pickupTime.length < 4) {
      setManualOrderError('Data e hora obrigatórias.');
      return;
    }
    if (validItems.length === 0) {
      setManualOrderError('Adicione ao menos um item.');
      return;
    }

    setManualOrderSaving(true);
    setManualOrderError(null);
    try {
      await onCreateManualOrder({
        customerName: manualOrderDraft.customerName.trim(),
        customerPhone: manualOrderDraft.customerPhone.trim(),
        items: validItems.map((item) => ({ product: item.product.trim(), quantity: item.quantity })),
        pickupDate: manualOrderDraft.pickupDate,
        pickupTime: manualOrderDraft.pickupTime,
        deliveryAddress: manualOrderDraft.deliveryAddress.trim() || undefined,
        paymentMethod: manualOrderDraft.paymentMethod.trim() || undefined,
        observations: manualOrderDraft.observations.trim() || undefined,
        status: 'pending',
        total: Number.parseFloat(manualOrderDraft.total.replace(',', '.')) || 0,
      });
      setManualOrderDraft(null);
      setManualOrderDateDisplay('');
    } catch (error) {
      setManualOrderError(getFriendlyErrorMessage(error) || 'Não foi possível salvar o pedido.');
    } finally {
      setManualOrderSaving(false);
    }
  };

  const handleStartNewConversation = async () => {
    let digits = normalizePhoneNumber(newChatPhone.trim());
    if (!digits) { setNewChatError('Digite um número de telefone válido.'); return; }
    if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
      digits = `55${digits}`;
    }
    if (digits.length < 12 || digits.length > 15) {
      setNewChatError('Número inválido. Use DDD + número (ex: 14998360854) ou com DDI (ex: 5514998360854).');
      return;
    }
    const text = newChatMessage.trim();
    if (!text) { setNewChatError('Digite uma mensagem para iniciar a conversa.'); return; }
    if (!token) { setNewChatError('Faça login para iniciar conversas.'); return; }

    const jid = `${digits}@s.whatsapp.net`;
    setNewChatLoading(true);
    setNewChatError(null);
    try {
      await send(jid, { text });
      await hydrateSession(jid);
      setActiveSessionId(jid);
      setShowNewChatModal(false);
      setNewChatPhone('');
      setNewChatMessage('');
    } catch (err) {
      setNewChatError(err instanceof Error ? err.message : 'Não foi possível iniciar a conversa.');
    } finally {
      setNewChatLoading(false);
    }
  };

  /* ─── Render ────────────────────────────────────────────────── */

  return (
    <>
      <div className="flex flex-1 overflow-hidden">
        {/* Session list */}
        <aside
          style={{ ['--list-width' as string]: `${listWidth}px` }}
          className={`relative flex-shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-surface)] w-full md:w-[var(--list-width)] ${
            activeSessionId ? 'hidden md:flex' : 'flex'
          }`}
        >
          <div className="px-4 py-3.5 border-b border-[var(--color-line)] flex-shrink-0 flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-[var(--color-ink)]">Lista de Conversas</h2>
            <div className="flex items-center gap-1 relative">
              <button
                onClick={() => { setShowNewChatModal(true); setNewChatError(null); }}
                title="Nova conversa"
                className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-brand)] transition-colors"
              >
                <Plus className="w-4 h-4" strokeWidth={2} />
              </button>
              <button
                onClick={() => setListMenuOpen((v) => !v)}
                title="Mais opções"
                className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-brand)] transition-colors"
              >
                <MoreVertical className="w-4 h-4" strokeWidth={2} />
              </button>
              {listMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setListMenuOpen(false)} aria-hidden="true" />
                  <div className="absolute right-0 top-9 z-20 min-w-[220px] rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] shadow-lg overflow-hidden">
                    <button
                      onClick={() => {
                        if (visibleUnreadJids.length === 0) { setListMenuOpen(false); return; }
                        if (visibleUnreadJids.length > 5) {
                          setMarkAllReadConfirm(true);
                          setListMenuOpen(false);
                        } else {
                          void runMarkAllVisibleRead();
                        }
                      }}
                      disabled={visibleUnreadJids.length === 0}
                      className="w-full text-left px-3 py-2 text-[13px] text-[var(--color-ink)] hover:bg-[var(--color-surface-muted)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      <CheckCheck className="w-3.5 h-3.5" strokeWidth={1.8} />
                      <span className="flex-1">Marcar todas como lidas</span>
                      {visibleUnreadJids.length > 0 && (
                        <span className="rounded-full bg-[var(--color-brand)] text-white text-[10px] font-bold px-1.5 py-0.5 min-w-[18px] text-center">
                          {visibleUnreadJids.length}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => enterSelectionMode()}
                      className="w-full text-left px-3 py-2 text-[13px] text-[var(--color-ink)] hover:bg-[var(--color-surface-muted)] flex items-center gap-2 border-t border-[var(--color-line)]"
                    >
                      <CheckSquare className="w-3.5 h-3.5" strokeWidth={1.8} />
                      Selecionar conversas
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="px-3 py-2.5 border-b border-[var(--color-line)] flex-shrink-0">
            <div className="flex items-center gap-2 bg-[var(--color-surface-muted)] rounded-lg px-3 py-2">
              <Search className="w-3.5 h-3.5 text-[var(--color-ink-faint)] flex-shrink-0" strokeWidth={1.8} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Pesquisar..."
                className="flex-1 bg-transparent text-[13px] outline-none text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)]"
              />
            </div>
          </div>

          <div className="px-3 py-2 border-b border-[var(--color-line)] flex-shrink-0 flex items-center gap-1.5 overflow-x-auto custom-scrollbar">
            {([
              { id: 'all', label: 'Todas' },
              { id: 'unread', label: 'Não lidas' },
              { id: 'active', label: 'Ativas' },
              { id: 'escalated', label: 'Escaladas' },
              { id: 'resolved', label: 'Resolvidas' },
              { id: 'archived', label: 'Arquivadas' },
            ] as { id: ChatListFilter; label: string }[]).map((chip) => (
              <button
                key={chip.id}
                onClick={() => setStatusFilter(chip.id)}
                className={`flex-shrink-0 px-2.5 py-1 rounded-full text-[11.5px] font-medium transition-colors ${
                  statusFilter === chip.id
                    ? 'bg-[var(--color-brand)] text-white'
                    : 'bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>

          {selectionMode && (
            <div className="px-3 py-2 border-b border-[var(--color-line)] flex-shrink-0 bg-[var(--color-brand-soft)] flex items-center gap-2 flex-wrap">
              <span className="text-[12px] font-medium text-[var(--color-ink)]">
                {selectedJids.size} selecionada{selectedJids.size === 1 ? '' : 's'}
              </span>
              <div className="flex-1 min-w-0" />
              <button
                onClick={() => void runBulkRead()}
                disabled={selectedJids.size === 0 || bulkActionLoading !== null}
                title="Marcar como lidas"
                className="px-2 py-1 rounded-md text-[11.5px] font-medium bg-[var(--color-surface)] text-[var(--color-ink)] hover:bg-[var(--color-surface-muted)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              >
                {bulkActionLoading === 'read' ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCheck className="w-3 h-3" />}
                Lidas
              </button>
              <button
                onClick={() => void runBulkArchive()}
                disabled={selectedJids.size === 0 || bulkActionLoading !== null}
                title="Arquivar"
                className="px-2 py-1 rounded-md text-[11.5px] font-medium bg-[var(--color-surface)] text-[var(--color-ink)] hover:bg-[var(--color-surface-muted)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              >
                {bulkActionLoading === 'archive' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Archive className="w-3 h-3" />}
                Arquivar
              </button>
              <button
                onClick={() => setBulkDeleteConfirm(true)}
                disabled={selectedJids.size === 0 || bulkActionLoading !== null}
                title="Excluir"
                className="px-2 py-1 rounded-md text-[11.5px] font-medium bg-[var(--color-surface)] text-[var(--color-alert)] hover:bg-[var(--color-alert-soft)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" />
                Excluir
              </button>
              <button
                onClick={exitSelectionMode}
                disabled={bulkActionLoading !== null}
                title="Sair do modo seleção"
                className="px-2 py-1 rounded-md text-[11.5px] font-medium text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)]"
              >
                Cancelar
              </button>
            </div>
          )}

          <div
            ref={chatListRef}
            onScroll={(e) => setChatListScrollTop(e.currentTarget.scrollTop)}
            className="flex-1 overflow-y-auto custom-scrollbar"
          >
            {chatLoading && sessions.length === 0 && (
              <p className="px-4 py-3 text-[12.5px] text-[var(--color-ink-muted)]">Carregando conversas…</p>
            )}

            {!token && !authLoading && (
              <div className="mx-3 my-3 bg-[var(--color-warn-soft)] rounded-lg px-3 py-2.5">
                <p className="text-[12.5px] text-[var(--color-warn)] font-medium">
                  Faça login no Supabase em Perfil para carregar as conversas do WhatsApp.
                </p>
              </div>
            )}

            {(chatError || chatActionError) && (
              <div className="mx-3 my-2 bg-[var(--color-alert-soft)] rounded-lg px-3 py-2">
                <p className="text-[12px] text-[var(--color-alert)]">{chatActionError ?? chatError}</p>
              </div>
            )}

            {!chatLoading && filteredSessions.length === 0 && token && (
              <p className="px-4 py-3 text-[12.5px] text-[var(--color-ink-muted)]">Nenhuma conversa encontrada.</p>
            )}

            {chatListWindow.topPad > 0 && (
              <div aria-hidden="true" style={{ height: chatListWindow.topPad }} />
            )}

            {chatListWindow.sessions.map((s) => {
              const isEscalated = s.status === 'escalated';
              const isSelected = selectedJids.has(s.id);
              const isPinned = !!s.pinned;
              return (
              <div
                key={s.id}
                style={{ height: CHAT_SESSION_ROW_HEIGHT }}
                className={`relative flex items-center gap-3 px-3 py-3 border-b border-[var(--color-line)] transition-colors group ${
                  isEscalated ? 'border-l-4 border-l-[var(--color-alert)] bg-[var(--color-alert-soft)]' : ''
                } ${
                  selectionMode && isSelected ? 'bg-[var(--color-brand-soft)]' : ''
                } ${
                  !selectionMode && activeSessionId === s.id
                    ? isEscalated
                      ? 'bg-[var(--color-alert-soft)]'
                      : 'bg-[var(--color-brand-soft)]'
                    : !isEscalated && !selectionMode && 'hover:bg-[var(--color-surface-muted)]'
                }`}
                onMouseEnter={() => setHoveredSessionId(s.id)}
                onMouseLeave={() => setHoveredSessionId(null)}
              >
                <button
                  onClick={() => {
                    if (selectionMode) toggleSelectJid(s.id);
                    else setActiveSessionId(s.id);
                  }}
                  className="flex items-center gap-3 flex-1 min-w-0 text-left"
                >
                  {selectionMode ? (
                    <div className="w-10 h-10 flex items-center justify-center flex-shrink-0">
                      {isSelected ? (
                        <CheckSquare className="w-5 h-5 text-[var(--color-brand)]" strokeWidth={2} />
                      ) : (
                        <Square className="w-5 h-5 text-[var(--color-ink-faint)]" strokeWidth={1.8} />
                      )}
                    </div>
                  ) : (
                    <ContactAvatar
                      url={profilePics[s.id]}
                      name={s.customerName}
                      size="md"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {isPinned && (
                          <Pin className="w-3 h-3 text-[var(--color-ink-faint)] flex-shrink-0" strokeWidth={2} />
                        )}
                        <h3 className="text-[13.5px] font-semibold text-[var(--color-ink)] truncate">{s.customerName}</h3>
                        {isEscalated && <EscaladoBadge />}
                      </div>
                      {isEscalated ? (
                        <SlaTimer escalatedAt={s.escalatedAt} className="flex-shrink-0 ml-1" />
                      ) : (
                        <span className={`text-[11px] text-[var(--color-ink-faint)] flex-shrink-0 ml-1 transition-opacity ${!selectionMode && hoveredSessionId === s.id ? 'opacity-0' : ''}`}>
                          {formatLastMessageTime(s.lastMessageTime)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[12.5px] text-[var(--color-ink-muted)] truncate flex-1">{s.lastMessage}</p>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {s.alerts && s.alerts.length > 0 && (
                          <span className="rounded-full bg-[var(--color-alert)] px-1.5 py-0.5 text-[10px] font-bold text-white">!</span>
                        )}
                        {s.unreadCount > 0 && (
                          <span className="rounded-full bg-[var(--color-brand)] min-w-[18px] h-[18px] flex items-center justify-center px-1 text-[10px] font-bold text-white">
                            {s.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>

                {!selectionMode && hoveredSessionId === s.id && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleTogglePin(s.id);
                      }}
                      title={isPinned ? 'Desafixar conversa' : 'Fixar conversa'}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-brand)] transition-colors flex-shrink-0"
                    >
                      {isPinned ? <PinOff className="w-3.5 h-3.5" strokeWidth={1.8} /> : <Pin className="w-3.5 h-3.5" strokeWidth={1.8} />}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteSessionPending({ id: s.id, name: s.customerName });
                      }}
                      title="Excluir conversa"
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--color-ink-faint)] hover:bg-[var(--color-alert-soft)] hover:text-[var(--color-alert)] transition-colors flex-shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" strokeWidth={1.8} />
                    </button>
                  </div>
                )}
              </div>
              );
            })}

            {chatListWindow.bottomPad > 0 && (
              <div aria-hidden="true" style={{ height: chatListWindow.bottomPad }} />
            )}
          </div>

          {/* Drag handle to resize the conversation list. The thin visible bar sits on the
              border itself; the wider invisible hit area gives a generous grab target without
              shifting the layout. */}
          <div
            onMouseDown={handleListResizeStart}
            onDoubleClick={() => {
              setListWidth(LIST_WIDTH_DEFAULT);
              try { window.localStorage.setItem(LIST_WIDTH_KEY, String(LIST_WIDTH_DEFAULT)); } catch { /* ignore */ }
            }}
            title="Arraste para redimensionar (duplo clique para padrão)"
            className="absolute top-0 right-[-3px] z-10 h-full w-[6px] cursor-col-resize group hidden md:block"
          >
            <div className="h-full w-px mx-auto bg-transparent group-hover:bg-[var(--color-brand)] transition-colors" />
          </div>
        </aside>

        {/* Chat panel */}
        <main
          className={`relative flex-col overflow-hidden wa-pattern w-full md:flex-1 ${
            activeSessionId ? 'flex' : 'hidden md:flex'
          }`}
          onDragOver={(e) => { e.preventDefault(); if (activeSession) setIsDragging(true); }}
          onDragEnter={(e) => { e.preventDefault(); if (activeSession) setIsDragging(true); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false); }}
          onDrop={async (e) => {
            e.preventDefault();
            setIsDragging(false);
            if (!activeSession) return;
            const file = e.dataTransfer.files[0];
            if (!file) return;
            const type: ChatAttachment['type'] =
              file.type.startsWith('video/') ? 'video' :
              file.type.startsWith('image/') ? 'image' : 'document';
            await handleDroppedFile(file, type);
          }}
        >
          {isDragging && activeSession && (
            <div className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 border-2 border-dashed border-[var(--color-brand)] bg-[var(--color-brand)]/10 backdrop-blur-[2px]">
              <Upload className="h-10 w-10 text-[var(--color-brand)]" strokeWidth={1.5} />
              <p className="text-[15px] font-semibold text-[var(--color-brand)]">Solte o arquivo para enviar</p>
            </div>
          )}
          {activeSession ? (
            <>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => void handleAttachmentSelect(event, 'image')}
              />
              <input
                ref={documentInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/csv"
                className="hidden"
                onChange={(event) => void handleAttachmentSelect(event, 'document')}
              />
              <input
                ref={videoInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(event) => void handleAttachmentSelect(event, 'video')}
              />

              {/* Header */}
              <div className="z-10 flex min-h-14 flex-shrink-0 items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-wa-panel)]/80 px-4 py-2 backdrop-blur-sm">
                <div className="flex min-w-0 items-center gap-1">
                <button
                  onClick={() => setActiveSessionId(null)}
                  aria-label="Voltar"
                  className="md:hidden flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-surface)]/70 transition-colors"
                >
                  <ArrowLeft className="h-5 w-5" strokeWidth={2} />
                </button>
                <button
                  onClick={() => setDetailsOpen((v) => !v)}
                  className="flex min-w-0 items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-surface)]/70"
                >
                  <ContactAvatar
                    url={profilePics[activeSession.id]}
                    name={activeSession.customerName}
                    size="md"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-[13.5px] font-semibold text-[var(--color-ink)]">
                        {activeSession.customerName}
                      </h2>
                      {activeSession.alerts && activeSession.alerts.length > 0 && (
                        <span className="rounded-full bg-[var(--color-alert-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-alert)]">
                          {activeSession.alerts.join(', ')}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-[11.5px] text-[var(--color-ink-muted)]">
                      {activeSession.customerPhone ? formatPhoneDisplay(activeSession.customerPhone) : 'Contato do WhatsApp'}
                    </p>
                  </div>
                </button>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-card)]">
                    <button
                      onClick={() => void handleAutoReplyToggle(false)}
                      className={`rounded-full px-3 py-1 text-[11.5px] font-medium transition-colors ${
                        !activeSession.autoReply
                          ? 'bg-[var(--color-ink)] text-white'
                          : 'text-[var(--color-ink-muted)]'
                      }`}
                    >
                      Manual
                    </button>
                    <button
                      onClick={() => void handleAutoReplyToggle(true)}
                      className={`rounded-full px-3 py-1 text-[11.5px] font-medium transition-colors ${
                        activeSession.autoReply
                          ? 'bg-[var(--color-brand)] text-white'
                          : 'text-[var(--color-ink-muted)]'
                      }`}
                    >
                      IA
                    </button>
                  </div>
                  {/* Desktop toggle */}
                  <button
                    onClick={() => setDetailsOpen((v) => !v)}
                    className="hidden md:inline-flex rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)]"
                  >
                    {detailsOpen ? 'Fechar perfil' : 'Abrir perfil'}
                  </button>
                  {/* Mobile: open details overlay */}
                  <button
                    onClick={() => setMobileDetailsOpen(true)}
                    aria-label="Detalhes"
                    className="md:hidden flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-surface)]/70 transition-colors"
                  >
                    <Info className="h-5 w-5" strokeWidth={1.8} />
                  </button>
                  <div className="relative">
                    <button
                      onClick={() => setChatMenuOpen((v) => !v)}
                      className="rounded-lg p-1.5 text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)]"
                    >
                      <MoreVertical className="h-4 w-4" strokeWidth={1.8} />
                    </button>
                    {chatMenuOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setChatMenuOpen(false)} />
                        <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] overflow-hidden">
                          <button
                            onClick={() => {
                              setChatMenuOpen(false);
                              if (activeSession) {
                                setDeleteSessionPending({ id: activeSession.id, name: activeSession.customerName });
                              }
                            }}
                            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-[13px] text-[var(--color-alert)] hover:bg-[var(--color-alert-soft)] transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.8} />
                            Excluir conversa
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Messages */}
              <div className="relative flex-1 min-h-0">
                <div
                  ref={scrollRef}
                  onScroll={handleMessagesScroll}
                  className="absolute inset-0 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-1"
                >
                  <div className="self-center mb-2">
                    <span className="text-[11px] font-medium text-[var(--color-ink-faint)] bg-[var(--color-wa-panel)]/60 px-3 py-1 rounded-full">
                      Criptografia de ponta a ponta
                    </span>
                  </div>

                  <AnimatePresence initial={false}>
                    {chatRenderItems.map((item, i) => {
                      if (item.kind === 'separator') {
                        return (
                          <MessageDateSeparator
                            key={item.key}
                            ref={(el) => registerSeparator(item.key, el)}
                            label={item.label}
                          />
                        );
                      }

                      const { message } = item;
                      const isSystem = message.kind === 'text' && (message.content ?? '').includes('[SISTEMA]');
                      const systemText = (message.content ?? '').replace('[SISTEMA]', '').trim();

                      if (isSystem) {
                        return (
                          <motion.div
                            key={item.key}
                            initial={{ opacity: 0, scale: 0.96 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="self-center my-1"
                          >
                            <span className="inline-block text-[11.5px] font-medium bg-[var(--color-warn-soft)] text-[var(--color-warn)] px-3 py-1 rounded-full">
                              {systemText}
                            </span>
                          </motion.div>
                        );
                      }

                      // isLastInGroup: look ahead in chatRenderItems, skipping separators.
                      // A separator between two same-role messages counts as a group break.
                      const isLastInGroup = (() => {
                        for (let j = i + 1; j < chatRenderItems.length; j++) {
                          const next = chatRenderItems[j];
                          if (next.kind === 'separator') return true;
                          return next.message.role !== message.role;
                        }
                        return true;
                      })();

                      return (
                        <motion.div
                          key={item.key}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.15 }}
                        >
                          <MessageBubble
                            message={message}
                            isLastInGroup={isLastInGroup}
                            profilePicUrl={profilePics[activeSession.id]}
                            customerName={activeSession.customerName}
                            onDelete={handleDeleteMessage}
                            isDeleting={deletingMessageId === message.id}
                          />
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>

                {/* Sticky date pill — floats above the scroll area */}
                <AnimatePresence>
                  {stickyVisible && stickyLabel && (
                    <motion.div
                      key={stickyLabel}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.18 }}
                      className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 z-10"
                    >
                      <span className="inline-block rounded-full bg-[var(--color-wa-panel)]/95 backdrop-blur-sm border border-[var(--color-line)] px-3 py-1 text-[11.5px] font-medium text-[var(--color-ink-muted)] shadow-[var(--shadow-card)]">
                        {stickyLabel}
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Input bar */}
              <div className="relative flex-shrink-0 bg-[var(--color-wa-panel)]/80 backdrop-blur-sm border-t border-[var(--color-line)] p-3">
                <AnimatePresence>
                  {!pendingAttachment && ownerInput.startsWith('/') && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                      className="absolute bottom-full left-4 right-4 z-50 mb-2 max-h-52 overflow-y-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-pop)] custom-scrollbar"
                    >
                      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-line)]">
                        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
                          Respostas rápidas
                        </span>
                      </div>
                      {quickResponses
                        .filter((r) => r.trigger.includes(ownerInput.slice(1).toUpperCase()))
                        .map((r) => (
                          <button
                            key={r.id}
                            onClick={() => setOwnerInput(r.response)}
                            className="w-full border-b border-[var(--color-line)] px-3 py-2.5 text-left last:border-0 hover:bg-[var(--color-surface-muted)] transition-colors"
                          >
                            <span className="text-[13px] font-semibold text-[var(--color-ink)]">/{r.trigger}</span>
                            <span className="block truncate text-[12px] text-[var(--color-ink-muted)] mt-0.5">{r.response}</span>
                          </button>
                        ))}
                      {quickResponses.filter((r) => r.trigger.includes(ownerInput.slice(1).toUpperCase())).length === 0 && (
                        <p className="px-3 py-3 text-center text-[12.5px] italic text-[var(--color-ink-faint)]">
                          Comando não encontrado
                        </p>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                {pendingAttachment && (
                  <div className="mb-3 flex items-start gap-3 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)]/92 p-3 shadow-[var(--shadow-card)]">
                    {pendingAttachment.type === 'image' ? (
                      <img
                        src={pendingAttachment.dataUrl}
                        alt={pendingAttachment.fileName}
                        className="h-16 w-16 rounded-xl object-cover"
                      />
                    ) : pendingAttachment.type === 'video' ? (
                      <video
                        src={pendingAttachment.dataUrl}
                        className="h-16 w-16 rounded-xl object-cover"
                        muted
                      />
                    ) : pendingAttachment.type === 'audio' ? (
                      <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]">
                        <Mic className="h-6 w-6" strokeWidth={1.8} />
                      </div>
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]">
                        <FileText className="h-6 w-6" strokeWidth={1.8} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-[var(--color-ink)]">{pendingAttachment.fileName}</p>
                      <p className="text-[12px] text-[var(--color-ink-muted)]">
                        {pendingAttachment.type === 'image' ? 'Imagem pronta para envio' : pendingAttachment.type === 'video' ? 'Vídeo pronto para envio' : pendingAttachment.type === 'audio' ? 'Áudio pronto para envio' : 'Documento pronto para envio'} • {formatAttachmentSize(pendingAttachment.sizeBytes)}
                      </p>
                    </div>
                    <button
                      onClick={() => setPendingAttachment(null)}
                      className="rounded-lg p-1.5 text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)]"
                    >
                      <X className="h-4 w-4" strokeWidth={1.8} />
                    </button>
                  </div>
                )}

                <AnimatePresence>
                  {manualOrderDraft && (
                    <ManualOrderDraftCard
                      draft={manualOrderDraft}
                      dateDisplay={manualOrderDateDisplay}
                      saving={manualOrderSaving}
                      error={manualOrderError}
                      onClose={() => {
                        if (manualOrderSaving) return;
                        setManualOrderDraft(null);
                        setManualOrderDateDisplay('');
                        setManualOrderError(null);
                      }}
                      onSave={() => void handleSaveManualOrder()}
                      onFieldChange={handleManualOrderFieldChange}
                      onDateDisplayChange={handleManualOrderDateDisplayChange}
                      onItemChange={handleManualOrderItemChange}
                      onAddItem={handleAddManualOrderItem}
                      onRemoveItem={handleRemoveManualOrderItem}
                    />
                  )}
                </AnimatePresence>

                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => imageInputRef.current?.click()}
                      disabled={attachmentLoading || isSending}
                      className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-surface)] text-[var(--color-ink-muted)] shadow-[var(--shadow-card)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-50"
                      title="Enviar imagem"
                    >
                      <ImagePlus className="h-4.5 w-4.5" strokeWidth={1.8} />
                    </button>
                    <button
                      onClick={() => documentInputRef.current?.click()}
                      disabled={attachmentLoading || isRecording || isSending}
                      className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-surface)] text-[var(--color-ink-muted)] shadow-[var(--shadow-card)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-50"
                      title="Enviar documento"
                    >
                      <Paperclip className="h-4.5 w-4.5" strokeWidth={1.8} />
                    </button>
                    <button
                      onClick={() => videoInputRef.current?.click()}
                      disabled={attachmentLoading || isSending}
                      className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-surface)] text-[var(--color-ink-muted)] shadow-[var(--shadow-card)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-50"
                      title="Enviar vídeo"
                    >
                      <Video className="h-4.5 w-4.5" strokeWidth={1.8} />
                    </button>
                    <button
                      onClick={() => { setContactModalOpen(true); setChatActionError(null); }}
                      disabled={isSending}
                      className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-surface)] text-[var(--color-ink-muted)] shadow-[var(--shadow-card)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-50"
                      title="Enviar contato"
                    >
                      <UserPlus className="h-4.5 w-4.5" strokeWidth={1.8} />
                    </button>
                    <button
                      onClick={isRecording ? handleStopRecording : handleStartRecording}
                      disabled={attachmentLoading || !!pendingAttachment || isSending}
                      className={`flex h-10 w-10 items-center justify-center rounded-xl shadow-[var(--shadow-card)] transition-colors disabled:opacity-50 ${
                        isRecording
                          ? 'animate-pulse bg-red-500 text-white hover:bg-red-600'
                          : 'bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
                      }`}
                      title={isRecording ? 'Parar gravação' : 'Gravar áudio'}
                    >
                      {isRecording ? <MicOff className="h-4.5 w-4.5" strokeWidth={1.8} /> : <Mic className="h-4.5 w-4.5" strokeWidth={1.8} />}
                    </button>
                  </div>
                  <div className="relative flex-1">
                    <textarea
                      ref={chatTextareaRef}
                      rows={1}
                      value={ownerInput}
                      onChange={(e) => {
                        setOwnerInput(e.target.value);
                        e.target.style.height = 'auto';
                        e.target.style.height = `${e.target.scrollHeight}px`;
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          if (e.shiftKey || e.ctrlKey) {
                            e.preventDefault();
                            const el = e.currentTarget;
                            const start = el.selectionStart ?? ownerInput.length;
                            const end = el.selectionEnd ?? ownerInput.length;
                            const next = ownerInput.slice(0, start) + '\n' + ownerInput.slice(end);
                            setOwnerInput(next);
                            requestAnimationFrame(() => {
                              el.selectionStart = start + 1;
                              el.selectionEnd = start + 1;
                              el.style.height = 'auto';
                              el.style.height = `${el.scrollHeight}px`;
                            });
                          } else {
                            e.preventDefault();
                            if (!isSending) void handleOwnerSend();
                          }
                        }
                      }}
                      disabled={isSending || aiAssistLoading !== null}
                      placeholder={pendingAttachment ? 'Adicione uma legenda (opcional)' : 'Digite uma mensagem ou /atalho'}
                      className="w-full resize-none overflow-y-auto max-h-[160px] bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl px-4 py-2.5 text-[13.5px] outline-none shadow-[var(--shadow-card)] focus:ring-2 focus:ring-[var(--color-brand)]/20 focus:border-[var(--color-brand)] transition-all pr-12 disabled:opacity-60 disabled:cursor-not-allowed leading-[1.5]"
                    />
                    <div className="absolute right-3 bottom-2.5">
                      {pendingAttachment ? (
                        <Paperclip className="h-4 w-4 text-[var(--color-brand)]" strokeWidth={1.8} />
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              if (aiAssistLoading) return;
                              setAiAssistMenuOpen((open) => !open);
                            }}
                            disabled={aiAssistLoading !== null || isSending}
                            title="Sugestões de IA"
                            className="flex h-7 w-7 items-center justify-center rounded-full transition-colors text-[var(--color-brand)] hover:bg-[var(--color-brand-soft)]"
                          >
                            {aiAssistLoading ? (
                              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
                            ) : (
                              <Bot className="h-4 w-4" strokeWidth={1.8} />
                            )}
                          </button>

                          <AnimatePresence>
                            {aiAssistMenuOpen && (
                              <>
                                <motion.button
                                  type="button"
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  exit={{ opacity: 0 }}
                                  className="fixed inset-0 z-40 cursor-default"
                                  onClick={() => setAiAssistMenuOpen(false)}
                                />
                                <motion.div
                                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                                  animate={{ opacity: 1, y: 0, scale: 1 }}
                                  exit={{ opacity: 0, y: 8, scale: 0.98 }}
                                  className="absolute bottom-full right-0 z-50 mb-3 w-56 overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-pop)]"
                                >
                                  <button
                                    type="button"
                                    onClick={() => void handleAiAssist('improve')}
                                    disabled={!ownerInput.trim()}
                                    className="flex w-full items-start gap-3 border-b border-[var(--color-line)] px-3 py-3 text-left transition-colors hover:bg-[var(--color-surface-muted)] disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    <Pencil className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-brand)]" strokeWidth={1.8} />
                                    <span className="block min-w-0">
                                      <span className="block text-[12.5px] font-semibold text-[var(--color-ink)]">Melhorar mensagem</span>
                                      <span className="block text-[11.5px] leading-relaxed text-[var(--color-ink-muted)]">Corrige e deixa mais amigável sem perder o tom humano.</span>
                                    </span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleAiAssist('reply')}
                                    className="flex w-full items-start gap-3 border-b border-[var(--color-line)] px-3 py-3 text-left transition-colors hover:bg-[var(--color-surface-muted)]"
                                  >
                                    <MessageCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-brand)]" strokeWidth={1.8} />
                                    <span className="block min-w-0">
                                      <span className="block text-[12.5px] font-semibold text-[var(--color-ink)]">Gerar resposta</span>
                                      <span className="block text-[11.5px] leading-relaxed text-[var(--color-ink-muted)]">Lê o contexto do chat e sugere a próxima resposta.</span>
                                    </span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleAiOrderDraft()}
                                    className="flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-[var(--color-surface-muted)]"
                                  >
                                    <ShoppingBag className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-brand)]" strokeWidth={1.8} />
                                    <span className="block min-w-0">
                                      <span className="block text-[12.5px] font-semibold text-[var(--color-ink)]">Criar pedido</span>
                                      <span className="block text-[11.5px] leading-relaxed text-[var(--color-ink-muted)]">Monta um pedido manual com base na conversa para você revisar.</span>
                                    </span>
                                  </button>
                                </motion.div>
                              </>
                            )}
                          </AnimatePresence>
                        </>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => void handleOwnerSend()}
                    disabled={isSending || (!ownerInput.trim() && !pendingAttachment)}
                    className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all flex-shrink-0 ${
                      isSending
                        ? 'bg-[var(--color-brand)] text-white shadow-[var(--shadow-card)] cursor-not-allowed'
                        : ownerInput || pendingAttachment
                          ? 'bg-[var(--color-brand)] text-white shadow-[var(--shadow-card)] hover:bg-[var(--color-brand-deep)]'
                          : 'bg-[var(--color-surface-muted)] text-[var(--color-ink-faint)]'
                    }`}
                  >
                    {isSending
                      ? <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} />
                      : <Send className="w-4 h-4" strokeWidth={2} />
                    }
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8">
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-[var(--color-surface)] flex items-center justify-center mx-auto mb-4 shadow-[var(--shadow-card)]">
                  <MessageCircle className="w-7 h-7 text-[var(--color-ink-faint)]" strokeWidth={1.5} />
                </div>
                <p className="text-[15px] font-semibold text-[var(--color-ink)]">
                  {token ? 'Nenhuma conversa ativa' : 'Faça login para abrir as conversas da empresa'}
                </p>
                <p className="mt-1.5 text-[13px] text-[var(--color-ink-muted)] max-w-xs mx-auto leading-relaxed">
                  Assim que o WhatsApp receber mensagens, elas aparecem aqui em tempo real.
                </p>
              </div>
            </div>
          )}
        </main>

        {/* Customer details panel — desktop inline + mobile overlay */}
        {activeSession && (
          <>
            {/* Mobile backdrop */}
            <AnimatePresence>
              {mobileDetailsOpen && (
                <motion.div
                  key="mobile-details-backdrop"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="fixed inset-0 z-40 bg-black/40 md:hidden"
                  onClick={() => setMobileDetailsOpen(false)}
                />
              )}
            </AnimatePresence>

          <aside className={`flex-col border-l border-[var(--color-line)] bg-[var(--color-surface)] overflow-y-auto custom-scrollbar
            ${mobileDetailsOpen
              ? 'flex fixed inset-y-0 right-0 z-50 w-[85vw] max-w-[320px] shadow-2xl'
              : detailsOpen
                ? 'hidden md:flex w-[260px] flex-shrink-0'
                : 'hidden'
            }
          `}>
            <div className="px-4 py-3.5 border-b border-[var(--color-line)] flex-shrink-0 flex items-center justify-between">
              <h3 className="text-[13.5px] font-semibold text-[var(--color-ink)]">Perfil do cliente</h3>
              <button
                onClick={() => { setDetailsOpen(false); setMobileDetailsOpen(false); }}
                className="rounded-md p-1 text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)] transition-colors"
              >
                <X className="h-4 w-4" strokeWidth={1.8} />
              </button>
            </div>

            {activeSession.status === 'escalated' && (
              <div className="border-b border-[var(--color-alert)] bg-[var(--color-alert-soft)] px-4 py-3 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <EscaladoBadge />
                  <SlaTimer escalatedAt={activeSession.escalatedAt} />
                </div>
                <p className="text-[12px] text-[var(--color-ink)]">
                  Esta conversa precisa de atendimento humano. A IA está pausada até você marcar como resolvido.
                </p>
                <button
                  type="button"
                  onClick={handleResolveEscalation}
                  disabled={resolvingEscalation}
                  className="rounded-md bg-[var(--color-brand)] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[var(--color-brand-deep)] disabled:opacity-50"
                >
                  {resolvingEscalation ? 'Marcando…' : 'Marcar como resolvido'}
                </button>
              </div>
            )}

            <div className="flex flex-col items-center gap-2 px-4 py-5 border-b border-[var(--color-line)]">
              <ContactAvatar
                url={profilePics[activeSession.id]}
                name={activeSession.customerName}
                size="lg"
              />
              <div className="text-center w-full px-2">
                {editingName ? (
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus
                      type="text"
                      value={editNameValue}
                      onChange={(e) => setEditNameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleSaveCustomerName();
                        if (e.key === 'Escape') setEditingName(false);
                      }}
                      className="flex-1 text-[13px] font-medium text-center bg-[var(--color-surface-muted)] border border-[var(--color-brand)] rounded-lg px-2 py-1 outline-none"
                    />
                    <button
                      onClick={() => void handleSaveCustomerName()}
                      className="w-6 h-6 flex items-center justify-center rounded-md bg-[var(--color-brand)] text-white"
                    >
                      <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
                    </button>
                    <button
                      onClick={() => setEditingName(false)}
                      className="w-6 h-6 flex items-center justify-center rounded-md text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-muted)]"
                    >
                      <X className="w-3.5 h-3.5" strokeWidth={2} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-1">
                    <p className="text-[14px] font-semibold text-[var(--color-ink)]">{activeSession.customerName}</p>
                    <button
                      onClick={() => { setEditNameValue(activeSession.customerName); setEditingName(true); }}
                      className="w-5 h-5 flex items-center justify-center rounded text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] hover:bg-[var(--color-surface-muted)] transition-colors"
                    >
                      <Pencil className="w-3 h-3" strokeWidth={2} />
                    </button>
                  </div>
                )}
                <p className="text-[12px] text-[var(--color-ink-muted)] mt-0.5">
                  {activeSession.customerPhone ? formatPhoneDisplay(activeSession.customerPhone) : '—'}
                </p>
              </div>
              {activeSession.alerts && activeSession.alerts.length > 0 && (
                <div className="flex flex-wrap gap-1 justify-center">
                  {activeSession.alerts.map((alert) => (
                    <span key={alert} className="rounded-full bg-[var(--color-alert-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-alert)]">
                      {alert}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="px-4 py-4 flex flex-col gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)] mb-1.5">Informações</p>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[12.5px] text-[var(--color-ink-muted)]">Telefone</span>
                    <span className="text-[12.5px] font-medium text-[var(--color-ink)]">
                      {activeSession.customerPhone ? formatPhoneDisplay(activeSession.customerPhone) : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[12.5px] text-[var(--color-ink-muted)]">Modo IA</span>
                    <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full ${activeSession.autoReply ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]' : 'bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)]'}`}>
                      {activeSession.autoReply ? 'Ativo' : 'Manual'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[12.5px] text-[var(--color-ink-muted)]">Última mensagem</span>
                    <span className="text-[12px] text-[var(--color-ink-faint)]">{formatLastMessageTime(activeSession.lastMessageTime)}</span>
                  </div>
                </div>
              </div>

              {activeSession.status !== 'escalated' && (
                <button
                  type="button"
                  onClick={handleManualEscalate}
                  className="self-start rounded-md border border-[var(--color-alert)] px-2 py-1 text-[11px] font-semibold text-[var(--color-alert)] hover:bg-[var(--color-alert-soft)]"
                  title="Marcar esta conversa como urgente e desativar a IA"
                >
                  Escalar para humano
                </button>
              )}

              <EscalationLogCard events={escalationEvents} loading={escalationsLoading} />
            </div>
          </aside>
          </>
        )}
      </div>

      {/* ── Nova conversa modal ──────────────────────────────────── */}
      {showNewChatModal && (
        <Modal
          open
          onClose={() => {
            if (!newChatLoading) setShowNewChatModal(false);
          }}
          titleId={newChatTitleId}
          disableEscape={newChatLoading}
          panelClassName="w-[400px] max-w-[calc(100vw-2rem)] bg-[var(--color-surface)] rounded-2xl shadow-[var(--shadow-pop)] border border-[var(--color-line)] overflow-hidden"
        >
              <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-line)]">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-[var(--color-brand-soft)] flex items-center justify-center">
                    <Phone className="w-4 h-4 text-[var(--color-brand-deep)]" strokeWidth={1.8} />
                  </div>
                  <h3 id={newChatTitleId} className="text-[14px] font-semibold text-[var(--color-ink)]">Nova conversa</h3>
                </div>
                <button
                  onClick={() => {
                    if (!newChatLoading) setShowNewChatModal(false);
                  }}
                  disabled={newChatLoading}
                  aria-label="Fechar"
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <X className="w-4 h-4" strokeWidth={1.8} />
                </button>
              </div>

              <div className="px-5 py-4 flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[12px] font-semibold text-[var(--color-ink-muted)] uppercase tracking-wide">
                    Número do WhatsApp
                  </label>
                  <input
                    autoFocus
                    type="tel"
                    value={newChatPhone}
                    onChange={(e) => setNewChatPhone(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void handleStartNewConversation()}
                    placeholder="DDD + número ou DDI + DDD + número"
                    className="w-full bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-xl px-4 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-[var(--color-brand)]/20 focus:border-[var(--color-brand)] transition-all"
                  />
                  <p className="text-[11.5px] text-[var(--color-ink-faint)]">
                    Só o DDD + número (o +55 é adicionado automaticamente).
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[12px] font-semibold text-[var(--color-ink-muted)] uppercase tracking-wide">
                    Primeira mensagem
                  </label>
                  <textarea
                    value={newChatMessage}
                    onChange={(e) => setNewChatMessage(e.target.value)}
                    placeholder="Olá! Como posso ajudar?"
                    rows={3}
                    className="w-full bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-xl px-4 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-[var(--color-brand)]/20 focus:border-[var(--color-brand)] transition-all resize-none"
                  />
                </div>

                {newChatError && (
                  <div className="bg-[var(--color-alert-soft)] rounded-xl px-3.5 py-2.5">
                    <p className="text-[12.5px] text-[var(--color-alert)]">{newChatError}</p>
                  </div>
                )}
              </div>

              <div className="px-5 pb-5 flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    if (!newChatLoading) setShowNewChatModal(false);
                  }}
                  disabled={newChatLoading}
                  className="px-4 py-2 rounded-xl text-[13px] font-medium text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => void handleStartNewConversation()}
                  disabled={newChatLoading}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand-deep)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed shadow-[var(--shadow-card)]"
                >
                  {newChatLoading ? (
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" strokeWidth={2} />
                  )}
                  {newChatLoading ? 'Enviando…' : 'Iniciar conversa'}
                </button>
              </div>
        </Modal>
      )}

      <ConfirmModal
        open={deleteMessagePending !== null}
        title="Apagar mensagem?"
        message="Essa acao tenta apagar a mensagem para todos no WhatsApp e nao pode ser desfeita."
        onClose={() => setDeleteMessagePending(null)}
        onConfirm={handleConfirmDeleteMessage}
        confirmLabel="Apagar"
        confirmLoadingLabel="Apagando..."
      />

      <ConfirmModal
        open={deleteSessionPending !== null}
        title="Excluir conversa?"
        message={`Excluir a conversa com ${deleteSessionPending?.name}? Esta ação não pode ser desfeita.`}
        onClose={() => setDeleteSessionPending(null)}
        onConfirm={async () => { await onDeleteSession(deleteSessionPending!.id); }}
        confirmLabel="Excluir"
        confirmLoadingLabel="Excluindo..."
      />

      <ConfirmModal
        open={bulkDeleteConfirm}
        title="Excluir conversas?"
        message={`Excluir ${selectedJids.size} conversa${selectedJids.size === 1 ? '' : 's'}? Esta ação não pode ser desfeita.`}
        onClose={() => setBulkDeleteConfirm(false)}
        onConfirm={runBulkDelete}
        confirmLabel="Excluir"
        confirmLoadingLabel="Excluindo..."
      />

      <ConfirmModal
        open={markAllReadConfirm}
        title="Marcar todas como lidas?"
        message={`Zerar o contador de não lidas em ${visibleUnreadJids.length} conversa${visibleUnreadJids.length === 1 ? '' : 's'}.`}
        onClose={() => setMarkAllReadConfirm(false)}
        onConfirm={runMarkAllVisibleRead}
        confirmLabel="Marcar"
        confirmLoadingLabel="Marcando..."
      />

      {/* ── Enviar contato modal ─────────────────────────────────── */}
      {contactModalOpen && (
        <Modal
          open
          onClose={() => { if (!isSending) { setContactModalOpen(false); setContactName(''); setContactPhone(''); setContactOrg(''); } }}
          titleId={contactModalTitleId}
          disableEscape={isSending}
          panelClassName="w-[400px] max-w-[calc(100vw-2rem)] bg-[var(--color-surface)] rounded-2xl shadow-[var(--shadow-pop)] border border-[var(--color-line)] overflow-hidden"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-line)]">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-[var(--color-brand-soft)] flex items-center justify-center">
                <UserPlus className="w-4 h-4 text-[var(--color-brand-deep)]" strokeWidth={1.8} />
              </div>
              <h3 id={contactModalTitleId} className="text-[14px] font-semibold text-[var(--color-ink)]">Enviar contato</h3>
            </div>
            <button
              onClick={() => { setContactModalOpen(false); setContactName(''); setContactPhone(''); setContactOrg(''); }}
              disabled={isSending}
              aria-label="Fechar"
              className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            >
              <X className="w-4 h-4" strokeWidth={2} />
            </button>
          </div>
          <div className="px-5 py-4 space-y-3">
            <div>
              <label className="block text-[12px] font-medium text-[var(--color-ink-muted)] mb-1">Nome *</label>
              <input
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Ex: João Silva"
                disabled={isSending}
                className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-muted)] px-3 py-2 text-[13px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-brand)] focus:outline-none disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[var(--color-ink-muted)] mb-1">Telefone *</label>
              <input
                type="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="Ex: 5514998360854"
                disabled={isSending}
                className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-muted)] px-3 py-2 text-[13px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-brand)] focus:outline-none disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[var(--color-ink-muted)] mb-1">Empresa <span className="text-[var(--color-ink-faint)]">(opcional)</span></label>
              <input
                type="text"
                value={contactOrg}
                onChange={(e) => setContactOrg(e.target.value)}
                placeholder="Ex: Donutopia"
                disabled={isSending}
                className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-muted)] px-3 py-2 text-[13px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-brand)] focus:outline-none disabled:opacity-50"
              />
            </div>
            <button
              onClick={() => void handleSendContact()}
              disabled={isSending || !contactName.trim() || !contactPhone.trim()}
              className="w-full rounded-xl bg-[var(--color-brand)] py-2.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {isSending ? 'Enviando...' : 'Enviar contato'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
