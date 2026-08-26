export const AUTOMATION_KINDS = ['birthday', 'reactivation', 'post_purchase', 'vip', 'abandoned_cart'] as const;
export type AutomationKind = (typeof AUTOMATION_KINDS)[number];

const AUTOMATION_LABELS: Record<AutomationKind, string> = {
  birthday: 'Aniversário',
  reactivation: 'Reativação',
  post_purchase: 'Pós-compra',
  vip: 'Clientes VIP',
  abandoned_cart: 'Carrinho abandonado',
};

export function getAutomationLabel(kind: AutomationKind): string {
  return AUTOMATION_LABELS[kind];
}

export interface AutomationActivation {
  message: string;
  sendStart: string;
  sendEnd: string;
  audience: string;
  dailyLimit: number;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function canEnableAutomation(input: AutomationActivation): boolean {
  return Boolean(input.message.trim()) &&
    TIME_PATTERN.test(input.sendStart) &&
    TIME_PATTERN.test(input.sendEnd) &&
    input.sendStart < input.sendEnd &&
    Boolean(input.audience.trim()) &&
    Number.isInteger(input.dailyLimit) &&
    input.dailyLimit >= 1 &&
    input.dailyLimit <= 200;
}

