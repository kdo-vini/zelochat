import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, LogOut, Check, Loader2, X, Sparkles, Shield, UserCircle2, Database, Phone, MapPin, Camera, FileText, Trash2 } from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import { ZeloState } from '../../types';
import { useSupabaseSession } from '../../hooks/useSupabaseSession';
import { useSubscription } from '../../hooks/useSubscription';
import { signOut, updateUserPassword } from '../../services/authService';
import type { EmpresaPerfil } from '../../hooks/useEmpresaPerfil';
import { ConfirmModal } from '../ConfirmModal';
import { SectionCard } from '../shared/SectionCard';
import { apiUrl, apiFetch } from '../../config';
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

  // Profile drafts synced from empresa_perfil
  const [draftName, setDraftName] = useState(empresa?.nome_exibicao ?? state.profile.name);
  const [draftContato, setDraftContato] = useState(empresa?.contato ?? '');
  const [draftEndereco, setDraftEndereco] = useState(empresa?.endereco ?? '');
  const [draftDocumento, setDraftDocumento] = useState(empresa?.documento ?? '');
  const [draftLogoUrl, setDraftLogoUrl] = useState(empresa?.logo_url ?? state.profile.avatar ?? '');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [pendingLogoUrl, setPendingLogoUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  // Apagar conta (LGPD) — fluxo com atrito: revelar → ciência → digitar nome → cooldown.
  const [dangerOpen, setDangerOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteStep, setDeleteStep] = useState<1 | 2>(1);
  const [ackIrreversible, setAckIrreversible] = useState(false);
  const [typedName, setTypedName] = useState('');
  const [deleteCooldown, setDeleteCooldown] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [reactivating, setReactivating] = useState(false);
  const [deletionScheduledAt, setDeletionScheduledAt] = useState<string | null>(empresa?.deletion_scheduled_at ?? null);

  const SUPPORT_WHATSAPP_URL =
    'https://wa.me/5514991537503?text=' +
    encodeURIComponent('Olá! Preciso de ajuda com a minha conta no ZeloChat antes de decidir apagá-la.');

  const companyName = (empresa?.nome_exibicao ?? '').trim();
  const nameMatches = companyName.length > 0 && typedName.trim().toLowerCase() === companyName.toLowerCase();
  const canConfirmDelete = deleteStep === 2 && nameMatches && deleteCooldown <= 0 && !deleting;
  const deletionDaysLeft = deletionScheduledAt
    ? Math.max(0, Math.ceil((new Date(deletionScheduledAt).getTime() - Date.now()) / 86400000))
    : 0;

  const handleReactivate = async () => {
    setReactivating(true);
    try {
      if (!token) throw new Error('Sessão expirada.');
      const res = await apiFetch(apiUrl('/api/account/reactivate'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Falha ao reativar.');
      }
      setDeletionScheduledAt(null);
    } catch {
      // best-effort; surface nothing intrusive
    } finally {
      setReactivating(false);
    }
  };

  const openDeleteModal = () => {
    setDeleteOpen(true);
    setDeleteStep(1);
    setAckIrreversible(false);
    setTypedName('');
    setDeleteCooldown(0);
    setDeleteError(null);
  };
  const goToConfirmStep = () => {
    if (!ackIrreversible) return;
    setDeleteStep(2);
    setDeleteCooldown(5);
  };
  // Cooldown ticker — runs only while on step 2 with time remaining.
  useEffect(() => {
    if (deleteStep !== 2 || deleteCooldown <= 0) return;
    const t = setTimeout(() => setDeleteCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [deleteStep, deleteCooldown]);

  const handleDeleteAccount = async () => {
    if (!canConfirmDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      if (!token) throw new Error('Sessão expirada. Faça login novamente.');
      const res = await apiFetch(apiUrl('/api/account'), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Falha ao apagar a conta.');
      }
      await signOut().catch(() => {});
      navigate('/auth');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Erro ao apagar a conta.');
      setDeleting(false);
    }
  };

  useEffect(() => {
    if (!empresa) return;
    setDeletionScheduledAt(empresa.deletion_scheduled_at ?? null);
    setDraftName(empresa.nome_exibicao ?? '');
    setDraftContato(empresa.contato ?? '');
    setDraftEndereco(empresa.endereco ?? '');
    setDraftDocumento(empresa.documento ?? '');
    setDraftLogoUrl(empresa.logo_url ?? state.profile.avatar ?? '');
  }, [empresa?.nome_exibicao, empresa?.contato, empresa?.endereco, empresa?.documento, empresa?.logo_url]);

  // Revoke object URL when component unmounts or file changes
  useEffect(() => {
    return () => { if (pendingLogoUrl) URL.revokeObjectURL(pendingLogoUrl); };
  }, [pendingLogoUrl]);

  const isProfileDirty =
    draftName !== (empresa?.nome_exibicao ?? state.profile.name) ||
    draftContato !== (empresa?.contato ?? '') ||
    draftEndereco !== (empresa?.endereco ?? '') ||
    draftDocumento !== (empresa?.documento ?? '') ||
    logoFile !== null;

  const handleLogoFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    if (file.size > 1.5 * 1024 * 1024) {
      alert('Imagem muito grande. Use PNG ou JPG de até 1,5 MB.');
      return;
    }
    if (pendingLogoUrl) URL.revokeObjectURL(pendingLogoUrl);
    setLogoFile(file);
    setPendingLogoUrl(URL.createObjectURL(file));
  }, [pendingLogoUrl]);

  const handleSaveProfile = async () => {
    setProfileSave('saving');
    try {
      let finalLogoUrl = draftLogoUrl || null;
      if (logoFile && session?.user?.id) {
        const fileName = `${session.user.id}.png`;
        const { error: upErr } = await supabase.storage
          .from('logos')
          .upload(fileName, logoFile, { upsert: true });
        if (upErr) throw upErr;
        const { data: { publicUrl } } = supabase.storage
          .from('logos')
          .getPublicUrl(fileName);
        finalLogoUrl = `${publicUrl}?t=${Date.now()}`;
      }

      const ok = await saveEmpresa({
        nome_exibicao: draftName,
        contato: draftContato || null,
        endereco: draftEndereco || null,
        documento: draftDocumento || null,
        logo_url: finalLogoUrl,
      });

      if (ok) {
        if (finalLogoUrl) setDraftLogoUrl(finalLogoUrl);
        setLogoFile(null);
        setPendingLogoUrl(null);
        setState(prev => ({ ...prev, profile: { ...prev.profile, name: draftName, avatar: finalLogoUrl || prev.profile.avatar } }));
        setProfileSave('saved');
        setTimeout(() => setProfileSave('idle'), 2500);
      } else {
        setProfileSave('error');
        setTimeout(() => setProfileSave('idle'), 3000);
      }
    } catch {
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
        <header className="flex flex-col items-center text-center gap-3">
          <div className="relative group">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-24 h-24 rounded-full overflow-hidden ring-2 ring-[var(--color-line)] shadow-sm bg-[var(--color-surface-muted)] block focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
              title="Alterar logo"
            >
              {(pendingLogoUrl || draftLogoUrl || state.profile.avatar) ? (
                <img src={pendingLogoUrl || draftLogoUrl || state.profile.avatar} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <UserCircle2 className="w-12 h-12 text-[var(--color-ink-faint)]" strokeWidth={1.2} />
                </div>
              )}
              <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera className="w-6 h-6 text-white" strokeWidth={1.8} />
              </div>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={handleLogoFileChange}
            />
          </div>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 text-[11.5px] text-[var(--color-ink-muted)] hover:text-[var(--color-brand)] transition-colors"
          >
            <Camera className="w-3 h-3" />
            {pendingLogoUrl ? 'Imagem selecionada — salve para confirmar' : 'Alterar logo'}
          </button>

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

        {/* 1. Dados do negócio — empresa_perfil */}
        <SectionCard icon={UserCircle2} title="Dados do negócio">
          <div className="space-y-4">
            {empresa && (
              <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--color-brand-deep)] bg-[var(--color-brand-soft)] px-2 py-0.5 rounded-full">
                <Check className="w-3 h-3" strokeWidth={2.5} />
                Sincronizado · Zelo PDV
              </span>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={LABEL}>Nome de exibição</label>
                <input
                  type="text"
                  value={draftName}
                  onChange={e => setDraftName(e.target.value)}
                  placeholder="Nome do seu negócio"
                  className={FIELD}
                />
              </div>
              <div>
                <label className={LABEL}>
                  <span className="flex items-center gap-1"><Phone className="w-3 h-3" />Telefone</span>
                </label>
                <input
                  type="tel"
                  value={draftContato}
                  onChange={e => setDraftContato(e.target.value)}
                  placeholder="(XX) XXXXX-XXXX"
                  className={FIELD}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={LABEL}>
                  <span className="flex items-center gap-1"><FileText className="w-3 h-3" />CNPJ / CPF</span>
                </label>
                <input
                  type="text"
                  value={draftDocumento}
                  onChange={e => setDraftDocumento(e.target.value)}
                  placeholder="00.000.000/0001-00"
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

            <div>
              <label className={LABEL}>
                <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />Endereço</span>
              </label>
              <input
                type="text"
                value={draftEndereco}
                onChange={e => setDraftEndereco(e.target.value)}
                placeholder="Rua, número, bairro, cidade - UF"
                className={FIELD}
              />
            </div>

            {isProfileDirty && (
              <button
                onClick={handleSaveProfile}
                disabled={profileSave === 'saving'}
                className="flex items-center gap-2 bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)] text-white px-4 py-2 rounded-lg text-[13.5px] font-semibold transition-colors disabled:opacity-50"
              >
                {profileSave === 'saving'
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Check className="w-4 h-4" />}
                {profileSave === 'saving' ? 'Salvando…' : 'Salvar dados'}
              </button>
            )}
            {profileSave === 'saved' && (
              <p className="text-[12.5px] text-[var(--color-brand)] font-medium">✓ Dados atualizados · visíveis no Zelo PDV</p>
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

            {/* Zona de perigo / exclusão agendada */}
            <div className="pt-2 border-t border-[var(--color-line)]">
              {deletionScheduledAt ? (
                <div className="rounded-xl border border-[var(--color-warn,#b45309)]/30 bg-[var(--color-warn-soft,#fef3c7)] p-4 space-y-2">
                  <p className="text-[13.5px] font-semibold text-[var(--color-ink)]">Exclusão agendada</p>
                  <p className="text-[12.5px] text-[var(--color-ink-soft)]">
                    Sua conta será apagada definitivamente em <strong>{deletionDaysLeft} {deletionDaysLeft === 1 ? 'dia' : 'dias'}</strong>.
                    Até lá nada foi apagado — você pode voltar atrás.
                  </p>
                  <button
                    onClick={handleReactivate}
                    disabled={reactivating}
                    className="w-full bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)] text-white py-2.5 rounded-lg text-[13.5px] font-semibold transition-colors disabled:opacity-50"
                  >
                    {reactivating ? 'Reativando…' : 'Reativar minha conta'}
                  </button>
                </div>
              ) : !dangerOpen ? (
                <button
                  onClick={() => setDangerOpen(true)}
                  className="text-[12px] font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] transition-colors"
                >
                  Opções avançadas da conta
                </button>
              ) : (
                <div className="rounded-xl border border-[var(--color-alert)]/25 bg-[var(--color-alert-soft)] p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <Trash2 className="w-5 h-5 text-[var(--color-alert)] flex-shrink-0 mt-0.5" strokeWidth={1.8} />
                    <div className="flex-1">
                      <p className="text-[13.5px] font-semibold text-[var(--color-alert)]">Apagar conta e todos os dados</p>
                      <p className="text-[12px] text-[var(--color-alert)]/70 mt-0.5">
                        Remove permanentemente seus dados do ZeloChat (conversas, pedidos, clientes)
                        e também os dados do Zelo PDV da mesma conta, e cancela sua assinatura.
                      </p>
                      <p className="text-[12px] text-[var(--color-ink-muted)] mt-1.5">
                        Com dúvidas ou travado em algo? Fale com a nossa equipe antes — a gente
                        resolve com você, sem precisar apagar nada.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <a
                      href={SUPPORT_WHATSAPP_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 text-center bg-[#25D366] text-white py-2.5 rounded-lg text-[13.5px] font-semibold hover:opacity-90 transition-opacity"
                    >
                      Falar com a equipe
                    </a>
                    <button
                      onClick={openDeleteModal}
                      className="flex-1 bg-[var(--color-alert)] text-white py-2.5 rounded-lg text-[13.5px] font-semibold hover:opacity-90 transition-opacity"
                    >
                      Apagar minha conta…
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Version line */}
            <div className="pt-3 border-t border-[var(--color-line)]">
              <p className="text-[11.5px] text-[var(--color-ink-faint)] text-center">ZeloChat · v1.4.2-beta</p>
            </div>
          </div>
        </SectionCard>
      </div>

      {deleteOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-md rounded-2xl bg-[var(--color-surface)] border border-[var(--color-alert)]/30 shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--color-line)]">
              <h3 className="text-[16px] font-bold text-[var(--color-alert)]">Apagar conta</h3>
            </div>
            <div className="p-6 space-y-4">
              {deleteStep === 1 ? (
                <>
                  <p className="text-[13.5px] leading-relaxed text-[var(--color-ink)]">
                    Você vai agendar a exclusão da conta
                    {companyName ? <> <strong>{companyName}</strong></> : null}. Sua assinatura é
                    cancelada e, após <strong>14 dias</strong>, todos os dados do ZeloChat (conversas,
                    pedidos, clientes) e do Zelo PDV da mesma conta são apagados de forma definitiva.
                  </p>
                  <p className="text-[13.5px] leading-relaxed text-[var(--color-ink-soft)]">
                    Durante esses 14 dias nada é apagado — é só entrar de novo e clicar em
                    <strong> Reativar</strong>. Depois do prazo, <strong>não há como recuperar</strong>.
                  </p>
                  <label className="flex items-start gap-2 text-[13px] cursor-pointer text-[var(--color-ink)]">
                    <input
                      type="checkbox"
                      checked={ackIrreversible}
                      onChange={(e) => setAckIrreversible(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>Entendo que após 14 dias a exclusão é permanente e apaga todos os meus dados.</span>
                  </label>
                </>
              ) : (
                <>
                  <p className="text-[13.5px] leading-relaxed text-[var(--color-ink)]">
                    Para confirmar, digite o nome da sua empresa: <strong>{companyName}</strong>
                  </p>
                  <input
                    type="text"
                    value={typedName}
                    onChange={(e) => setTypedName(e.target.value)}
                    placeholder={companyName}
                    autoComplete="off"
                    className={`${FIELD} ${nameMatches ? 'border-[var(--color-brand)]' : ''}`}
                  />
                </>
              )}
              {deleteError && (
                <p className="text-[12.5px] text-[var(--color-alert)]">{deleteError}</p>
              )}
            </div>
            <div className="px-6 py-4 bg-[var(--color-surface-muted)] border-t border-[var(--color-line)] flex justify-end gap-3">
              <button
                onClick={() => !deleting && setDeleteOpen(false)}
                disabled={deleting}
                className="px-4 py-2 text-[13.5px] font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              {deleteStep === 1 ? (
                <button
                  onClick={goToConfirmStep}
                  disabled={!ackIrreversible}
                  className="px-4 py-2 rounded-lg text-[13.5px] font-semibold text-white bg-[var(--color-alert)] hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Continuar
                </button>
              ) : (
                <button
                  onClick={handleDeleteAccount}
                  disabled={!canConfirmDelete}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13.5px] font-semibold text-white bg-[var(--color-alert)] hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {deleting
                    ? 'Agendando…'
                    : deleteCooldown > 0
                      ? `Aguarde ${deleteCooldown}s…`
                      : 'Agendar exclusão (14 dias)'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

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
