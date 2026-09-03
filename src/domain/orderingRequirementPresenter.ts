import {
  AI_ORDER_CANCEL_BUTTON,
  AI_ORDER_CONFIRM_PREFIX,
  AI_ORDER_STATE_PREFIX,
  type OrderingRequirement,
  type OrderingSnapshot,
} from './aiWhatsAppOrdering.js';

export type OrderingReplyPayload =
  | { kind: 'text'; text: string }
  | { kind: 'buttons'; text: string; buttons: Array<{ id: string; label: string }> }
  | { kind: 'list'; text: string; buttonText: string; sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }> };

export interface OrderingPresenterState {
  offeredOptionalRequirementIds?: string[];
  declinedOptionalRequirementIds?: string[];
}

export interface OrderingPresentation {
  payload: OrderingReplyPayload;
  offeredOptionalRequirementIds: string[];
  declinedOptionalRequirementIds: string[];
  autoSelect?: { lineId: string; groupId: string; optionId: string };
}

const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
  .format(value)
  .replace(/\u00a0/g, ' ');

function requirementCardinality(requirement: OrderingRequirement): string {
  if (requirement.minSelections === 1 && requirement.maxSelections === 1) return 'Escolha 1 opção.';
  if ((requirement.minSelections ?? 0) === 0 && requirement.maxSelections) return `Você pode escolher até ${requirement.maxSelections}.`;
  if (requirement.minSelections && requirement.maxSelections) return `Escolha de ${requirement.minSelections} a ${requirement.maxSelections} opções.`;
  if (requirement.minSelections) return `Escolha pelo menos ${requirement.minSelections} opção${requirement.minSelections > 1 ? 'es' : ''}.`;
  return '';
}

function optionLabel(option: NonNullable<OrderingRequirement['options']>[number]): string {
  if (option.displayPrice) return `${option.name} (${option.displayPrice})`;
  if (option.priceDelta > 0) return `${option.name} (+${money(option.priceDelta)})`;
  return option.name;
}

function compactOptionalOffer(requirements: OrderingRequirement[]): string {
  const pieces = requirements.map((requirement) => {
    const options = (requirement.options ?? []).filter((option) => option.available);
    const preview = options.slice(0, 5).map((option) => optionLabel(option)).join(', ');
    const suffix = options.length > 5 ? ', ...' : '';
    return `${requirement.label}: ${preview}${suffix}`;
  });
  return `Se quiser completar com extras opcionais, você pode me dizer assim: ${pieces.join(' | ')}. Se preferir, pode responder "sem extras".`;
}

function reviewButtons(snapshot: OrderingSnapshot): OrderingReplyPayload {
  const token = snapshot.confirmationAction?.token ?? '';
  return {
    kind: 'buttons',
    text: `Resumo do pedido:\n${snapshot.summaryText ?? ''}`.trim(),
    buttons: [
      { id: `${AI_ORDER_CONFIRM_PREFIX}${token}`, label: 'Confirmar' },
      { id: 'ZOA', label: 'Alterar' },
      { id: AI_ORDER_CANCEL_BUTTON, label: 'Cancelar' },
    ],
  };
}

function buildRequirementPrompt(requirement: OrderingRequirement): OrderingReplyPayload {
  switch (requirement.kind) {
    case 'fulfillment_type':
      return {
        kind: 'buttons',
        text: 'Seu pedido é para entrega ou retirada?',
        buttons: [
          { id: 'REQ:fulfillment:delivery', label: 'Entrega' },
          { id: 'REQ:fulfillment:pickup', label: 'Retirada' },
        ],
      };
    case 'payment_method':
      if ((requirement.options ?? []).length > 0 && (requirement.options?.length ?? 0) <= 3) {
        return {
          kind: 'buttons',
          text: requirement.label,
          buttons: (requirement.options ?? []).map((option) => ({ id: `REQ:${requirement.id}:${option.id}`, label: optionLabel(option) })),
        };
      }
      return { kind: 'text', text: requirement.label };
    case 'delivery_address':
    case 'pickup_schedule':
    case 'customer_name':
      return { kind: 'text', text: requirement.label };
    case 'modifier_group': {
      const options = (requirement.options ?? []).filter((option) => option.available);
      const cardinality = requirementCardinality(requirement);
      const intro = [requirement.label, cardinality].filter(Boolean).join(' ');
      if (requirement.lineId && options.length === 1 && requirement.minSelections === 1 && requirement.maxSelections === 1) {
        return {
          kind: 'text',
          text: `${intro} Vou considerar ${optionLabel(options[0])} para seguir.`,
        };
      }
      if (options.length > 0 && options.length <= 3 && requirement.maxSelections === 1) {
        return {
          kind: 'buttons',
          text: intro,
          buttons: options.map((option) => ({ id: `REQ:${requirement.id}:${option.id}`, label: optionLabel(option) })),
        };
      }
      if (options.length >= 4 && options.length <= 10 && requirement.maxSelections === 1) {
        return {
          kind: 'list',
          text: intro,
          buttonText: 'Ver opções',
          sections: [{
            title: requirement.label,
            rows: options.map((option) => ({
              id: `REQ:${requirement.id}:${option.id}`,
              title: optionLabel(option),
            })),
          }],
        };
      }
      return {
        kind: 'text',
        text: `${intro}\n${options.map((option) => `- ${optionLabel(option)}`).join('\n')}`.trim(),
      };
    }
    default:
      return { kind: 'text', text: requirement.label };
  }
}

export function presentOrderingRequirements(
  snapshot: OrderingSnapshot,
  state: OrderingPresenterState = {},
): OrderingPresentation {
  const offered = new Set(state.offeredOptionalRequirementIds ?? []);
  const declined = new Set(state.declinedOptionalRequirementIds ?? []);
  const blocking = snapshot.requirements.filter((requirement) => requirement.blocking);
  const optional = snapshot.requirements.filter((requirement) => !requirement.blocking);
  const pendingOptional = optional.filter((requirement) => !offered.has(requirement.id) && !declined.has(requirement.id));

  if (snapshot.readyForConfirmation && snapshot.confirmationAction && !pendingOptional.length) {
    return {
      payload: reviewButtons(snapshot),
      offeredOptionalRequirementIds: [...offered],
      declinedOptionalRequirementIds: [...declined],
    };
  }

  if (blocking.length === 0 && pendingOptional.length > 0) {
    pendingOptional.forEach((requirement) => offered.add(requirement.id));
    return {
      payload: { kind: 'text', text: compactOptionalOffer(pendingOptional) },
      offeredOptionalRequirementIds: [...offered],
      declinedOptionalRequirementIds: [...declined],
    };
  }

  const requirement = blocking[0] ?? pendingOptional[0] ?? snapshot.requirements[0];
  const options = (requirement?.options ?? []).filter((option) => option.available);
  const autoSelectable = requirement?.kind === 'modifier_group'
    && requirement.lineId
    && options.length === 1
    && requirement.minSelections === 1
    && requirement.maxSelections === 1;

  return {
    payload: requirement ? buildRequirementPrompt(requirement) : { kind: 'text', text: 'Me diga o próximo detalhe do pedido.' },
    offeredOptionalRequirementIds: [...offered],
    declinedOptionalRequirementIds: [...declined],
    ...(autoSelectable && requirement.lineId ? {
      autoSelect: { lineId: requirement.lineId, groupId: requirement.groupId ?? requirement.id, optionId: options[0].id },
    } : {}),
  };
}
