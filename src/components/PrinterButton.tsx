import { Loader2, Printer, PrinterCheck, WifiOff } from 'lucide-react';
import type { UsePrinterReturn } from '../hooks/usePrinter';
import type { Order } from '../types';

interface PrinterButtonProps {
  printer: UsePrinterReturn;
  expanded: boolean;
  testOrder?: Order;
}

export function PrinterButton({ printer, expanded, testOrder }: PrinterButtonProps) {
  const { supported, connected, connecting, printing, deviceName, error, connect } = printer;

  if (!supported) return null;

  if (!connected && !connecting) {
    return (
      <button
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
              {error ? 'Erro — tentar novamente' : 'Conectar impressora'}
            </p>
            {error && (
              <p className="text-[11px] text-red-400 truncate mt-[-1px]">{error}</p>
            )}
          </div>
        )}
        {!expanded && (
          <span className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-md bg-[var(--color-ink)] px-2.5 py-1.5 text-[12px] font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
            Conectar impressora
          </span>
        )}
      </button>
    );
  }

  if (connecting) {
    return (
      <div className={`w-full flex items-center text-[var(--color-ink-muted)] ${
        expanded ? 'gap-3 px-3 py-2.5' : 'justify-center px-0 py-2.5'
      }`}>
        <Loader2 className="w-[18px] h-[18px] flex-shrink-0 animate-spin" strokeWidth={1.8} />
        {expanded && <p className="text-[13.5px] font-medium">Conectando...</p>}
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
            {printing ? 'Imprimindo…' : (deviceName ?? 'Impressora')}
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
