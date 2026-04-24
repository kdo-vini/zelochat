import React, { useState, useEffect, useRef } from 'react';
import { Smartphone, RefreshCw, Wifi, WifiOff, QrCode, Loader2, Clock, UserCog, Shield, Check, CloudOff, LogOut, Bot, BotOff } from 'lucide-react';
import { ZeloState } from '../../types';
import type { EmpresaPerfil } from '../../hooks/useEmpresaPerfil';
import { API_BASE, WS_URL, apiFetch, WaServerOfflineError } from '../../config';
import { maskBrazilianPhone } from '../../domain/chat';
import { getAiEnabled, setAiEnabled as setAiEnabledApi } from '../../services/waApi';

const FIELD = 'w-full bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg px-3 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-[var(--color-brand)]/25 focus:border-[var(--color-brand)] transition-colors';
const LABEL = 'block text-[11.5px] font-medium text-[var(--color-ink-muted)] mb-1';

const SectionCard = ({ icon: Icon, title, children }: {
  icon: typeof Clock;
  title: string;
  children: React.ReactNode;
}) => (
  <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl overflow-hidden">
    <div className="flex items-center gap-2 px-5 py-4 border-b border-[var(--color-line)]">
      <Icon className="w-4 h-4 text-[var(--color-ink-muted)]" strokeWidth={1.8} />
      <h3 className="text-[14px] font-semibold">{title}</h3>
    </div>
    <div className="p-5">{children}</div>
  </div>
);

export const WhatsAppIntegrationCard = () => {
  const [waStatus, setWaStatus] = useState<'disconnected' | 'qr' | 'connecting' | 'connected'>('disconnected');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);


  // Poll the backend every 3s while QR is showing — catches connection even if webhook/tunnel fails
  const startPolling = () => {
    if (pollRef.current) return; // already polling
    pollRef.current = setInterval(async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/qr/refresh`, { method: 'POST' });
        const data = await res.json();
        if (data.status === 'connected' || data.qr === null && !data.error) {
          setWaStatus('connected');
          setQrCode(null);
          setError(null);
          stopPolling();
        } else if (data.qr) {
          // QR rotated — update it
          setQrCode(data.qr);
        }
      } catch { /* keep polling */ }
    }, 3000);
  };

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  useEffect(() => {
    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen = () => {
        setError(null);
        apiFetch(`${API_BASE}/api/status`).then(r => r.json()).then(d => {
          setWaStatus(d.status);
          if (d.status === 'qr') startPolling();
        }).catch(() => setError('Servidor WhatsApp offline'));
        apiFetch(`${API_BASE}/api/qr`).then(r => r.json()).then(d => { if (d.qr) setQrCode(d.qr); }).catch(() => {});
      };
      ws.onmessage = (ev) => {
        try {
          const p = JSON.parse(ev.data);
          if (p.type === 'qr') { setQrCode(p.data); setWaStatus('qr'); setIsLoading(false); startPolling(); }
          if (p.type === 'connection') {
            setWaStatus(p.data);
            if (p.data === 'connected') { setQrCode(null); setError(null); stopPolling(); }
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
  }, []);

  const refreshQR = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE}/api/qr/refresh`, { method: 'POST' });
      const data = await res.json();
      if (data.qr) {
        setQrCode(data.qr);
        setWaStatus('qr');
        startPolling();
      } else if (data.status === 'connected') {
        setWaStatus('connected');
        setQrCode(null);
      } else if (data.error) {
        setError(`Erro ao gerar QR Code: ${data.error}`);
      } else {
        setError('WhatsApp não respondeu. Verifique a conexão com o servidor e tente novamente.');
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
    if (!confirm('Desconectar o WhatsApp? Você precisará escanear o QR Code novamente para reconectar.')) return;
    setIsDisconnecting(true);
    setError(null);

    // Stop QR polling immediately so /api/qr/refresh can't race the disconnect
    // request and re-trigger session re-pairing on the server during logout.
    stopPolling();

    try {
      const res = await apiFetch(`${API_BASE}/api/whatsapp/disconnect`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.ok) {
        // Server already awaited the Whatsmiau logout — safe to flip UI state.
        setWaStatus('disconnected');
        setQrCode(null);
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

  return (
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
            onClick={disconnectWA}
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

interface SettingsViewProps {
  state: ZeloState;
  setState: React.Dispatch<React.SetStateAction<ZeloState>>;
  saveEmpresa: (patch: Partial<Omit<EmpresaPerfil, 'id'>>) => Promise<boolean>;
  isAuthenticated: boolean;
  token: string | null;
}

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

export const SettingsView = ({ state, setState, saveEmpresa, isAuthenticated, token }: SettingsViewProps) => {
  // Local draft for identity fields — synced from state but independently editable
  const [draft, setDraft] = useState({
    name:    state.businessInfo.name,
    address: state.businessInfo.address,
    phone:   state.businessInfo.phone,
    pixKey:  state.businessInfo.pixKey,
    managerPhone: state.businessInfo.managerPhone,
  });
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Draft for hours section
  const [hoursDraft, setHoursDraft] = useState({
    openTime:   state.businessInfo.openTime,
    closeTime:  state.businessInfo.closeTime,
    closedDays: state.businessInfo.closedDays,
  });
  const [hoursSaveState, setHoursSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Keep draft in sync if state.businessInfo is hydrated from Supabase after mount
  useEffect(() => {
    setDraft({
      name:    state.businessInfo.name,
      address: state.businessInfo.address,
      phone:   state.businessInfo.phone,
      pixKey:  state.businessInfo.pixKey,
      managerPhone: state.businessInfo.managerPhone,
    });
  }, [state.businessInfo.name, state.businessInfo.address, state.businessInfo.phone, state.businessInfo.pixKey, state.businessInfo.managerPhone]);

  useEffect(() => {
    setHoursDraft({
      openTime:   state.businessInfo.openTime,
      closeTime:  state.businessInfo.closeTime,
      closedDays: state.businessInfo.closedDays,
    });
  }, [state.businessInfo.openTime, state.businessInfo.closeTime, state.businessInfo.closedDays]);

  const isDirty =
    draft.name    !== state.businessInfo.name    ||
    draft.address !== state.businessInfo.address ||
    draft.phone   !== state.businessInfo.phone   ||
    draft.pixKey  !== state.businessInfo.pixKey  ||
    draft.managerPhone !== state.businessInfo.managerPhone;

  const isHoursDirty =
    hoursDraft.openTime   !== state.businessInfo.openTime   ||
    hoursDraft.closeTime  !== state.businessInfo.closeTime  ||
    JSON.stringify(hoursDraft.closedDays) !== JSON.stringify(state.businessInfo.closedDays);

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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="space-y-5">
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
          </div>

          <div className="space-y-5">
            <WhatsAppIntegrationCard />

            <AiGlobalToggleCard token={token} />

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

            <SectionCard icon={Shield} title="Segurança e dados">
              <div className="space-y-3">
                <p className="text-[13px] text-[var(--color-ink-muted)]">
                  Seus dados de faturamento e clientes são armazenados localmente e criptografados em trânsito.
                </p>
                <button
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `zelochat-backup-${new Date().toISOString().split('T')[0]}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  }}
                  className="w-full bg-[var(--color-surface-muted)] border border-[var(--color-line)] text-[var(--color-ink-soft)] py-2.5 rounded-lg text-[13.5px] font-semibold hover:bg-[var(--color-line)] transition-colors"
                >
                  Exportar backup de dados
                </button>
              </div>
            </SectionCard>
          </div>
        </div>
      </div>
    </div>
  );
};
