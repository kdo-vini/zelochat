import { useCallback, useEffect, useState } from 'react';
import type { EscalationEvent } from '../types';
import {
  getOpenEscalationCount,
  listEscalationEvents,
} from '../services/waApi';

interface Options {
  /** Trigger to refetch (e.g. last escalation event id from useWhatsAppSessions). */
  refetchKey?: string | number | null;
}

export function useEscalationEvents(
  token: string | null,
  jid: string | null,
  options: Options = {},
) {
  const [events, setEvents] = useState<EscalationEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!token || !jid) {
      setEvents([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await listEscalationEvents(token, jid);
      setEvents(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar histórico de escalações.');
    } finally {
      setLoading(false);
    }
  }, [token, jid]);

  useEffect(() => {
    void reload();
  }, [reload, options.refetchKey]);

  return { events, loading, error, reload };
}

/** Tracks the global open-escalation count for the nav pill. */
export function useOpenEscalationCount(token: string | null, refetchKey?: unknown) {
  const [count, setCount] = useState<number>(0);

  const reload = useCallback(async () => {
    if (!token) {
      setCount(0);
      return;
    }
    try {
      const next = await getOpenEscalationCount(token);
      setCount(next);
    } catch {
      // silent — non-critical
    }
  }, [token]);

  useEffect(() => {
    void reload();
  }, [reload, refetchKey]);

  return { count, reload };
}
