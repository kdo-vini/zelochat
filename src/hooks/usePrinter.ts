import { useCallback, useEffect, useRef, useState } from 'react';
import {
  connectPrinter,
  getStoredPrinter,
  isPrinterSupported,
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
  disconnect: () => void;
  print: (order: Order, businessName?: string) => Promise<void>;
  printDay: (dateLabel: string, orders: Order[], businessName?: string) => Promise<void>;
}

export function usePrinter(): UsePrinterReturn {
  const [device, setDevice] = useState<USBDevice | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deviceRef = useRef<USBDevice | null>(null);

  const supported = isPrinterSupported();

  // Try to reconnect to a previously authorized device on mount
  useEffect(() => {
    if (!supported) return;
    getStoredPrinter().then((d) => {
      if (d) {
        setDevice(d);
        deviceRef.current = d;
      }
    }).catch(() => {/* no stored device */});
  }, [supported]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const d = await connectPrinter();
      setDevice(d);
      deviceRef.current = d;
    } catch (err) {
      if (err instanceof Error && err.name !== 'NotFoundError') {
        setError(err.message);
      }
      // NotFoundError = user closed the dialog without selecting — not an error
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setDevice(null);
    deviceRef.current = null;
    setError(null);
  }, []);

  const print = useCallback(async (order: Order, businessName?: string) => {
    const d = deviceRef.current;
    if (!d) { setError('Impressora não conectada.'); return; }
    setPrinting(true);
    setError(null);
    try {
      await printOrder(d, order, businessName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao imprimir.';
      setError(msg);
    } finally {
      setPrinting(false);
    }
  }, []);

  const printDay = useCallback(async (dateLabel: string, orders: Order[], businessName?: string) => {
    const d = deviceRef.current;
    if (!d) { setError('Impressora não conectada.'); return; }
    setPrinting(true);
    setError(null);
    try {
      await printDayReport(d, dateLabel, orders, businessName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao imprimir relatório.';
      setError(msg);
    } finally {
      setPrinting(false);
    }
  }, []);

  const deviceName = device
    ? (device.productName || device.manufacturerName || 'Impressora')
    : null;

  return {
    supported,
    connected: device !== null,
    connecting,
    printing,
    deviceName,
    error,
    connect,
    disconnect,
    print,
    printDay,
  };
}
