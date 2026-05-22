import { type ReactNode, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Modal, useModalTitleId } from './Modal';

type Props = {
  open: boolean;
  title: string;
  message: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  confirmLabel?: string;
  confirmLoadingLabel?: string;
  destructive?: boolean;
  helperContent?: ReactNode;
};

export function ConfirmModal({
  open,
  title,
  message,
  onClose,
  onConfirm,
  confirmLabel = 'Confirmar',
  confirmLoadingLabel = 'Aguarde...',
  destructive = true,
  helperContent,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const titleId = useModalTitleId();

  useEffect(() => {
    if (open) setErr(null);
  }, [open]);

  if (!open) return null;

  const handleClose = () => {
    if (!loading) onClose();
  };

  const handleConfirm = async () => {
    setLoading(true);
    setErr(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ocorreu um erro. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      titleId={titleId}
      disableEscape={loading}
      panelClassName="rounded-2xl bg-white shadow-xl"
    >
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 p-5">
          <h3 id={titleId} className="text-base font-bold text-gray-800">{title}</h3>
          <button
            onClick={handleClose}
            disabled={loading}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">
          <p className="text-sm text-gray-700">{message}</p>
          {helperContent ? <div className="mt-3">{helperContent}</div> : null}
          {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
          <div className="mt-6 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={loading}
              className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-gray-300 ${
                destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-[#25D366] hover:bg-[#1EBE5D]'
              }`}
            >
              {loading ? confirmLoadingLabel : confirmLabel}
            </button>
          </div>
        </div>
    </Modal>
  );
}
