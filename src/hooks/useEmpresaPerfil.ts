import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import type { Session } from '@supabase/supabase-js';
import type { ChatMessage, PixReceiptConfig } from '../types';
import { normalizePixReceiptConfig } from '../domain/pixReceipt';
import {
  normalizeAiGlobalMode,
  normalizeAiScheduleDays,
  normalizeAiScheduleTime,
  type AiGlobalMode,
  type AiScheduleDays,
} from '../domain/aiSchedule';
import { normalizeZeloChatMode, type ZeloChatMode } from '../domain/zelochatMode';

/** Subset of empresa_perfil columns relevant to ZeloChat */
export interface EmpresaPerfil {
  id: string;
  nome_exibicao: string;
  endereco: string | null;
  contato: string | null;
  logo_url: string | null;
  timezone: string | null;
  /** PDV-owned column — safe to read/write, must never ALTER via migration from this repo */
  documento: string | null;
  /** Added via migration 001_empresa_perfil_chave_pix.sql — may be null if migration not yet run */
  chave_pix: string | null;
  /** Added via migration 003_triggers_and_manager_phone.sql — may be null if migration not yet run */
  manager_phone: string | null;
  /** Added via migration 004_empresa_horarios.sql — may be null if migration not yet run */
  horario_abertura: string | null;
  horario_fechamento: string | null;
  dias_fechamento: string[] | null;
  /** Added via migration 005_ai_config_and_quick_responses.sql — may be null if migration not yet run */
  ai_instructions: string | null;
  /** Added via migration 006_blocked_dates_manager_history.sql — may be null if migration not yet run */
  blocked_dates: { date: string; reason: string }[] | null;
  manager_history: ChatMessage[] | null;
  /** Added via migration 011_delivery_config.sql — may be null if migration not yet run */
  delivery_config: { enabled: boolean; neighborhoods: { name: string; fee: number }[] } | null;
  pix_receipt_config: PixReceiptConfig | null;
  ai_mode: AiGlobalMode | null;
  ai_schedule_start: string | null;
  ai_schedule_end: string | null;
  /** Added via migration 040_ai_schedule_per_day.sql — may be null if migration not yet run. */
  ai_schedule_days: AiScheduleDays | null;
  zelochat_mode: ZeloChatMode;
  /** Customer status notification toggles — added via add_out_for_delivery_status_and_customer_notify_toggles */
  notify_customer_preparing: boolean;
  notify_customer_ready: boolean;
  notify_customer_out_for_delivery: boolean;
  /** Self-service deletion grace period — set when deletion is scheduled (ISO), null otherwise. */
  deletion_scheduled_at: string | null;
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

    const fullSelect = [
      'id',
      'nome_exibicao',
      'endereco',
      'contato',
      'logo_url',
      'timezone',
      'documento',
      'chave_pix',
      'manager_phone',
      'horario_abertura',
      'horario_fechamento',
      'dias_fechamento',
      'ai_instructions',
      'blocked_dates',
      'manager_history',
      'delivery_config',
      'pix_receipt_config',
      'ai_mode',
      'ai_schedule_start',
      'ai_schedule_end',
      'ai_schedule_days',
      'zelochat_mode',
      'notify_customer_preparing',
      'notify_customer_ready',
      'notify_customer_out_for_delivery',
      'deletion_scheduled_at',
    ].join(', ');

    let { data, error: dbError } = await supabase
      .from('empresa_perfil')
      .select(fullSelect)
      .eq('user_id', session.user.id)
      .maybeSingle();

    // ai_schedule_days was added in migration 040. Pre-migration empresas would
    // lose ALL AI settings if we let this kick straight into the base-columns
    // fallback below, so retry once without the new column first.
    if (dbError?.message?.includes('ai_schedule_days')) {
      console.warn('[useEmpresaPerfil] ai_schedule_days column missing; retrying without it. Run migration 040.');
      const selectWithoutDays = fullSelect.replace(/,\s*ai_schedule_days/, '');
      const retry = await supabase
        .from('empresa_perfil')
        .select(selectWithoutDays)
        .eq('user_id', session.user.id)
        .maybeSingle();
      data = retry.data;
      dbError = retry.error;
    }

    let row = data as (Partial<EmpresaPerfil> & { id?: string }) | null;
    if (dbError) {
      console.warn('[useEmpresaPerfil] full profile query failed; falling back to base columns:', dbError.message);
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('empresa_perfil')
        .select('id, nome_exibicao, endereco, contato, logo_url, timezone, documento')
        .eq('user_id', session.user.id)
        .maybeSingle();

      if (fallbackError) {
        console.error('[useEmpresaPerfil] query error:', fallbackError);
        setError(fallbackError.message);
        setLoading(false);
        return;
      }
      row = fallbackData as (Partial<EmpresaPerfil> & { id?: string }) | null;
    }

    if (!row?.id) {
      setEmpresa(null);
      setLoading(false);
      return;
    }

    const deliveryConfig = row.delivery_config && typeof row.delivery_config === 'object'
      ? row.delivery_config
      : null;
    const blockedDates = Array.isArray(row.blocked_dates)
      ? row.blocked_dates
      : null;
    const managerHistory = Array.isArray(row.manager_history)
      ? row.manager_history
      : null;

    setEmpresa({
      id: row.id,
      nome_exibicao: row.nome_exibicao ?? '',
      endereco: row.endereco ?? null,
      contato: row.contato ?? null,
      logo_url: row.logo_url ?? null,
      timezone: row.timezone ?? null,
      documento: row.documento ?? null,
      chave_pix: row.chave_pix ?? null,
      manager_phone: row.manager_phone ?? null,
      horario_abertura: row.horario_abertura ?? null,
      horario_fechamento: row.horario_fechamento ?? null,
      dias_fechamento: row.dias_fechamento ?? null,
      ai_instructions: row.ai_instructions ?? null,
      blocked_dates: blockedDates as { date: string; reason: string }[] | null,
      manager_history: managerHistory as ChatMessage[] | null,
      delivery_config: deliveryConfig,
      pix_receipt_config: normalizePixReceiptConfig(row.pix_receipt_config),
      ai_mode: normalizeAiGlobalMode(row.ai_mode) ?? null,
      ai_schedule_start: normalizeAiScheduleTime(row.ai_schedule_start),
      ai_schedule_end: normalizeAiScheduleTime(row.ai_schedule_end),
      ai_schedule_days: normalizeAiScheduleDays(row.ai_schedule_days),
      zelochat_mode: normalizeZeloChatMode(row.zelochat_mode),
      notify_customer_preparing: row.notify_customer_preparing ?? true,
      notify_customer_ready: row.notify_customer_ready ?? true,
      notify_customer_out_for_delivery: row.notify_customer_out_for_delivery ?? true,
      deletion_scheduled_at: row.deletion_scheduled_at ?? null,
    });
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
        } else if (dbError.message.includes('ai_instructions') && patch.ai_instructions !== undefined) {
          console.warn('[useEmpresaPerfil] ai_instructions column missing — saving without it. Run migration 005.');
          const { ai_instructions: _omitted, ...patchWithout } = patch as Partial<EmpresaPerfil>;
          const { error: retryError } = await supabase
            .from('empresa_perfil')
            .update({ ...patchWithout, updated_at: new Date().toISOString() })
            .eq('id', empresa.id);
          if (retryError) {
            setError(retryError.message);
            return false;
          }
        } else if (
          (dbError.message.includes('blocked_dates') || dbError.message.includes('manager_history')) &&
          (patch.blocked_dates !== undefined || patch.manager_history !== undefined)
        ) {
          console.warn('[useEmpresaPerfil] blocked_dates/manager_history columns missing — saving without them. Run migration 006.');
          const { blocked_dates: _bd, manager_history: _mh, ...patchWithout } = patch as Partial<EmpresaPerfil>;
          const { error: retryError } = await supabase
            .from('empresa_perfil')
            .update({ ...patchWithout, updated_at: new Date().toISOString() })
            .eq('id', empresa.id);
          if (retryError) {
            setError(retryError.message);
            return false;
          }
        } else if (dbError.message.includes('delivery_config') && patch.delivery_config !== undefined) {
          console.warn('[useEmpresaPerfil] delivery_config column missing — saving without it. Run migration 011.');
          const { delivery_config: _dc, ...patchWithout } = patch as Partial<EmpresaPerfil>;
          const { error: retryError } = await supabase
            .from('empresa_perfil')
            .update({ ...patchWithout, updated_at: new Date().toISOString() })
            .eq('id', empresa.id);
          if (retryError) {
            setError(retryError.message);
            return false;
          }
        } else if (dbError.message.includes('pix_receipt_config') && patch.pix_receipt_config !== undefined) {
          console.warn('[useEmpresaPerfil] pix_receipt_config column missing - saving without it. Run migration 020.');
          const { pix_receipt_config: _prc, ...patchWithout } = patch as Partial<EmpresaPerfil>;
          const { error: retryError } = await supabase
            .from('empresa_perfil')
            .update({ ...patchWithout, updated_at: new Date().toISOString() })
            .eq('id', empresa.id);
          if (retryError) {
            setError(retryError.message);
            return false;
          }
        } else if (dbError.message.includes('zelochat_mode') && patch.zelochat_mode !== undefined) {
          console.warn('[useEmpresaPerfil] zelochat_mode column missing - saving without it. Run migration 023.');
          const { zelochat_mode: _mode, ...patchWithout } = patch as Partial<EmpresaPerfil>;
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
