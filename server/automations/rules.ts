export const AUTOMATION_KINDS = ['birthday', 'reactivation', 'post_purchase', 'vip', 'abandoned_cart'] as const;
export type AutomationKind = (typeof AUTOMATION_KINDS)[number];
export const DEFAULT_AUTOMATION_TIMEZONE = 'America/Sao_Paulo';

export type AutomationRule = {
  id?: string;
  empresaId?: string;
  kind: AutomationKind;
  enabled: boolean;
  message: string;
  timezone: string;
  sendStart: string;
  sendEnd: string;
  config: Record<string, unknown>;
  dailyLimit: number;
  version: number;
};

const defaults: Record<AutomationKind, Omit<AutomationRule, 'kind'>> = {
  birthday: { enabled: false, message: '', timezone: DEFAULT_AUTOMATION_TIMEZONE, sendStart: '09:00', sendEnd: '20:00', config: { daysBefore: 0, sendAt: '10:00' }, dailyLimit: 50, version: 1 },
  reactivation: { enabled: false, message: '', timezone: DEFAULT_AUTOMATION_TIMEZONE, sendStart: '09:00', sendEnd: '20:00', config: { inactiveDays: 30, cooldownDays: 30 }, dailyLimit: 50, version: 1 },
  post_purchase: { enabled: false, message: '', timezone: DEFAULT_AUTOMATION_TIMEZONE, sendStart: '09:00', sendEnd: '20:00', config: { delayHours: 24 }, dailyLimit: 50, version: 1 },
  vip: { enabled: false, message: '', timezone: DEFAULT_AUTOMATION_TIMEZONE, sendStart: '09:00', sendEnd: '20:00', config: { deliveredOrders: 5, totalSpentCents: 30000, thresholdVersion: 1 }, dailyLimit: 50, version: 1 },
  abandoned_cart: { enabled: false, message: '', timezone: DEFAULT_AUTOMATION_TIMEZONE, sendStart: '09:00', sendEnd: '20:00', config: { delayHours: 2 }, dailyLimit: 50, version: 1 },
};

export function getDefaultAutomationRule(kind: AutomationKind): AutomationRule {
  const value = defaults[kind];
  return { kind, ...value, config: { ...value.config } };
}

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
function numberIn(config: Record<string, unknown>, key: string, min: number, max: number): boolean {
  const value = config[key];
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

export function validateAutomationRule(kind: AutomationKind, input: Partial<AutomationRule>): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (input.dailyLimit !== undefined && (!Number.isInteger(input.dailyLimit) || input.dailyLimit < 1 || input.dailyLimit > 200)) errors.push('dailyLimit');
  if (input.timezone !== undefined && input.timezone !== DEFAULT_AUTOMATION_TIMEZONE) errors.push('timezone');
  if (input.enabled && !String(input.message ?? '').trim()) errors.push('message');
  if (input.sendStart !== undefined && !timePattern.test(input.sendStart)) errors.push('sendStart');
  if (input.sendEnd !== undefined && !timePattern.test(input.sendEnd)) errors.push('sendEnd');
  const config = input.config ?? {};
  if (kind === 'birthday' && !numberIn(config, 'daysBefore', 0, 7)) errors.push('daysBefore');
  if (kind === 'reactivation' && (!numberIn(config, 'inactiveDays', 7, 180) || !numberIn(config, 'cooldownDays', 1, 180))) errors.push('reactivation_config');
  if (kind === 'post_purchase' && !numberIn(config, 'delayHours', 1, 168)) errors.push('delayHours');
  if (kind === 'vip' && (!numberIn(config, 'deliveredOrders', 1, 1000) || !numberIn(config, 'totalSpentCents', 1, 100000000))) errors.push('vip_config');
  if (kind === 'abandoned_cart' && !numberIn(config, 'delayHours', 2, 24)) errors.push('delayHours');
  return { ok: errors.length === 0, errors };
}

export type IdempotencyInput = { pessoaId?: string; year?: number; cycle?: string; orderId?: string; thresholdVersion?: number; cartId?: string };
export function idempotencyKeyFor(kind: AutomationKind, input: IdempotencyInput): string {
  if (kind === 'birthday') return `birthday:${input.pessoaId}:${input.year}`;
  if (kind === 'reactivation') return `reactivation:${input.pessoaId}:${input.cycle}`;
  if (kind === 'post_purchase') return `post_purchase:${input.pessoaId}:${input.orderId}`;
  if (kind === 'vip') return `vip:${input.pessoaId}:v${input.thresholdVersion}`;
  return `abandoned_cart:${input.cartId}`;
}
