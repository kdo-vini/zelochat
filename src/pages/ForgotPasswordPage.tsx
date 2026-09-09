import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { resetPasswordForEmail } from '../services/authService';
import AuthCard from '../components/auth/AuthCard';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    document.body.classList.add('landing-theme');
    return () => document.body.classList.remove('landing-theme');
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!email) {
      setErrorMsg('Informe seu e-mail.');
      return;
    }

    setLoading(true);
    const redirectTo = `${window.location.origin}/auth/reset-password`;
    const { error } = await resetPasswordForEmail(email, redirectTo);

    // Always show success to prevent email enumeration
    if (error) {
      console.error('[ForgotPasswordPage] resetPasswordForEmail failed:', error);
    }

    setSuccessMsg(
      'Se existir uma conta com este e-mail, enviaremos instruções em instantes. Verifique sua caixa de entrada.'
    );
    setLoading(false);
  };

  return (
    <div className="landing-theme min-h-screen flex items-center justify-center bg-[#F8FAFC] px-4 py-12">
      <AuthCard
        title="Recuperar senha"
        subtitle="Informe seu e-mail e enviaremos as instruções de recuperação."
      >
        {successMsg ? (
          <div className="space-y-4">
            <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-4">
              {successMsg}
            </div>
            <Link
              to="/auth"
              className="block w-full text-center bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)] text-white rounded-lg h-11 leading-[2.75rem] font-semibold transition-colors"
            >
              Voltar ao login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            {errorMsg && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                {errorMsg}
              </div>
            )}

            <div>
              <label
                htmlFor="forgot-email"
                className="block text-sm font-medium text-[#0B1120] mb-1"
              >
                E-mail
              </label>
              <input
                id="forgot-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com.br"
                className="border border-[#E5E7EB] rounded-lg h-11 px-3 w-full focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] focus:border-transparent text-[#0B1120] placeholder:text-[#64748B]"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)] text-white rounded-lg h-11 font-semibold px-6 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Enviando...' : 'Enviar instruções'}
            </button>

            <div className="text-center">
              <Link
                to="/auth"
                className="text-sm text-[#64748B] hover:text-[#0B1120] transition-colors"
              >
                Voltar ao login
              </Link>
            </div>
          </form>
        )}
      </AuthCard>
    </div>
  );
}
