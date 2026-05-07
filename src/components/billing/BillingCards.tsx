import React, { useState } from 'react';
import { Loader2, Check, Lock, Sparkles, ArrowRightLeft, UserCog } from 'lucide-react';
import { type ZeloChatSubscription } from '../../hooks/useSubscription';
import { startCheckout, openPortal, BillingError } from '../../services/billingApi';
import { PRICING } from '../../data/pricing';

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
  const [busy, setBusy] = useState<'checkout' | 'portal' | 'upgrade' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // P1.28/P1.29 — 'trialing' goes to portal to convert trial to paid (not checkout,
  // which would create a duplicate subscription). 'paused' also goes to portal where
  // Stripe lets the user resume the subscription.
  const needsPortal = status === 'past_due' || status === 'unpaid' || status === 'trialing' || status === 'paused';

  // Variante 1: user tem PDV ativo → upsell pro Pacote Gestão + Atendimento (147 = +88 vs 156 separado).
  // Abre o PlanChangeModal nativo (currentPlan='pdv'), que chama /api/billing/change-plan
  // pra modificar a subscription Stripe existente — sem redirecionar pro ZeloPDV.
  if (hasPdvOnly) {
    return (
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
          className="w-full flex items-center justify-center gap-2 bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)] disabled:opacity-60 disabled:cursor-not-allowed text-white py-2.5 rounded-lg text-[13.5px] font-semibold transition-colors"
        >
          <Sparkles className="w-4 h-4" strokeWidth={2} />
          Upgrade para Pacote Gestão + Atendimento
        </button>

        <p className="text-[11.5px] text-[var(--color-ink-faint)] text-center">
          R$ {PRICING.bundle.priceBRL}/mês total · proporção do mês atual cobrada · cancele quando quiser
        </p>
      </div>
    );
  }

  // Variante 2: user sem subscription ativa OU em status problemático → fluxo padrão Stripe Checkout.
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
      return 'Seu período de avaliação ainda está ativo. Clique abaixo para converter para o plano pago e garantir acesso contínuo.';
    }
    if (status === 'canceled' || status === 'incomplete_expired') {
      return 'Reative seu plano para conectar o WhatsApp e continuar usando a IA do ZeloChat.';
    }
    return 'Você pode configurar tudo agora — produtos, horários e a personalidade da IA. Para conectar o WhatsApp e começar a atender, ative o plano ZeloChat Pro.';
  })();

  const handleClick = async () => {
    setError(null);
    if (!token) {
      setError('Sessão expirada. Faça login novamente.');
      return;
    }
    const target = needsPortal ? 'portal' : 'checkout';
    setBusy(target);
    try {
      const result = target === 'portal'
        ? await openPortal(token)
        : await startCheckout(token, 'chat');
      window.location.href = result.url;
    } catch (err) {
      // Backend pode retornar PDV_UPGRADE_AVAILABLE caso detecte sub PDV ativa
      // entre a hora do hook e a hora do click — abrimos o modal de troca de plano
      // em vez de redirecionar pra fora do app.
      if (err instanceof BillingError && err.code === 'PDV_UPGRADE_AVAILABLE') {
        setBusy(null);
        onPlanChange();
        return;
      }
      // P1.28 — Status can change between render and click (e.g. trial just converted).
      // Reload so the UI reflects the current state.
      if (err instanceof BillingError && err.code === 'TRIALING_USE_PORTAL') {
        window.location.reload();
        return;
      }
      const msg = err instanceof BillingError
        ? err.message
        : 'Não foi possível abrir o pagamento. Tente novamente.';
      setError(msg);
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-[var(--color-brand-soft)] flex items-center justify-center flex-shrink-0">
          <Lock className="w-5 h-5 text-[var(--color-brand-deep)]" strokeWidth={1.8} />
        </div>
        <div className="flex-1">
          <p className="text-[14px] font-semibold leading-snug">{headline}</p>
          <p className="text-[12.5px] text-[var(--color-ink-muted)] mt-1 leading-relaxed">
            {subline}
          </p>
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

      <button
        type="button"
        onClick={handleClick}
        disabled={busy !== null}
        className="w-full flex items-center justify-center gap-2 bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)] disabled:opacity-60 disabled:cursor-not-allowed text-white py-2.5 rounded-lg text-[13.5px] font-semibold transition-colors"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" strokeWidth={2} />}
        {busy
          ? 'Abrindo pagamento…'
          : status === 'trialing'
            ? 'Ativar plano pago'
            : status === 'paused'
              ? 'Reativar plano'
              : needsPortal
                ? 'Regularizar pagamento'
                : 'Ativar ZeloChat Pro'}
      </button>

      <p className="text-[11.5px] text-[var(--color-ink-faint)] text-center">
        R$ {PRICING.chat.priceBRL}/mês · Sem fidelidade · Cancele a qualquer momento
      </p>
    </div>
  );
};

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

  // P1.29 — Dynamic status badge instead of hardcoded "Ativo"
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
    if (!token) {
      setError('Sessão expirada. Faça login novamente.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const result = await openPortal(token);
      window.location.href = result.url;
    } catch (err) {
      const msg = err instanceof BillingError
        ? err.message
        : 'Não foi possível abrir o portal. Tente novamente.';
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
