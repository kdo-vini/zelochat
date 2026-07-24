import { useCallback, useRef } from 'react';
import type { Order } from '../types';

const AUTO_PRINT_DEDUPE_WINDOW_MS = 48 * 60 * 60 * 1000; // 48h
const PRINTED_ORDER_IDS_KEY = 'zelochat_auto_printed_order_ids_v1';

function loadPrintedOrderIds(): Map<string, number> {
  try {
    const raw = localStorage.getItem(PRINTED_ORDER_IDS_KEY);
    if (!raw) return new Map();
    const parsed: Array<[string, number]> = JSON.parse(raw);
    return Array.isArray(parsed) ? new Map(parsed) : new Map();
  } catch {
    return new Map();
  }
}

function savePrintedOrderIds(map: Map<string, number>): void {
  try {
    localStorage.setItem(PRINTED_ORDER_IDS_KEY, JSON.stringify(Array.from(map.entries())));
  } catch {
    // localStorage cheio ou desabilitado — falha silenciosa, impressão é bônus
  }
}

export function useAutoPrint(
  printer: { connected: boolean; print: (order: Order, businessName?: string) => Promise<void> },
  businessName: string,
  toast: { success: (msg: string) => void; error: (msg: string) => void; info: (msg: string) => void },
) {
  const autoPrintedRef = useRef<Map<string, number> | null>(null);
  if (autoPrintedRef.current === null) {
    autoPrintedRef.current = loadPrintedOrderIds();
  }

  const autoPrintOrder = useCallback((order: Order) => {
    if (!printer.connected) return;
    const printedIds = autoPrintedRef.current ?? new Map<string, number>();
    autoPrintedRef.current = printedIds;

    const now = Date.now();
    for (const [orderId, ts] of printedIds) {
      if (now - ts > AUTO_PRINT_DEDUPE_WINDOW_MS) printedIds.delete(orderId);
    }
    savePrintedOrderIds(printedIds);

    const previousTs = printedIds.get(order.id);
    if (previousTs && now - previousTs < AUTO_PRINT_DEDUPE_WINDOW_MS) return;
    printedIds.set(order.id, now);
    savePrintedOrderIds(printedIds);

    printer.print(order, businessName || 'ZeloChat').catch((err) => {
      printedIds.delete(order.id);
      savePrintedOrderIds(printedIds);
      console.error('[printer] auto-print falhou para pedido', order.id, err);
      toast.error('Não consegui imprimir o pedido automaticamente. Verifique a impressora.');
    });
  }, [printer, businessName, toast]);

  const reprintOrder = useCallback(async (order: Order) => {
    try {
      await printer.print(order, businessName || 'ZeloChat');
      toast.success('Pedido enviado para a impressora.');
    } catch (err) {
      console.error('[printer] reimpressão falhou para pedido', order.id, err);
      toast.error(err instanceof Error ? err.message : 'Não consegui imprimir o pedido. Verifique a impressora.');
    }
  }, [printer, businessName, toast]);

  return { autoPrintOrder, reprintOrder };
}
