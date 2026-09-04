import type { ChatCompletionFunctionTool } from 'openai/resources/chat/completions.js';
import type { CatalogReplyResult, OrderingDraft, OrderingSnapshot } from '../src/domain/aiWhatsAppOrdering.js';
import { sanitizeCustomerForWire, sanitizeFulfillmentForWire } from '../src/domain/aiWhatsAppOrdering.js';

export interface ConversationOrderPatch {
  items: Array<{
    lineId?: string;
    productId: number;
    quantity: number;
    notes?: string;
    selectedOptions?: Array<{
      groupId: string;
      optionSelections: Array<{ optionId: string; quantity: number }>;
    }>;
  }>;
  /** Lines to drop from the cart entirely (CT Important 5). */
  removedLineIds?: string[];
  observations?: string;
  fulfillment?: OrderingDraft['fulfillment'];
  paymentMethod?: string;
}

function newLineId(productId: number, used: Set<string>): string {
  let suffix = 1;
  let candidate = `line-${productId}-${suffix}`;
  while (used.has(candidate)) {
    suffix += 1;
    candidate = `line-${productId}-${suffix}`;
  }
  return candidate;
}

function allowedGroupsByProduct(result: CatalogReplyResult): Map<number, Map<string, Set<string>>> {
  const products = new Map<number, Map<string, Set<string>>>();
  for (const candidate of result.results) {
    const groups = products.get(candidate.productId) ?? new Map<string, Set<string>>();
    for (const group of candidate.modifierGroups ?? []) {
      const options = groups.get(group.id) ?? new Set<string>();
      for (const option of group.options) options.add(option.id);
      groups.set(group.id, options);
    }
    products.set(candidate.productId, groups);
  }
  return products;
}

function currentGroupsByLine(current: OrderingSnapshot | null): Map<string, Map<string, Set<string>>> {
  const lines = new Map<string, Map<string, Set<string>>>();
  for (const item of current?.cart.items ?? []) {
    const groups = new Map<string, Set<string>>();
    for (const group of item.selectedModifiers) {
      groups.set(group.groupId, new Set(group.selectedOptions.map((option) => option.optionId)));
    }
    lines.set(item.lineId, groups);
  }
  return lines;
}

export function buildOrderingPatchTool(): ChatCompletionFunctionTool {
  return {
    type: 'function',
    function: {
      name: 'alterar_carrinho',
      description: 'Aplica um patch estruturado ao rascunho canônico do pedido usando somente IDs válidos.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['items'],
        properties: {
          items: {
            type: 'array',
            minItems: 1,
            maxItems: 25,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['productId', 'quantity'],
              properties: {
                lineId: { type: 'string', minLength: 1, maxLength: 64 },
                productId: { type: 'integer', minimum: 1 },
                quantity: { type: 'integer', minimum: 1, maximum: 999 },
                notes: { type: 'string', maxLength: 200 },
                selectedOptions: {
                  type: 'array',
                  maxItems: 20,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['groupId', 'optionSelections'],
                    properties: {
                      groupId: { type: 'string', minLength: 1, maxLength: 64 },
                      optionSelections: {
                        type: 'array',
                        maxItems: 25,
                        items: {
                          type: 'object',
                          additionalProperties: false,
                          required: ['optionId', 'quantity'],
                          properties: {
                            optionId: { type: 'string', minLength: 1, maxLength: 64 },
                            quantity: { type: 'integer', minimum: 1, maximum: 99 },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          removedLineIds: {
            type: 'array',
            maxItems: 50,
            description: 'IDs de linha a remover completamente do carrinho (ex.: cliente cancelou só um item).',
            items: { type: 'string', minLength: 1, maxLength: 64 },
          },
          fulfillment: {
            type: 'object',
            additionalProperties: false,
            properties: {
              type: { type: 'string', enum: ['pickup', 'delivery'] },
              asap: { type: 'boolean' },
              pickupDate: { type: 'string' },
              pickupTime: { type: 'string' },
              deliveryAddress: { type: 'string' },
              deliveryNeighborhood: { type: 'string' },
              deliveryPostalCode: { type: 'string' },
              deliveryNumber: { type: 'string' },
              deliveryComplement: { type: 'string' },
            },
          },
          paymentMethod: { type: 'string', maxLength: 40 },
          observations: { type: 'string', maxLength: 500 },
        },
      },
    },
  };
}

export function validateConversationOrderPatch(
  patch: ConversationOrderPatch,
  result: CatalogReplyResult,
  current: OrderingSnapshot | null,
): boolean {
  const byProduct = allowedGroupsByProduct(result);
  const currentByLine = currentGroupsByLine(current);
  const currentProducts = new Map((current?.cart.items ?? []).map((item) => [item.lineId, item.productId]));

  return patch.items.every((item) => {
    if (!Number.isInteger(item.productId) || item.productId <= 0 || !Number.isInteger(item.quantity) || item.quantity <= 0) return false;
    const lineProductId = item.lineId ? currentProducts.get(item.lineId) : undefined;
    if (lineProductId != null && lineProductId !== item.productId) return false;
    const allowedGroups = byProduct.get(item.productId);
    const currentGroups = item.lineId ? currentByLine.get(item.lineId) : undefined;
    return (item.selectedOptions ?? []).every((group) => {
      const allowedOptions = allowedGroups?.get(group.groupId) ?? currentGroups?.get(group.groupId);
      if (!allowedOptions) return false;
      return group.optionSelections.every((option) =>
        Number.isInteger(option.quantity) && option.quantity > 0 && allowedOptions.has(option.optionId));
    });
  });
}

function selectedOptionsFromModifiers(
  modifiers: OrderingSnapshot['cart']['items'][number]['selectedModifiers'],
): NonNullable<ConversationOrderPatch['items'][number]['selectedOptions']> {
  return modifiers.map((group) => ({
    groupId: group.groupId,
    optionSelections: group.selectedOptions.map((option) => ({
      optionId: option.optionId,
      quantity: option.quantity,
    })),
  }));
}

export function applyConversationOrderPatch(
  current: OrderingSnapshot | null,
  patch: ConversationOrderPatch,
): OrderingDraft {
  const currentItems = new Map((current?.cart.items ?? []).map((item) => [item.lineId, item]));
  const usedLineIds = new Set((current?.cart.items ?? []).flatMap((item) => item.lineId ? [item.lineId] : []));
  const removedLineIds = new Set(patch.removedLineIds ?? []);
  const mergedItems = patch.items
    .filter((item) => !(item.lineId && removedLineIds.has(item.lineId)))
    .map((item) => {
      const currentItem = item.lineId ? currentItems.get(item.lineId) : undefined;
      const lineId = item.lineId?.trim() || currentItem?.lineId || newLineId(item.productId, usedLineIds);
      usedLineIds.add(lineId);
      return {
        lineId,
        productId: item.productId,
        quantity: item.quantity,
        notes: item.notes,
        // FIX 2026-09-04 (PR I-13): a patch item that omits `selectedOptions`
        // entirely (e.g. a quantity-only change: "quero 3 ao invés de 2")
        // used to wipe every mistura/molho/paid add-on already chosen on that
        // line, because this used to assign `item.selectedOptions` verbatim
        // (`undefined`) with no merge against the line it was looked up from
        // one line above. When the caller (the model, via `alterar_carrinho`)
        // does not mention modifiers for an existing line, keep the line's
        // current selections; an explicit (even empty) array is still a
        // deliberate full replace.
        selectedOptions: item.selectedOptions ?? (currentItem ? selectedOptionsFromModifiers(currentItem.selectedModifiers) : undefined),
      };
    });

  const untouchedItems = (current?.cart.items ?? [])
    .filter((item) => !removedLineIds.has(item.lineId ?? ''))
    .filter((item) => !mergedItems.some((candidate) => candidate.lineId === item.lineId))
    .map((item) => ({
      lineId: item.lineId,
      productId: item.productId,
      quantity: item.quantity,
      notes: item.notes,
      selectedOptions: selectedOptionsFromModifiers(item.selectedModifiers),
    }));

  return {
    items: [...untouchedItems, ...mergedItems],
    removedLineIds: patch.removedLineIds,
    observations: patch.observations ?? current?.cart.observations,
    customer: sanitizeCustomerForWire(current?.customer),
    fulfillment: patch.fulfillment ?? sanitizeFulfillmentForWire(current?.fulfillment),
    paymentMethod: patch.paymentMethod ?? current?.payment?.declaredMethod ?? undefined,
  };
}
