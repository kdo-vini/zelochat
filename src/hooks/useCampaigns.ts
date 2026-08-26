import { useCallback, useEffect, useState } from 'react';
import { fetchCampaigns, fetchSegments, type Campaign, type CustomerSegment } from '../services/customerCampaignApi';

export function useCampaigns(token: string | null) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [segments, setSegments] = useState<CustomerSegment[]>([]);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const [nextCampaigns, nextSegments] = await Promise.all([fetchCampaigns(token), fetchSegments(token)]);
      setCampaigns(nextCampaigns); setSegments(nextSegments);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as campanhas.'); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);
  return { campaigns, segments, loading, error, refresh };
}
