import { apiFetch, apiUrl } from '../config';

import type {
  ZeloMenuModifierGroup,
  ZeloMenuModifierSelectionInput,
  ZeloMenuSelectedModifierGroup,
} from '../domain/zelomenuModifiers';

export type ZeloMenuCatalogProduct = {
  id: number;
  name: string;
  price: number;
  basePrice: number;
  available: boolean;
  description?: string | null;
  photoUrl?: string | null;
  sortOrder?: number;
  unitBased?: boolean;
  stockControlled?: boolean;
  stockQuantity?: number;
  modifierGroups: ZeloMenuModifierGroup[];
};

export type ZeloMenuCatalogGroup = {
  nome: string;
  subcategorias: Array<{ nome: string; produtos: ZeloMenuCatalogProduct[] }>;
  produtosDireto: ZeloMenuCatalogProduct[];
};

export type ZeloMenuCartItem = {
  productId: number | null;
  productName: string;
  baseUnitPrice: number;
  selectedModifiers: ZeloMenuSelectedModifierGroup[];
  modifierDeltaTotal: number;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  notes?: string | null;
};

export type ZeloMenuCartSessionPayload = {
  id: string;
  orderingId: string;
  context: 'whatsapp_order' | 'public_order' | 'table_order';
  state: string;
  revision: number;
  customer: {
    name: string | null;
    phone: string | null;
  };
  cart: {
    items: ZeloMenuCartItem[];
    observations: string | null;
  };
  fulfillment: {
    type: 'pickup' | 'delivery';
    pickupDate: string | null;
    pickupTime: string | null;
    deliveryAddress: string | null;
    deliveryNeighborhood: string | null;
    deliveryFee: number;
    deliveryFeeToConfirm: boolean;
  };
  pricing: {
    subtotal: number;
    deliveryFee: number;
    total: number;
  };
  payment: {
    declaredMethod: string | null;
    pixReceiptRequired: boolean;
    pixReceiptApproved: boolean;
  };
  metadata: Record<string, unknown>;
  lastRevalidatedAt: string | null;
  lastRevalidation: ZeloMenuCartRevalidation | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  archivedAt: string | null;
};

export type ZeloMenuCartRevalidationIssue = {
  code:
    | 'product_missing'
    | 'product_unavailable'
    | 'stock_insufficient'
    | 'price_changed'
    | 'schedule_unavailable'
    | 'modifier_invalid';
  message: string;
  productName?: string;
  requestedQuantity?: number;
  availableQuantity?: number | null;
  previousUnitPrice?: number;
  currentUnitPrice?: number;
};

export type ZeloMenuCartRevalidation = {
  checkedAt: string;
  ok: boolean;
  issues: ZeloMenuCartRevalidationIssue[];
  previewCart: {
    items: ZeloMenuCartItem[];
    observations: string | null;
  } | null;
  previewPricing: {
    subtotal: number;
    deliveryFee: number;
    total: number;
  } | null;
  previewPayment: {
    declaredMethod: string | null;
    pixReceiptRequired: boolean;
    pixReceiptApproved: boolean;
  } | null;
};

export type ZeloMenuPublicCartResponse = {
  session: ZeloMenuCartSessionPayload;
  business: {
    name: string;
    address: string;
    pixEnabled: boolean;
    deliveryEnabled: boolean;
    deliveryNeighborhoods: Array<{ name: string; fee: number }>;
  };
  catalog: ZeloMenuCatalogGroup[];
  link: {
    path: string;
    tokenStatus: 'current' | 'stale';
  };
  revalidation: ZeloMenuCartRevalidation;
};

export type ZeloMenuConfirmCartResponse = ZeloMenuPublicCartResponse & {
  confirmation: {
    confirmed: boolean;
    alreadyConfirmed: boolean;
    state: string;
    customerMessage: string | null;
  };
};

export type ZeloMenuUpdateCartPayload = {
  customerName?: string | null;
  customerPhone?: string | null;
  items?: Array<{
    productId?: number | null;
    productName: string;
    quantity: number;
    notes?: string | null;
    selectedOptions?: ZeloMenuModifierSelectionInput[];
  }>;
  fulfillment?: {
    type?: 'pickup' | 'delivery';
    pickupDate?: string | null;
    pickupTime?: string | null;
    deliveryAddress?: string | null;
    deliveryNeighborhood?: string | null;
  };
  paymentMethod?: string | null;
  observations?: string | null;
};

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((body as { error?: string }).error || `HTTP ${response.status}`);
  }
  return body as T;
}

export async function getPublicCart(token: string): Promise<ZeloMenuPublicCartResponse> {
  const response = await apiFetch(apiUrl(`/public-api/zelomenu/cart/${encodeURIComponent(token)}`), {
    cache: 'no-store',
  });
  return parseResponse<ZeloMenuPublicCartResponse>(response);
}

export async function updatePublicCart(
  token: string,
  payload: ZeloMenuUpdateCartPayload,
): Promise<ZeloMenuPublicCartResponse> {
  const response = await apiFetch(apiUrl(`/public-api/zelomenu/cart/${encodeURIComponent(token)}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseResponse<ZeloMenuPublicCartResponse>(response);
}

export async function confirmPublicCart(token: string): Promise<ZeloMenuConfirmCartResponse> {
  const response = await apiFetch(apiUrl(`/public-api/zelomenu/cart/${encodeURIComponent(token)}/confirm`), {
    method: 'POST',
  });
  return parseResponse<ZeloMenuConfirmCartResponse>(response);
}

// ─── ZLM-203 — loja pública por slug ───────────────────────────────────────────
export type ZeloMenuPublicStoreResponse = {
  business: {
    name: string;
    address: string;
    pixEnabled: boolean;
    deliveryEnabled: boolean;
    deliveryNeighborhoods: Array<{ name: string; fee: number }>;
  };
  catalog: ZeloMenuCatalogGroup[];
};

export async function getPublicStore(slug: string): Promise<ZeloMenuPublicStoreResponse> {
  const response = await apiFetch(apiUrl(`/public-api/zelomenu/store/${encodeURIComponent(slug)}`), {
    cache: 'no-store',
  });
  return parseResponse<ZeloMenuPublicStoreResponse>(response);
}

export async function startPublicOrder(
  slug: string,
  payload: {
    customerName?: string | null;
    customerPhone?: string | null;
    items: ZeloMenuUpdateCartPayload['items'];
  },
): Promise<{ token: string; path: string; orderingId: string }> {
  const response = await apiFetch(apiUrl(`/public-api/zelomenu/store/${encodeURIComponent(slug)}/cart`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseResponse<{ token: string; path: string; orderingId: string }>(response);
}
