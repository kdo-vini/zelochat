import { idempotencyKeyFor, type AutomationKind, type AutomationRule } from './rules.js';

export type AutomationCandidate = {
  pessoaId?: string | null;
  phone?: string | null;
  conflict?: boolean;
  blocked?: boolean;
  optedOut?: boolean;
  employee?: boolean;
  birthday?: { day: number; month: number } | null;
  lastDeliveredAt?: string | null;
  lastConversationAt?: string | null;
  openOrder?: boolean;
  promotionalContactAt?: string | null;
  recentAutomationSentAt?: string | null;
  order?: { id: string; status: string; deliveredAt?: string | null; totalCents?: number } | null;
  deliveredOrders?: number;
  totalSpentCents?: number;
  cart?: { id: string; state: string; updatedAt: string; archivedAt?: string | null } | null;
  eventKey?: string;
};

export type EvaluatedDispatch = {
  kind: AutomationKind;
  eventKey: string;
  status: 'eligible' | 'suppressed';
  suppressionReason?: string;
  pessoaId: string | null;
  phone: string | null;
  message: string;
};

function dateMs(value: string | null | undefined): number | null { if (!value) return null; const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : null; }
function localParts(now: Date, timezone: string): { day: number; month: number; year: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { day: Number(value.day), month: Number(value.month), year: Number(value.year), minutes: Number(value.hour) * 60 + Number(value.minute) };
}
function parseMinutes(value: string): number { const [hour, minute] = value.split(':').map(Number); return hour * 60 + minute; }

export function isWithinAutomationWindow(now: Date, window: { start: string; end: string }, timezone = 'America/Sao_Paulo'): boolean {
  const minutes = localParts(now, timezone).minutes;
  const start = parseMinutes(window.start); const end = parseMinutes(window.end);
  return start <= end ? minutes >= start && minutes <= end : minutes >= start || minutes <= end;
}

function suppression(kind: AutomationKind, candidate: AutomationCandidate, rule: AutomationRule, now: Date): string | undefined {
  if (!rule.enabled) return 'disabled';
  if (!candidate.phone?.trim()) return 'missing_phone';
  if (candidate.conflict) return 'identity_conflict';
  if (candidate.blocked) return 'blocked';
  if (candidate.optedOut) return 'opt_out';
  if (candidate.employee) return 'employee';
  if (!isWithinAutomationWindow(now, { start: rule.sendStart, end: rule.sendEnd }, rule.timezone)) return 'outside_window';
  const local = localParts(now, rule.timezone);
  if (kind === 'birthday') {
    const birthday = candidate.birthday;
    const daysBefore = Number(rule.config.daysBefore ?? 0);
    if (!birthday) return 'missing_birthday';
    const target = new Date(Date.UTC(local.year, birthday.month - 1, birthday.day));
    const today = new Date(Date.UTC(local.year, local.month - 1, local.day));
    const distance = Math.round((target.getTime() - today.getTime()) / 86400000);
    if (distance < 0 || distance > daysBefore) return 'not_due';
  }
  if (kind === 'reactivation') {
    if (candidate.openOrder) return 'open_order';
    if (dateMs(candidate.promotionalContactAt) !== null && now.getTime() - (dateMs(candidate.promotionalContactAt) as number) < 7 * 86400000) return 'recent_promotion';
    if (dateMs(candidate.recentAutomationSentAt) !== null && now.getTime() - (dateMs(candidate.recentAutomationSentAt) as number) < Number(rule.config.cooldownDays ?? 30) * 86400000) return 'cooldown';
    const last = dateMs(candidate.lastDeliveredAt) ?? dateMs(candidate.lastConversationAt);
    if (last === null || now.getTime() - last < Number(rule.config.inactiveDays ?? 30) * 86400000) return 'not_inactive';
  }
  if (kind === 'post_purchase' && (!candidate.order || candidate.order.status !== 'delivered' || !candidate.order.deliveredAt || now.getTime() - Date.parse(candidate.order.deliveredAt) < Number(rule.config.delayHours ?? 24) * 3600000)) return 'not_due';
  if (kind === 'vip' && (Number(candidate.deliveredOrders ?? 0) < Number(rule.config.deliveredOrders ?? 5) && Number(candidate.totalSpentCents ?? 0) < Number(rule.config.totalSpentCents ?? 30000))) return 'threshold_not_reached';
  if (kind === 'abandoned_cart') {
    if (!candidate.cart || candidate.cart.state !== 'cart_open' || candidate.cart.archivedAt) return 'cart_not_open';
    if (now.getTime() - Date.parse(candidate.cart.updatedAt) < Number(rule.config.delayHours ?? 2) * 3600000) return 'not_due';
    if (now.getTime() - Date.parse(candidate.cart.updatedAt) > 24 * 3600000) return 'cart_expired';
  }
  return undefined;
}

export function evaluateAutomationCandidate(kind: AutomationKind, candidate: AutomationCandidate, rule: AutomationRule, now = new Date()): EvaluatedDispatch {
  const eventKey = candidate.eventKey ?? (kind === 'birthday' ? idempotencyKeyFor(kind, { pessoaId: candidate.pessoaId ?? undefined, year: localParts(now, rule.timezone).year }) : kind === 'reactivation' ? idempotencyKeyFor(kind, { pessoaId: candidate.pessoaId ?? undefined, cycle: new Date(now.getTime()).toISOString().slice(0, 7) }) : kind === 'post_purchase' ? idempotencyKeyFor(kind, { pessoaId: candidate.pessoaId ?? undefined, orderId: candidate.order?.id }) : kind === 'vip' ? idempotencyKeyFor(kind, { pessoaId: candidate.pessoaId ?? undefined, thresholdVersion: Number(rule.config.thresholdVersion ?? rule.version) }) : idempotencyKeyFor(kind, { cartId: candidate.cart?.id }));
  const reason = suppression(kind, candidate, rule, now);
  return { kind, eventKey, status: reason ? 'suppressed' : 'eligible', suppressionReason: reason, pessoaId: candidate.pessoaId ?? null, phone: candidate.phone ?? null, message: rule.message };
}
