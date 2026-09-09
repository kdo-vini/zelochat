import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import { updateUserPassword } from '../services/authService';
import { getFriendlyErrorMessage } from '../services/errorMessages';
import AuthCard from '../components/auth/AuthCard';
import PasswordInput from '../components/auth/PasswordInput';

interface ValidationRule {
  label: string;
  test: (pw: string) => boolean;
}

const RULES: ValidationRule[] = [
  { label: 'Pelo menos 8 caracteres', test: (pw) => pw.length >= 8 },
  { label: 'Uma letra maiúscula', test: (pw) => /[A-Z]/.test(pw) },
  { label: 'Um número', test: (pw) => /\d/.test(pw) },
  { label: 'Um caractere especial', test: (pw) => /[^A-Za-z0-9]/.test(pw) },
];

export default function ResetPasswordPage() {
  const navigate = useNavigate();

  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState(false);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [success, setSuccess] = useState(false);

  const sessionReadyRef = useRef(false);

  useEffect(() => {
    document.body.classList.add('landing-theme');
    return () => document.body.classList.remove('landing-theme');
  }, []);

  useEffect(() => {
    // Check if a session already exists (e.g. user came from email link)
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        sessionReadyRef.current = true;
        setSessionReady(true);
      }
    });

    // Subscribe to auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (
        event === 'PASSWORD_RECOVERY' ||
        (event === 'SIGNED_IN' && session)
      ) {
        sessionReadyRef.current = true;
        setSessionReady(true);
      }
    });

    // 6-second timeout fallback
    const timeout = setTimeout(() => {
      if (!sessionReadyRef.current) {
        setSessionError(true);
      }
    }, 6000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    const allValid = RULES.every((r) => r.test(password));
    if (!allValid) {
      setErrorMsg('A senha não atende a todos os requisitos.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('As senhas não conferem.');
      return;
    }

    setLoading(true);
    const { error } = await updateUserPassword(password);

    if (error) {
      setErrorMsg(getFriendlyErrorMessage(error));
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);

    // Brief delay so the user sees the success state, then navigate
    setTimeout(() => {
      navigate('/app');
    }, 1500);
  };

  if (sessionError) {
    return (
      <div className="landing-theme min-h-screen flex items-center justify-center bg-[#F8FAFC] px-4 py-12">
        <AuthCard title="Link expirado">
          <div className="space-y-4">
            <p className="text-sm text-[#64748B] text-center">
              Este link de redefinição de senha expirou ou é inválido. Solicite um novo link.
            </p>
            <Link
              to="/auth/forgot-password"
              className="block w-full text-center bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)] text-white rounded-lg h-11 leading-[2.75rem] font-semibold transition-colors"
            >
              Solicitar novo link
            </Link>
          </div>
        </AuthCard>
      </div>
    );
  }

  if (!sessionReady) {
    return (
      <div className="landing-theme min-h-screen flex items-center justify-center bg-[#F8FAFC]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#E5E7EB] border-t-[var(--color-brand)]" />
          <p className="text-sm text-[#64748B]">Verificando link...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="landing-theme min-h-screen flex items-center justify-center bg-[#F8FAFC] px-4 py-12">
      <AuthCard
        title="Nova senha"
        subtitle="Defina uma senha forte para sua conta."
      >
        {success ? (
          <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-4 text-center">
            <p className="font-semibold mb-1">Senha atualizada!</p>
            <p>Redirecionando...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            {errorMsg && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                {errorMsg}
              </div>
            )}

            <PasswordInput
              id="reset-password"
              label="Nova senha"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="Mínimo 8 caracteres"
            />

            {/* Validation checklist */}
            <ul className="space-y-1.5 px-1">
              {RULES.map((rule) => {
                const passing = rule.test(password);
                return (
                  <li
                    key={rule.label}
                    className={`flex items-center gap-2 text-sm transition-colors ${
                      passing ? 'text-[var(--color-brand)]' : 'text-[#64748B]'
                    }`}
                  >
                    <span
                      className={`w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 transition-colors ${
                        passing
                          ? 'bg-[var(--color-brand)] border-[var(--color-brand)]'
                          : 'border-[#D1D5DB] bg-white'
                      }`}
                    >
                      {passing && <Check size={10} className="text-white" strokeWidth={3} />}
                    </span>
                    {rule.label}
                  </li>
                );
              })}
            </ul>

            <PasswordInput
              id="reset-confirm"
              label="Confirmar senha"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              placeholder="Repita a nova senha"
            />

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)] text-white rounded-lg h-11 font-semibold px-6 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Atualizando...' : 'Atualizar senha'}
            </button>
          </form>
        )}
      </AuthCard>
    </div>
  );
}
