import { useState } from 'react';
import { ZELO_IMPRESSAO_DOWNLOAD_PAGE_URL, ZELO_IMPRESSAO_INSTALLER_DOWNLOAD_URL } from '@zelo/impressao-client';
import { Loader2, Printer, PrinterCheck } from 'lucide-react';
import type { UsePrinterReturn } from '../hooks/usePrinter';
import type { Order } from '../types';

interface PrinterButtonProps {
  printer: UsePrinterReturn;
  expanded: boolean;
  testOrder?: Order;
}

export function PrinterButton({ printer, expanded, testOrder }: PrinterButtonProps) {
  const { supported, connected, connecting, printing, deviceName, error, connect } = printer;
  const [pairCode, setPairCode] = useState('');
  const [pairing, setPairing] = useState(false);

  if (!supported) return null;

  async function submitPair() {
    if (!pairCode.trim()) return;
    setPairing(true);
    try {
      await printer.pair(pairCode.trim());
      setPairCode('');
    } finally {
      setPairing(false);
    }
  }

  if (!connected && !connecting) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={connect}
        title={!expanded ? 'Conectar impressora' : undefined}
        className={`w-full flex items-center rounded-[10px] transition-all text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)] ${
          expanded ? 'gap-3 px-3 py-2.5' : 'justify-center px-0 py-2.5'
        }`}
      >
        <Printer className="w-[18px] h-[18px] flex-shrink-0" strokeWidth={1.8} />
        {expanded && (
          <div className="flex-1 text-left overflow-hidden">
            <p className="text-[13.5px] font-medium leading-tight">
              {error ? 'Zelo Impressão offline' : 'Impressão automática'}
            </p>
            {error && (
              <p className="text-[11px] text-red-400 truncate mt-[-1px]">{error}</p>
            )}
            {error?.includes('código') && (
              <div className="mt-2 flex gap-1.5">
                <input
                  value={pairCode}
                  onChange={(event) => setPairCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Código"
                  inputMode="numeric"
                  className="min-w-0 flex-1 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 text-[12px] text-[var(--color-ink)]"
                />
                <button
                  type="button"
                  onClick={(event) => { event.stopPropagation(); void submitPair(); }}
                  disabled={pairing || pairCode.length < 6}
                  className="rounded-md bg-[var(--color-brand)] px-2 py-1 text-[12px] font-semibold text-white disabled:opacity-50"
                >
                  {pairing ? '...' : 'OK'}
                </button>
              </div>
            )}
            {error && !error.includes('código') && (
              <div className="mt-2 flex flex-wrap gap-2">
                <a
                  href={ZELO_IMPRESSAO_INSTALLER_DOWNLOAD_URL}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => event.stopPropagation()}
                  className="rounded-md bg-[var(--color-brand)] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:opacity-90"
                >
                  Baixar app
                </a>
                <a
                  href={ZELO_IMPRESSAO_DOWNLOAD_PAGE_URL}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => event.stopPropagation()}
                  className="rounded-md border border-[var(--color-line)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface)]"
                >
                  Como instalar
                </a>
              </div>
            )}
          </div>
        )}
        {!expanded && (
          <span className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-md bg-[var(--color-ink)] px-2.5 py-1.5 text-[12px] font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
            Impressão automática
          </span>
        )}
      </div>
    );
  }

  if (connecting) {
    return (
      <div className={`w-full flex items-center text-[var(--color-ink-muted)] ${
        expanded ? 'gap-3 px-3 py-2.5' : 'justify-center px-0 py-2.5'
      }`}>
        <Loader2 className="w-[18px] h-[18px] flex-shrink-0 animate-spin" strokeWidth={1.8} />
        {expanded && <p className="text-[13.5px] font-medium">Verificando...</p>}
      </div>
    );
  }

  // Connected
  return (
    <div className={`w-full flex items-center rounded-[10px] ${
      expanded ? 'gap-3 px-3 py-2.5' : 'justify-center px-0 py-2.5'
    }`}>
      {printing
        ? <Loader2 className="w-[18px] h-[18px] flex-shrink-0 animate-spin text-[var(--color-brand)]" strokeWidth={1.8} />
        : <PrinterCheck className="w-[18px] h-[18px] flex-shrink-0 text-emerald-500" strokeWidth={1.8} />
      }
      {expanded && (
        <div className="flex-1 overflow-hidden">
          <p className="text-[13.5px] font-medium leading-tight text-[var(--color-ink)] truncate">
            {printing ? 'Imprimindo…' : (deviceName ?? 'Zelo Impressão')}
          </p>
          {error && !printing && (
            <p className="text-[11px] text-red-400 mt-[-1px] line-clamp-2" title={error}>{error}</p>
          )}
          {testOrder && !printing && (
            <button
              onClick={() => { void printer.print(testOrder).catch(() => { /* erro já está em printer.error */ }); }}
              className="text-[11px] text-[var(--color-brand)] hover:underline mt-[-1px]"
            >
              Imprimir teste
            </button>
          )}
        </div>
      )}
    </div>
  );
}
