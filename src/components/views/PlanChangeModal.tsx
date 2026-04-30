import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2, Sparkles, Check, AlertTriangle, X, ArrowRight } from 'lucide-react';
import {
  changePlan,
  startCheckout,
  openPortal,
  BillingError,
  type ChangePlanResult,
  type ChangePlanTarget,
  type PlanTier,
} from '../../services/billingApi';
import { PRICING } from '../../data/pricing';
import { Modal, useModalTitleId } from '../Modal';

interface PlanChangeModalProps {
  open: boolean;
  onClose: () => void;
  currentPlan: PlanTier;
  willCancel: boolean;
  token: string | null;
  onSuccess: () => Promise<void>;
}

type Phase = 'select' | 'confirming' | 'success' | 'error';

interface PlanOption {
  target: ChangePlanTarget;
  label: string;
  priceBRL: number;
  pitch: string;
  warning?: string;
}

function getTargetOption(currentPlan: PlanTier): PlanOption | null {
  switch (currentPlan) {
    case 'pdv':
      return {
        target: 'bundle',
        label: 'Pacote Gestão + Atendimento',
        priceBRL: PRICING.bundle.priceBRL,
        pitch: `Adiciona o atendimento por WhatsApp com IA ao seu PDV. Pagamento único — economiza R$ 9/mês vs assinar separado.`,
      };
    case 'chat':
      return {
        target: 'bundle',
        label: 'Pacote Gestão + Atendimento',
        priceBRL: PRICING.bundle.priceBRL,
        pitch: `Mantém tudo do ZeloChat e adiciona o ZeloPDV completo. Pagamento único de R$ ${PRICING.bundle.priceBRL}/mês.`,
      };
    case 'bundle':
      return {
        target: 'chat',
        label: 'ZeloChat Pro',
        priceBRL: PRICING.chat.priceBRL,
        pitch: `Mantém o atendimento por WhatsApp com IA por R$ ${PRICING.chat.priceBRL}/mês.`,
        warning: 'Você perderá acesso ao ZeloPDV. Pedidos, gestão de estoque e relatórios deixam de funcionar.',
      };
  }
}

function planLabel(tier: PlanTier): string {
  if (tier === 'pdv') return 'ZeloPDV';
  if (tier === 'chat') return 'ZeloChat Pro';
  return 'Pacote Gestão + Atendimento';
}

export const PlanChangeModal = ({
  open,
  onClose,
  currentPlan,
  willCancel,
  token,
  onSuccess,
}: PlanChangeModalProps) => {
  const [phase, setPhase] = useState<Phase>('select');
  const [acknowledged, setAcknowledged] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [result, setResult] = useState<ChangePlanResult | null>(null);
  const [followUpBusy, setFollowUpBusy] = useState(false);
  const inFlightRef = useRef(false);

  // Reset state every time the modal reopens.
  useEffect(() => {
    if (open) {
      setPhase('select');
      setAcknowledged(false);
      setErrorMsg(null);
      setErrorCode(null);
      setResult(null);
      setFollowUpBusy(false);
      inFlightRef.current = false;
    }
  }, [open]);

  if (!open) return null;

  const option = getTargetOption(currentPlan);
  // Defensive: nothing useful to do for unsupported current plans.
  if (!option) {
    return (
      <ModalShell onClose={onClose} title="Mudar de plano">
        <p className="text-[13px] text-[var(--color-ink-muted)]">
          Não há troca de plano disponível para este caso. Use o portal do Stripe pra cancelar ou ajustar.
        </p>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[13px] font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-muted)] transition-colors"
          >
            Fechar
          </button>
        </div>
      </ModalShell>
    );
  }

  const needsAck = !!option.warning;

  const handleConfirm = async () => {
    if (inFlightRef.current) return;
    if (!token) {
      setErrorMsg('Sessão expirada. Faça login novamente.');
      setErrorCode(null);
      setPhase('error');
      return;
    }
    if (needsAck && !acknowledged) return;

    inFlightRef.current = true;
    setErrorMsg(null);
    setErrorCode(null);
    setPhase('confirming');
    try {
      const res = await changePlan(token, option.target);
      setResult(res);
      setPhase('success');
      void onSuccess();
    } catch (err) {
      if (err instanceof BillingError) {
        setErrorMsg(err.message);
        setErrorCode(err.code ?? null);
      } else {
        setErrorMsg('Não foi possível mudar de plano. Tente novamente.');
      }
      setPhase('error');
    } finally {
      inFlightRef.current = false;
    }
  };

  const handleOpenPortal = async () => {
    if (!token || followUpBusy) return;
    setFollowUpBusy(true);
    try {
      const res = await openPortal(token);
      window.location.href = res.url;
    } catch (err) {
      const msg = err instanceof BillingError ? err.message : 'Não foi possível abrir o portal.';
      setErrorMsg(msg);
      setFollowUpBusy(false);
    }
  };

  const handleStartCheckout = async () => {
    if (!token || followUpBusy) return;
    setFollowUpBusy(true);
    try {
      const res = await startCheckout(token, option.target);
      window.location.href = res.url;
    } catch (err) {
      const msg = err instanceof BillingError ? err.message : 'Não foi possível abrir o checkout.';
      setErrorMsg(msg);
      setFollowUpBusy(false);
    }
  };

  return (
    <ModalShell
      onClose={onClose}
      closeDisabled={phase === 'confirming'}
      title="Mudar de plano"
    >
      {phase === 'select' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg p-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-[var(--color-ink-faint)] font-semibold">Plano atual</p>
              <p className="text-[13.5px] font-semibold mt-0.5">{planLabel(currentPlan)}</p>
            </div>
            <ArrowRight className="w-4 h-4 text-[var(--color-ink-faint)]" strokeWidth={1.8} />
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wide text-[var(--color-ink-faint)] font-semibold">Novo plano</p>
              <p className="text-[13.5px] font-semibold mt-0.5">{option.label}</p>
            </div>
          </div>

          <div className="bg-[var(--color-brand-soft)]/40 border border-[var(--color-brand)]/20 rounded-lg p-3">
            <p className="text-[13px] font-semibold text-[var(--color-brand-deep)]">
              R$ {option.priceBRL}/mês
            </p>
            <p className="text-[12.5px] text-[var(--color-ink-soft)] mt-1 leading-relaxed">
              {option.pitch}
            </p>
          </div>

          {willCancel && (
            <div className="flex gap-2 bg-[var(--color-warn-soft)] border border-[var(--color-warn)]/20 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 text-[var(--color-warn)] flex-shrink-0 mt-0.5" strokeWidth={1.8} />
              <p className="text-[12.5px] text-[var(--color-warn)] leading-relaxed">
                Mudar de plano também reativa sua assinatura — o cancelamento agendado será desfeito.
              </p>
            </div>
          )}

          {option.warning && (
            <div className="bg-[var(--color-alert-soft)] border border-[var(--color-alert)]/20 rounded-lg p-3 space-y-2">
              <div className="flex gap-2">
                <AlertTriangle className="w-4 h-4 text-[var(--color-alert)] flex-shrink-0 mt-0.5" strokeWidth={1.8} />
                <p className="text-[12.5px] text-[var(--color-alert)] leading-relaxed">
                  {option.warning}
                </p>
              </div>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-0.5 accent-[var(--color-alert)]"
                />
                <span className="text-[12.5px] text-[var(--color-ink-soft)]">
                  Eu entendo e quero mudar mesmo assim.
                </span>
              </label>
            </div>
          )}

          <p className="text-[11.5px] text-[var(--color-ink-faint)]">
            A diferença é cobrada (ou creditada) proporcional aos dias restantes — aparece na sua próxima fatura, sem cobrança imediata.
          </p>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-[13px] font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-muted)] transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={needsAck && !acknowledged}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" strokeWidth={2} />
              Confirmar mudança
            </button>
          </div>
        </div>
      )}

      {phase === 'confirming' && (
        <div className="py-8 text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-[var(--color-brand)] mx-auto" strokeWidth={1.8} />
          <p className="text-[13.5px] font-semibold">Atualizando assinatura…</p>
          <p className="text-[12.5px] text-[var(--color-ink-muted)]">
            Não feche esta janela.
          </p>
        </div>
      )}

      {phase === 'success' && result && (
        <div className="space-y-4">
          <div className="text-center space-y-3 py-2">
            <div className="w-12 h-12 rounded-full bg-[var(--color-brand-soft)] flex items-center justify-center mx-auto">
              <Check className="w-6 h-6 text-[var(--color-brand-deep)]" strokeWidth={2.5} />
            </div>
            <p className="text-[14px] font-semibold">Plano atualizado para {planLabel(result.planTier)}.</p>
            <p className="text-[12.5px] text-[var(--color-ink-muted)] leading-relaxed">
              A diferença proporcional será aplicada na sua próxima fatura. Você não foi cobrado agora.
            </p>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-[13px] font-semibold text-white bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)] transition-colors"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div className="space-y-4">
          <div className="bg-[var(--color-alert-soft)] border border-[var(--color-alert)]/20 rounded-lg p-3">
            <div className="flex gap-2">
              <AlertTriangle className="w-4 h-4 text-[var(--color-alert)] flex-shrink-0 mt-0.5" strokeWidth={1.8} />
              <p className="text-[12.5px] text-[var(--color-alert)] font-medium leading-relaxed">
                {errorMsg ?? 'Algo deu errado. Tente novamente.'}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-[13px] font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-muted)] transition-colors"
            >
              Fechar
            </button>
            {errorCode === 'SUBSCRIPTION_PAYMENT_ISSUE' || errorCode === 'PAYMENT_ACTION_REQUIRED' ? (
              <button
                type="button"
                onClick={handleOpenPortal}
                disabled={followUpBusy}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)] disabled:opacity-60 transition-colors"
              >
                {followUpBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Abrir portal pra regularizar
              </button>
            ) : errorCode === 'SUBSCRIPTION_NOT_RESUMABLE' ? (
              <button
                type="button"
                onClick={handleStartCheckout}
                disabled={followUpBusy}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)] disabled:opacity-60 transition-colors"
              >
                {followUpBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Reativar via Checkout
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setPhase('select');
                  setErrorMsg(null);
                  setErrorCode(null);
                }}
                className="px-4 py-2 rounded-lg text-[13px] font-semibold text-white bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)] transition-colors"
              >
                Tentar novamente
              </button>
            )}
          </div>
        </div>
      )}
    </ModalShell>
  );
};

interface ModalShellProps {
  onClose: () => void;
  title: string;
  children: ReactNode;
  closeDisabled?: boolean;
}

function ModalShell({ onClose, title, children, closeDisabled = false }: ModalShellProps) {
  const titleId = useModalTitleId();
  const handleClose = () => {
    if (!closeDisabled) onClose();
  };

  return (
    <Modal
      open
      onClose={handleClose}
      titleId={titleId}
      disableEscape={closeDisabled}
      panelClassName="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-line)] shadow-xl"
    >
        <div className="flex items-center justify-between gap-4 border-b border-[var(--color-line)] px-5 py-4">
          <h3 id={titleId} className="text-[14px] font-semibold">{title}</h3>
          <button
            type="button"
            onClick={handleClose}
            disabled={closeDisabled}
            aria-label="Fechar"
            className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>
        <div className="p-5">{children}</div>
    </Modal>
  );
}
