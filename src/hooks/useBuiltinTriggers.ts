import { useCallback, useEffect, useState } from 'react';
import type { BuiltinTriggerInfo } from '../types';
import {
  listBuiltinTriggers,
  setBuiltinTriggerDisabled as setDisabledApi,
} from '../services/waApi';

export function useBuiltinTriggers(token: string | null) {
  const [items, setItems] = useState<BuiltinTriggerInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!token) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await listBuiltinTriggers(token);
      setItems(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar gatilhos do sistema.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setDisabled = useCallback(
    async (builtinId: string, disabled: boolean) => {
      if (!token) return;
      // Optimistic update; rollback on failure.
      setItems((prev) => prev.map((t) => (t.id === builtinId ? { ...t, disabled } : t)));
      try {
        await setDisabledApi(token, builtinId, disabled);
      } catch (err) {
        setItems((prev) => prev.map((t) => (t.id === builtinId ? { ...t, disabled: !disabled } : t)));
        throw err;
      }
    },
    [token],
  );

  return { items, loading, error, reload, setDisabled };
}
