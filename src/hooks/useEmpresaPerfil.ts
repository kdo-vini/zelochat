import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import type { Session } from '@supabase/supabase-js';

/** Subset of empresa_perfil columns relevant to ZeloChat */
export interface EmpresaPerfil {
  id: string;
  nome_exibicao: string;
  endereco: string | null;
  contato: string | null;
  logo_url: string | null;
  /** Added via migration 001_empresa_perfil_chave_pix.sql — may be null if migration not yet run */
  chave_pix: string | null;
  /** Added via migration 003_triggers_and_manager_phone.sql — may be null if migration not yet run */
  manager_phone: string | null;
}

interface UseEmpresaPerfilResult {
  empresa: EmpresaPerfil | null;
  loading: boolean;
  error: string | null;
  /** Persist changes back to Supabase. Returns true on success. */
  save: (patch: Partial<Omit<EmpresaPerfil, 'id'>>) => Promise<boolean>;
  refresh: () => Promise<void>;
}

export function useEmpresaPerfil(session: Session | null): UseEmpresaPerfilResult {
  const [empresa, setEmpresa] = useState<EmpresaPerfil | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!session?.user?.id) {
      setEmpresa(null);
      return;
    }

    setLoading(true);
    setError(null);

    // Step 1: fetch the guaranteed columns (no chave_pix — may not exist yet)
    const { data, error: dbError } = await supabase
      .from('empresa_perfil')
      .select('id, nome_exibicao, endereco, contato, logo_url')
      .eq('user_id', session.user.id)
      .maybeSingle();

    if (dbError) {
      console.error('[useEmpresaPerfil] query error:', dbError);
      setError(dbError.message);
      setLoading(false);
      return;
    }

    if (!data) {
      // No empresa row for this user — not an error, just empty
      setEmpresa(null);
      setLoading(false);
      return;
    }

    // Step 2: try to get chave_pix separately — gracefully skip if column doesn't exist yet
    let chavePix: string | null = null;
    const { data: pixData, error: pixError } = await supabase
      .from('empresa_perfil')
      .select('chave_pix')
      .eq('id', data.id)
      .maybeSingle();

    if (!pixError && pixData) {
      chavePix = (pixData as { chave_pix?: string | null }).chave_pix ?? null;
    } else if (pixError) {
      // Column probably doesn't exist yet — log but don't fail
      console.warn('[useEmpresaPerfil] chave_pix not available (run migration 001):', pixError.message);
    }

    let managerPhone: string | null = null;
    const { data: mgrData, error: mgrError } = await supabase
      .from('empresa_perfil')
      .select('manager_phone')
      .eq('id', data.id)
      .maybeSingle();

    if (!mgrError && mgrData) {
      managerPhone = (mgrData as { manager_phone?: string | null }).manager_phone ?? null;
    } else if (mgrError) {
      console.warn('[useEmpresaPerfil] manager_phone not available (run migration 003):', mgrError.message);
    }

    setEmpresa({ ...data, chave_pix: chavePix, manager_phone: managerPhone });
    setLoading(false);
  }, [session?.user?.id]);

  useEffect(() => {
    void fetch();
  }, [fetch]);

  const save = useCallback(
    async (patch: Partial<Omit<EmpresaPerfil, 'id'>>): Promise<boolean> => {
      if (!empresa?.id) return false;

      setError(null);

      // If patch includes chave_pix but column may not exist, try with and without
      const { error: dbError } = await supabase
        .from('empresa_perfil')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', empresa.id);

      if (dbError) {
        // If chave_pix column missing, retry without it
        if (dbError.message.includes('chave_pix') && patch.chave_pix !== undefined) {
          console.warn('[useEmpresaPerfil] chave_pix column missing — saving without it. Run migration 001.');
          const { chave_pix: _omitted, ...patchWithout } = patch as Partial<EmpresaPerfil>;
          const { error: retryError } = await supabase
            .from('empresa_perfil')
            .update({ ...patchWithout, updated_at: new Date().toISOString() })
            .eq('id', empresa.id);
          if (retryError) {
            setError(retryError.message);
            return false;
          }
        } else if (dbError.message.includes('manager_phone') && patch.manager_phone !== undefined) {
          console.warn('[useEmpresaPerfil] manager_phone column missing — saving without it. Run migration 003.');
          const { manager_phone: _omitted, ...patchWithout } = patch as Partial<EmpresaPerfil>;
          const { error: retryError } = await supabase
            .from('empresa_perfil')
            .update({ ...patchWithout, updated_at: new Date().toISOString() })
            .eq('id', empresa.id);
          if (retryError) {
            setError(retryError.message);
            return false;
          }
        } else {
          setError(dbError.message);
          return false;
        }
      }

      // Optimistically update local state
      setEmpresa((prev) => (prev ? { ...prev, ...patch } : prev));
      return true;
    },
    [empresa?.id],
  );

  return { empresa, loading, error, save, refresh: fetch };
}
