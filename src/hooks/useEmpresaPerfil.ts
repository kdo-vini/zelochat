import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import type { Session } from '@supabase/supabase-js';
import type { ChatMessage, PixReceiptConfig } from '../types';
import { normalizePixReceiptConfig } from '../domain/pixReceipt';
import type { AiGlobalMode } from '../domain/aiSchedule';
import { DEFAULT_ZELOCHAT_MODE, normalizeZeloChatMode, type ZeloChatMode } from '../domain/zelochatMode';

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
  zelochat_mode: ZeloChatMode;
  /** Customer status notification toggles — added via add_out_for_delivery_status_and_customer_notify_toggles */
  notify_customer_preparing: boolean;
  notify_customer_ready: boolean;
  notify_customer_out_for_delivery: boolean;
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
      .select('id, nome_exibicao, endereco, contato, logo_url, timezone, documento')
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

    let horarioAbertura: string | null = null;
    let horarioFechamento: string | null = null;
    let diasFechamento: string[] | null = null;
    const { data: horariosData, error: horariosError } = await supabase
      .from('empresa_perfil')
      .select('horario_abertura, horario_fechamento, dias_fechamento')
      .eq('id', data.id)
      .maybeSingle();

    if (!horariosError && horariosData) {
      const h = horariosData as { horario_abertura?: string | null; horario_fechamento?: string | null; dias_fechamento?: string[] | null };
      horarioAbertura = h.horario_abertura ?? null;
      horarioFechamento = h.horario_fechamento ?? null;
      diasFechamento = h.dias_fechamento ?? null;
    } else if (horariosError) {
      console.warn('[useEmpresaPerfil] horarios not available (run migration 004):', horariosError.message);
    }

    let aiInstructions: string | null = null;
    const { data: aiData, error: aiErr } = await supabase
      .from('empresa_perfil')
      .select('ai_instructions')
      .eq('id', data.id)
      .maybeSingle();
    if (!aiErr && aiData) {
      aiInstructions = (aiData as { ai_instructions?: string | null }).ai_instructions ?? null;
    } else if (aiErr) {
      console.warn('[useEmpresaPerfil] ai_instructions not available (run migration 005):', aiErr.message);
    }

    let blockedDates: { date: string; reason: string }[] | null = null;
    let managerHistory: ChatMessage[] | null = null;
    const { data: m006Data, error: m006Err } = await supabase
      .from('empresa_perfil')
      .select('blocked_dates, manager_history')
      .eq('id', data.id)
      .maybeSingle();
    if (!m006Err && m006Data) {
      const d = m006Data as { blocked_dates?: unknown; manager_history?: unknown };
      blockedDates = Array.isArray(d.blocked_dates) ? (d.blocked_dates as { date: string; reason: string }[]) : null;
      managerHistory = Array.isArray(d.manager_history) ? (d.manager_history as ChatMessage[]) : null;
    } else if (m006Err) {
      console.warn('[useEmpresaPerfil] blocked_dates/manager_history not available (run migration 006):', m006Err.message);
    }

    let deliveryConfig: { enabled: boolean; neighborhoods: { name: string; fee: number }[] } | null = null;
    const { data: m011Data, error: m011Err } = await supabase
      .from('empresa_perfil')
      .select('delivery_config')
      .eq('id', data.id)
      .maybeSingle();
    if (!m011Err && m011Data) {
      const d = m011Data as { delivery_config?: unknown };
      deliveryConfig = d.delivery_config && typeof d.delivery_config === 'object'
        ? (d.delivery_config as { enabled: boolean; neighborhoods: { name: string; fee: number }[] })
        : null;
    } else if (m011Err) {
      console.warn('[useEmpresaPerfil] delivery_config not available (run migration 011):', m011Err.message);
    }

    let pixReceiptConfig: PixReceiptConfig | null = null;
    const { data: pixReceiptData, error: pixReceiptErr } = await supabase
      .from('empresa_perfil')
      .select('pix_receipt_config')
      .eq('id', data.id)
      .maybeSingle();
    if (!pixReceiptErr && pixReceiptData) {
      pixReceiptConfig = normalizePixReceiptConfig((pixReceiptData as { pix_receipt_config?: unknown }).pix_receipt_config);
    } else if (pixReceiptErr) {
      console.warn('[useEmpresaPerfil] pix_receipt_config not available (run migration 020):', pixReceiptErr.message);
    }

    let aiMode: AiGlobalMode | null = null;
    let aiScheduleStart: string | null = null;
    let aiScheduleEnd: string | null = null;
    const { data: aiScheduleData, error: aiScheduleErr } = await supabase
      .from('empresa_perfil')
      .select('ai_mode, ai_schedule_start, ai_schedule_end')
      .eq('id', data.id)
      .maybeSingle();
    if (!aiScheduleErr && aiScheduleData) {
      const row = aiScheduleData as {
        ai_mode?: string | null;
        ai_schedule_start?: string | null;
        ai_schedule_end?: string | null;
      };
      aiMode = row.ai_mode === 'always_on' || row.ai_mode === 'always_off' || row.ai_mode === 'scheduled'
        ? row.ai_mode
        : null;
      aiScheduleStart = row.ai_schedule_start ?? null;
      aiScheduleEnd = row.ai_schedule_end ?? null;
    } else if (aiScheduleErr) {
      console.warn('[useEmpresaPerfil] ai_mode/ai_schedule_* not available:', aiScheduleErr.message);
    }

    let zelochatMode: ZeloChatMode = DEFAULT_ZELOCHAT_MODE;
    const { data: modeData, error: modeErr } = await supabase
      .from('empresa_perfil')
      .select('zelochat_mode')
      .eq('id', data.id)
      .maybeSingle();
    if (!modeErr && modeData) {
      zelochatMode = normalizeZeloChatMode((modeData as { zelochat_mode?: unknown }).zelochat_mode);
    } else if (modeErr) {
      console.warn('[useEmpresaPerfil] zelochat_mode not available (run migration 023):', modeErr.message);
    }

    let notifyPreparing = true;
    let notifyReady = true;
    let notifyOutForDelivery = true;
    const { data: notifyData, error: notifyErr } = await supabase
      .from('empresa_perfil')
      .select('notify_customer_preparing, notify_customer_ready, notify_customer_out_for_delivery')
      .eq('id', data.id)
      .maybeSingle();
    if (!notifyErr && notifyData) {
      const n = notifyData as {
        notify_customer_preparing?: boolean | null;
        notify_customer_ready?: boolean | null;
        notify_customer_out_for_delivery?: boolean | null;
      };
      notifyPreparing = n.notify_customer_preparing ?? true;
      notifyReady = n.notify_customer_ready ?? true;
      notifyOutForDelivery = n.notify_customer_out_for_delivery ?? true;
    } else if (notifyErr) {
      console.warn('[useEmpresaPerfil] notify_customer_* not available:', notifyErr.message);
    }

    setEmpresa({
      ...data,
      chave_pix: chavePix,
      manager_phone: managerPhone,
      horario_abertura: horarioAbertura,
      horario_fechamento: horarioFechamento,
      dias_fechamento: diasFechamento,
      ai_instructions: aiInstructions,
      blocked_dates: blockedDates,
      manager_history: managerHistory,
      delivery_config: deliveryConfig,
      pix_receipt_config: pixReceiptConfig,
      ai_mode: aiMode,
      ai_schedule_start: aiScheduleStart,
      ai_schedule_end: aiScheduleEnd,
      zelochat_mode: zelochatMode,
      notify_customer_preparing: notifyPreparing,
      notify_customer_ready: notifyReady,
      notify_customer_out_for_delivery: notifyOutForDelivery,
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
