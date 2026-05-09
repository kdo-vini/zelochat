import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../services/supabaseClient';
import type { QuickResponse } from '../types';

function rowToQR(row: Record<string, unknown>): QuickResponse {
  return {
    id: row.id as string,
    trigger: (row.trigger as string) ?? '',
    response: (row.response as string) ?? '',
  };
}

export function useQuickResponses(session: Session | null, options: { enabled?: boolean } = {}) {
  const [items, setItems] = useState<QuickResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const empresaIdRef = useRef<string | null>(null);
  const lastUserIdRef = useRef<string | null>(null);
  const enabled = options.enabled ?? true;

  const fetchEmpresaId = useCallback(async (userId: string): Promise<string | null> => {
    const { data } = await supabase
      .from('empresa_perfil')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  }, []);

  const refresh = useCallback(async () => {
    if (!session?.user?.id) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: dbError } = await supabase
        .from('zelochat_quick_responses')
        .select('*')
        .order('position', { ascending: true });
      if (dbError) throw dbError;
      setItems((data ?? []).map(rowToQR));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar as respostas rápidas.');
    } finally {
      setLoading(false);
    }
  }, [session?.user?.id]);

  useEffect(() => {
    const userId = session?.user?.id ?? null;
    if (userId !== lastUserIdRef.current) {
      empresaIdRef.current = null;
      lastUserIdRef.current = userId;
    }
    if (!userId) {
      setItems([]);
      return;
    }
    if (!enabled) return;
    void refresh();
  }, [session?.user?.id, enabled, refresh]);

  const ensureEmpresaId = useCallback(async (): Promise<string> => {
    if (empresaIdRef.current) return empresaIdRef.current;
    if (!session?.user?.id) throw new Error('Faça login.');
    const id = await fetchEmpresaId(session.user.id);
    if (!id) throw new Error('Perfil da empresa não encontrado.');
    empresaIdRef.current = id;
    return id;
  }, [session?.user?.id, fetchEmpresaId]);

  const add = useCallback(async (): Promise<QuickResponse> => {
    const empresaId = await ensureEmpresaId();
    const position = items.length > 0 ? Math.min(...items.map((i, idx) => idx)) - 1 : 0;
    const { data, error: dbError } = await supabase
      .from('zelochat_quick_responses')
      .insert({
        empresa_id: empresaId,
        trigger: '',
        response: '',
        position,
      })
      .select()
      .single();
    if (dbError) throw dbError;
    const created = rowToQR(data as Record<string, unknown>);
    setItems((prev) => [created, ...prev]);
    return created;
  }, [items.length, ensureEmpresaId]);

  const update = useCallback(
    async (id: string, patch: Partial<Pick<QuickResponse, 'trigger' | 'response'>>): Promise<void> => {
      setItems((prev) => prev.map((qr) => (qr.id === id ? { ...qr, ...patch } : qr)));
      const update: Record<string, unknown> = {};
      if (patch.trigger !== undefined) update.trigger = patch.trigger;
      if (patch.response !== undefined) update.response = patch.response;
      update.updated_at = new Date().toISOString();
      const { error: dbError } = await supabase
        .from('zelochat_quick_responses')
        .update(update)
        .eq('id', id);
      if (dbError) throw dbError;
    },
    [],
  );

  const remove = useCallback(async (id: string): Promise<void> => {
    const prev = items;
    setItems((p) => p.filter((qr) => qr.id !== id));
    const { error: dbError } = await supabase
      .from('zelochat_quick_responses')
      .delete()
      .eq('id', id);
    if (dbError) {
      setItems(prev);
      throw dbError;
    }
  }, [items]);

  return { items, loading, error, refresh, add, update, remove };
}
