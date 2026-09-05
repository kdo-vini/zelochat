import { useCallback, useEffect, useRef } from 'react';
import type { Order } from '../types';
import type { OrderPrintOptions } from '../services/printerService';
import { getZeloImpressaoFriendlyMessage, isPrintOutcomeUnknown } from '../services/zeloImpressaoClient';

const AUTO_PRINT_DEDUPE_WINDOW_MS = 48 * 60 * 60 * 1000; // 48h
const PRINTED_ORDER_IDS_KEY = 'zelochat_auto_printed_order_ids_v1';

/** Keep events arriving during pairing/owner lookup; never carry them to another login. */
export class PendingAutoPrintOrders {
  private actor: string | null = null;
  private orders = new Map<string, { order: Order; receivedAt: number }>();
  setActor(actor: string | null): void {
    if (actor !== this.actor) this.orders.clear();
    this.actor = actor;
  }
  add(order: Order, now = Date.now()): void {
    if (!this.actor) return;
    this.orders.set(order.id, { order, receivedAt: now });
    if (this.orders.size > 1000) this.orders.delete(this.orders.keys().next().value!);
  }
  take(now = Date.now()): Order[] {
    const orders = [...this.orders.values()].filter((entry) => now - entry.receivedAt < 15 * 60_000).map((entry) => entry.order);
    this.orders.clear();
    return orders;
  }
}

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
  printer: { connected: boolean; print: (order: Order, businessName?: string, options?: OrderPrintOptions) => Promise<void> },
  businessName: string,
  toast: { success: (msg: string) => void; error: (msg: string) => void; info: (msg: string) => void },
  ownerUserId: string | null,
  actorUserId: string | null = ownerUserId,
) {
  const pendingRef = useRef(new PendingAutoPrintOrders());
  pendingRef.current.setActor(actorUserId);
  const actorRef = useRef(actorUserId);
  actorRef.current = actorUserId;
  const printingQueue = useRef(Promise.resolve());
  const queuedIds = useRef(new Set<string>());
  const autoPrintedRef = useRef<Map<string, number> | null>(null);
  if (autoPrintedRef.current === null) {
    autoPrintedRef.current = loadPrintedOrderIds();
  }

  const autoPrintOrder = useCallback((order: Order) => {
    if (!printer.connected || !ownerUserId) { pendingRef.current.add(order); return; }
    const printedIds = autoPrintedRef.current ?? new Map<string, number>();
    autoPrintedRef.current = printedIds;

    const now = Date.now();
    for (const [orderId, ts] of printedIds) {
      if (now - ts > AUTO_PRINT_DEDUPE_WINDOW_MS) printedIds.delete(orderId);
    }
    savePrintedOrderIds(printedIds);

    const key = `${ownerUserId}:${order.id}`;
    // Preserve the previous version's uncertain/successful attempts during rollout.
    const previousTs = printedIds.get(key) ?? printedIds.get(order.id);
    if (previousTs && now - previousTs < AUTO_PRINT_DEDUPE_WINDOW_MS) return;
    if (queuedIds.current.has(key)) return;
    queuedIds.current.add(key);

    printingQueue.current = printingQueue.current.then(async () => {
      if (actorRef.current !== actorUserId) {
        return;
      }
      printedIds.set(key, Date.now());
      savePrintedOrderIds(printedIds);
      await printer.print(order, businessName || 'ZeloChat', { mode: 'automatic', companyStoreId: ownerUserId });
    }).catch((err) => {
      if (!isPrintOutcomeUnknown(err)) {
        printedIds.delete(key);
        savePrintedOrderIds(printedIds);
      }
      console.error('[printer] auto-print falhou para pedido', order.id, err);
      toast.error(getZeloImpressaoFriendlyMessage(err));
    }).finally(() => { queuedIds.current.delete(key); });
  }, [printer, businessName, toast, ownerUserId, actorUserId]);

  useEffect(() => {
    if (!printer.connected || !ownerUserId) return;
    for (const order of pendingRef.current.take()) autoPrintOrder(order);
  }, [printer.connected, ownerUserId, autoPrintOrder]);

  const reprintOrder = useCallback(async (order: Order) => {
    try {
      await printer.print(order, businessName || 'ZeloChat', ownerUserId ? { mode: 'manual', companyStoreId: ownerUserId } : undefined);
      toast.success('Pedido enviado para a impressora.');
    } catch (err) {
      console.error('[printer] reimpressão falhou para pedido', order.id, err);
      toast.error(getZeloImpressaoFriendlyMessage(err));
    }
  }, [printer, businessName, toast, ownerUserId]);

  return { autoPrintOrder, reprintOrder };
}
