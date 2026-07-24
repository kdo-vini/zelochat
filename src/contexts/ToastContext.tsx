import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

/**
 * P1 (CODE_REVIEW.md §"Frontend swallows every error silently") — minimal
 * in-app toast system. Used to surface delete/update failures, optimistic-
 * rollback warnings, and non-critical info. The previous pattern
 * `void X.catch(() => {})` ate every error; operators thought the action
 * worked and discovered later via refresh that nothing happened.
 *
 * Usage:
 *   const toast = useToast();
 *   toast.success('Pedido excluído');
 *   toast.error('Falha ao excluir — tente novamente');
 *   toast.info('Sincronizando…');
 *
 * Toasts auto-dismiss after 4s (8s for errors). Stacked top-right; max 5 at
 * a time (oldest is dropped when overflowing).
 *
 * Do NOT use this for system-level browser notifications — those go through
 * `useNotifications` (chrome notification API). This is purely an in-app
 * visual feedback layer.
 */

type ToastVariant = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  variant: ToastVariant;
  message: string;
}

interface ToastContextValue {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const MAX_VISIBLE = 5;
const TTL_BY_VARIANT: Record<ToastVariant, number> = {
  success: 4000,
  info: 4000,
  error: 8000,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counterRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((variant: ToastVariant, message: string) => {
    const id = ++counterRef.current;
    setToasts((prev) => {
      const next = [...prev, { id, variant, message }];
      return next.length > MAX_VISIBLE ? next.slice(next.length - MAX_VISIBLE) : next;
    });
    setTimeout(() => dismiss(id), TTL_BY_VARIANT[variant]);
  }, [dismiss]);

  const value: ToastContextValue = {
    success: useCallback((m: string) => show('success', m), [show]),
    error: useCallback((m: string) => show('error', m), [show]),
    info: useCallback((m: string) => show('info', m), [show]),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }
  return ctx;
}

interface ContainerProps {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

function ToastContainer({ toasts, onDismiss }: ContainerProps) {
  return (
    <div className="fixed inset-x-4 top-4 z-[100] flex flex-col gap-2 pointer-events-none sm:inset-x-auto sm:right-4 sm:max-w-sm">
      <AnimatePresence>
        {toasts.map((t) => (
          // wrapper div carries the React `key`; ToastItem doesn't need it in its props type
          <div key={t.id}>
            <ToastItem toast={t} onDismiss={() => onDismiss(t.id)} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}

interface ItemProps {
  toast: Toast;
  onDismiss: () => void;
}

function ToastItem({ toast, onDismiss }: ItemProps) {
  const palette = {
    success: { ring: 'ring-emerald-200', bg: 'bg-emerald-50', text: 'text-emerald-900', Icon: CheckCircle2, iconClass: 'text-emerald-500' },
    error:   { ring: 'ring-red-200',     bg: 'bg-red-50',     text: 'text-red-900',     Icon: AlertCircle,  iconClass: 'text-red-500' },
    info:    { ring: 'ring-sky-200',     bg: 'bg-sky-50',     text: 'text-sky-900',     Icon: Info,         iconClass: 'text-sky-500' },
  }[toast.variant];

  const { Icon } = palette;

  return (
    <motion.div
      initial={{ opacity: 0, x: 20, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 20, scale: 0.96 }}
      transition={{ duration: 0.18 }}
      className={`pointer-events-auto flex items-start gap-3 rounded-xl ${palette.bg} ${palette.text} ring-1 ${palette.ring} px-4 py-3 shadow-lg`}
      role="status"
      aria-live="polite"
    >
      <Icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${palette.iconClass}`} strokeWidth={2.2} />
      <p className="text-[13px] leading-snug flex-1">{toast.message}</p>
      <button
        onClick={onDismiss}
        className="text-current opacity-50 hover:opacity-100 transition-opacity"
        aria-label="Fechar notificação"
      >
        <X className="w-4 h-4" strokeWidth={2.2} />
      </button>
    </motion.div>
  );
}
