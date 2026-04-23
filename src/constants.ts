import type { Order, ZeloState } from "./types";

export const INITIAL_STATE: ZeloState = {
  products: [],
  blockedDates: [],
  orders: [],
  sessions: [],
  aiInstructions: "",
  quickResponses: [],
  dailyContext: [],
  triggers: [],
  managerHistory: [],
  drivers: [],
  businessInfo: {
    name: "",
    hours: "",
    closedDays: [],
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
  delivered: 'Entregue'
};

export const STATUS_COLORS: Record<Order['status'], string> = {
  pending: 'bg-orange-100 text-orange-600',
  preparing: 'bg-blue-100 text-blue-600',
  ready: 'bg-green-100 text-green-600',
  delivered: 'bg-gray-100 text-gray-600'
};
