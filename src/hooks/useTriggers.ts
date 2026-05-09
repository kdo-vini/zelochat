import { useCallback, useEffect, useState } from 'react';
import type { Trigger, TriggerKind } from '../types';
import {
  listTriggers,
  createTrigger as createTriggerRequest,
  updateTrigger as updateTriggerRequest,
  deleteTrigger as deleteTriggerRequest,
} from '../services/waApi';

function sortTriggers(items: Trigger[]): Trigger[] {
  return [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function useTriggers(token: string | null, options: { enabled?: boolean } = {}) {
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = options.enabled ?? true;

  const refresh = useCallback(async () => {
    if (!token) {
      setTriggers([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await listTriggers(token);
      setTriggers(sortTriggers(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar os gatilhos.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  const createTrigger = useCallback(async (naturalInput: string, kind: TriggerKind) => {
    if (!token) throw new Error('Faça login para criar gatilhos.');
    setError(null);
    try {
      const trig = await createTriggerRequest(token, naturalInput, kind);
      setTriggers((prev) => sortTriggers([...prev, trig]));
      return trig;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível criar o gatilho.';
      setError(message);
      throw new Error(message);
    }
  }, [token]);

  const updateTrigger = useCallback(async (
    id: string,
    patch: { name?: string; conditionDescription?: string; active?: boolean; kind?: TriggerKind },
  ) => {
    if (!token) throw new Error('Faça login para editar gatilhos.');
    setError(null);
    try {
      const trig = await updateTriggerRequest(token, id, patch);
      setTriggers((prev) => sortTriggers(prev.map((t) => (t.id === id ? trig : t))));
      return trig;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível atualizar o gatilho.';
      setError(message);
      throw new Error(message);
    }
  }, [token]);

  const deleteTrigger = useCallback(async (id: string) => {
    if (!token) throw new Error('Faça login para remover gatilhos.');
    setError(null);
    try {
      await deleteTriggerRequest(token, id);
      setTriggers((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível remover o gatilho.';
      setError(message);
      throw new Error(message);
    }
  }, [token]);

  return { triggers, loading, error, refresh, createTrigger, updateTrigger, deleteTrigger };
}
