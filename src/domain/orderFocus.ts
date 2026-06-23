import type { Order } from '../types';
import { normalizePhoneNumber } from './chat';

export interface OrderFocusRequest {
  source: 'chat' | 'calendar' | 'production' | 'zelomenu_review';
  shortId?: string;
  remoteJid?: string;
  customerPhone?: string;
  pickupDate?: string;
  pickupTime?: string;
  total?: number;
}

function normalizeOrderPhone(phone?: string): string {
  if (!phone) return '';
  const digits = normalizePhoneNumber(phone);
  if (!digits) return '';
  return digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
}

function moneyMatches(left?: number, right?: number): boolean {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  return Math.abs((left ?? 0) - (right ?? 0)) < 0.01;
}

export function hasOrderFocusData(request: OrderFocusRequest | null | undefined): boolean {
  if (!request) return false;
  return Boolean(
    request.shortId
    || request.customerPhone
    || request.pickupDate
    || request.pickupTime
    || Number.isFinite(request.total),
  );
}

export function resolveOrderFocusRequest(
  orders: Order[],
  request: OrderFocusRequest | null | undefined,
): Order | null {
  if (!request || orders.length === 0 || !hasOrderFocusData(request)) return null;

  const shortId = request.shortId?.trim().replace(/^#/, '').toUpperCase();
  if (shortId) {
    const exactShortIdMatch = orders
      .filter((order) => order.id.slice(0, 8).toUpperCase() === shortId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    if (exactShortIdMatch) return exactShortIdMatch;
  }

  const requestedPhone = normalizeOrderPhone(request.customerPhone);
  const scored = orders
    .map((order) => {
      let score = 0;
      if (requestedPhone && normalizeOrderPhone(order.customerPhone) === requestedPhone) score += 4;
      if (request.pickupDate && order.pickupDate === request.pickupDate) score += 3;
      if (request.pickupTime && order.pickupTime === request.pickupTime) score += 2;
      if (Number.isFinite(request.total) && moneyMatches(order.total, request.total)) score += 2;
      return { order, score };
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return new Date(right.order.createdAt).getTime() - new Date(left.order.createdAt).getTime();
    });

  const best = scored[0];
  if (!best) return null;

  const minScore = shortId
    ? 6
    : requestedPhone && (request.pickupDate || request.pickupTime || Number.isFinite(request.total))
      ? 6
      : requestedPhone
        ? 4
        : request.pickupDate && request.pickupTime
          ? 5
          : request.pickupDate
            ? 3
            : Number.isFinite(request.total)
              ? 2
              : Number.POSITIVE_INFINITY;

  return best.score >= minScore ? best.order : null;
}
