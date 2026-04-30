import { useEffect, useId, useRef, type ReactNode } from 'react';

interface ModalProps {
  /** Whether the modal is visible. When false the modal is unmounted. */
  open: boolean;
  /** Called when the user clicks the backdrop or presses Escape. */
  onClose: () => void;
  /** Content of the modal. */
  children: ReactNode;
  /**
   * Optional id for the modal's title element. When provided the modal sets
   * aria-labelledby to this id. If omitted a stable auto-generated id is used
   * — pass it to the heading element via the render prop pattern below.
   */
  titleId?: string;
  /** Classes applied to the fixed root wrapper. Defaults to centered modal layout. */
  containerClassName?: string;
  /** Classes applied to the backdrop element. */
  backdropClassName?: string;
  /** Width/position classes applied before panelClassName. */
  panelLayoutClassName?: string;
  /** Extra classes applied to the inner panel wrapper. */
  panelClassName?: string;
  /** When true, pressing Escape does NOT close the modal (e.g. mid-async call). */
  disableEscape?: boolean;
}

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Accessible modal primitive.
 *
 * Provides:
 * - role="dialog" + aria-modal="true"
 * - aria-labelledby wired to a stable title id (use the exported `useTitleId` or pass `titleId`)
 * - Escape-to-close (unless `disableEscape` is true)
 * - Focus trap (Tab / Shift+Tab cycle within the modal)
 * - Return focus to the previously focused element on unmount
 * - Backdrop click closes (calls onClose)
 *
 * Usage:
 * ```tsx
 * const titleId = useModalTitleId();
 * <Modal open={open} onClose={onClose} titleId={titleId}>
 *   <h3 id={titleId}>Título do modal</h3>
 *   ...
 * </Modal>
 * ```
 */
export function Modal({
  open,
  onClose,
  children,
  titleId: externalTitleId,
  containerClassName = 'fixed inset-0 z-50 flex items-center justify-center p-4',
  backdropClassName = 'absolute inset-0 bg-black/40',
  panelLayoutClassName = 'w-full max-w-md',
  panelClassName = '',
  disableEscape = false,
}: ModalProps) {
  const autoTitleId = useId();
  const titleId = externalTitleId ?? autoTitleId;

  const panelRef = useRef<HTMLDivElement>(null);
  // Remember the element that had focus before the modal opened so we can
  // restore it when the modal closes (WCAG 2.4.3 Focus Order).
  const previousFocusRef = useRef<Element | null>(null);

  // Capture active element on mount; restore on unmount.
  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement;
    // Focus the first focusable element inside the modal on next tick so
    // the DOM is painted before we query.
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const first = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTORS);
      first?.focus();
    });
    return () => {
      cancelAnimationFrame(raf);
      // Restore focus when modal closes.
      const prev = previousFocusRef.current;
      if (prev instanceof HTMLElement) {
        prev.focus();
      }
    };
  }, [open]);

  // Escape-to-close listener.
  useEffect(() => {
    if (!open || disableEscape) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose, disableEscape]);

  // Focus trap: intercept Tab and Shift+Tab to cycle within the modal.
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll(FOCUSABLE_SELECTORS))
        .filter((node): node is HTMLElement => node instanceof HTMLElement);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  if (!open) return null;

  return (
    <div className={containerClassName}>
      {/* Backdrop */}
      <div
        className={backdropClassName}
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative ${panelLayoutClassName} ${panelClassName}`}
        // Prevent backdrop click from firing when clicking inside the panel.
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Convenience hook that returns a stable id string for wiring the modal title
 * to `aria-labelledby`. Use the returned id on the heading element inside the
 * modal and pass it to `<Modal titleId={...}>`.
 */
export function useModalTitleId(): string {
  return useId();
}
