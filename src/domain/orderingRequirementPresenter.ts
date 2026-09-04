import {
  AI_ORDER_ALTER_BUTTON,
  AI_ORDER_CANCEL_BUTTON,
  AI_ORDER_CONFIRM_PREFIX,
  buildRequirementButtonId,
  renderOrderingSummary,
  type OrderingRequirement,
  type OrderingRequirementKind,
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
  .replace(/ /g, ' ');

/**
 * WhatsApp interactive titles are hard-capped (`src/domain/outbound.ts`:
 * button label 20 chars, list row/section title 24). A realistic modifier
 * name with a price delta — the design spec's own worked example, "Bife
 * acebolado (+R$ 12,00)" — is 26 chars BEFORE the price. Folding the price
 * into the title was what made every montável turn fail outbound validation
 * and escalate to a human (PR C-1). Titles now carry ONLY the (possibly
 * truncated) name; the price always goes into the message body or the list
 * row's `description`, which has a much larger cap.
 */
function truncateLabel(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  if (max <= 1) return trimmed.slice(0, max);
  return `${trimmed.slice(0, max - 1)}…`;
}

function requirementCardinality(requirement: OrderingRequirement): string {
  if (requirement.minSelections === 1 && requirement.maxSelections === 1) return 'Escolha 1 opção.';
  if ((requirement.minSelections ?? 0) === 0 && requirement.maxSelections) return `Você pode escolher até ${requirement.maxSelections}.`;
  if (requirement.minSelections && requirement.maxSelections) return `Escolha de ${requirement.minSelections} a ${requirement.maxSelections} opções.`;
  if (requirement.minSelections) return `Escolha pelo menos ${requirement.minSelections} opção${requirement.minSelections > 1 ? 'es' : ''}.`;
  return '';
}

/** Full name + price, for plain-text bodies where there is no title cap. */
function optionTextWithPrice(option: NonNullable<OrderingRequirement['options']>[number]): string {
  if (option.displayPrice) return `${option.name} (${option.displayPrice})`;
  if (option.priceDelta > 0) return `${option.name} (+${money(option.priceDelta)})`;
  return option.name;
}

/** Short price fragment for a list row's `description` field. */
function optionPriceDescription(option: NonNullable<OrderingRequirement['options']>[number]): string | undefined {
  if (option.displayPrice) return option.displayPrice;
  if (option.priceDelta > 0) return `+ ${money(option.priceDelta)}`;
  return undefined;
}

function compactOptionalOffer(requirements: OrderingRequirement[]): string {
  // FIX 2026-09-04 (PR I-12): this used to `slice(0, 5)` each group's options
  // and append "...", literally omitting extras from the message — the exact
  // symptom of Incident XXVIII ("omitiu misturas e acompanhamentos"). Every
  // available option is always listed; nothing is ever hidden.
  const pieces = requirements.map((requirement) => {
    const options = (requirement.options ?? []).filter((option) => option.available);
    const preview = options.map((option) => optionTextWithPrice(option)).join(', ');
    return `${requirement.label}: ${preview}`;
  });
  return `Se quiser completar com extras opcionais, você pode me dizer assim: ${pieces.join(' | ')}. Se preferir, pode responder "sem extras".`;
}

function reviewButtons(snapshot: OrderingSnapshot): OrderingReplyPayload {
  const token = snapshot.confirmationAction?.token ?? '';
  // FIX 2026-09-04 (PR Important "summaryText"): `snapshot.summaryText` does
  // not exist on the ZeloMenu wire (confirmed against every recorded
  // fixture) — reading it here always rendered "Resumo do pedido:" with an
  // empty body next to a live Confirmar button. `renderOrderingSummary` is
  // the single, already-correct source of truth for this text.
  return {
    kind: 'buttons',
    text: renderOrderingSummary(snapshot),
    buttons: [
      { id: `${AI_ORDER_CONFIRM_PREFIX}${token}`, label: 'Confirmar' },
      { id: AI_ORDER_ALTER_BUTTON, label: 'Alterar' },
      { id: AI_ORDER_CANCEL_BUTTON, label: 'Cancelar' },
    ],
  };
}

function requirementOptionButtonId(requirement: OrderingRequirement, optionId: string, snapshot: OrderingSnapshot): string {
  return buildRequirementButtonId({
    requirementId: requirement.id,
    optionId,
    orderingId: snapshot.orderingId,
    revision: snapshot.revision,
  });
}

function modifierGroupPrompt(requirement: OrderingRequirement, snapshot: OrderingSnapshot): OrderingReplyPayload {
  const options = (requirement.options ?? []).filter((option) => option.available);
  const cardinality = requirementCardinality(requirement);
  const intro = [requirement.label, cardinality].filter(Boolean).join(' ');
  if (requirement.lineId && options.length === 1 && requirement.minSelections === 1 && requirement.maxSelections === 1) {
    return { kind: 'text', text: `${intro} Vou considerar ${optionTextWithPrice(options[0])} para seguir.` };
  }
  if (options.length > 0 && options.length <= 3 && requirement.maxSelections === 1) {
    return {
      kind: 'buttons',
      // Price is never in the button label (20-char cap) — it lives in the
      // body text, one line per option, so the customer still sees it.
      text: `${intro}\n${options.map((option) => `- ${optionTextWithPrice(option)}`).join('\n')}`,
      buttons: options.map((option) => ({
        id: requirementOptionButtonId(requirement, option.id, snapshot),
        label: truncateLabel(option.name, 20),
      })),
    };
  }
  if (options.length >= 4 && options.length <= 10 && requirement.maxSelections === 1) {
    return {
      kind: 'list',
      text: intro,
      buttonText: 'Ver opções',
      sections: [{
        title: truncateLabel(requirement.label, 24),
        rows: options.map((option) => ({
          id: requirementOptionButtonId(requirement, option.id, snapshot),
          title: truncateLabel(option.name, 24),
          description: optionPriceDescription(option),
        })),
      }],
    };
  }
  return {
    kind: 'text',
    text: `${intro}\n${options.map((option) => `- ${optionTextWithPrice(option)}`).join('\n')}`.trim(),
  };
}

function fulfillmentTypePrompt(requirement: OrderingRequirement, snapshot: OrderingSnapshot): OrderingReplyPayload {
  return {
    kind: 'buttons',
    text: 'Seu pedido é para entrega ou retirada?',
    buttons: [
      { id: requirementOptionButtonId(requirement, 'delivery', snapshot), label: 'Entrega' },
      { id: requirementOptionButtonId(requirement, 'pickup', snapshot), label: 'Retirada' },
    ],
  };
}

function paymentMethodPrompt(requirement: OrderingRequirement, snapshot: OrderingSnapshot): OrderingReplyPayload {
  const options = requirement.options ?? [];
  if (options.length > 0 && options.length <= 3) {
    return {
      kind: 'buttons',
      text: requirement.label,
      buttons: options.map((option) => ({
        id: requirementOptionButtonId(requirement, option.id, snapshot),
        label: truncateLabel(option.name, 20),
      })),
    };
  }
  // ZeloMenu's `payment_method` requirement carries no `options[]` at all
  // (see `requirement-types.json`) — asking in plain text is the only
  // affordance that can exist for it; the model still applies the answer
  // via `alterar_carrinho`.
  return { kind: 'text', text: requirement.label };
}

/**
 * FIX 2026-09-04 (CT #1/#2, PR C-2/C-7): one branch per requirement `type`
 * ZeloMenu can emit, keyed by the SAME union the wire adapter produces. The
 * `satisfies Record<...>` below fails the typecheck the moment ZeloMenu adds
 * a requirement type without a matching branch here — mirroring the
 * authority's own `conversationOrderingWireContract.ts` exhaustiveness
 * check, so drift is caught at build time instead of in production.
 */
const REQUIREMENT_PROMPT_BUILDERS = {
  fulfillment_type: fulfillmentTypePrompt,
  payment_method: paymentMethodPrompt,
  delivery_address: (requirement: OrderingRequirement) => ({ kind: 'text', text: requirement.label } as OrderingReplyPayload),
  schedule: (requirement: OrderingRequirement) => ({ kind: 'text', text: requirement.label } as OrderingReplyPayload),
  customer_name: (requirement: OrderingRequirement) => ({ kind: 'text', text: requirement.label } as OrderingReplyPayload),
  modifier_group: modifierGroupPrompt,
} satisfies Record<OrderingRequirementKind, (requirement: OrderingRequirement, snapshot: OrderingSnapshot) => OrderingReplyPayload>;

function buildRequirementPrompt(requirement: OrderingRequirement, snapshot: OrderingSnapshot): OrderingReplyPayload {
  const builder = REQUIREMENT_PROMPT_BUILDERS[requirement.type as OrderingRequirementKind];
  if (builder) return builder(requirement, snapshot);
  // Unknown/forward-compat requirement type (authority version skew): ask in
  // plain text using the requirement's own label — NEVER an empty/undefined
  // body (that used to be the default branch's exact failure mode).
  return { kind: 'text', text: requirement.label || 'Preciso de mais uma informação para continuar com o pedido.' };
}

export function presentOrderingRequirements(
  snapshot: OrderingSnapshot,
  state: OrderingPresenterState = {},
): OrderingPresentation {
  const offered = new Set(state.offeredOptionalRequirementIds ?? []);
  const declined = new Set(state.declinedOptionalRequirementIds ?? []);
  // FIX 2026-09-04 (PR C-2): `requirements` is optional on the domain type
  // for callers that build a snapshot without it; defaulting to `[]` here
  // (matching the existing `?? []` at the server call sites) turns a version
  // -skew TypeError into "nothing left to ask" instead of a crash.
  const requirements = snapshot.requirements ?? [];
  const blocking = requirements.filter((requirement) => requirement.blocking);
  const optional = requirements.filter((requirement) => !requirement.blocking);
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

  const requirement = blocking[0] ?? pendingOptional[0] ?? requirements[0];
  const options = (requirement?.options ?? []).filter((option) => option.available);
  const autoSelectable = requirement?.type === 'modifier_group'
    && requirement.lineId
    && options.length === 1
    && requirement.minSelections === 1
    && requirement.maxSelections === 1;

  return {
    payload: requirement ? buildRequirementPrompt(requirement, snapshot) : { kind: 'text', text: 'Me diga o próximo detalhe do pedido.' },
    offeredOptionalRequirementIds: [...offered],
    declinedOptionalRequirementIds: [...declined],
    ...(autoSelectable && requirement.lineId ? {
      autoSelect: { lineId: requirement.lineId, groupId: requirement.groupId ?? requirement.id, optionId: options[0].id },
    } : {}),
  };
}
