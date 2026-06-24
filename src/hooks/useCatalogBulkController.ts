import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ProdutoRow,
  ZeloMenuProductPublicationInput,
  ZeloMenuProductPublicationRow,
} from './useCatalog';
import { getFriendlyErrorMessage } from '../services/errorMessages';

export type BulkPublicationState = 'published' | 'unpublished';

export type CatalogBulkAction =
  | { type: 'delete' }
  | { type: 'set-publication'; state: BulkPublicationState };

export type CatalogBulkResult = {
  total: number;
  changed: number;
  skipped: number;
  failed: Array<{ productId: number; reason: string }>;
};

type UseCatalogBulkControllerArgs = {
  visibleProducts: readonly ProdutoRow[];
  deleteProduto: (id: number) => Promise<void>;
  upsertProductPublication: (
    productId: number,
    patch: ZeloMenuProductPublicationInput,
  ) => Promise<ZeloMenuProductPublicationRow>;
};

export type CatalogBulkController = {
  selectionMode: boolean;
  busyAction: CatalogBulkAction['type'] | null;
  selectedIds: ReadonlySet<number>;
  selectedCount: number;
  hasSelection: boolean;
  allVisibleSelected: boolean;
  enterSelection(seedProductId?: number): void;
  exitSelection(): void;
  isSelected(productId: number): boolean;
  toggle(productId: number): void;
  toggleMany(productIds: Iterable<number>): void;
  toggleVisible(): void;
  run(action: CatalogBulkAction): Promise<CatalogBulkResult>;
};

export function useCatalogBulkController({
  visibleProducts,
  deleteProduto,
  upsertProductPublication,
}: UseCatalogBulkControllerArgs): CatalogBulkController {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set<number>());
  const [busyAction, setBusyAction] = useState<CatalogBulkAction['type'] | null>(null);

  const visibleIds = useMemo(() => visibleProducts.map((product) => product.id), [visibleProducts]);
  const visibleIdSet = useMemo(() => new Set(visibleIds), [visibleIds]);

  useEffect(() => {
    setSelectedIds((previous) => {
      const next = new Set<number>();
      for (const id of previous) {
        if (visibleIdSet.has(id)) next.add(id);
      }
      return next;
    });
  }, [visibleIdSet]);

  useEffect(() => {
    if (selectionMode && selectedIds.size === 0) setSelectionMode(false);
  }, [selectionMode, selectedIds]);

  const selectedCount = selectedIds.size;
  const hasSelection = selectedCount > 0;
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  const enterSelection = useCallback((seedProductId?: number) => {
    setSelectionMode(true);
    if (seedProductId == null) return;
    setSelectedIds(new Set<number>([seedProductId]));
  }, []);

  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set<number>());
  }, []);

  const isSelected = useCallback((productId: number) => selectedIds.has(productId), [selectedIds]);

  const toggle = useCallback((productId: number) => {
    setSelectionMode(true);
    setSelectedIds((previous) => {
      const next = new Set<number>(previous);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }, []);

  const toggleMany = useCallback((productIds: Iterable<number>) => {
    const ids = [...new Set(Array.from(productIds).filter((id) => visibleIdSet.has(id)))];
    if (ids.length === 0) return;
    setSelectionMode(true);
    setSelectedIds((previous) => {
      const allSelected = ids.every((id) => previous.has(id));
      const next = new Set<number>(previous);
      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, [visibleIdSet]);

  const toggleVisible = useCallback(() => {
    if (visibleIds.length === 0) return;
    toggleMany(visibleIds);
  }, [toggleMany, visibleIds]);

  const run = useCallback(async (action: CatalogBulkAction): Promise<CatalogBulkResult> => {
    const ids: number[] = Array.from(selectedIds);
    if (ids.length === 0) {
      return { total: 0, changed: 0, skipped: 0, failed: [] };
    }

    setBusyAction(action.type);
    try {
      const results = await Promise.allSettled(
        ids.map(async (productId) => {
          if (action.type === 'delete') {
            await deleteProduto(productId);
            return;
          }

          const patch: ZeloMenuProductPublicationInput = action.state === 'published'
            ? { visivel_online: true, pausado_manualmente: false }
            : { visivel_online: false, pausado_manualmente: false };
          await upsertProductPublication(productId, patch);
        }),
      );

      const failed: Array<{ productId: number; reason: string }> = [];
      const succeededIds: number[] = [];

      results.forEach((result, index) => {
        const productId = ids[index];
        if (result.status === 'fulfilled') {
          succeededIds.push(productId);
          return;
        }
        failed.push({
          productId,
          reason: getFriendlyErrorMessage(result.reason) || 'Não foi possível concluir esta ação.',
        });
      });

      setSelectedIds(new Set<number>(failed.map((item) => item.productId)));
      if (failed.length === 0) setSelectionMode(false);

      return {
        total: ids.length,
        changed: succeededIds.length,
        skipped: 0,
        failed,
      };
    } finally {
      setBusyAction(null);
    }
  }, [deleteProduto, selectedIds, upsertProductPublication]);

  return {
    selectionMode,
    busyAction,
    selectedIds,
    selectedCount,
    hasSelection,
    allVisibleSelected,
    enterSelection,
    exitSelection,
    isSelected,
    toggle,
    toggleMany,
    toggleVisible,
    run,
  };
}
