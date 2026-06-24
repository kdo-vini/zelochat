import type { ZeloMenuModifierSelectionInput } from './zelomenuModifiers';

const CART_TTL_MS = 12 * 60 * 60 * 1000;

export type ZeloMenuStoreCartItem = {
  key: string;
  productId: number;
  productName: string;
  quantity: number;
  selectedOptions: ZeloMenuModifierSelectionInput[];
  unitPrice: number;
};

export type ZeloMenuStoreCartCache = {
  items: Record<string, ZeloMenuStoreCartItem>;
};

export function zeloMenuStoreCartStorageKey(slug: string): string {
  return `zelomenu_cart_${slug}`;
}

export function loadZeloMenuStoreCartCache(slug: string): ZeloMenuStoreCartCache {
  const empty: ZeloMenuStoreCartCache = { items: {} };
  if (!slug) return empty;
  try {
    const raw = localStorage.getItem(zeloMenuStoreCartStorageKey(slug));
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as { savedAt?: number } & Partial<ZeloMenuStoreCartCache>;
    if (!parsed.savedAt || Date.now() - parsed.savedAt > CART_TTL_MS) {
      localStorage.removeItem(zeloMenuStoreCartStorageKey(slug));
      return empty;
    }
    return { items: parsed.items ?? {} };
  } catch {
    return empty;
  }
}

export function persistZeloMenuStoreCartCache(
  slug: string,
  cart: ZeloMenuStoreCartCache,
): void {
  if (!slug) return;
  try {
    if (Object.keys(cart.items).length === 0) {
      localStorage.removeItem(zeloMenuStoreCartStorageKey(slug));
      return;
    }
    localStorage.setItem(
      zeloMenuStoreCartStorageKey(slug),
      JSON.stringify({ ...cart, savedAt: Date.now() }),
    );
  } catch {
    // localStorage indisponível (modo privado/cota): o servidor segue canônico.
  }
}

function selectionSignature(selectedOptions: ZeloMenuModifierSelectionInput[]): string {
  return (
    selectedOptions
      .map((group) => `${group.groupId}:${[...group.optionIds].sort().join(',')}`)
      .sort()
      .join('|') || 'plain'
  );
}

export function syncZeloMenuStoreCartCache(input: {
  slug: string | null;
  state: string;
  items: Array<{
    productId: number | null;
    productName: string;
    quantity: number;
    unitPrice: number;
    selectedModifiers: Array<{
      groupId: string;
      selectedOptions: Array<{ optionId: string }>;
    }>;
  }>;
}): void {
  if (!input.slug) return;
  if (input.state !== 'cart_open') {
    persistZeloMenuStoreCartCache(input.slug, { items: {} });
    return;
  }

  const items = Object.fromEntries(
    input.items.flatMap((item) => {
      if (item.productId == null || item.quantity <= 0) return [];
      const selectedOptions = item.selectedModifiers.map((group) => ({
        groupId: group.groupId,
        optionIds: group.selectedOptions.map((option) => option.optionId),
      }));
      const key = `${item.productId}::${selectionSignature(selectedOptions)}`;
      return [[key, {
        key,
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        selectedOptions,
        unitPrice: item.unitPrice,
      } satisfies ZeloMenuStoreCartItem]];
    }),
  );

  persistZeloMenuStoreCartCache(input.slug, { items });
}
