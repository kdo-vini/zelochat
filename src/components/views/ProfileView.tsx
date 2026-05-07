import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, LogOut, Check, Loader2, X, Sparkles, Shield, UserCircle2, Database } from 'lucide-react';
import { ZeloState } from '../../types';
import { useSupabaseSession } from '../../hooks/useSupabaseSession';
import { useSubscription } from '../../hooks/useSubscription';
import { signOut, updateUserPassword } from '../../services/authService';
import type { EmpresaPerfil } from '../../hooks/useEmpresaPerfil';
import { ConfirmModal } from '../ConfirmModal';
import { SectionCard } from '../shared/SectionCard';
import { BillingManagementCard } from '../billing/BillingCards';
import { PlanChangeModal } from './PlanChangeModal';

const FIELD = 'w-full bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg px-3 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-[var(--color-brand)]/25 focus:border-[var(--color-brand)] transition-colors';
const LABEL = 'block text-[11.5px] font-medium text-[var(--color-ink-muted)] mb-1';

const PASSWORD_RULES = [
  { label: 'Pelo menos 8 caracteres', test: (pw: string) => pw.length >= 8 },
  { label: 'Uma letra maiúscula', test: (pw: string) => /[A-Z]/.test(pw) },
  { label: 'Um número', test: (pw: string) => /\d/.test(pw) },
  { label: 'Um caractere especial', test: (pw: string) => /[^A-Za-z0-9]/.test(pw) },
];

type ProfileState = Pick<
  ZeloState,
  'profile' | 'aiInstructions' | 'blockedDates' | 'businessInfo' | 'deliveryConfig' | 'drivers' | 'quickResponses' | 'triggers'
>;

interface ProfileViewProps {
  state: ProfileState;
  setState: React.Dispatch<React.SetStateAction<ZeloState>>;
  empresa: EmpresaPerfil | null;
  saveEmpresa: (patch: Partial<Omit<EmpresaPerfil, 'id'>>) => Promise<boolean>;
  token: string | null;
}

export const ProfileView = ({ state, setState, empresa, saveEmpresa, token }: ProfileViewProps) => {
  const navigate = useNavigate();
  const { session } = useSupabaseSession();
  const signedInEmail = session?.user?.email ?? null;

  // Subscription — used to render billing management or "no plan" prompt.
  const {
    subscription,
    isActive: subscriptionActive,
    refresh: refreshSubscription,
  } = useSubscription(session);
  const [planChangeOpen, setPlanChangeOpen] = useState(false);
  const handlePlanChange = () => {
    if (!subscription) return;
    setPlanChangeOpen(true);
  };

  // Profile draft synced from empresa_perfil
  const [draftName, setDraftName] = useState(state.profile.name);
  const [profileSave, setProfileSave] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Password change state
  const [pwOpen, setPwOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwState, setPwState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [pwError, setPwError] = useState<string | null>(null);

  // Logout state
  const [signingOut, setSigningOut] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

  useEffect(() => {
    if (empresa?.nome_exibicao) setDraftName(empresa.nome_exibicao);
  }, [empresa?.nome_exibicao]);

  const isNameDirty = draftName !== (empresa?.nome_exibicao ?? state.profile.name);

  const handleSaveName = async () => {
    setProfileSave('saving');
    const ok = await saveEmpresa({ nome_exibicao: draftName });
    if (ok) {
      setState(prev => ({ ...prev, profile: { ...prev.profile, name: draftName } }));
      setProfileSave('saved');
      setTimeout(() => setProfileSave('idle'), 2500);
    } else {
      setProfileSave('error');
      setTimeout(() => setProfileSave('idle'), 3000);
    }
  };

  const closePwForm = () => {
    setPwOpen(false);
    setNewPassword('');
    setConfirmPassword('');
    setPwError(null);
    setPwState('idle');
  };

  const handleChangePassword = async () => {
    setPwError(null);

    const allValid = PASSWORD_RULES.every((r) => r.test(newPassword));
    if (!allValid) {
      setPwError('A senha não atende a todos os requisitos.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('As senhas não conferem.');
      return;
    }

    setPwState('saving');
    const { error } = await updateUserPassword(newPassword);
    if (error) {
      setPwError(error.message || 'Não foi possível atualizar a senha.');
      setPwState('idle');
      return;
    }
    setPwState('saved');
    setTimeout(() => closePwForm(), 1800);
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      const { error } = await signOut();
      if (error) {
        throw new Error('Não consegui encerrar sua sessão no servidor. Verifique sua conexão e tente de novo.');
      }
      navigate('/auth');
    } catch (err) {
      setSigningOut(false);
      throw err;
    }
  };

  const handleExportBackup = () => {
    // P2.9 — LGPD compliance: strip all keys that contain customer PII
    // (chat history, orders, sessions) before exporting. Only
    // configuration-level keys are included. Chat data remains in
    // Supabase and is never written to a local file.
    const safeBackup = {
      _notice: 'Dados de conversa não incluídos neste backup. Apenas configurações do sistema.',
      businessInfo: state.businessInfo,
      triggers: state.triggers,
      quickResponses: state.quickResponses,
      aiInstructions: state.aiInstructions,
      drivers: state.drivers,
      blockedDates: state.blockedDates,
      deliveryConfig: state.deliveryConfig,
      // Intentionally excluded: sessions, orders, managerHistory, products
      // (products come from ZeloPDV and are not backed up here)
    };
    const blob = new Blob([JSON.stringify(safeBackup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zelochat-config-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
      <div className="max-w-[700px] mx-auto px-8 py-8 space-y-6">

        {/* Avatar header */}
        <header className="flex flex-col items-center text-center gap-4">
          <div className="relative group">
            <div className="w-24 h-24 rounded-full overflow-hidden ring-2 ring-[var(--color-line)] shadow-sm">
              <img src={state.profile.avatar} alt="" className="w-full h-full object-cover" />
            </div>
          </div>
          <div>
            <h2 className="text-[22px] font-semibold">{draftName || state.profile.name}</h2>
            <p className="text-[13px] text-[var(--color-ink-muted)] flex items-center justify-center gap-1.5 mt-0.5">
              <Check className="w-3.5 h-3.5 text-[var(--color-brand)]" />
              {state.profile.role} · ZeloChat
            </p>
            {signedInEmail && (
              <p className="text-[12.5px] text-[var(--color-ink-faint)] mt-0.5">{signedInEmail}</p>
            )}
          </div>
        </header>

        {/* 1. Identidade — empresa_perfil */}
        <SectionCard icon={UserCircle2} title="Dados do perfil">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              {empresa && (
                <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--color-brand-deep)] bg-[var(--color-brand-soft)] px-2 py-0.5 rounded-full">
                  <Check className="w-3 h-3" strokeWidth={2.5} />
                  Sincronizado · Zelo PDV
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={LABEL}>Nome da empresa</label>
                <input
                  type="text"
                  value={draftName}
                  onChange={e => setDraftName(e.target.value)}
                  className={FIELD}
                />
              </div>
              <div>
                <label className={LABEL}>E-mail da conta</label>
                <input
                  type="email"
                  value={signedInEmail ?? ''}
                  disabled
                  className={`${FIELD} opacity-60 cursor-not-allowed`}
                />
              </div>
            </div>

            {isNameDirty && (
              <button
                onClick={handleSaveName}
                disabled={profileSave === 'saving'}
                className="flex items-center gap-2 bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)] text-white px-4 py-2 rounded-lg text-[13.5px] font-semibold transition-colors disabled:opacity-50"
              >
                {profileSave === 'saving'
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Check className="w-4 h-4" />}
                {profileSave === 'saving' ? 'Salvando…' : 'Salvar nome'}
              </button>
            )}
            {profileSave === 'saved' && (
              <p className="text-[12.5px] text-[var(--color-brand)] font-medium">✓ Nome atualizado no Zelo PDV</p>
            )}
            {profileSave === 'error' && (
              <p className="text-[12.5px] text-[var(--color-alert)] font-medium">Erro ao salvar. Tente novamente.</p>
            )}
          </div>
        </SectionCard>

        {/* 2. Plano */}
        <SectionCard icon={Sparkles} title="Plano">
          {subscriptionActive ? (
            <BillingManagementCard subscription={subscription} token={token} onPlanChange={handlePlanChange} />
          ) : (
            <div className="space-y-3">
              <p className="text-[14px] font-semibold leading-snug">Sem plano ativo</p>
              <p className="text-[12.5px] text-[var(--color-ink-muted)] leading-relaxed">
                Você ainda não tem um plano ZeloChat ativo. Para conectar o WhatsApp e atender clientes pela IA,
                escolha um plano na aba <strong>Configurações</strong>.
              </p>
            </div>
          )}
        </SectionCard>

        {/* 3. Conta — actions + version */}
        <SectionCard icon={Shield} title="Conta">
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                onClick={() => setPwOpen((v) => !v)}
                className={`flex items-center gap-3 p-4 border rounded-xl text-left transition-colors group ${
                  pwOpen
                    ? 'bg-[var(--color-brand-soft)] border-[var(--color-brand)]/40'
                    : 'bg-[var(--color-surface-muted)] border-[var(--color-line)] hover:border-[var(--color-brand)]/40'
                }`}
              >
                <ShieldCheck className="w-5 h-5 text-[var(--color-ink-muted)] group-hover:text-[var(--color-brand)] transition-colors flex-shrink-0" strokeWidth={1.8} />
                <div>
                  <p className="text-[13.5px] font-semibold">Alterar senha</p>
                  <p className="text-[12px] text-[var(--color-ink-muted)]">Atualizar credenciais</p>
                </div>
              </button>
              <button
                onClick={() => setConfirmLogout(true)}
                disabled={signingOut}
                className="flex items-center gap-3 p-4 bg-[var(--color-alert-soft)] border border-[var(--color-alert)]/20 rounded-xl text-left hover:border-[var(--color-alert)]/40 transition-colors disabled:opacity-60"
              >
                <LogOut className="w-5 h-5 text-[var(--color-alert)] flex-shrink-0" strokeWidth={1.8} />
                <div>
                  <p className="text-[13.5px] font-semibold text-[var(--color-alert)]">
                    {signingOut ? 'Saindo…' : 'Sair da conta'}
                  </p>
                  <p className="text-[12px] text-[var(--color-alert)]/70">Encerra a sessão no ZeloChat</p>
                </div>
              </button>
            </div>

            {pwOpen && (
              <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-muted)] p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-[13px] font-semibold">Nova senha</h4>
                  <button
                    onClick={closePwForm}
                    className="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] transition-colors"
                    aria-label="Fechar"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {pwState === 'saved' ? (
                  <div className="text-[13px] text-[var(--color-brand-deep)] bg-[var(--color-brand-soft)] border border-[var(--color-brand)]/30 rounded-lg p-3 text-center">
                    ✓ Senha atualizada com sucesso.
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className={LABEL}>Nova senha</label>
                        <input
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="Mínimo 8 caracteres"
                          autoComplete="new-password"
                          className={FIELD}
                        />
                      </div>
                      <div>
                        <label className={LABEL}>Confirmar nova senha</label>
                        <input
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="Repita a nova senha"
                          autoComplete="new-password"
                          className={FIELD}
                        />
                      </div>
                    </div>

                    <ul className="space-y-1.5">
                      {PASSWORD_RULES.map((rule) => {
                        const passing = rule.test(newPassword);
                        return (
                          <li
                            key={rule.label}
                            className={`flex items-center gap-2 text-[12px] transition-colors ${
                              passing ? 'text-[var(--color-brand-deep)]' : 'text-[var(--color-ink-muted)]'
                            }`}
                          >
                            <span
                              className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center flex-shrink-0 transition-colors ${
                                passing
                                  ? 'bg-[var(--color-brand)] border-[var(--color-brand)]'
                                  : 'border-[var(--color-line)] bg-[var(--color-surface)]'
                              }`}
                            >
                              {passing && <Check size={9} className="text-white" strokeWidth={3} />}
                            </span>
                            {rule.label}
                          </li>
                        );
                      })}
                    </ul>

                    {pwError && (
                      <p className="text-[12.5px] text-[var(--color-alert)] font-medium">{pwError}</p>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={handleChangePassword}
                        disabled={pwState === 'saving' || !newPassword || !confirmPassword}
                        className="flex items-center gap-2 bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)] text-white px-4 py-2 rounded-lg text-[13.5px] font-semibold transition-colors disabled:opacity-50"
                      >
                        {pwState === 'saving' && <Loader2 className="w-4 h-4 animate-spin" />}
                        {pwState === 'saving' ? 'Atualizando…' : 'Atualizar senha'}
                      </button>
                      <button
                        onClick={closePwForm}
                        className="text-[13.5px] font-semibold text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] px-4 py-2 transition-colors"
                      >
                        Cancelar
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Backup export */}
            <div className="pt-2 border-t border-[var(--color-line)] space-y-3">
              <div className="flex items-start gap-3">
                <Database className="w-5 h-5 text-[var(--color-ink-muted)] flex-shrink-0 mt-0.5" strokeWidth={1.8} />
                <div className="flex-1">
                  <p className="text-[13.5px] font-semibold">Backup de dados</p>
                  <p className="text-[12px] text-[var(--color-ink-muted)] mt-0.5">
                    Seus dados de faturamento e clientes são armazenados localmente e criptografados em trânsito.
                  </p>
                </div>
              </div>
              <button
                onClick={handleExportBackup}
                className="w-full bg-[var(--color-surface-muted)] border border-[var(--color-line)] text-[var(--color-ink-soft)] py-2.5 rounded-lg text-[13.5px] font-semibold hover:bg-[var(--color-line)] transition-colors"
              >
                Exportar backup de dados
              </button>
            </div>

            {/* Version line */}
            <div className="pt-3 border-t border-[var(--color-line)]">
              <p className="text-[11.5px] text-[var(--color-ink-faint)] text-center">ZeloChat · v1.4.2-beta</p>
            </div>
          </div>
        </SectionCard>
      </div>

      <ConfirmModal
        open={confirmLogout}
        title="Sair da conta?"
        message="Você será desconectado do ZeloChat neste dispositivo."
        onClose={() => setConfirmLogout(false)}
        onConfirm={handleSignOut}
        confirmLabel="Sair"
        confirmLoadingLabel="Saindo..."
      />

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
