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
  subscription: ZeloChatSubscription | null;
  isActive: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
}

/**
 * Reads the user's subscription from the shared `subscriptions` table.
 * ZeloChat is unlocked when plan_tier is 'chat' or 'bundle', status is 'active',
 * and the period (or manual extension) hasn't expired.
 *
 * No free trial: 'trialing' is intentionally excluded.
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
      .in('plan_tier', ['chat', 'bundle'])
      .order('current_period_end', { ascending: false, nullsFirst: false })
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

  return {
    subscription,
    isActive: isSubscriptionActive(subscription),
    loading,
    refresh: load,
  };
}

export function isSubscriptionActive(sub: ZeloChatSubscription | null): boolean {
  if (!sub) return false;
  if (sub.status !== 'active') return false;
  const now = Date.now();
  const expiry = sub.manually_extended_until ?? sub.current_period_end;
  if (!expiry) return false;
  return new Date(expiry).getTime() > now;
}
