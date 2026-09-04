/**
 * Wire → domain adapter for ZeloMenu's conversational ordering surface.
 *
 * ZeloMenu (the authority) emits `requirements[]` shaped with `type`/`name`,
 * and reuses `kind` on modifier requirements for the modifier SUBTYPE
 * (`'adicional'|'variacao'`) — see
 * `tests/fixtures/zelomenu-wire/v1/requirement-types.json`. The consumer
 * domain type (`src/domain/aiWhatsAppOrdering.ts`) used to guess a different
 * shape (`kind` as the discriminator, `label` for the question text) that
 * collided with ZeloMenu's own `kind` field — every requirement prompt
 * rendered `undefined` in production (CT #1/#2). This module is the ONLY
 * place that shape translation happens; every snapshot that enters the
 * process (GET, `open_or_update_draft`, `confirm_draft`, `cancel_draft`, and
 * the `current` snapshot on a 409) MUST go through `parseOrderingSnapshotWire`
 * — see `ZeloMenuInternalClient` in `zeloMenuInternalClient.ts`.
 */
import type { OrderingRequirement, OrderingRequirementKind, OrderingSnapshot } from '../src/domain/aiWhatsAppOrdering.js';

/**
 * Thrown when a response that is supposed to be a full ordering snapshot is
 * missing fields this codebase cannot safely operate without (PR C-2 / FN
 * C5 — deployment/version skew against an older or rolled-back ZeloMenu).
 * Callers must never let this surface as a raw TypeError; it is caught at
 * the client boundary and turned into the same friendly escalation copy any
 * other ZeloMenu failure gets.
 */
export class OrderingWireUnsupportedError extends Error {
  constructor(public readonly reason: string) {
    super(`ORDERING_WIRE_UNSUPPORTED: ${reason}`);
    this.name = 'OrderingWireUnsupportedError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function strOrNull(value: unknown): string | null | undefined {
  if (value === null) return null;
  return str(value);
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function mapRequirementOption(raw: unknown): NonNullable<OrderingRequirement['options']>[number] | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;
  return {
    id: raw.id,
    name: raw.name,
    currentPrice: typeof raw.currentPrice === 'number' ? raw.currentPrice : undefined,
    priceDelta: num(raw.priceDelta, 0),
    available: bool(raw.available, true),
    displayPrice: str(raw.displayPrice),
  };
}

function mapRequirement(raw: unknown): OrderingRequirement | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.type !== 'string' || typeof raw.name !== 'string') return null;
  // Unknown types pass through as-is: the presenter's exhaustive builder map
  // (`src/domain/orderingRequirementPresenter.ts`) falls back to a
  // plain-text question naming the requirement rather than throwing, so a
  // future ZeloMenu requirement type degrades gracefully instead of
  // crashing this turn.
  const type = raw.type as OrderingRequirementKind;
  const requirement: OrderingRequirement = {
    id: raw.id,
    type,
    label: raw.name,
    blocking: bool(raw.blocking, true),
  };
  if (typeof raw.lineId === 'string') requirement.lineId = raw.lineId;
  if (typeof raw.groupId === 'string') requirement.groupId = raw.groupId;
  if (typeof raw.productId === 'number') requirement.productId = raw.productId;
  if (raw.kind === 'adicional' || raw.kind === 'variacao') requirement.kind = raw.kind;
  if (typeof raw.pricingMode === 'string') requirement.pricingMode = raw.pricingMode;
  if (typeof raw.minSelections === 'number') requirement.minSelections = raw.minSelections;
  if (raw.maxSelections === null || typeof raw.maxSelections === 'number') requirement.maxSelections = raw.maxSelections as number | null;
  if (typeof raw.minTotalQuantity === 'number') requirement.minTotalQuantity = raw.minTotalQuantity;
  if (raw.maxTotalQuantity === null || typeof raw.maxTotalQuantity === 'number') requirement.maxTotalQuantity = raw.maxTotalQuantity as number | null;
  if (typeof raw.allowsQuantity === 'boolean') requirement.allowsQuantity = raw.allowsQuantity;
  if (raw.maxPerOption === null || typeof raw.maxPerOption === 'number') requirement.maxPerOption = raw.maxPerOption as number | null;
  if (typeof raw.selectedDistinctCount === 'number') requirement.selectedDistinctCount = raw.selectedDistinctCount;
  if (typeof raw.selectedTotalQuantity === 'number') requirement.selectedTotalQuantity = raw.selectedTotalQuantity;
  if (typeof raw.autoSelectableOptionId === 'string') requirement.autoSelectableOptionId = raw.autoSelectableOptionId;
  if (Array.isArray(raw.missingFields)) requirement.missingFields = raw.missingFields.filter((value): value is string => typeof value === 'string');
  if (Array.isArray(raw.options)) {
    requirement.options = raw.options.map(mapRequirementOption).filter((option): option is NonNullable<OrderingRequirement['options']>[number] => option !== null);
  }
  return requirement;
}

function mapCartItem(raw: unknown): OrderingSnapshot['cart']['items'][number] | null {
  if (!isRecord(raw) || typeof raw.productId !== 'number') return null;
  const selectedModifiers = Array.isArray(raw.selectedModifiers)
    ? raw.selectedModifiers.flatMap((group) => {
      if (!isRecord(group) || typeof group.groupId !== 'string') return [];
      const selectedOptions = Array.isArray(group.selectedOptions)
        ? group.selectedOptions.flatMap((option) => {
          if (!isRecord(option) || typeof option.optionId !== 'string') return [];
          return [{
            optionId: option.optionId,
            optionName: str(option.optionName) ?? '',
            priceDelta: num(option.priceDelta, 0),
            quantity: num(option.quantity, 1),
          }];
        })
        : [];
      return [{
        groupId: group.groupId,
        groupName: str(group.groupName) ?? '',
        kind: str(group.kind) ?? '',
        selectedOptions,
      }];
    })
    : [];
  return {
    lineId: str(raw.lineId),
    productId: raw.productId,
    productName: str(raw.productName) ?? '',
    baseUnitPrice: num(raw.baseUnitPrice, 0),
    selectedModifiers,
    modifierDeltaTotal: num(raw.modifierDeltaTotal, 0),
    quantity: num(raw.quantity, 1),
    unitPrice: num(raw.unitPrice, 0),
    lineTotal: num(raw.lineTotal, 0),
    notes: str(raw.notes) ?? undefined,
  };
}

/**
 * Parses a raw JSON body into the domain `OrderingSnapshot` shape. Throws
 * `OrderingWireUnsupportedError` (never a bare `TypeError`) when the payload
 * is missing the identity fields or the `requirements` array this codebase
 * requires to operate safely — see the class docstring.
 */
export function parseOrderingSnapshotWire(json: unknown): OrderingSnapshot {
  if (!isRecord(json)) throw new OrderingWireUnsupportedError('empty_or_non_object_body');
  if (typeof json.orderingId !== 'string' || typeof json.empresaId !== 'string' || typeof json.remoteJid !== 'string') {
    throw new OrderingWireUnsupportedError('missing_identity_fields');
  }
  if (typeof json.state !== 'string' || !Number.isFinite(json.revision)) {
    throw new OrderingWireUnsupportedError('missing_state_or_revision');
  }
  if (!Array.isArray(json.requirements)) {
    // The single most likely real-world trigger: ZeloChat deployed ahead of
    // (or ZeloMenu rolled back after) the authority branch that adds this
    // field (FN C5). Fail closed instead of throwing deep inside the
    // presenter.
    throw new OrderingWireUnsupportedError('missing_requirements_array');
  }

  const revision = num(json.revision, 0);
  const cartRaw = isRecord(json.cart) ? json.cart : {};
  const items = Array.isArray(cartRaw.items)
    ? cartRaw.items.map(mapCartItem).filter((item): item is OrderingSnapshot['cart']['items'][number] => item !== null)
    : [];

  const fulfillmentRaw = isRecord(json.fulfillment) ? json.fulfillment : {};
  const paymentRaw = isRecord(json.payment) ? json.payment : {};
  const pricingRaw = isRecord(json.pricing) ? json.pricing : {};
  const revalidationRaw = isRecord(json.revalidation) ? json.revalidation : {};
  const customerRaw = isRecord(json.customer) ? json.customer : {};
  const confirmationActionRaw = isRecord(json.confirmationAction) ? json.confirmationAction : null;
  const orderRaw = isRecord(json.order) ? json.order : null;

  return {
    orderingId: json.orderingId,
    empresaId: json.empresaId,
    remoteJid: json.remoteJid,
    state: json.state,
    revision,
    cart: {
      items,
      observations: strOrNull(cartRaw.observations) ?? undefined,
    },
    customer: {
      name: strOrNull(customerRaw.name),
      phone: strOrNull(customerRaw.phone),
    },
    fulfillment: {
      type: fulfillmentRaw.type === 'pickup' || fulfillmentRaw.type === 'delivery' ? fulfillmentRaw.type : null,
      asap: bool(fulfillmentRaw.asap, false),
      pickupDate: strOrNull(fulfillmentRaw.pickupDate),
      pickupTime: strOrNull(fulfillmentRaw.pickupTime),
      deliveryAddress: strOrNull(fulfillmentRaw.deliveryAddress),
      deliveryNumber: strOrNull(fulfillmentRaw.deliveryNumber),
      deliveryNeighborhood: strOrNull(fulfillmentRaw.deliveryNeighborhood),
      deliveryPostalCode: strOrNull(fulfillmentRaw.deliveryPostalCode),
      deliveryComplement: strOrNull(fulfillmentRaw.deliveryComplement),
      deliveryFee: typeof fulfillmentRaw.deliveryFee === 'number' ? fulfillmentRaw.deliveryFee : undefined,
      deliveryFeeToConfirm: typeof fulfillmentRaw.deliveryFeeToConfirm === 'boolean' ? fulfillmentRaw.deliveryFeeToConfirm : undefined,
    },
    payment: {
      declaredMethod: strOrNull(paymentRaw.declaredMethod),
      pixReceiptRequired: bool(paymentRaw.pixReceiptRequired, false),
      pixReceiptApproved: bool(paymentRaw.pixReceiptApproved, false),
    },
    pricing: {
      subtotal: num(pricingRaw.subtotal, 0),
      deliveryFee: num(pricingRaw.deliveryFee, 0),
      discount: num(pricingRaw.discount, 0),
      total: num(pricingRaw.total, 0),
    },
    revalidation: {
      checkedAt: str(revalidationRaw.checkedAt) ?? '',
      ok: bool(revalidationRaw.ok, true),
      issues: Array.isArray(revalidationRaw.issues)
        ? revalidationRaw.issues.flatMap((issue) => (isRecord(issue) && typeof issue.code === 'string'
          ? [{ code: issue.code, message: str(issue.message) ?? '' }]
          : []))
        : [],
    },
    requirements: json.requirements.map(mapRequirement).filter((requirement): requirement is OrderingRequirement => requirement !== null),
    readyForConfirmation: bool(json.readyForConfirmation, false),
    confirmationAction: confirmationActionRaw && typeof confirmationActionRaw.token === 'string' ? {
      type: 'confirm_order',
      token: confirmationActionRaw.token,
      revision: num(confirmationActionRaw.revision, revision),
      expiresAt: str(confirmationActionRaw.expiresAt) ?? '',
    } : null,
    requiresReview: bool(json.requiresReview, false),
    order: orderRaw && typeof orderRaw.id === 'string' ? {
      id: orderRaw.id,
      status: str(orderRaw.status) ?? '',
      alreadyConfirmed: bool(orderRaw.alreadyConfirmed, false),
      revision: num(orderRaw.revision, revision),
    } : null,
  };
}
