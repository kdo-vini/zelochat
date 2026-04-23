import React, { useState, useEffect } from 'react';
import { Camera, ShieldCheck, LogOut, Check, Loader2 } from 'lucide-react';
import { ZeloState } from '../../types';
import { supabase } from '../../services/supabaseClient';
import { useSupabaseSession } from '../../hooks/useSupabaseSession';
import type { EmpresaPerfil } from '../../hooks/useEmpresaPerfil';

const FIELD = 'w-full bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg px-3 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-[var(--color-brand)]/25 focus:border-[var(--color-brand)] transition-colors';
const LABEL = 'block text-[11.5px] font-medium text-[var(--color-ink-muted)] mb-1';

interface ProfileViewProps {
  state: ZeloState;
  setState: React.Dispatch<React.SetStateAction<ZeloState>>;
  empresa: EmpresaPerfil | null;
  saveEmpresa: (patch: Partial<Omit<EmpresaPerfil, 'id'>>) => Promise<boolean>;
}

export const ProfileView = ({ state, setState, empresa, saveEmpresa }: ProfileViewProps) => {
  const { session, loading: authLoading } = useSupabaseSession();

  // Auth form
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading2, setAuthLoading2] = useState(false);

  // Profile draft synced from empresa_perfil
  const [draftName, setDraftName] = useState(state.profile.name);
  const [profileSave, setProfileSave] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const signedInEmail = session?.user?.email ?? null;

  // Sync draft when empresa loads
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

  const signIn = async () => {
    setAuthLoading2(true);
    setAuthError(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: authEmail.trim(),
        password: authPassword,
      });
      if (error) throw error;
      setAuthPassword('');
    } catch (e: unknown) {
      setAuthError((e as Error)?.message ?? 'Não foi possível autenticar.');
    } finally { setAuthLoading2(false); }
  };

  const signOut = async () => {
    setAuthLoading2(true);
    setAuthError(null);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (e: unknown) {
      setAuthError((e as Error)?.message ?? 'Não foi possível sair.');
    } finally { setAuthLoading2(false); }
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
            <button className="absolute bottom-0 right-0 w-8 h-8 bg-[var(--color-brand)] text-white rounded-full flex items-center justify-center shadow-md opacity-0 group-hover:opacity-100 transition-opacity">
              <Camera className="w-3.5 h-3.5" />
            </button>
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

        {/* Identity — from empresa_perfil */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-semibold">Dados do perfil</h3>
            {empresa ? (
              <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--color-brand-deep)] bg-[var(--color-brand-soft)] px-2 py-0.5 rounded-full">
                <Check className="w-3 h-3" strokeWidth={2.5} />
                Sincronizado · Zelo PDV
              </span>
            ) : (
              <span className="text-[11.5px] text-[var(--color-ink-faint)]">
                {authLoading ? 'Carregando…' : 'Faça login para sincronizar'}
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
                disabled={!signedInEmail}
                className={`${FIELD} disabled:opacity-50 disabled:cursor-not-allowed`}
              />
            </div>
            <div>
              <label className={LABEL}>E-mail da conta</label>
              <input
                type="email"
                value={signedInEmail ?? ''}
                disabled
                placeholder="Faça login para ver"
                className={`${FIELD} opacity-60 cursor-not-allowed`}
              />
            </div>
          </div>

          {isNameDirty && signedInEmail && (
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

        {/* Supabase auth */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-semibold">Autenticação</h3>
            {!authLoading && (
              <span className={`text-[12px] font-semibold px-2.5 py-1 rounded-full ${
                signedInEmail
                  ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]'
                  : 'bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)]'
              }`}>
                {signedInEmail ? 'Conectado' : 'Desconectado'}
              </span>
            )}
          </div>

          {signedInEmail ? (
            <div className="flex items-center justify-between p-3 bg-[var(--color-brand-soft)] rounded-lg">
              <span className="text-[13px] text-[var(--color-brand-deep)]">
                Conectado como <strong>{signedInEmail}</strong>
              </span>
              <button
                onClick={signOut}
                disabled={authLoading2}
                className="text-[12.5px] font-semibold text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] disabled:opacity-50 transition-colors"
              >
                {authLoading2 ? 'Saindo…' : 'Sair'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>E-mail</label>
                  <input
                    type="email"
                    value={authEmail}
                    onChange={e => setAuthEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && void signIn()}
                    placeholder="voce@empresa.com"
                    className={FIELD}
                  />
                </div>
                <div>
                  <label className={LABEL}>Senha</label>
                  <input
                    type="password"
                    value={authPassword}
                    onChange={e => setAuthPassword(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && void signIn()}
                    placeholder="••••••••"
                    className={FIELD}
                  />
                </div>
              </div>
              <button
                onClick={signIn}
                disabled={authLoading2 || !authEmail.trim() || !authPassword}
                className="bg-[var(--color-ink)] text-white px-4 py-2.5 rounded-lg text-[13.5px] font-semibold hover:bg-[var(--color-ink-soft)] transition-colors disabled:opacity-40"
              >
                {authLoading2 ? 'Entrando…' : 'Entrar'}
              </button>
              <p className="text-[12px] text-[var(--color-ink-faint)]">
                Configure{' '}
                <code className="font-mono text-[var(--color-ink-muted)]">VITE_SUPABASE_URL</code> e{' '}
                <code className="font-mono text-[var(--color-ink-muted)]">VITE_SUPABASE_ANON_KEY</code>{' '}
                em <code className="font-mono text-[var(--color-ink-muted)]">.env.local</code>.
              </p>
            </div>
          )}

          {authError && (
            <div className="bg-[var(--color-alert-soft)] border border-[var(--color-alert)]/20 rounded-lg p-3">
              <p className="text-[12.5px] text-[var(--color-alert)] font-medium">{authError}</p>
            </div>
          )}
        </div>

        {/* Danger zone */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl p-5 space-y-4">
          <h3 className="text-[14px] font-semibold">Ações da conta</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              onClick={() => window.alert('Disponível em breve.')}
              className="flex items-center gap-3 p-4 bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-xl text-left hover:border-[var(--color-brand)]/40 transition-colors group"
            >
              <ShieldCheck className="w-5 h-5 text-[var(--color-ink-muted)] group-hover:text-[var(--color-brand)] transition-colors flex-shrink-0" strokeWidth={1.8} />
              <div>
                <p className="text-[13.5px] font-semibold">Alterar senha</p>
                <p className="text-[12px] text-[var(--color-ink-muted)]">Atualizar credenciais</p>
              </div>
            </button>
            <button
              onClick={() => {
                if (window.confirm('Limpar todos os dados locais e reiniciar?')) {
                  localStorage.removeItem('zelochat_state');
                  window.location.reload();
                }
              }}
              className="flex items-center gap-3 p-4 bg-[var(--color-alert-soft)] border border-[var(--color-alert)]/20 rounded-xl text-left hover:border-[var(--color-alert)]/40 transition-colors"
            >
              <LogOut className="w-5 h-5 text-[var(--color-alert)] flex-shrink-0" strokeWidth={1.8} />
              <div>
                <p className="text-[13.5px] font-semibold text-[var(--color-alert)]">Encerrar sessão</p>
                <p className="text-[12px] text-[var(--color-alert)]/70">Limpa dados locais</p>
              </div>
            </button>
          </div>
        </div>

        <p className="text-center text-[12px] text-[var(--color-ink-faint)]">ZeloChat · v1.4.2-beta</p>
      </div>
    </div>
  );
};
