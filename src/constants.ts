import type { Order, ZeloState } from "./types";
import { DEFAULT_PIX_RECEIPT_CONFIG } from "./domain/pixReceipt";

export const INITIAL_STATE: ZeloState = {
  products: [],
  blockedDates: [],
  orders: [],
  sessions: [],
  aiInstructions: "",
  deliveryConfig: null,
  pixReceiptConfig: DEFAULT_PIX_RECEIPT_CONFIG,
  quickResponses: [],
  triggers: [],
  managerHistory: [],
  drivers: [],
  businessInfo: {
    name: "",
    openTime: "",
    closeTime: "",
    closedDays: [],
    timezone: "America/Sao_Paulo",
    specialty: "",
    address: "",
    phone: "",
    pixKey: "",
    managerPhone: "",
  },
  profile: {
    name: "",
    email: "",
    role: "",
    avatar: "",
    notifications: true,
    darkMode: false,
  },
};

export const STATUS_LABELS: Record<Order['status'], string> = {
  pending: 'Pendente',
  preparing: 'Preparando',
  ready: 'Pronto',
  out_for_delivery: 'Saiu pra entrega',
  delivered: 'Entregue'
};

export const STATUS_COLORS: Record<Order['status'], string> = {
  pending: 'bg-orange-100 text-orange-600',
  preparing: 'bg-blue-100 text-blue-600',
  ready: 'bg-green-100 text-green-600',
  out_for_delivery: 'bg-purple-100 text-purple-600',
  delivered: 'bg-gray-100 text-gray-600'
};
