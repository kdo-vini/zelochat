import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../services/supabaseClient';

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

  return {
    subscription,
    isActive,
    hasPdvOnly,
    loading,
    refresh: load,
  };
}

/** True se a row tem status='active' e período não expirou (manual ou normal). */
export function isSubscriptionActive(sub: ZeloChatSubscription | null): boolean {
  if (!sub) return false;
  if (sub.status !== 'active') return false;
  const now = Date.now();
  const expiry = sub.manually_extended_until ?? sub.current_period_end;
  if (!expiry) return false;
  return new Date(expiry).getTime() > now;
}
