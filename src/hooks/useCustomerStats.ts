import { useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { normalizePhoneNumber } from '../domain/chat';

export interface CustomerStats {
  orderCount: number;
  avgTicket: number;
}

export function useCustomerStats(
  phone: string | null | undefined,
): { stats: CustomerStats | null; loading: boolean } {
  const [stats, setStats] = useState<CustomerStats | null>(null);
  const [loading, setLoading] = useState(false);
  const empresaIdRef = useRef<string | null>(null);
  const lastUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!phone) {
      setStats(null);
      return;
    }

    const normalized = normalizePhoneNumber(phone);
    if (!normalized) {
      setStats(null);
      return;
    }

    let cancelled = false;

    async function fetchStats() {
      setLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id ?? null;
        if (!userId || cancelled) return;

        // Clear empresa cache if user changed (e.g. after account switch)
        if (userId !== lastUserIdRef.current) {
          empresaIdRef.current = null;
          lastUserIdRef.current = userId;
        }

        if (!empresaIdRef.current) {
          const { data } = await supabase
            .from('empresa_perfil')
            .select('id')
            .eq('user_id', userId)
            .maybeSingle();
          empresaIdRef.current = (data as { id: string } | null)?.id ?? null;
        }
        const empresaId = empresaIdRef.current;
        if (!empresaId || cancelled) return;

        // Match by last 10 digits to handle with/without country code (55)
        const suffix = normalized.slice(-10);

        const { data, error } = await supabase
          .from('zelo_orders')
          .select('total, customer')
          .eq('empresa_id', empresaId)
          .ilike('customer->>phone', `%${suffix}`);

        if (error || cancelled) return;

        const rows = (data ?? []) as { total: number }[];
        if (rows.length === 0) {
          setStats({ orderCount: 0, avgTicket: 0 });
          return;
        }

        const orderCount = rows.length;
        const avgTicket = rows.reduce((sum, r) => sum + Number(r.total), 0) / orderCount;
        setStats({ orderCount, avgTicket });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchStats();
    return () => { cancelled = true; };
  }, [phone]);

  return { stats, loading };
}
