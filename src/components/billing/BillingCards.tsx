import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, Check, Lock, Sparkles, ArrowRightLeft, UserCog, QrCode, Copy, CheckCheck, X, ChevronRight } from 'lucide-react';
import { type ZeloChatSubscription } from '../../hooks/useSubscription';
import { startCheckout, openPortal, BillingError, createPixCharge, getPixStatus } from '../../services/billingApi';
import { PRICING } from '../../data/pricing';

// ---------------------------------------------------------------------------
// PixPaymentModal
// ---------------------------------------------------------------------------

type PixStep = 'plan' | 'qr';

interface PixModalProps {
  open: boolean;
  onClose: () => void;
  token: string | null;
  initialPlan?: 'chat' | 'bundle';
  hasPdvOnly?: boolean;
  onSuccess: () => void;
}

export const PixPaymentModal = ({ open, onClose, token, initialPlan, hasPdvOnly, onSuccess }: PixModalProps) => {
  const [step, setStep] = useState<PixStep>(initialPlan ? 'qr' : 'plan');
  const [selectedPlan, setSelectedPlan] = useState<'chat' | 'bundle'>(initialPlan ?? 'chat');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [pixCopyPaste, setPixCopyPaste] = useState<string | null>(null);
  const [pixQrCode, setPixQrCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    setStep(initialPlan ? 'qr' : 'plan');
    setSelectedPlan(initialPlan ?? 'chat');
    setLoading(false);
    setError(null);
    setPaymentId(null);
    setPixCopyPaste(null);
    setPixQrCode(null);
    setExpiresAt(null);
    setCopied(false);
    setSecondsLeft(0);
    if (pollRef.current) clearTimeout(pollRef.current);
  }, [initialPlan]);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  // Countdown timer
  useEffect(() => {
    if (!expiresAt || step !== 'qr') return;
    const tick = () => {
      const left = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(left);
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [expiresAt, step]);

  // Polling
  const schedulePoll = useCallback((pid: string) => {
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = setTimeout(async () => {
      if (!token) return;
      try {
        const s = await getPixStatus(token, pid);
        if (s.status === 'completed') {
          onSuccess();
          onClose();
          return;
        }
        if (s.status === 'pending') {
          schedulePoll(pid);
        }
        // expired/failed — leave QR visible, user can close
      } catch {
        schedulePoll(pid); // retry silently
      }
    }, 10_000);
  }, [token, onSuccess, onClose]);

  useEffect(() => {
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, []);

  const handleGenerateQr = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const result = await createPixCharge(token, selectedPlan);
      setPaymentId(result.paymentId);
      setPixCopyPaste(result.pixCopyPaste);
      setPixQrCode(result.pixQrCode);
      setExpiresAt(result.expiresAt);
      setStep('qr');
      schedulePoll(result.paymentId);
    } catch (err) {
      const msg = err instanceof BillingError ? err.message : 'Não foi possível gerar o Pix. Tente novamente.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!pixCopyPaste) return;
    await navigator.clipboard.writeText(pixCopyPaste).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const expired = secondsLeft === 0 && !!expiresAt;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full sm:max-w-sm bg-[var(--color-surface)] rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 sm:p-6 mx-0 sm:mx-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center">
              <QrCode className="w-4 h-4 text-green-600" strokeWidth={2} />
            </div>
            <h2 className="text-[15px] font-semibold">Pagar com Pix</h2>
          </div>
          <button type="button" onClick={onClose} className="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] transition-colors p-1 rounded-lg hover:bg-[var(--color-surface-muted)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step 1: Plan selection */}
        {step === 'plan' && (
          <div className="space-y-4">
            {hasPdvOnly && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                <p className="text-[12px] text-amber-800 leading-relaxed">
                  Você já tem o <strong>ZeloPDV ativo</strong>. Escolha o plano — o Plano Completo inclui PDV + ZeloChat.
                </p>
              </div>
            )}

            <p className="text-[13px] text-[var(--color-ink-muted)]">Selecione o plano e gere o QR Code para pagar:</p>

            <div className="space-y-2">
              {(['chat', 'bundle'] as const).map((plan) => (
                <button
                  key={plan}
                  type="button"
                  onClick={() => setSelectedPlan(plan)}
                  className={`w-full text-left p-3 rounded-xl border-2 transition-all ${
                    selectedPlan === plan
                      ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)]'
                      : 'border-[var(--color-line)] hover:border-[var(--color-brand)]/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[13.5px] font-semibold">{PRICING[plan].label}</p>
                      <p className="text-[11.5px] text-[var(--color-ink-muted)] mt-0.5">
                        {plan === 'bundle'
                          ? 'PDV + Atendimento WhatsApp com IA · 30 dias'
                          : 'Atendimento WhatsApp com IA · 30 dias'}
                      </p>
                    </div>
                    <div className="text-right ml-3 flex-shrink-0">
                      <p className="text-[14px] font-bold text-[var(--color-ink)]">R$ {PRICING[plan].priceBRL}</p>
                      <p className="text-[10.5px] text-[var(--color-ink-faint)]">/mês</p>
                    </div>
                  </div>
                  {plan === 'bundle' && (
                    <p className="text-[11px] text-green-700 font-medium mt-1.5">
                      ✓ Economiza R$ 9/mês em vez de assinar separado
                    </p>
                  )}
                </button>
              ))}
            </div>

            {error && (
              <p className="text-[12px] text-[var(--color-alert)] bg-[var(--color-alert-soft)] rounded-lg px-3 py-2">{error}</p>
            )}

            <button
              type="button"
              onClick={handleGenerateQr}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white py-2.5 rounded-xl text-[13.5px] font-semibold transition-colors"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
              {loading ? 'Gerando cobrança…' : `Gerar Pix · R$ ${PRICING[selectedPlan].priceBRL}`}
            </button>
          </div>
        )}

        {/* Step 2: QR Code */}
        {step === 'qr' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-[13px] text-[var(--color-ink-muted)]">
                <strong>{PRICING[selectedPlan].label}</strong> · R$ {PRICING[selectedPlan].priceBRL}/mês
              </p>
              {secondsLeft > 0 && (
                <span className={`text-[12px] font-mono font-semibold px-2 py-0.5 rounded-full ${
                  secondsLeft < 120 ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'
                }`}>
                  {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
                </span>
              )}
              {expired && (
                <span className="text-[12px] font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Expirado</span>
              )}
            </div>

            {pixQrCode && !expired ? (
              <div className="flex justify-center">
                <img
                  src={`data:image/png;base64,${pixQrCode}`}
                  alt="QR Code Pix"
                  className="w-44 h-44 rounded-xl border border-[var(--color-line)]"
                />
              </div>
            ) : expired ? (
              <div className="flex flex-col items-center gap-2 py-6">
                <p className="text-[13px] text-[var(--color-ink-muted)]">O QR Code expirou.</p>
                <button
                  type="button"
                  onClick={() => { reset(); }}
                  className="text-[13px] font-semibold text-[var(--color-brand)] hover:underline"
                >
                  Gerar novo Pix
                </button>
              </div>
            ) : null}

            {pixCopyPaste && !expired && (
              <div className="space-y-2">
                <p className="text-[11.5px] text-[var(--color-ink-muted)] text-center">ou use o código copia e cola:</p>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="w-full flex items-center gap-2 bg-[var(--color-surface-muted)] hover:bg-[var(--color-line)] border border-[var(--color-line)] rounded-xl px-3 py-2.5 transition-colors"
                >
                  <span className="flex-1 text-[11.5px] font-mono text-[var(--color-ink-soft)] text-left truncate">{pixCopyPaste}</span>
                  {copied
                    ? <CheckCheck className="w-4 h-4 text-green-600 flex-shrink-0" />
                    : <Copy className="w-4 h-4 text-[var(--color-ink-muted)] flex-shrink-0" />}
                </button>
                {copied && <p className="text-[11.5px] text-green-600 text-center font-medium">Copiado!</p>}
              </div>
            )}

            {!expired && (
              <div className="flex items-center gap-2 text-[11.5px] text-[var(--color-ink-faint)]">
                <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
                <span>Aguardando pagamento… a tela atualiza automaticamente.</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// SubscriptionPaywall
// ---------------------------------------------------------------------------

/**
 * Locked state when there's no active ZeloChat subscription. Renders inside
 * `WhatsAppIntegrationCard` (because connecting WhatsApp requires a paid plan)
 * and acts as the upsell surface. Caller wraps in its own card chrome.
 */
export const SubscriptionPaywall = ({
  subscription,
  hasPdvOnly,
  token,
  onPlanChange,
}: {
  subscription: ZeloChatSubscription | null;
  hasPdvOnly: boolean;
  token: string | null;
  onPlanChange: () => void;
}) => {
  const status = subscription?.status;
  const [busy, setBusy] = useState<'checkout' | 'portal' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pixOpen, setPixOpen] = useState(false);

  // P1.28/P1.29 — 'trialing' goes to portal to convert trial to paid (Stripe).
  // 'paused' also goes to portal where Stripe lets the user resume.
  const needsPortal = status === 'past_due' || status === 'unpaid' || status === 'paused';

  // Variante 1: user tem PDV ativo → upsell pro Pacote Gestão + Atendimento.
  // Primary CTA: Stripe change-plan. Secondary: Pix.
  if (hasPdvOnly) {
    return (
      <>
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-[var(--color-brand-soft)] flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-5 h-5 text-[var(--color-brand-deep)]" strokeWidth={1.8} />
            </div>
            <div className="flex-1">
              <p className="text-[14px] font-semibold leading-snug">Você já tem o ZeloPDV. Adicione o Atendimento.</p>
              <p className="text-[12.5px] text-[var(--color-ink-muted)] mt-1 leading-relaxed">
                Faça upgrade para o <strong>Pacote Gestão + Atendimento</strong> e tenha PDV completo + IA no WhatsApp por
                <strong> R$ {PRICING.bundle.priceBRL}/mês</strong> — você economiza <strong>R$ 9/mês</strong> em vez de assinar separado.
              </p>
            </div>
          </div>

          <ul className="space-y-2 bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg p-3">
            {[
              'Mantém tudo que você já tem do ZeloPDV',
              'Adiciona atendimento ilimitado pelo WhatsApp com IA',
              'Cardápio sincronizado automaticamente',
              'Cancela quando quiser, sem fidelidade',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2 text-[12.5px] text-[var(--color-ink-soft)]">
                <Check className="w-3.5 h-3.5 text-[var(--color-brand)] mt-0.5 flex-shrink-0" strokeWidth={2.5} />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={onPlanChange}
            className="w-full flex items-center justify-center gap-2 bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)] text-white py-2.5 rounded-lg text-[13.5px] font-semibold transition-colors"
          >
            <Sparkles className="w-4 h-4" strokeWidth={2} />
            Upgrade para Pacote Gestão + Atendimento
          </button>

          <button
            type="button"
            onClick={() => setPixOpen(true)}
            className="w-full flex items-center justify-center gap-2 bg-[var(--color-surface-muted)] hover:bg-[var(--color-line)] border border-[var(--color-line)] text-[var(--color-ink)] py-2 rounded-lg text-[13px] font-medium transition-colors"
          >
            <QrCode className="w-4 h-4 text-green-600" strokeWidth={2} />
            Prefiro pagar com Pix
          </button>

          <p className="text-[11.5px] text-[var(--color-ink-faint)] text-center">
            R$ {PRICING.bundle.priceBRL}/mês total · proporção do mês atual cobrada · cancele quando quiser
          </p>
        </div>

        <PixPaymentModal
          open={pixOpen}
          onClose={() => setPixOpen(false)}
          token={token}
          initialPlan="bundle"
          hasPdvOnly={true}
          onSuccess={() => { setPixOpen(false); window.location.reload(); }}
        />
      </>
    );
  }

  // Variante 2: user sem subscription ativa OU em status problemático.
  const headline = (() => {
    if (!subscription) return 'Ative o ZeloChat para conectar o WhatsApp';
    if (status === 'past_due' || status === 'unpaid') return 'Sua assinatura está com pagamento pendente';
    if (status === 'canceled' || status === 'incomplete_expired') return 'Sua assinatura foi encerrada';
    if (status === 'paused') return 'Sua assinatura está pausada';
    if (status === 'trialing') return 'Você está em período de avaliação';
    if (status === 'incomplete') return 'Finalize a ativação da sua assinatura';
    return 'Ative o ZeloChat para conectar o WhatsApp';
  })();

  const subline = (() => {
    if (status === 'past_due' || status === 'unpaid') {
      return 'Regularize o pagamento para reconectar o WhatsApp e voltar a atender clientes pela IA.';
    }
    if (status === 'paused') {
      return 'Sua assinatura está pausada. Clique abaixo para reativá-la e voltar a atender clientes.';
    }
    if (status === 'trialing') {
      return 'Você está em período de avaliação. Assine agora para garantir acesso contínuo ao ZeloChat.';
    }
    if (status === 'canceled' || status === 'incomplete_expired') {
      return 'Reative seu plano para conectar o WhatsApp e continuar usando a IA do ZeloChat.';
    }
    return 'Você pode configurar tudo agora — produtos, horários e a personalidade da IA. Para conectar o WhatsApp e começar a atender, ative o plano ZeloChat Pro.';
  })();

  const handleStripeClick = async () => {
    setError(null);
    if (!token) { setError('Sessão expirada. Faça login novamente.'); return; }
    const target = needsPortal ? 'portal' : 'checkout';
    setBusy(target);
    try {
      const result = target === 'portal' ? await openPortal(token) : await startCheckout(token, 'chat');
      window.location.href = result.url;
    } catch (err) {
      if (err instanceof BillingError && err.code === 'PDV_UPGRADE_AVAILABLE') {
        setBusy(null);
        onPlanChange();
        return;
      }
      if (err instanceof BillingError && err.code === 'TRIALING_USE_PORTAL') {
        window.location.reload();
        return;
      }
      const msg = err instanceof BillingError ? err.message : 'Não foi possível abrir o pagamento. Tente novamente.';
      setError(msg);
      setBusy(null);
    }
  };

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-[var(--color-brand-soft)] flex items-center justify-center flex-shrink-0">
            <Lock className="w-5 h-5 text-[var(--color-brand-deep)]" strokeWidth={1.8} />
          </div>
          <div className="flex-1">
            <p className="text-[14px] font-semibold leading-snug">{headline}</p>
            <p className="text-[12.5px] text-[var(--color-ink-muted)] mt-1 leading-relaxed">{subline}</p>
          </div>
        </div>

        <ul className="space-y-2 bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg p-3">
          {[
            'Atendimento ilimitado pelo WhatsApp com IA',
            'Kanban de produção e gestão de motoboys',
            'Cardápio sincronizado com o Zelo PDV',
            'Sem fidelidade — cancele quando quiser',
          ].map((item) => (
            <li key={item} className="flex items-start gap-2 text-[12.5px] text-[var(--color-ink-soft)]">
              <Check className="w-3.5 h-3.5 text-[var(--color-brand)] mt-0.5 flex-shrink-0" strokeWidth={2.5} />
              <span>{item}</span>
            </li>
          ))}
        </ul>

        {error && (
          <div className="bg-[var(--color-alert-soft)] border border-[var(--color-alert)]/20 rounded-lg p-3">
            <p className="text-[12.5px] text-[var(--color-alert)] font-medium">{error}</p>
          </div>
        )}

        {/* Stripe — primary CTA (hidden for trialing since they can go straight to Pix) */}
        {!needsPortal && status !== 'trialing' && (
          <button
            type="button"
            onClick={handleStripeClick}
            disabled={busy !== null}
            className="w-full flex items-center justify-center gap-2 bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)] disabled:opacity-60 disabled:cursor-not-allowed text-white py-2.5 rounded-lg text-[13.5px] font-semibold transition-colors"
          >
            {busy === 'checkout' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" strokeWidth={2} />}
            {busy === 'checkout' ? 'Abrindo pagamento…' : 'Ativar ZeloChat Pro · Cartão'}
          </button>
        )}

        {needsPortal && (
          <button
            type="button"
            onClick={handleStripeClick}
            disabled={busy !== null}
            className="w-full flex items-center justify-center gap-2 bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)] disabled:opacity-60 disabled:cursor-not-allowed text-white py-2.5 rounded-lg text-[13.5px] font-semibold transition-colors"
          >
            {busy === 'portal' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" strokeWidth={2} />}
            {busy === 'portal' ? 'Abrindo portal…' : status === 'paused' ? 'Reativar plano' : 'Regularizar pagamento'}
          </button>
        )}

        {/* Pix — always shown as primary CTA for trialing, secondary otherwise */}
        <button
          type="button"
          onClick={() => setPixOpen(true)}
          className={`w-full flex items-center justify-center gap-2 transition-colors rounded-lg text-[13.5px] font-semibold py-2.5 ${
            status === 'trialing' || !subscription
              ? 'bg-green-600 hover:bg-green-700 text-white'
              : 'bg-[var(--color-surface-muted)] hover:bg-[var(--color-line)] border border-[var(--color-line)] text-[var(--color-ink)]'
          }`}
        >
          <QrCode className="w-4 h-4" strokeWidth={2} />
          {status === 'trialing' || !subscription ? 'Ativar ZeloChat Pro · Pix' : 'Pagar com Pix'}
        </button>

        <p className="text-[11.5px] text-[var(--color-ink-faint)] text-center">
          R$ {PRICING.chat.priceBRL}/mês · Sem fidelidade · Cancele a qualquer momento
        </p>
      </div>

      <PixPaymentModal
        open={pixOpen}
        onClose={() => setPixOpen(false)}
        token={token}
        hasPdvOnly={false}
        onSuccess={() => { setPixOpen(false); window.location.reload(); }}
      />
    </>
  );
};

// ---------------------------------------------------------------------------
// BillingManagementCard
// ---------------------------------------------------------------------------

/**
 * Active-subscription management surface (plan name, next charge, change plan,
 * Stripe portal). Returns inner content only — caller wraps with whatever card
 * chrome fits the surrounding page.
 */
export const BillingManagementCard = ({
  subscription,
  token,
  onPlanChange,
}: {
  subscription: ZeloChatSubscription | null;
  token: string | null;
  onPlanChange: () => void;
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!subscription) return null;

  const planLabel = subscription.plan_tier === 'bundle' ? 'Pacote Gestão + Atendimento' : 'ZeloChat Pro';
  const periodEnd = subscription.manually_extended_until ?? subscription.current_period_end;
  const periodEndFmt = periodEnd
    ? new Date(periodEnd).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
    : null;
  const willCancel = !!subscription.cancel_at_period_end;
  const canChangePlan =
    subscription.status === 'active' &&
    (subscription.plan_tier === 'chat' || subscription.plan_tier === 'bundle');

  const STATUS_LABEL: Record<string, string> = {
    active: 'Ativo',
    trialing: 'Em avaliação',
    paused: 'Pausado',
    past_due: 'Pagamento pendente',
    unpaid: 'Pagamento pendente',
    canceled: 'Cancelado',
    incomplete: 'Pendente',
    incomplete_expired: 'Expirado',
  };
  const badgeClass = subscription.status === 'active'
    ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]'
    : subscription.status === 'paused' || subscription.status === 'trialing'
      ? 'bg-amber-50 text-amber-700'
      : 'bg-red-50 text-red-700';

  const handleOpenPortal = async () => {
    if (!token) { setError('Sessão expirada. Faça login novamente.'); return; }
    setError(null);
    setBusy(true);
    try {
      const result = await openPortal(token);
      window.location.href = result.url;
    } catch (err) {
      const msg = err instanceof BillingError ? err.message : 'Não foi possível abrir o portal. Tente novamente.';
      setError(msg);
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[14px] font-semibold leading-snug">{planLabel}</p>
          <p className="text-[12.5px] text-[var(--color-ink-muted)] mt-0.5">
            {willCancel
              ? `Cancela em ${periodEndFmt ?? 'breve'} — você ainda pode reativar.`
              : periodEndFmt
                ? `Próxima cobrança em ${periodEndFmt}.`
                : 'Plano ativo.'}
          </p>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-2 py-1 rounded-full ${badgeClass}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
          {STATUS_LABEL[subscription.status] ?? subscription.status}
        </span>
      </div>

      {error && (
        <div className="bg-[var(--color-alert-soft)] border border-[var(--color-alert)]/20 rounded-lg p-3">
          <p className="text-[12.5px] text-[var(--color-alert)] font-medium">{error}</p>
        </div>
      )}

      {canChangePlan && (
        <button
          type="button"
          onClick={onPlanChange}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 bg-[var(--color-brand-soft)] hover:bg-[var(--color-brand-soft)]/80 disabled:opacity-60 text-[var(--color-brand-deep)] py-2.5 rounded-lg text-[13.5px] font-semibold transition-colors border border-[var(--color-brand)]/20"
        >
          <ArrowRightLeft className="w-4 h-4" strokeWidth={1.8} />
          Mudar de plano
        </button>
      )}

      <button
        type="button"
        onClick={handleOpenPortal}
        disabled={busy}
        className="w-full flex items-center justify-center gap-2 bg-[var(--color-surface-muted)] hover:bg-[var(--color-line)] disabled:opacity-60 text-[var(--color-ink)] py-2.5 rounded-lg text-[13.5px] font-semibold transition-colors border border-[var(--color-line)]"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCog className="w-4 h-4" strokeWidth={1.8} />}
        {busy ? 'Abrindo portal…' : 'Gerenciar pagamento e cancelamento'}
      </button>

      <p className="text-[11px] text-[var(--color-ink-faint)] text-center">
        Cartão, faturas e cancelamento ficam no portal seguro do Stripe.
      </p>
    </div>
  );
};
