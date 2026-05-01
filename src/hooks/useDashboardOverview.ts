import { useCallback, useEffect, useState } from 'react';
import type { DashboardOverview, DashboardRange } from '../types';
import { getDashboardOverview } from '../services/waApi';

export function useDashboardOverview(
  token: string | null,
  range: DashboardRange,
  period?: { startDate?: string; endDate?: string },
) {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!token) {
      setOverview(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const next = await getDashboardOverview(token, range, period);
      setOverview(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar a visão geral.');
    } finally {
      setLoading(false);
    }
  }, [token, range, period?.startDate, period?.endDate]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { overview, loading, error, reload };
}
