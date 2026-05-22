import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getLocalPrintStatus,
  getZeloImpressaoFriendlyMessage,
  isPrinterSupported,
  pairLocalPrint,
  printOrder,
  printDayReport,
} from '../services/printerService';
import type { Order } from '../types';

export interface UsePrinterReturn {
  supported: boolean;
  connected: boolean;
  connecting: boolean;
  printing: boolean;
  deviceName: string | null;
  error: string | null;
  connect: () => Promise<void>;
  pair: (code: string) => Promise<void>;
  disconnect: () => void;
  print: (order: Order, businessName?: string) => Promise<void>;
  printDay: (dateLabel: string, orders: Order[], businessName?: string) => Promise<void>;
}

export function usePrinter(): UsePrinterReturn {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const supported = isPrinterSupported();

  const refresh = useCallback(async () => {
    if (!supported) return;
    const status = await getLocalPrintStatus();
    if (!mountedRef.current) return;
    setConnected(status.connected);
    setDeviceName(status.deviceName);
    setError(status.error);
  }, [supported]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => { mountedRef.current = false; };
  }, [refresh]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      await refresh();
    } catch (err) {
      setError(getZeloImpressaoFriendlyMessage(err));
    } finally {
      setConnecting(false);
    }
  }, [refresh]);

  const disconnect = useCallback(() => {
    setConnected(false);
    setDeviceName(null);
    setError(null);
  }, []);

  const pair = useCallback(async (code: string) => {
    setConnecting(true);
    setError(null);
    try {
      await pairLocalPrint(code);
      await refresh();
    } catch (err) {
      setError(getZeloImpressaoFriendlyMessage(err));
      throw err;
    } finally {
      setConnecting(false);
    }
  }, [refresh]);

  const print = useCallback(async (order: Order, businessName?: string) => {
    setPrinting(true);
    setError(null);
    try {
      await printOrder(order, businessName);
      setConnected(true);
    } catch (err) {
      const msg = getZeloImpressaoFriendlyMessage(err);
      console.error('[printer] print falhou:', err);
      setError(msg);
      throw err;
    } finally {
      setPrinting(false);
    }
  }, []);

  const printDay = useCallback(async (dateLabel: string, orders: Order[], businessName?: string) => {
    setPrinting(true);
    setError(null);
    try {
      await printDayReport(dateLabel, orders, businessName, { browserFallback: true });
      setConnected(true);
    } catch (err) {
      const msg = getZeloImpressaoFriendlyMessage(err);
      console.error('[printer] printDay falhou:', err);
      setError(msg);
      throw err;
    } finally {
      setPrinting(false);
    }
  }, []);

  return {
    supported,
    connected,
    connecting,
    printing,
    deviceName,
    error,
    connect,
    pair,
    disconnect,
    print,
    printDay,
  };
}
