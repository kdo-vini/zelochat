import { clampCatalogQuery } from './aiWhatsAppOrdering.js';

/**
 * Validates the model output used to decide whether a free-text WhatsApp
 * message is an order when no order is in progress. Confirmations and buttons
 * remain deterministic elsewhere; invalid model output is never trusted, so
 * callers can fail closed and fall back to the current behavior.
 */

export type OrderingIntent =
  | 'pedido'
  | 'duvida_cardapio'
  | 'pedir_cardapio'
  | 'conversa'
  | 'atendente'
  | 'outro';

export const ORDERING_INTENTS: readonly OrderingIntent[] = [
  'pedido',
  'duvida_cardapio',
  'pedir_cardapio',
  'conversa',
  'atendente',
  'outro',
];

export interface OrderingRoute {
  intent: OrderingIntent;
  confidence: number;
  items: string[];
}

export const ORDERING_ROUTE_MIN_CONFIDENCE = 0.6;
export const ORDERING_ROUTE_MAX_ITEMS = 10;
export const ORDERING_ROUTE_MAX_ITEM_LENGTH = 60;

function isOrderingIntent(value: unknown): value is OrderingIntent {
  return typeof value === 'string'
    && (ORDERING_INTENTS as readonly string[]).includes(value);
}

export function parseOrderingRoute(input: unknown): OrderingRoute | null {
  let value: unknown = input;

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;

  const route = value as Record<string, unknown>;
  if (!isOrderingIntent(route.intent)) return null;
  if (typeof route.confidence !== 'number' || !Number.isFinite(route.confidence)
    || route.confidence < 0 || route.confidence > 1) return null;
  if (!Array.isArray(route.items) || route.items.some((item) => typeof item !== 'string')) return null;

  const items: string[] = [];
  const seen = new Set<string>();
  for (const rawItem of route.items) {
    const item = rawItem.trim();
    if (item.length === 0 || item.length > ORDERING_ROUTE_MAX_ITEM_LENGTH) continue;

    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    if (items.length === ORDERING_ROUTE_MAX_ITEMS) break;
  }

  return { intent: route.intent, confidence: route.confidence, items };
}

export type OrderingEntryDecision = 'order' | 'menu_request' | 'generic';

export function decideOrderingEntry(route: OrderingRoute): OrderingEntryDecision {
  if (route.confidence < ORDERING_ROUTE_MIN_CONFIDENCE) return 'generic';

  switch (route.intent) {
    case 'pedido':
    case 'duvida_cardapio':
      return 'order';
    case 'pedir_cardapio':
      return 'menu_request';
    case 'conversa':
    case 'atendente':
    case 'outro':
      return 'generic';
  }
}

export function routeCatalogQuery(route: OrderingRoute, fallbackQuery: string): string {
  return clampCatalogQuery(route.items.length > 0 ? route.items.join(', ') : fallbackQuery);
}
