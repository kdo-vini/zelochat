import React, { useState, useEffect, useRef } from 'react';
import { useLocalDraft } from '../../hooks/useLocalDraft';
import { useToast } from '../../contexts/ToastContext';
import { Smartphone, RefreshCw, Wifi, WifiOff, QrCode, Loader2, Clock, UserCog, Check, CloudOff, LogOut, Bot, BotOff, Bike, Plus, Trash2, Bell, ChefHat, CheckCircle2, Sparkles, Settings2, ChevronDown } from 'lucide-react';
import { ConfirmModal } from '../ConfirmModal';
import { ZeloState, type DeliveryConfig, type DeliveryNeighborhood } from '../../types';
import type { EmpresaPerfil } from '../../hooks/useEmpresaPerfil';
import { normalizeZeloChatMode, type ZeloChatMode } from '../../domain/zelochatMode';
import { API_BASE, WS_URL, apiFetch, WaServerOfflineError } from '../../config';
import { maskBrazilianPhone } from '../../domain/chat';
import {
  AI_SCHEDULE_DAY_KEYS,
  buildDefaultAiScheduleDays,
  evaluateAiSchedule,
  normalizeAiScheduleTime,
  type AiGlobalMode,
  type AiScheduleDay,
  type AiScheduleDayKey,
  type AiScheduleDays,
} from '../../domain/aiSchedule';
import { reverseEngineerWizardState, summarizeScheduleResult, WIZARD_DAY_LABELS } from '../../domain/aiScheduleWizard';
import { ScheduleWizard } from '../settings/ScheduleWizard';
import { ScheduleVisualPreview } from '../settings/ScheduleVisualPreview';
import {
  getAiEnabled,
  getAiSettings,
  parseScheduleDescription,
  setAiEnabled as setAiEnabledApi,
  setAiSettings as setAiSettingsApi,
  type AiSettings,
} from '../../services/waApi';
import { useSupabaseSession } from '../../hooks/useSupabaseSession';
import { useSubscription, type ZeloChatSubscription } from '../../hooks/useSubscription';
import { PlanChangeModal } from './PlanChangeModal';
import { SectionCard } from '../shared/SectionCard';
import { SubscriptionPaywall } from '../billing/BillingCards';
import { PublicLinkCard } from '../zelomenu/PublicLinkCard';
import { ZeloMenuSettingsCard } from '../zelomenu/ZeloMenuSettingsCard';

const FIELD = 'w-full bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg px-3 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-[var(--color-brand)]/25 focus:border-[var(--color-brand)] transition-colors';
const LABEL = 'block text-[11.5px] font-medium text-[var(--color-ink-muted)] mb-1';

/**
 * Tier header for grouping setting sections by access frequency. Operação
 * (daily/weekly), Negócio (configured during onboarding, occasionally tweaked).
 * Account-level concerns (Plano, Conta) live in ProfileView, not here.
 */
const TierGroup = ({ label, description, children }: {
  label: string;
  description: string;
  children: React.ReactNode;
}) => (
  <section className="space-y-3">
    <div>
      <h2 className="text-[12px] font-bold uppercase tracking-wider text-[var(--color-ink-faint)]">{label}</h2>
      <p className="text-[12px] text-[var(--color-ink-muted)] mt-0.5">{description}</p>
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">{children}</div>
  </section>
);


interface WhatsAppIntegrationCardProps {
  token: string | null;
  subscriptionActive: boolean;
  subscriptionLoading: boolean;
  subscription: ZeloChatSubscription | null;
  hasPdvOnly: boolean;
  onPlanChange: () => void;
}

// Module-level cache do último status conhecido. Sobrevive a remounts do
// WhatsAppIntegrationCard (que acontecem toda vez que o operador navega
// pra outra view e volta). Antes, o initial state hardcoded 'disconnected'
// fazia o badge piscar vermelho por ~3s enquanto /api/status era buscado —
// operador via "Desconectado" toda vez que abria Configurações, mesmo com
// WhatsApp conectado o tempo todo.
let lastKnownWaStatus: 'disconnected' | 'qr' | 'connecting' | 'connected' = 'connecting';
let lastKnownQrCode: string | null = null;

export const WhatsAppIntegrationCard = ({ token, subscriptionActive, subscriptionLoading, subscription, hasPdvOnly, onPlanChange }: WhatsAppIntegrationCardProps) => {
  // Initial state usa o cache do módulo (último valor conhecido) em vez de
  // 'disconnected' fixo. Primeira montagem da sessão começa em 'connecting'
  // (loading state neutro), montagens subsequentes usam o último status
  // sincronizado.
  const [waStatus, setWaStatus] = useState<'disconnected' | 'qr' | 'connecting' | 'connected'>(lastKnownWaStatus);
  const [qrCode, setQrCode] = useState<string | null>(lastKnownQrCode);
  const [isLoading, setIsLoading] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sync local state → module cache so the next remount picks up where we left off.
  useEffect(() => { lastKnownWaStatus = waStatus; }, [waStatus]);
  useEffect(() => { lastKnownQrCode = qrCode; }, [qrCode]);


  // Poll the backend every 3s while QR is showing — catches connection even if webhook/tunnel fails
  const startPolling = () => {
    if (pollRef.current) return; // already polling
    pollRef.current = setInterval(async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/qr/refresh`, {
          method: 'POST',
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        });
        const data = await res.json();
        if (data.status === 'connected' || (!data.status && data.qr === null && !data.error)) {
          setWaStatus('connected');
          setQrCode(null);
          setError(null);
          stopPolling();
        } else if (data.qr) {
          // QR rotated — update it
          setQrCode(data.qr);
          setWaStatus('qr');
          setError(null);
        } else if (data.status === 'connecting') {
          setWaStatus('connecting');
        }
      } catch { /* keep polling */ }
    }, 3000);
  };

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  useEffect(() => {
    if (!subscriptionActive) return;
    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen = () => {
        setError(null);
        const authHeaders = token ? { 'Authorization': `Bearer ${token}` } : {};
        apiFetch(`${API_BASE}/api/status`, { headers: authHeaders }).then(r => r.json()).then(d => {
          setWaStatus(d.status);
          if (d.status === 'qr') startPolling();
        }).catch(() => setError('Servidor WhatsApp offline'));
        apiFetch(`${API_BASE}/api/qr`, { headers: authHeaders })
          .then(r => r.json())
          .then(d => {
            if (d.qr) setQrCode(d.qr);
            if (d.status) setWaStatus(d.status);
          })
          .catch(() => {});
      };
      ws.onmessage = (ev) => {
        try {
          const p = JSON.parse(ev.data);
          if (p.type === 'qr') { setQrCode(p.data); setWaStatus('qr'); setIsLoading(false); startPolling(); }
          if (p.type === 'connection') {
            setWaStatus(p.data);
            if (p.data === 'connected') {
              setQrCode(null);
              setError(null);
              stopPolling();
              // Confirm with Whatsmiau so we don't trust a racy in-memory flag.
              apiFetch(`${API_BASE}/api/status`, {
                headers: token ? { 'Authorization': `Bearer ${token}` } : {},
              })
                .then(r => r.json())
                .then(d => { if (d.status) setWaStatus(d.status); })
                .catch(() => {});
            }
          }
        } catch {}
      };
      ws.onclose = () => { reconnectRef.current = setTimeout(connect, 5000); };
      ws.onerror = () => { setError('Não foi possível conectar ao servidor'); ws.close(); };
    }
    connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      stopPolling();
      wsRef.current?.close();
    };
  }, [subscriptionActive]);

  const refreshQR = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE}/api/qr/refresh`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (res.status === 402 || data.code === 'SUBSCRIPTION_INACTIVE') {
        setError(data.error ?? 'Ative seu plano ZeloChat para conectar o WhatsApp.');
      } else if (data.qr) {
        setQrCode(data.qr);
        setWaStatus('qr');
        startPolling();
      } else if (data.status === 'connected') {
        setWaStatus('connected');
        setQrCode(null);
        stopPolling();
      } else if (data.status === 'connecting') {
        setWaStatus('connecting');
        startPolling();
        setError('Aguardando resposta do WhatsApp. O ZeloChat vai tentar novamente automaticamente.');
      } else if (data.error) {
        setError(`Erro ao gerar QR Code: ${data.error}`);
      } else if (data.status === 'disconnected' || data.status === 'pending') {
        // Whatsmiau ainda não retornou QR (instância recém-criada ou serviço lento).
        // Mostra contexto se backend deu detalhes, senão pede pra esperar e clicar de novo.
        setError('Aguardando resposta do WhatsApp. Espere uns 10 segundos e clique em "Gerar QR Code" novamente.');
      } else {
        setError('Resposta inesperada do servidor. Tente novamente em instantes.');
      }
    } catch (err) {
      setError(
        err instanceof WaServerOfflineError
          ? err.message
          : 'Não foi possível contatar o servidor WhatsApp. Tente novamente em instantes.',
      );
    } finally {
      setIsLoading(false);
    }
  };

  const disconnectWA = async () => {
    setIsDisconnecting(true);
    setError(null);

    // Stop QR polling immediately so /api/qr/refresh can't race the disconnect
    // request and re-trigger session re-pairing on the server during logout.
    stopPolling();

    try {
      const res = await apiFetch(`${API_BASE}/api/whatsapp/disconnect`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        // Server already awaited the Whatsmiau logout — flip UI optimistically,
        // then re-verify against upstream so we catch silent failures.
        setWaStatus('disconnected');
        setQrCode(null);
        try {
          const verify = await apiFetch(`${API_BASE}/api/status`, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {},
          });
          const v = await verify.json();
          if (v.status && v.status !== 'disconnected') {
            setWaStatus(v.status);
            setError('O WhatsApp ainda aparece conectado. Tente novamente.');
          }
        } catch { /* verification is best-effort */ }
      } else {
        setError(data.error ?? 'Erro ao desconectar.');
        // Don't flip UI to 'disconnected' on failure — user should retry.
      }
    } catch (err) {
      setError(
        err instanceof WaServerOfflineError
          ? err.message
          : 'Não foi possível contatar o servidor WhatsApp.',
      );
    } finally {
      setIsDisconnecting(false);
    }
  };

  const STATUS_CONFIG = {
    connected:    { dot: 'bg-[var(--color-brand)]',   text: 'Conectado',          badge: 'bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]',  Icon: Wifi },
    qr:           { dot: 'bg-[var(--color-warn)]',    text: 'Aguardando QR Code', badge: 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]',          Icon: QrCode },
    connecting:   { dot: 'bg-[var(--color-ink-soft)]', text: 'Conectando…',       badge: 'bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)]', Icon: Loader2 },
    disconnected: { dot: 'bg-[var(--color-ink-faint)]', text: 'Desconectado',     badge: 'bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)]', Icon: WifiOff },
  };

  const cfg = STATUS_CONFIG[waStatus];

  if (!subscriptionLoading && !subscriptionActive) {
    return (
      <SectionCard icon={Smartphone} title="Integração WhatsApp">
        <SubscriptionPaywall subscription={subscription} hasPdvOnly={hasPdvOnly} token={token} onPlanChange={onPlanChange} />
      </SectionCard>
    );
  }

  return (
    <>
    <SectionCard icon={Smartphone} title="Integração WhatsApp">
      <div className="flex items-center justify-between mb-5">
        <span className={`inline-flex items-center gap-2 text-[12.5px] font-semibold px-2.5 py-1.5 rounded-full ${cfg.badge}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${waStatus === 'connecting' ? 'animate-pulse' : ''}`} />
          {cfg.text}
        </span>
      </div>

      {waStatus === 'connected' ? (
        <div className="text-center py-4 space-y-3">
          <div className="w-12 h-12 bg-[var(--color-brand-soft)] rounded-full flex items-center justify-center mx-auto">
            <Wifi className="w-6 h-6 text-[var(--color-brand-deep)]" strokeWidth={1.8} />
          </div>
          <p className="text-[14px] font-semibold">WhatsApp conectado</p>
          <p className="text-[13px] text-[var(--color-ink-muted)]">
            Mensagens sendo recebidas e respondidas automaticamente.
          </p>
          {error && (
            <div className="bg-[var(--color-alert-soft)] border border-[var(--color-alert)]/20 rounded-lg p-3">
              <p className="text-[12.5px] text-[var(--color-alert)] font-medium">{error}</p>
            </div>
          )}
          <button
            onClick={() => setConfirmDisconnect(true)}
            disabled={isDisconnecting}
            className="flex items-center gap-2 mx-auto text-[12.5px] text-[var(--color-ink-muted)] hover:text-[var(--color-alert)] disabled:opacity-50 transition-colors"
          >
            {isDisconnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" strokeWidth={1.8} />}
            {isDisconnecting ? 'Desconectando…' : 'Desconectar WhatsApp'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {qrCode ? (
            <div className="text-center space-y-3">
              <div className="inline-block p-3 bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-xl">
                <img src={qrCode} alt="QR Code WhatsApp" className="w-44 h-44 mx-auto" />
              </div>
              <p className="text-[12.5px] text-[var(--color-ink-muted)]">
                WhatsApp → <strong>Dispositivos conectados</strong> → <strong>Escanear QR Code</strong>
              </p>
            </div>
          ) : (
            <div className="text-center py-4 space-y-2">
              <div className="w-12 h-12 bg-[var(--color-surface-muted)] rounded-full flex items-center justify-center mx-auto">
                <cfg.Icon className={`w-6 h-6 text-[var(--color-ink-muted)] ${waStatus === 'connecting' ? 'animate-spin' : ''}`} strokeWidth={1.8} />
              </div>
              <p className="text-[13.5px] font-medium">
                {waStatus === 'connecting' ? 'Conectando…' : 'WhatsApp não conectado'}
              </p>
              <p className="text-[12.5px] text-[var(--color-ink-muted)]">
                {waStatus === 'connecting' ? 'Aguarde.' : 'Gere o QR Code para parear o número.'}
              </p>
            </div>
          )}

          {error && (
            <div className="bg-[var(--color-alert-soft)] border border-[var(--color-alert)]/20 rounded-lg p-3">
              <p className="text-[12.5px] text-[var(--color-alert)] font-medium">{error}</p>
            </div>
          )}

          <button
            onClick={refreshQR}
            disabled={isLoading || waStatus === 'connecting'}
            className="w-full flex items-center justify-center gap-2 bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)] disabled:bg-[var(--color-surface-muted)] disabled:text-[var(--color-ink-faint)] text-white py-2.5 rounded-lg text-[13.5px] font-semibold transition-colors"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {qrCode ? 'Atualizar QR Code' : 'Gerar QR Code'}
          </button>
        </div>
      )}
    </SectionCard>

    <ConfirmModal
      open={confirmDisconnect}
      title="Desconectar WhatsApp?"
      message="Você precisará escanear o QR Code novamente para reconectar o WhatsApp."
      onClose={() => setConfirmDisconnect(false)}
      onConfirm={disconnectWA}
      confirmLabel="Desconectar"
      confirmLoadingLabel="Desconectando..."
    />
    </>
  );
};

/**
 * Global AI kill-switch card — lets the dono silence auto-replies without disconnecting WhatsApp.
 * Messages still arrive in real time; only the bot stays quiet.
 */
interface AiGlobalToggleCardProps {
  token: string | null;
}
export const AiGlobalToggleCard = ({ token }: AiGlobalToggleCardProps) => {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setEnabled(null); return; }
    let cancelled = false;
    getAiEnabled(token)
      .then((v) => { if (!cancelled) setEnabled(v); })
      .catch(() => { if (!cancelled) setEnabled(true); });
    return () => { cancelled = true; };
  }, [token]);

  const toggle = async () => {
    if (!token || enabled === null || saving) return;
    const next = !enabled;
    setSaving(true);
    setError(null);
    setEnabled(next); // optimistic
    try {
      await setAiEnabledApi(token, next);
    } catch (err) {
      setEnabled(!next); // rollback
      setError(err instanceof WaServerOfflineError ? err.message : 'Não foi possível salvar. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  const isOn = enabled !== false;
  const Icon = isOn ? Bot : BotOff;

  return (
    <SectionCard icon={Bot} title="Assistente de IA">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <p className="text-[13.5px] font-semibold">
              {isOn ? 'IA respondendo automaticamente' : 'IA desativada — atendimento manual'}
            </p>
            <p className="text-[12.5px] text-[var(--color-ink-muted)] mt-0.5">
              {isOn
                ? 'Mensagens recebidas são respondidas pela IA quando o chat está em modo automático.'
                : 'As mensagens continuam chegando em tempo real, mas a IA não responde em nenhum chat. Você responde manualmente.'}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={isOn}
            onClick={toggle}
            disabled={!token || enabled === null || saving}
            className={`relative inline-flex items-center h-6 w-11 rounded-full transition-colors flex-shrink-0 disabled:opacity-50 ${
              isOn ? 'bg-[var(--color-brand)]' : 'bg-[var(--color-line)]'
            }`}
          >
            <span
              className={`inline-block w-5 h-5 bg-white rounded-full shadow transform transition-transform ${
                isOn ? 'translate-x-[22px]' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        <div className={`flex items-center gap-2 text-[12px] px-3 py-2 rounded-lg ${
          isOn
            ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]'
            : 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]'
        }`}>
          <Icon className="w-3.5 h-3.5" strokeWidth={2} />
          <span>{isOn ? 'Ativada globalmente' : 'Desativada globalmente'}</span>
        </div>

        {!token && (
          <p className="text-[12px] text-[var(--color-warn)]">Faça login para controlar a IA.</p>
        )}
        {error && (
          <p className="text-[12px] text-[var(--color-alert)]">{error}</p>
        )}
      </div>
    </SectionCard>
  );
};

const DAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

interface AiGlobalScheduleCardProps {
  token: string | null;
  timezone: string;
  /** Used to seed the per-day schedule when the operator switches to "Agendada" for the first time. */
  businessOpenTime: string;
  businessCloseTime: string;
  /** Current blocked_dates — passed to the natural-language parser so it can edit them. */
  blockedDates: { date: string; reason: string }[];
  /** Persist proposed blocked_dates after operator confirms a NL edit. Triggers debounced save in AppShell. */
  onUpdateBlockedDates: (next: { date: string; reason: string }[]) => void;
}

const DAY_LABELS: Record<AiScheduleDayKey, string> = {
  sun: 'Domingo',
  mon: 'Segunda',
  tue: 'Terça',
  wed: 'Quarta',
  thu: 'Quinta',
  fri: 'Sexta',
  sat: 'Sábado',
};

type DayMode = 'off' | 'allDay' | 'window';

function dayMode(day: AiScheduleDay): DayMode {
  if (!day.enabled) return 'off';
  if (day.start === day.end) return 'allDay';
  return 'window';
}

function describeDay(day: AiScheduleDay): string {
  const mode = dayMode(day);
  if (mode === 'off') return 'IA desligada';
  if (mode === 'allDay') return '24 horas';
  if (day.inverted) return `IA fora de ${day.start}–${day.end}`;
  return `${day.start} às ${day.end}`;
}

/**
 * Decide how to seed the per-day editor when the operator hasn't saved one yet.
 *
 * Preference order (so existing customers don't lose their schedule on first
 * open of the new UI):
 *   1. legacy single-window (aiScheduleStart/aiScheduleEnd) — that's the
 *      schedule actually in effect on the backend right now;
 *   2. loja business hours — when no legacy schedule exists, mirror the loja's
 *      open/close;
 *   3. commercial defaults (08:00–18:00) — last resort.
 *
 * Legacy windows that cross midnight (start > end) can't be expressed
 * cleanly per-day (we deliberately don't wrap days). When that happens we
 * fall back to business hours so the form shows something valid, and the
 * UI surfaces a warning so the operator knows their previous overnight
 * window won't translate 1:1.
 */
function seedScheduleDays(
  current: AiScheduleDays | null,
  legacyStart: string | null,
  legacyEnd: string | null,
  openTime: string,
  closeTime: string,
): AiScheduleDays {
  if (current) return current;
  const ls = normalizeAiScheduleTime(legacyStart);
  const le = normalizeAiScheduleTime(legacyEnd);
  if (ls && le && ls < le) {
    return buildDefaultAiScheduleDays(ls, le);
  }
  const start = normalizeAiScheduleTime(openTime) ?? '08:00';
  const end = normalizeAiScheduleTime(closeTime) ?? '18:00';
  if (start === end) return buildDefaultAiScheduleDays();
  return buildDefaultAiScheduleDays(start, end);
}

function formatBlockedDateLabel(iso: string): string {
  // iso = 'YYYY-MM-DD' — parse and format dd/mm/yyyy in PT-BR.
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return iso;
  const [, y, m, d] = match;
  return `${d}/${m}/${y}`;
}

function hasLegacyOvernightWindow(legacyStart: string | null, legacyEnd: string | null): boolean {
  const ls = normalizeAiScheduleTime(legacyStart);
  const le = normalizeAiScheduleTime(legacyEnd);
  return Boolean(ls && le && ls > le);
}

const AI_MODE_OPTIONS: { value: AiGlobalMode; title: string; description: string }[] = [
  {
    value: 'always_on',
    title: 'Sempre ligada',
    description: 'A IA responde automaticamente sempre que o chat estiver em modo automático.',
  },
  {
    value: 'always_off',
    title: 'Sempre desligada',
    description: 'As mensagens continuam chegando em tempo real, mas o atendimento fica manual em todos os chats.',
  },
  {
    value: 'scheduled',
    title: 'Agendada',
    description: 'Defina dia e horário: 24 horas, janela específica ou desligada — diferente em cada dia da semana.',
  },
];

function describeAiScheduleState(settings: AiSettings | null, timezone: string): {
  headline: string;
  badge: string;
  badgeTone: string;
} {
  if (!settings) {
    return {
      headline: 'Carregando configuração da IA...',
      badge: 'Verificando...',
      badgeTone: 'bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)]',
    };
  }

  const evaluation = evaluateAiSchedule({
    aiEnabled: settings.mode !== 'always_off',
    aiMode: settings.mode,
    aiScheduleStart: settings.scheduleStart,
    aiScheduleEnd: settings.scheduleEnd,
    aiScheduleDays: settings.scheduleDays,
    timezone,
  });

  if (settings.mode === 'always_on') {
    return {
      headline: 'IA respondendo automaticamente',
      badge: 'Ativada globalmente',
      badgeTone: 'bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]',
    };
  }
  if (settings.mode === 'always_off') {
    return {
      headline: 'IA desativada - atendimento manual',
      badge: 'Desativada globalmente',
      badgeTone: 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]',
    };
  }
  return {
    headline: evaluation.effectiveEnabledNow ? 'IA agendada e ativa agora' : 'IA agendada e fora da janela agora',
    badge: evaluation.effectiveEnabledNow ? 'Ativa agora' : 'Fora da janela agora',
    badgeTone: evaluation.effectiveEnabledNow
      ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]'
      : 'bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)]',
  };
}

export const AiGlobalScheduleCard = ({
  token,
  timezone,
  businessOpenTime,
  businessCloseTime,
  blockedDates,
  onUpdateBlockedDates,
}: AiGlobalScheduleCardProps) => {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Open the wizard explicitly (e.g. after clicking "Reconfigurar"). */
  const [wizardOpen, setWizardOpen] = useState(false);
  /** Disclosure for the legacy per-day editor — kept as power-user escape. */
  const [advancedOpen, setAdvancedOpen] = useState(false);
  /** Natural-language incremental-edit state. */
  const [nlInput, setNlInput] = useState('');
  const [nlLoading, setNlLoading] = useState(false);
  const [nlError, setNlError] = useState<string | null>(null);
  const [nlProposal, setNlProposal] = useState<
    | {
        mode: AiGlobalMode;
        scheduleDays: AiScheduleDays | null;
        blockedDates: { date: string; reason: string }[] | null;
        summary: string;
      }
    | null
  >(null);

  useEffect(() => {
    if (!token) { setSettings(null); return; }
    let cancelled = false;
    getAiSettings(token)
      .then((value) => { if (!cancelled) setSettings(value); })
      .catch(() => {
        if (!cancelled) {
          setSettings({ mode: 'always_on', scheduleStart: null, scheduleEnd: null, scheduleDays: null });
        }
      });
    return () => { cancelled = true; };
  }, [token]);

  const saveSettings = async (next: AiSettings) => {
    if (!token || saving) return;
    const previous = settings;
    setSaving(true);
    setError(null);
    setSettings(next);
    try {
      const saved = await setAiSettingsApi(token, next);
      setSettings(saved);
    } catch (err) {
      setSettings(previous);
      setError(err instanceof WaServerOfflineError ? err.message : 'Não foi possível salvar. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  const updateMode = async (mode: AiGlobalMode) => {
    if (!settings) return;
    if (mode === 'scheduled') {
      setError(null);
      setAdvancedOpen(false);
      // Empty schedule → open the wizard. Existing schedule → show summary
      // so operator can either confirm what's already saved or click
      // "Reconfigurar" to reopen the wizard pre-filled.
      const hasSchedule = settings.scheduleDays !== null;
      setWizardOpen(!hasSchedule);
      const scheduleDays = settings.scheduleDays
        ?? seedScheduleDays(null, settings.scheduleStart, settings.scheduleEnd, businessOpenTime, businessCloseTime);
      setSettings((prev) => prev ? { ...prev, mode, scheduleDays } : prev);
      return;
    }
    setWizardOpen(false);
    setAdvancedOpen(false);
    await saveSettings({
      mode,
      scheduleStart: settings.scheduleStart,
      scheduleEnd: settings.scheduleEnd,
      scheduleDays: settings.scheduleDays,
    });
  };

  const handleWizardConfirm = async (payload: {
    mode: 'always_on' | 'scheduled';
    scheduleDays: AiScheduleDays | null;
  }) => {
    if (!settings) return;
    await saveSettings({
      mode: payload.mode,
      scheduleStart: settings.scheduleStart,
      scheduleEnd: settings.scheduleEnd,
      scheduleDays: payload.scheduleDays,
    });
    setWizardOpen(false);
  };

  const submitNaturalLanguageEdit = async () => {
    if (!token || !settings) return;
    const description = nlInput.trim();
    if (!description) return;
    setNlLoading(true);
    setNlError(null);
    setNlProposal(null);
    try {
      const proposal = await parseScheduleDescription(token, {
        description,
        currentSchedule: settings.scheduleDays,
        currentBlockedDates: blockedDates,
      });
      setNlProposal(proposal);
    } catch (err) {
      setNlError(err instanceof WaServerOfflineError
        ? err.message
        : 'Não consegui entender. Tente reformular ou edite manualmente.');
    } finally {
      setNlLoading(false);
    }
  };

  const confirmNaturalLanguageProposal = async () => {
    if (!nlProposal || !settings) return;
    if (nlProposal.mode === 'scheduled' && !nlProposal.scheduleDays) {
      setNlError('Proposta inválida — tente reformular.');
      return;
    }
    // Apply blocked_dates change first (debounced auto-save in AppShell)
    // so the user's state is consistent before we kick the schedule save.
    if (nlProposal.blockedDates) {
      onUpdateBlockedDates(nlProposal.blockedDates);
    }
    await saveSettings({
      mode: nlProposal.mode,
      scheduleStart: settings.scheduleStart,
      scheduleEnd: settings.scheduleEnd,
      scheduleDays: nlProposal.scheduleDays,
    });
    setNlProposal(null);
    setNlInput('');
  };

  const cancelNaturalLanguageProposal = () => {
    setNlProposal(null);
    setNlError(null);
  };

  const updateDay = (dayKey: AiScheduleDayKey, patch: Partial<AiScheduleDay>) => {
    setSettings((prev) => {
      if (!prev) return prev;
      const current = prev.scheduleDays ?? seedScheduleDays(null, prev.scheduleStart, prev.scheduleEnd, businessOpenTime, businessCloseTime);
      const nextDay: AiScheduleDay = { ...current[dayKey], ...patch };
      return {
        ...prev,
        scheduleDays: { ...current, [dayKey]: nextDay },
      };
    });
  };

  const setDayMode = (dayKey: AiScheduleDayKey, next: DayMode) => {
    setSettings((prev) => {
      if (!prev) return prev;
      const current = prev.scheduleDays ?? seedScheduleDays(null, prev.scheduleStart, prev.scheduleEnd, businessOpenTime, businessCloseTime);
      const day = current[dayKey];
      let nextDay: AiScheduleDay;
      if (next === 'off') {
        nextDay = { ...day, enabled: false };
      } else if (next === 'allDay') {
        // inverted is meaningless for 24h-on; clear it so a future flip back
        // to 'window' doesn't surprise the operator with stale polarity.
        nextDay = { enabled: true, start: '00:00', end: '00:00', inverted: false };
      } else {
        // 'window' — re-enable; if the previous start/end was a 24h placeholder
        // (start === end), seed something sensible so both inputs have a value.
        const start = day.start !== day.end ? day.start : '08:00';
        const end = day.start !== day.end ? day.end : '18:00';
        nextDay = { enabled: true, start, end, inverted: day.inverted };
      }
      return {
        ...prev,
        scheduleDays: { ...current, [dayKey]: nextDay },
      };
    });
  };

  const saveSchedule = async () => {
    if (!settings) return;
    const days = settings.scheduleDays ?? seedScheduleDays(null, settings?.scheduleStart ?? null, settings?.scheduleEnd ?? null, businessOpenTime, businessCloseTime);
    let firstInvalid: { dayKey: AiScheduleDayKey; reason: string } | null = null;
    let hasEnabled = false;
    for (const key of AI_SCHEDULE_DAY_KEYS) {
      const day = days[key];
      if (!day.enabled) continue;
      hasEnabled = true;
      if (day.start === day.end) continue; // 24h is valid
      const start = normalizeAiScheduleTime(day.start);
      const end = normalizeAiScheduleTime(day.end);
      if (!start || !end) {
        firstInvalid = { dayKey: key, reason: 'Informe horários válidos.' };
        break;
      }
      if (start >= end) {
        firstInvalid = { dayKey: key, reason: 'O horário inicial precisa ser antes do final.' };
        break;
      }
    }
    if (firstInvalid) {
      setError(`${DAY_LABELS[firstInvalid.dayKey]}: ${firstInvalid.reason}`);
      return;
    }
    if (!hasEnabled) {
      setError('Habilite pelo menos um dia para a agenda da IA.');
      return;
    }
    await saveSettings({ ...settings, scheduleDays: days });
  };

  const status = describeAiScheduleState(settings, timezone);
  const mode = settings?.mode ?? 'always_on';
  const StatusIcon = mode === 'always_off' ? BotOff : Bot;
  const scheduleDays = mode === 'scheduled' && settings
    ? (settings.scheduleDays ?? seedScheduleDays(null, settings?.scheduleStart ?? null, settings?.scheduleEnd ?? null, businessOpenTime, businessCloseTime))
    : null;

  return (
    <SectionCard icon={Bot} title="Assistente de IA">
      <div className="space-y-4">
        <div className="space-y-1">
          <p className="text-[13.5px] font-semibold">{status.headline}</p>
          <p className="text-[12.5px] text-[var(--color-ink-muted)] mt-0.5">
            A agenda global da IA só libera respostas automáticas quando o chat também estiver em modo automático.
          </p>
        </div>

        <div className={`flex items-center gap-2 text-[12px] px-3 py-2 rounded-lg ${status.badgeTone}`}>
          <StatusIcon className="w-3.5 h-3.5" strokeWidth={2} />
          <span>{status.badge}</span>
        </div>

        <div className="grid grid-cols-1 gap-2">
          {AI_MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => void updateMode(option.value)}
              disabled={!token || !settings || saving}
              className={`text-left rounded-xl border px-3 py-3 transition-colors ${
                mode === option.value
                  ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)]/50'
                  : 'border-[var(--color-line)] bg-[var(--color-surface-muted)] hover:bg-[var(--color-surface)]'
              } disabled:opacity-50`}
            >
              <p className="text-[13px] font-semibold">{option.title}</p>
              <p className="text-[12px] text-[var(--color-ink-muted)] mt-1">{option.description}</p>
            </button>
          ))}
        </div>

        {mode === 'scheduled' && settings && (() => {
          // Reverse-engineer the saved schedule into wizard state so
          // "Reconfigurar" opens with the operator's existing answers
          // pre-filled instead of starting blank.
          const wizardInitial = settings.scheduleDays
            ? reverseEngineerWizardState('scheduled', settings.scheduleDays)
            : null;
          const showWizard = wizardOpen || !settings.scheduleDays;
          if (showWizard) {
            return (
              <ScheduleWizard
                initial={wizardInitial}
                saving={saving}
                onConfirm={handleWizardConfirm}
                onCancel={settings.scheduleDays ? () => setWizardOpen(false) : undefined}
              />
            );
          }
          // Summary view — operator saved a schedule; show what it looks like.
          const summary = summarizeScheduleResult({ mode: 'scheduled', scheduleDays: settings.scheduleDays });
          return (
            <div className="space-y-3">
              <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-muted)] p-3 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-semibold">Agenda salva</p>
                    <p className="text-[12px] text-[var(--color-ink-muted)] mt-0.5">{summary.headline}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setWizardOpen(true)}
                    disabled={saving}
                    className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)] text-white text-[12px] font-semibold disabled:opacity-50"
                  >
                    <Sparkles className="w-3.5 h-3.5" /> Reconfigurar
                  </button>
                </div>
                <ScheduleVisualPreview scheduleDays={settings.scheduleDays} />
                <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 space-y-0.5">
                  {summary.lines.map((line) => (
                    <div key={line.day} className="flex items-center justify-between text-[12px]">
                      <span className="text-[var(--color-ink-muted)] w-12">{WIZARD_DAY_LABELS[line.day]}</span>
                      <span className="text-[var(--color-ink)] text-right flex-1">{line.label}</span>
                    </div>
                  ))}
                </div>

                {(() => {
                  // Surface upcoming blocked dates so the operator knows the
                  // schedule is being overridden on those days. List the next
                  // 3 that haven't passed; "Em datas bloqueadas, a IA cobre"
                  // is the rule the gate now applies — see CLAUDE.md
                  // §"Agenda global da IA".
                  const todayIso = new Intl.DateTimeFormat('en-CA', {
                    timeZone: timezone || 'America/Sao_Paulo',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                  }).format(new Date());
                  const upcoming = blockedDates
                    .filter((d) => d.date >= todayIso)
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .slice(0, 3);
                  return (
                    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 space-y-1">
                      <p className="text-[11.5px] text-[var(--color-ink-muted)]">
                        <strong>Datas bloqueadas:</strong> nesses dias a IA cobre o WhatsApp 24h (mas não aceita pedidos — a loja não está operando).
                      </p>
                      {upcoming.length > 0 && (
                        <ul className="text-[11.5px] text-[var(--color-ink)] space-y-0.5 pt-1">
                          {upcoming.map((d) => (
                            <li key={d.date}>
                              • {formatBlockedDateLabel(d.date)}
                              {d.reason && <span className="text-[var(--color-ink-muted)]"> — {d.reason}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                      {upcoming.length === 0 && (
                        <p className="text-[11px] text-[var(--color-ink-faint)]">Nenhuma data bloqueada nos próximos dias.</p>
                      )}
                    </div>
                  );
                })()}

                {/* Natural-language incremental edit. Operator types
                    "muda quarta pra 24h"; backend LLM returns a proposed
                    schedule; we render a diff preview before saving. */}
                {nlProposal ? (
                  <div className="rounded-lg border border-[var(--color-brand)] bg-[var(--color-brand-soft)]/30 p-2.5 space-y-2">
                    <p className="text-[12px] text-[var(--color-brand-deep)] font-semibold">
                      {nlProposal.summary}
                    </p>
                    {nlProposal.mode === 'scheduled' && (
                      <ScheduleVisualPreview scheduleDays={nlProposal.scheduleDays} />
                    )}
                    {nlProposal.mode === 'always_on' && (
                      <p className="text-[12px] text-[var(--color-ink-muted)]">A IA passa a responder 24 horas, todos os dias.</p>
                    )}
                    {nlProposal.mode === 'always_off' && (
                      <p className="text-[12px] text-[var(--color-ink-muted)]">A IA fica desligada — atendimento manual.</p>
                    )}
                    {nlProposal.blockedDates && (() => {
                      const currentKeys = new Set(blockedDates.map((d) => d.date));
                      const proposedKeys = new Set(nlProposal.blockedDates.map((d) => d.date));
                      const added = nlProposal.blockedDates.filter((d) => !currentKeys.has(d.date));
                      const removed = blockedDates.filter((d) => !proposedKeys.has(d.date));
                      if (added.length === 0 && removed.length === 0) return null;
                      return (
                        <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 space-y-1">
                          <p className="text-[11px] text-[var(--color-ink-faint)] uppercase tracking-wide">Datas bloqueadas</p>
                          {added.map((d) => (
                            <p key={`add-${d.date}`} className="text-[12px] text-[var(--color-brand-deep)]">
                              + {formatBlockedDateLabel(d.date)} {d.reason && <span className="text-[var(--color-ink-muted)]">— {d.reason}</span>}
                            </p>
                          ))}
                          {removed.map((d) => (
                            <p key={`rm-${d.date}`} className="text-[12px] text-[var(--color-alert)] line-through">
                              − {formatBlockedDateLabel(d.date)} {d.reason && <span className="text-[var(--color-ink-muted)]">— {d.reason}</span>}
                            </p>
                          ))}
                        </div>
                      );
                    })()}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void confirmNaturalLanguageProposal()}
                        disabled={saving}
                        className="flex-1 flex items-center justify-center gap-1 bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)] disabled:opacity-50 text-white px-3 py-2 rounded-lg text-[12.5px] font-semibold"
                      >
                        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        Aplicar mudança
                      </button>
                      <button
                        type="button"
                        onClick={cancelNaturalLanguageProposal}
                        disabled={saving}
                        className="px-3 py-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] text-[12.5px] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <p className="text-[11.5px] text-[var(--color-ink-muted)]">
                      Quer ajustar algo? Descreva em uma frase:
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={nlInput}
                        onChange={(e) => setNlInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !nlLoading) {
                            e.preventDefault();
                            void submitNaturalLanguageEdit();
                          }
                        }}
                        placeholder='Ex: "muda quarta pra 24h" ou "domingo só de tarde"'
                        disabled={!token || nlLoading || saving}
                        className={`${FIELD} text-[12.5px]`}
                      />
                      <button
                        type="button"
                        onClick={() => void submitNaturalLanguageEdit()}
                        disabled={!token || nlLoading || saving || !nlInput.trim()}
                        className="shrink-0 flex items-center gap-1 px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)] hover:border-[var(--color-brand)] text-[12.5px] disabled:opacity-50"
                      >
                        {nlLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                        Pedir
                      </button>
                    </div>
                    {nlError && <p className="text-[11.5px] text-[var(--color-alert)]">{nlError}</p>}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => setAdvancedOpen((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] text-[12px] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
              >
                <span className="flex items-center gap-1.5">
                  <Settings2 className="w-3.5 h-3.5" /> Editar manualmente (avançado)
                </span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
              </button>

              {advancedOpen && scheduleDays && (
                <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-muted)] p-3 space-y-3">
                  <p className="text-[12px] text-[var(--color-ink-muted)]">
                    Editor dia a dia. Use só se a agenda que você quer não couber no assistente — por exemplo, horários diferentes em cada dia.
                  </p>
                  {!settings.scheduleDays && hasLegacyOvernightWindow(settings.scheduleStart, settings.scheduleEnd) && (
                    <p className="text-[12px] text-[var(--color-warn)]">
                      Sua agenda atual ({settings.scheduleStart}–{settings.scheduleEnd}) cruza a madrugada. Revise os horários de cada dia antes de salvar.
                    </p>
                  )}
                  <div className="space-y-2">
                    {AI_SCHEDULE_DAY_KEYS.map((key) => {
                      const day = scheduleDays[key];
                      const currentMode = dayMode(day);
                      return (
                        <div
                          key={key}
                          className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-2.5 space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[13px] font-semibold">{DAY_LABELS[key]}</p>
                              <p className="text-[11.5px] text-[var(--color-ink-muted)]">{describeDay(day)}</p>
                            </div>
                            <div className="flex rounded-md border border-[var(--color-line)] overflow-hidden text-[11.5px]">
                              {(['off', 'allDay', 'window'] as DayMode[]).map((option) => {
                                const label = option === 'off' ? 'Desligada' : option === 'allDay' ? '24 horas' : 'Horário';
                                const active = currentMode === option;
                                return (
                                  <button
                                    key={option}
                                    type="button"
                                    onClick={() => setDayMode(key, option)}
                                    disabled={!token || saving}
                                    className={`px-2.5 py-1.5 transition-colors ${
                                      active
                                        ? 'bg-[var(--color-brand)] text-white'
                                        : 'bg-transparent text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)]'
                                    } disabled:opacity-50`}
                                  >
                                    {label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                          {currentMode === 'window' && (
                            <div className="space-y-2">
                              <div className="grid grid-cols-2 gap-2">
                                <label>
                                  <span className={LABEL}>{day.inverted ? 'Humano das' : 'Liga às'}</span>
                                  <input
                                    type="time"
                                    value={day.start}
                                    onChange={(e) => updateDay(key, { start: e.target.value })}
                                    disabled={!token || saving}
                                    className={FIELD}
                                  />
                                </label>
                                <label>
                                  <span className={LABEL}>{day.inverted ? 'até as' : 'Desliga às'}</span>
                                  <input
                                    type="time"
                                    value={day.end}
                                    onChange={(e) => updateDay(key, { end: e.target.value })}
                                    disabled={!token || saving}
                                    className={FIELD}
                                  />
                                </label>
                              </div>
                              <div className="flex rounded-md border border-[var(--color-line)] overflow-hidden text-[11.5px]">
                                {[
                                  { value: false, label: 'IA DENTRO desse horário' },
                                  { value: true, label: 'IA FORA desse horário' },
                                ].map((option) => {
                                  const active = day.inverted === option.value;
                                  return (
                                    <button
                                      key={String(option.value)}
                                      type="button"
                                      onClick={() => updateDay(key, { inverted: option.value })}
                                      disabled={!token || saving}
                                      className={`flex-1 px-2.5 py-1.5 transition-colors ${
                                        active
                                          ? 'bg-[var(--color-brand)] text-white'
                                          : 'bg-transparent text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)]'
                                      } disabled:opacity-50`}
                                    >
                                      {option.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => void saveSchedule()}
                    disabled={!token || saving}
                    className="w-full flex items-center justify-center gap-2 bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)] disabled:opacity-50 text-white py-2.5 rounded-lg text-[13.5px] font-semibold transition-colors"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {saving ? 'Salvando...' : 'Salvar agenda'}
                  </button>
                </div>
              )}
            </div>
          );
        })()}

        {!token && (
          <p className="text-[12px] text-[var(--color-warn)]">Faça login para controlar a IA.</p>
        )}
        {error && (
          <p className="text-[12px] text-[var(--color-alert)]">{error}</p>
        )}
      </div>
    </SectionCard>
  );
};

type SettingsState = Pick<
  ZeloState,
  'aiInstructions' | 'blockedDates' | 'businessInfo' | 'deliveryConfig' | 'drivers' | 'quickResponses' | 'triggers'
>;

interface SettingsViewProps {
  state: SettingsState;
  setState: React.Dispatch<React.SetStateAction<ZeloState>>;
  empresa: EmpresaPerfil | null;
  saveEmpresa: (patch: Partial<Omit<EmpresaPerfil, 'id'>>) => Promise<boolean>;
  isAuthenticated: boolean;
  token: string | null;
  zelochatMode?: ZeloChatMode;
}

type CustomerNotifyKey = 'notify_customer_preparing' | 'notify_customer_ready' | 'notify_customer_out_for_delivery';

interface NotifyRow {
  key: CustomerNotifyKey;
  icon: typeof Clock;
  title: string;
  description: string;
}

const NOTIFY_ROWS: NotifyRow[] = [
  {
    key: 'notify_customer_preparing',
    icon: ChefHat,
    title: 'Em preparo',
    description: 'Avisamos no WhatsApp do cliente assim que o pedido entra em preparo.',
  },
  {
    key: 'notify_customer_ready',
    icon: CheckCircle2,
    title: 'Pronto',
    description: 'Avisamos quando o pedido fica pronto, antes do despacho.',
  },
  {
    key: 'notify_customer_out_for_delivery',
    icon: Bike,
    title: 'Saiu pra entrega',
    description: 'Avisamos quando o motoboy sai com o pedido a caminho do cliente.',
  },
];

const CustomerNotificationsCard = ({
  empresa,
  saveEmpresa,
  isAuthenticated,
}: {
  empresa: EmpresaPerfil | null;
  saveEmpresa: (patch: Partial<Omit<EmpresaPerfil, 'id'>>) => Promise<boolean>;
  isAuthenticated: boolean;
}) => {
  const [savingKey, setSavingKey] = useState<CustomerNotifyKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (key: CustomerNotifyKey) => {
    if (!empresa || savingKey) return;
    const next = !empresa[key];
    setSavingKey(key);
    setError(null);
    const ok = await saveEmpresa({ [key]: next } as Partial<Omit<EmpresaPerfil, 'id'>>);
    if (!ok) setError('Não foi possível salvar. Tente novamente.');
    setSavingKey(null);
  };

  return (
    <SectionCard icon={Bell} title="Notificações ao cliente">
      <div className="space-y-1">
        <p className="text-[12.5px] text-[var(--color-ink-muted)] mb-3">
          Envie atualizações automáticas no WhatsApp do cliente a cada mudança de status do pedido.
        </p>
        <div className="divide-y divide-[var(--color-line)]">
          {NOTIFY_ROWS.map((row) => {
            const isOn = empresa ? empresa[row.key] : false;
            const RowIcon = row.icon;
            const isSaving = savingKey === row.key;
            return (
              <div key={row.key} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="flex items-start gap-3 flex-1">
                  <div className="w-7 h-7 rounded-md bg-[var(--color-surface-muted)] border border-[var(--color-line)] flex items-center justify-center flex-shrink-0 mt-0.5">
                    <RowIcon className="w-3.5 h-3.5 text-[var(--color-ink-muted)]" strokeWidth={1.8} />
                  </div>
                  <div className="flex-1">
                    <p className="text-[13.5px] font-semibold">{row.title}</p>
                    <p className="text-[12px] text-[var(--color-ink-muted)] mt-0.5">{row.description}</p>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isOn}
                  onClick={() => void toggle(row.key)}
                  disabled={!isAuthenticated || !empresa || isSaving}
                  className={`relative inline-flex items-center h-6 w-11 rounded-full transition-colors flex-shrink-0 disabled:opacity-50 mt-1 ${
                    isOn ? 'bg-[var(--color-brand)]' : 'bg-[var(--color-line)]'
                  }`}
                >
                  <span className={`inline-block w-5 h-5 bg-white rounded-full shadow transform transition-transform ${isOn ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
                </button>
              </div>
            );
          })}
        </div>
        {!isAuthenticated && (
          <p className="text-[12px] text-[var(--color-warn)] mt-3">Faça login para ativar as notificações.</p>
        )}
        {error && <p className="text-[12px] text-[var(--color-alert)] mt-3">{error}</p>}
      </div>
    </SectionCard>
  );
};

const DeliveryConfigCard = ({
  state,
  setState,
  saveEmpresa,
  isAuthenticated,
}: Pick<SettingsViewProps, 'state' | 'setState' | 'saveEmpresa' | 'isAuthenticated'>) => {
  const current = state.deliveryConfig ?? { enabled: false, neighborhoods: [] };
  const [draft, setDraft] = useState<DeliveryConfig>(current);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [newName, setNewName] = useState('');
  const [newFee, setNewFee] = useState('');

  useEffect(() => {
    setDraft(state.deliveryConfig ?? { enabled: false, neighborhoods: [] });
  }, [state.deliveryConfig]);

  const isDirty = JSON.stringify(draft) !== JSON.stringify(state.deliveryConfig ?? { enabled: false, neighborhoods: [] });

  const handleSave = async () => {
    setSaveState('saving');
    const ok = await saveEmpresa({ delivery_config: draft });
    if (ok) {
      setState(prev => ({ ...prev, deliveryConfig: draft }));
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2500);
    } else {
      setSaveState('error');
      setTimeout(() => setSaveState('idle'), 3000);
    }
  };

  const addNeighborhood = () => {
    const name = newName.trim();
    const fee = parseFloat(newFee.replace(',', '.'));
    if (!name || isNaN(fee) || fee < 0) return;
    setDraft(prev => ({ ...prev, neighborhoods: [...prev.neighborhoods, { name, fee }] }));
    setNewName('');
    setNewFee('');
  };

  const removeNeighborhood = (idx: number) => {
    setDraft(prev => ({ ...prev, neighborhoods: prev.neighborhoods.filter((_, i) => i !== idx) }));
  };

  const updateFee = (idx: number, val: string) => {
    const fee = parseFloat(val.replace(',', '.'));
    if (isNaN(fee)) return;
    setDraft(prev => ({
      ...prev,
      neighborhoods: prev.neighborhoods.map((n, i) => i === idx ? { ...n, fee } : n),
    }));
  };

  return (
    <SectionCard icon={Bike} title="Entrega (delivery)">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium">Aceita entregas</p>
            <p className="text-[11.5px] text-[var(--color-ink-faint)]">A IA vai perguntar o modo e calcular a taxa automaticamente</p>
          </div>
          <button
            onClick={() => setDraft(prev => ({ ...prev, enabled: !prev.enabled }))}
            disabled={!isAuthenticated}
            className={`relative inline-flex items-center h-6 w-11 rounded-full transition-colors flex-shrink-0 disabled:opacity-50 ${
              draft.enabled ? 'bg-[var(--color-brand)]' : 'bg-[var(--color-line)]'
            }`}
          >
            <span className={`inline-block w-5 h-5 bg-white rounded-full shadow transform transition-transform ${draft.enabled ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
          </button>
        </div>

        {draft.enabled && (
          <>
            <div>
              <label className={LABEL}>Bairros atendidos e taxas</label>
              {draft.neighborhoods.length === 0 ? (
                <p className="text-[12px] text-[var(--color-ink-faint)] py-2">Nenhum bairro cadastrado ainda.</p>
              ) : (
                <div className="space-y-1.5 mb-3">
                  {draft.neighborhoods.map((n: DeliveryNeighborhood, idx: number) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="flex-1 text-[13px] bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg px-3 py-2">{n.name}</span>
                      <div className="flex items-center gap-1 bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg px-2">
                        <span className="text-[12px] text-[var(--color-ink-muted)]">R$</span>
                        <input
                          type="number"
                          min="0"
                          step="0.50"
                          value={n.fee}
                          onChange={e => updateFee(idx, e.target.value)}
                          className="w-16 bg-transparent py-2 text-[13px] outline-none"
                        />
                      </div>
                      <button
                        onClick={() => removeNeighborhood(idx)}
                        className="p-2 text-[var(--color-ink-faint)] hover:text-[var(--color-alert)] transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Nome do bairro"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addNeighborhood()}
                  className="flex-1 bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-[var(--color-brand)]/25 focus:border-[var(--color-brand)]"
                />
                <div className="flex items-center gap-1 bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg px-2">
                  <span className="text-[12px] text-[var(--color-ink-muted)]">R$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.50"
                    placeholder="0,00"
                    value={newFee}
                    onChange={e => setNewFee(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addNeighborhood()}
                    className="w-16 bg-transparent py-2 text-[13px] outline-none"
                  />
                </div>
                <button
                  onClick={addNeighborhood}
                  disabled={!newName.trim() || !newFee}
                  className="p-2 bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)] disabled:opacity-40 text-white rounded-lg transition-colors"
                >
                  <Plus className="w-4 h-4" strokeWidth={2.5} />
                </button>
              </div>
            </div>

            <p className="text-[11.5px] text-[var(--color-ink-faint)]">
              Bairros fora desta lista são encaminhados automaticamente para atendimento humano.
            </p>
          </>
        )}

        {isDirty && (
          <button
            onClick={handleSave}
            disabled={saveState === 'saving' || !isAuthenticated}
            className="w-full flex items-center justify-center gap-2 bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)] disabled:opacity-50 text-white py-2.5 rounded-lg text-[13.5px] font-semibold transition-colors"
          >
            {saveState === 'saving' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {saveState === 'saving' ? 'Salvando…' : 'Salvar configuração de entrega'}
          </button>
        )}
        {saveState === 'saved' && <p className="text-[12.5px] text-[var(--color-brand)] text-center font-medium">✓ Salvo com sucesso</p>}
        {saveState === 'error' && <p className="text-[12.5px] text-[var(--color-alert)] text-center font-medium">Erro ao salvar. Verifique a conexão.</p>}
        {!isAuthenticated && <p className="text-[12px] text-[var(--color-warn)] text-center">Faça login para salvar.</p>}
      </div>
    </SectionCard>
  );
};

function TimeInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex-1">
      <label className="block text-[11.5px] font-medium text-[var(--color-ink-muted)] mb-1">{label}</label>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg px-3 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-[var(--color-brand)]/25 focus:border-[var(--color-brand)] transition-colors"
      />
    </div>
  );
}

export const SettingsView = ({ state, setState, empresa, saveEmpresa, isAuthenticated, token, zelochatMode }: SettingsViewProps) => {
  const { session } = useSupabaseSession();
  const { subscription, isActive: subscriptionActive, hasPdvOnly, loading: subscriptionLoading, refresh: refreshSubscription } = useSubscription(session);
  const isGeneralMode = normalizeZeloChatMode(zelochatMode ?? empresa?.zelochat_mode) === 'general';
  const [planChangeOpen, setPlanChangeOpen] = useState(false);
  const handlePlanChange = () => {
    if (!subscription) return;
    setPlanChangeOpen(true);
  };

  const toast = useToast();

  // P1.40 — Persist unsaved drafts to localStorage so the user doesn't lose
  // in-progress edits when the session expires and they're redirected to login.
  const serverBusinessInfo = {
    name:         state.businessInfo.name,
    address:      state.businessInfo.address,
    phone:        state.businessInfo.phone,
    pixKey:       state.businessInfo.pixKey,
    managerPhone: state.businessInfo.managerPhone,
  };
  const {
    draft,
    setDraft,
    clearDraft: clearBusinessDraft,
    isDirtyVsServer: isDirty,
    hasStoredDraft: hasBusinessDraft,
  } = useLocalDraft('business', serverBusinessInfo);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const serverHours = {
    openTime:   state.businessInfo.openTime,
    closeTime:  state.businessInfo.closeTime,
    closedDays: state.businessInfo.closedDays,
  };
  const {
    draft: hoursDraft,
    setDraft: setHoursDraft,
    clearDraft: clearHoursDraft,
    isDirtyVsServer: isHoursDirty,
    hasStoredDraft: hasHoursDraft,
  } = useLocalDraft('hours', serverHours);
  const [hoursSaveState, setHoursSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Notify the user once on mount if a stored draft was found.
  useEffect(() => {
    if (hasBusinessDraft || hasHoursDraft) {
      toast.info('Encontramos alterações não salvas neste formulário. Revise e salve para não perdê-las.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveEmpresa = async () => {
    setSaveState('saving');
    const ok = await saveEmpresa({
      nome_exibicao: draft.name    || undefined,
      endereco:      draft.address || undefined,
      contato:       draft.phone   || undefined,
      chave_pix:     draft.pixKey  || undefined,
      manager_phone: draft.managerPhone || null,
    });
    if (ok) {
      // Commit to global state
      setState(prev => ({
        ...prev,
        businessInfo: {
          ...prev.businessInfo,
          name:    draft.name,
          address: draft.address,
          phone:   draft.phone,
          pixKey:  draft.pixKey,
          managerPhone: draft.managerPhone,
        },
      }));
      clearBusinessDraft();
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2500);
    } else {
      setSaveState('error');
      setTimeout(() => setSaveState('idle'), 3000);
    }
  };

  const handleSaveHours = async () => {
    setHoursSaveState('saving');
    const ok = await saveEmpresa({
      horario_abertura:  hoursDraft.openTime  || null,
      horario_fechamento: hoursDraft.closeTime || null,
      dias_fechamento:   hoursDraft.closedDays,
    });
    if (ok) {
      setState(prev => ({
        ...prev,
        businessInfo: {
          ...prev.businessInfo,
          openTime:   hoursDraft.openTime,
          closeTime:  hoursDraft.closeTime,
          closedDays: hoursDraft.closedDays,
        },
      }));
      clearHoursDraft();
      setHoursSaveState('saved');
      setTimeout(() => setHoursSaveState('idle'), 2500);
    } else {
      setHoursSaveState('error');
      setTimeout(() => setHoursSaveState('idle'), 3000);
    }
  };

  const toggleDay = (day: string) => {
    setHoursDraft(prev => ({
      ...prev,
      closedDays: prev.closedDays.includes(day)
        ? prev.closedDays.filter(d => d !== day)
        : [...prev.closedDays, day],
    }));
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
      <div className="max-w-[1100px] mx-auto px-8 py-8 space-y-6">
        <header>
          <h1 className="text-[22px] font-semibold tracking-tight">Configurações</h1>
          <p className="text-[13px] text-[var(--color-ink-muted)]">Dados da empresa, horários e preferências do sistema.</p>
        </header>

        <div className="space-y-8">
          <TierGroup
            label="Operação"
            description="Status do sistema e atendimento — muda no dia-a-dia."
          >
            <WhatsAppIntegrationCard
              token={token}
              subscriptionActive={subscriptionActive}
              subscriptionLoading={subscriptionLoading}
              subscription={subscription}
              hasPdvOnly={hasPdvOnly}
              onPlanChange={handlePlanChange}
            />

            {token && subscriptionActive ? <PublicLinkCard token={token} /> : null}
            {token && subscriptionActive ? <ZeloMenuSettingsCard token={token} /> : null}

            <AiGlobalScheduleCard
              token={token}
              timezone={state.businessInfo.timezone}
              businessOpenTime={state.businessInfo.openTime}
              businessCloseTime={state.businessInfo.closeTime}
              blockedDates={state.blockedDates}
              onUpdateBlockedDates={(next) => setState((prev) => ({ ...prev, blockedDates: next }))}
            />

            <SectionCard icon={Clock} title="Horários e atendimento">
              <div className="space-y-3">
                <div className="flex gap-3">
                  <TimeInput
                    label="Abre às"
                    value={hoursDraft.openTime}
                    onChange={v => setHoursDraft(p => ({ ...p, openTime: v }))}
                  />
                  <TimeInput
                    label="Fecha às"
                    value={hoursDraft.closeTime}
                    onChange={v => setHoursDraft(p => ({ ...p, closeTime: v }))}
                  />
                </div>
                <div>
                  <label className={LABEL}>Dias de fechamento</label>
                  <div className="flex gap-2 flex-wrap mt-2">
                    {DAYS.map(day => {
                      const closed = hoursDraft.closedDays.includes(day);
                      return (
                        <button
                          key={day}
                          onClick={() => toggleDay(day)}
                          className={`px-3 py-1.5 rounded-lg text-[12.5px] font-semibold transition-all ${
                            closed
                              ? 'bg-[var(--color-alert)] text-white'
                              : 'bg-[var(--color-surface-muted)] text-[var(--color-ink-soft)] hover:bg-[var(--color-line)]'
                          }`}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[12px] text-[var(--color-ink-faint)] mt-2">
                    Dias em vermelho = fechados. A IA não aceitará pedidos nesses dias.
                  </p>
                </div>

                {isHoursDirty && (
                  <button
                    onClick={handleSaveHours}
                    disabled={hoursSaveState === 'saving' || !isAuthenticated}
                    className="w-full flex items-center justify-center gap-2 bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)] disabled:opacity-50 text-white py-2.5 rounded-lg text-[13.5px] font-semibold transition-colors"
                  >
                    {hoursSaveState === 'saving' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {hoursSaveState === 'saving' ? 'Salvando…' : 'Salvar horários'}
                  </button>
                )}
                {hoursSaveState === 'saved' && (
                  <p className="text-[12.5px] text-[var(--color-brand)] text-center font-medium">✓ Salvo com sucesso</p>
                )}
                {hoursSaveState === 'error' && (
                  <p className="text-[12.5px] text-[var(--color-alert)] text-center font-medium">Erro ao salvar. Verifique a conexão.</p>
                )}
                {isHoursDirty && !isAuthenticated && (
                  <p className="text-[12px] text-[var(--color-warn)] text-center">Faça login em Perfil para salvar.</p>
                )}
              </div>
            </SectionCard>
          </TierGroup>

          <TierGroup
            label="Negócio"
            description="Como sua lanchonete aparece pro cliente."
          >
            <SectionCard icon={Smartphone} title="Dados da empresa">
              <div className="space-y-3">
                {/* Source badge */}
                <div className="flex items-center gap-2">
                  {isAuthenticated ? (
                    <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--color-brand-deep)] bg-[var(--color-brand-soft)] px-2 py-0.5 rounded-full">
                      <Check className="w-3 h-3" strokeWidth={2.5} />
                      Sincronizado com Zelo PDV
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--color-ink-faint)] bg-[var(--color-surface-muted)] px-2 py-0.5 rounded-full">
                      <CloudOff className="w-3 h-3" strokeWidth={1.8} />
                      Faça login para sincronizar
                    </span>
                  )}
                </div>

                <div>
                  <label className={LABEL}>Nome da lanchonete</label>
                  <input type="text" value={draft.name}
                    onChange={e => setDraft(p => ({ ...p, name: e.target.value }))}
                    className={FIELD} />
                </div>
                <div>
                  <label className={LABEL}>Endereço de retirada</label>
                  <input type="text" value={draft.address}
                    onChange={e => setDraft(p => ({ ...p, address: e.target.value }))}
                    className={FIELD} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={LABEL}>Telefone de contato</label>
                    <input type="text" value={draft.phone}
                      onChange={e => setDraft(p => ({ ...p, phone: e.target.value }))}
                      className={FIELD} />
                  </div>
                  <div>
                    <label className={LABEL}>Chave PIX</label>
                    <input type="text" value={draft.pixKey}
                      onChange={e => setDraft(p => ({ ...p, pixKey: e.target.value }))}
                      className={FIELD} />
                  </div>
                </div>

                {/* Save button — only shown when there are unsaved changes */}
                {isDirty && (
                  <button
                    onClick={handleSaveEmpresa}
                    disabled={saveState === 'saving' || !isAuthenticated}
                    className="w-full flex items-center justify-center gap-2 bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)] disabled:opacity-50 text-white py-2.5 rounded-lg text-[13.5px] font-semibold transition-colors"
                  >
                    {saveState === 'saving' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {saveState === 'saving' ? 'Salvando…' : 'Salvar no Zelo PDV'}
                  </button>
                )}
                {saveState === 'saved' && (
                  <p className="text-[12.5px] text-[var(--color-brand)] text-center font-medium">✓ Salvo com sucesso</p>
                )}
                {saveState === 'error' && (
                  <p className="text-[12.5px] text-[var(--color-alert)] text-center font-medium">Erro ao salvar. Verifique a conexão.</p>
                )}
                {isDirty && !isAuthenticated && (
                  <p className="text-[12px] text-[var(--color-warn)] text-center">Faça login em Perfil para salvar no Zelo PDV.</p>
                )}
              </div>
            </SectionCard>

            {!isGeneralMode && (
              <>
                <CustomerNotificationsCard empresa={empresa} saveEmpresa={saveEmpresa} isAuthenticated={isAuthenticated} />
                <DeliveryConfigCard state={state} setState={setState} saveEmpresa={saveEmpresa} isAuthenticated={isAuthenticated} />
              </>
            )}

            <SectionCard icon={UserCog} title="Gerente">
              <div className="space-y-3">
                <p className="text-[12.5px] text-[var(--color-ink-muted)]">
                  WhatsApp pessoal do gerente. Os gatilhos configurados enviam notificações e escalações direto para esse número.
                </p>
                <div>
                  <label className={LABEL}>WhatsApp do gerente</label>
                  <input
                    type="text"
                    inputMode="tel"
                    value={draft.managerPhone}
                    onChange={e => setDraft(p => ({ ...p, managerPhone: maskBrazilianPhone(e.target.value) }))}
                    placeholder="(XX) XXXXX-XXXX"
                    className={FIELD}
                  />
                  <p className="text-[11.5px] text-[var(--color-ink-faint)] mt-1.5">
                    Inclua DDD. Usamos esse número só para alertas — nunca para o cliente.
                  </p>
                </div>
              </div>
            </SectionCard>
          </TierGroup>
        </div>
      </div>

      {subscription && (
        <PlanChangeModal
          open={planChangeOpen}
          onClose={() => setPlanChangeOpen(false)}
          currentPlan={subscription.plan_tier}
          willCancel={!!subscription.cancel_at_period_end}
          token={token}
          onSuccess={refreshSubscription}
        />
      )}
    </div>
  );
};
