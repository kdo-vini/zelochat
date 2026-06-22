import { normalizeLoose } from './conversationState';

export type OrderEventTriggerLike = {
  id: string;
  kind: string;
  name: string;
  conditionDescription?: string | null;
  naturalInput?: string | null;
  active?: boolean;
};

export type OrderEventItemLike = {
  product: string;
  quantity: number;
};

export type OrderCreatedTriggerMatch<T extends OrderEventTriggerLike = OrderEventTriggerLike> = {
  trigger: T;
  reason: string;
};

function triggerText(trigger: OrderEventTriggerLike): string {
  return normalizeLoose([
    trigger.name,
    trigger.conditionDescription,
    trigger.naturalInput,
  ].filter(Boolean).join(' '));
}

function isNewOrderTrigger(text: string): boolean {
  return /\b(novo pedido|pedido novo|pedido feito|pedido realizado|pedido criado|pedido confirmado)\b/u.test(text)
    || /\b(sempre|quando|assim que)\b.*\bpedido\b.*\b(feit|realizad|criad|confirmad)\w*\b/u.test(text);
}

function largeOrderThreshold(text: string): number | null {
  if (!/\b(pedido grande|pedido alto|pedido volumoso|muitos salgad|mais de|acima de)\b/u.test(text)) {
    return null;
  }
  const match = text.match(/\b(?:mais de|acima de|maior que|passar de|passar dos|pedir mais de)?\s*(\d{2,5})\s*(?:salgad\w*|unidad\w*|itens|pedido)?\b/u);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function selectOrderCreatedNotifyTriggers<T extends OrderEventTriggerLike>(
  triggers: T[],
  items: OrderEventItemLike[],
): OrderCreatedTriggerMatch<T>[] {
  const totalItems = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const matches: OrderCreatedTriggerMatch<T>[] = [];

  for (const trigger of triggers) {
    if (trigger.kind !== 'notify_manager' || trigger.active === false) continue;
    const text = triggerText(trigger);
    if (!text) continue;

    if (isNewOrderTrigger(text)) {
      matches.push({ trigger, reason: 'Novo pedido confirmado' });
      continue;
    }

    const threshold = largeOrderThreshold(text);
    if (threshold !== null && totalItems > threshold) {
      matches.push({
        trigger,
        reason: `Pedido confirmado com ${totalItems} itens, acima do limite configurado de ${threshold}.`,
      });
    }
  }

  return matches;
}
