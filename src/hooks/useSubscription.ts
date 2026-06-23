import { useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../services/supabaseClient';
import { isSubscriptionCurrentlyActive } from '../domain/subscription.js';
import {
  resolveZeloMenuCapabilities,
  type ZeloMenuCapabilitySet,
} from '../domain/zelomenuEntitlements.js';

export interface ZeloChatSubscription {
  id: string;
  status: string;
  plan_tier: 'pdv' | 'chat' | 'bundle';
  current_period_end: string | null;
  manually_extended_until: string | null;
  cancel_at_period_end: boolean | null;
}

interface UseSubscriptionResult {
  /** Latest subscription row (any plan_tier) — null se user nunca assinou. */
  subscription: ZeloChatSubscription | null;
  /** True se plan_tier IN ('chat','bundle') E ativo — gateia uso do ZeloChat. */
  isActive: boolean;
  /** True se user tem plan_tier='pdv' ativo (precisa fazer upgrade pra acessar Chat). */
  hasPdvOnly: boolean;
  /**
   * Capabilities efetivas do ZeloMenu (ZLM-205, D-103). Derivadas do plan_tier
   * ativo via resolver de domínio puro. Hoje, no app ZeloChat, todo cliente
   * chat/bundle ativo já recebe `menu_publication`/`ordering_review` por D-014.
   */
  capabilities: ZeloMenuCapabilitySet;
  loading: boolean;
  refresh: () => Promise<void>;
}

/**
 * Reads the user's subscription from the shared `subscriptions` table.
 *
 * Pega a row mais recente independente do plan_tier — assim conseguimos:
 *  - liberar ZeloChat se já tem chat/bundle (isActive)
 *  - detectar usuários PDV-only e oferecer upgrade pro pacote (hasPdvOnly)
 *
 * No free trial: 'trialing' é intencionalmente excluído de isActive.
 */
export function useSubscription(session: Session | null): UseSubscriptionResult {
  const [subscription, setSubscription] = useState<ZeloChatSubscription | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!session?.user?.id) {
      setSubscription(null);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from('subscriptions')
      .select('id, status, plan_tier, current_period_end, manually_extended_until, cancel_at_period_end')
      .eq('user_id', session.user.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn('[useSubscription] load failed:', error.message);
      setSubscription(null);
    } else {
      setSubscription((data ?? null) as ZeloChatSubscription | null);
    }
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  const isActive = isSubscriptionActive(subscription) &&
    !!subscription &&
    (subscription.plan_tier === 'chat' || subscription.plan_tier === 'bundle');
  const hasPdvOnly = isSubscriptionActive(subscription) &&
    !!subscription &&
    subscription.plan_tier === 'pdv';

  const capabilities = useMemo(
    () => resolveZeloMenuCapabilities({
      planTier: subscription?.plan_tier ?? null,
      active: isSubscriptionActive(subscription),
      // SEAM ÚNICO (D-103): quando o ZeloPDV publicar `has_zelo_menu`, basta
      // adicionar a coluna ao SELECT acima e passar o valor aqui. Enquanto a
      // coluna não existir, chat/bundle seguem fail-safe ON e `pdv` puro fica
      // sem ZeloMenu — exatamente o comportamento atual.
      hasZeloMenuFlag: undefined,
    }),
    [subscription],
  );

  return {
    subscription,
    isActive,
    hasPdvOnly,
    capabilities,
    loading,
    refresh: load,
  };
}

/** True se a row tem status='active' e período não expirou (manual ou normal). */
export function isSubscriptionActive(sub: ZeloChatSubscription | null): boolean {
  return isSubscriptionCurrentlyActive(sub);
}
