import React, { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { signIn, signUp } from '../services/authService';
import { getFriendlyErrorMessage } from '../services/errorMessages';
import { ZeloChatLogo } from '../components/auth/AuthCard';
import PasswordInput from '../components/auth/PasswordInput';
import GoogleAuthButton from '../components/auth/GoogleAuthButton';

type Mode = 'login' | 'signup';

/* ─── Right dark panel ─────────────────────────────────────────── */
function HeroPanel() {
  return (
    <div className="hidden lg:flex flex-col justify-center items-start px-12 py-16 bg-[#0B1120] text-white flex-1 min-h-screen">
      <div className="max-w-sm">
        <div className="mb-8">
          <ZeloChatLogo onDark />
        </div>
        <h2 className="text-3xl font-bold leading-snug mb-4">
          Atendimento mais rápido e inteligente para o seu negócio.
        </h2>
        <p className="text-[#94A3B8] text-base leading-relaxed mb-10">
          Responda clientes com IA, sincronize pedidos e venda mais — tudo integrado ao seu ZeloPDV.
        </p>
        <div className="flex items-center gap-3 text-sm text-[#64748B]">
          <span>🔒 Dados criptografados</span>
          <span>·</span>
          <span>🇧🇷 Suporte em português</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Login form ───────────────────────────────────────────────── */
interface LoginFormProps {
  onSuccess: () => void;
}

function LoginForm({ onSuccess }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);

    const { error } = await signIn(email, password);

    if (error) {
      setErrorMsg(getFriendlyErrorMessage(error));
      setLoading(false);
      return;
    }

    onSuccess();
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {errorMsg && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
          {errorMsg}
        </div>
      )}

      <div>
        <label htmlFor="login-email" className="block text-sm font-medium text-[#0B1120] mb-1">
          E-mail
        </label>
        <input
          id="login-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="seu@email.com.br"
          className="border border-[#E5E7EB] rounded-lg h-11 px-3 w-full focus:outline-none focus:ring-2 focus:ring-[#25D366] focus:border-transparent text-[#0B1120] placeholder:text-[#64748B]"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label htmlFor="login-password" className="block text-sm font-medium text-[#0B1120]">
            Senha
          </label>
          <Link
            to="/auth/forgot-password"
            className="text-sm text-[#25D366] hover:text-[#1EBE5D] transition-colors"
          >
            Esqueci minha senha
          </Link>
        </div>
        <PasswordInput
          id="login-password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          placeholder="Sua senha"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-[#25D366] hover:bg-[#1EBE5D] text-white rounded-lg h-11 font-semibold px-6 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Entrando...' : 'Entrar'}
      </button>

      <div className="flex items-center gap-3 py-1">
        <div className="flex-1 h-px bg-[#E5E7EB]" />
        <span className="text-sm text-[#64748B]">ou</span>
        <div className="flex-1 h-px bg-[#E5E7EB]" />
      </div>

      <GoogleAuthButton onError={setErrorMsg} />
    </form>
  );
}

/* ─── Signup form ──────────────────────────────────────────────── */
interface SignupFormProps {
  onSwitchToLogin: () => void;
}

function SignupForm({ onSwitchToLogin }: SignupFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [success, setSuccess] = useState(false);
  // P1.32 — resend e-mail de confirmação. O dono da lanchonete não é técnico:
  // se o e-mail não chegar (typo, spam filter, throttle do Supabase), antes
  // não tinha jeito de tentar de novo sem voltar pro form e refazer tudo.
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [resendMsg, setResendMsg] = useState('');

  const handleResend = async () => {
    if (!email) {
      setResendState('error');
      setResendMsg('E-mail não encontrado. Volte ao cadastro.');
      return;
    }
    setResendState('sending');
    setResendMsg('');
    try {
      // signUp com o mesmo e-mail re-dispara o e-mail de confirmação no Supabase
      // quando o user existe mas ainda não confirmou. Sem precisar de novo
      // endpoint backend.
      const { error } = await signUp(email, password || 'placeholder-not-used-because-already-exists');
      if (error && !error.message.toLowerCase().includes('already')) {
        throw error;
      }
      setResendState('sent');
      setResendMsg('Reenviado! Cheque a caixa de entrada e o spam.');
    } catch (err) {
      console.error('[AuthPage] resend confirmation failed:', err);
      setResendState('error');
      setResendMsg('Não consegui reenviar. Aguarde 1 minuto e tente de novo.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!email) {
      setErrorMsg('Informe seu e-mail.');
      return;
    }
    if (password.length < 8) {
      setErrorMsg('A senha deve ter pelo menos 8 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('As senhas não conferem.');
      return;
    }

    setLoading(true);
    const { data, error } = await signUp(email, password);

    if (error) {
      setErrorMsg(getFriendlyErrorMessage(error));
      setLoading(false);
      return;
    }

    // Supabase returns identities: [] when the email is already registered
    if (data.user?.identities?.length === 0) {
      setErrorMsg('Este e-mail já está cadastrado. Faça login.');
      setLoading(false);
      return;
    }

    setLoading(false);
    setSuccess(true);
  };

  if (success) {
    return (
      <div className="space-y-4">
        <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="font-semibold mb-1">Conta criada com sucesso!</p>
          <p className="mb-2">
            Enviamos um e-mail de confirmação pra <strong>{email}</strong>. Cheque a caixa de entrada (e a pasta de spam) e clique no link pra ativar.
          </p>
          <p className="text-[12.5px] text-green-800/80">
            Não chegou? Espera 1-2 minutos antes de reenviar.
          </p>
        </div>

        {resendMsg && (
          <div className={`text-sm rounded-lg p-3 ${
            resendState === 'sent'
              ? 'text-green-700 bg-green-50 border border-green-200'
              : 'text-red-700 bg-red-50 border border-red-200'
          }`}>
            {resendMsg}
          </div>
        )}

        <button
          type="button"
          onClick={handleResend}
          disabled={resendState === 'sending' || resendState === 'sent'}
          className="w-full bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-800 rounded-lg h-11 font-semibold px-6 transition-colors"
        >
          {resendState === 'sending' ? 'Reenviando…' :
           resendState === 'sent'    ? 'Reenviado ✓' :
                                       'Reenviar e-mail de confirmação'}
        </button>

        <button
          type="button"
          onClick={onSwitchToLogin}
          className="w-full bg-[#25D366] hover:bg-[#1EBE5D] text-white rounded-lg h-11 font-semibold px-6 transition-colors"
        >
          Voltar ao login
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {errorMsg && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
          {errorMsg}
        </div>
      )}

      <div>
        <label htmlFor="signup-email" className="block text-sm font-medium text-[#0B1120] mb-1">
          E-mail
        </label>
        <input
          id="signup-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="seu@email.com.br"
          className="border border-[#E5E7EB] rounded-lg h-11 px-3 w-full focus:outline-none focus:ring-2 focus:ring-[#25D366] focus:border-transparent text-[#0B1120] placeholder:text-[#64748B]"
        />
      </div>

      <PasswordInput
        id="signup-password"
        label="Senha"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        placeholder="Mínimo 8 caracteres"
      />

      <PasswordInput
        id="signup-confirm"
        label="Confirmar senha"
        autoComplete="new-password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        required
        placeholder="Repita a senha"
      />

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-[#25D366] hover:bg-[#1EBE5D] text-white rounded-lg h-11 font-semibold px-6 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Criando conta...' : 'Criar conta'}
      </button>

      <div className="flex items-center gap-3 py-1">
        <div className="flex-1 h-px bg-[#E5E7EB]" />
        <span className="text-sm text-[#64748B]">ou</span>
        <div className="flex-1 h-px bg-[#E5E7EB]" />
      </div>

      <GoogleAuthButton onError={setErrorMsg} />

      <p className="text-xs text-[#64748B] text-center leading-relaxed">
        Ao criar uma conta você aceita nossos{' '}
        <a href="/termos" className="underline hover:text-[#0B1120]">
          Termos de uso
        </a>{' '}
        e{' '}
        <a href="/privacidade" className="underline hover:text-[#0B1120]">
          Política de privacidade
        </a>
        .
      </p>
    </form>
  );
}

/* ─── AuthPage ─────────────────────────────────────────────────── */
export default function AuthPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const rawMode = searchParams.get('mode');
  const mode: Mode = rawMode === 'signup' ? 'signup' : 'login';

  // Add landing-theme class to body while on this page
  useEffect(() => {
    document.body.classList.add('landing-theme');
    return () => document.body.classList.remove('landing-theme');
  }, []);

  if (session) {
    return <Navigate to="/app" replace />;
  }

  const switchMode = (newMode: Mode) => {
    setSearchParams({ mode: newMode }, { replace: true });
  };

  return (
    <div className="landing-theme min-h-screen flex">
      {/* Left — form side */}
      <div className="flex flex-col justify-center items-center flex-1 px-6 py-12 bg-white">
        <div className="w-full max-w-md">
          {/* Back to home */}
          <div className="mb-6">
            <Link
              to="/"
              className="inline-flex items-center gap-1 text-sm text-[#64748B] hover:text-[#0B1120] transition-colors"
            >
              <span aria-hidden="true">←</span>
              <span>Voltar ao início</span>
            </Link>
          </div>

          {/* Card */}
          <div className="rounded-2xl shadow-xl bg-white p-8 border border-[#E5E7EB]">
            {/* Logo (mobile only — hidden on lg since it shows in panel) */}
            <div className="flex justify-center mb-6 lg:hidden">
              <ZeloChatLogo />
            </div>
            <div className="hidden lg:flex justify-center mb-6">
              <ZeloChatLogo />
            </div>

            {/* Tab toggle */}
            <div className="flex rounded-lg border border-[#E5E7EB] p-1 mb-6 bg-[#F9FAFB]">
              <button
                type="button"
                onClick={() => switchMode('login')}
                className={`flex-1 h-9 rounded-md text-sm font-medium transition-colors ${
                  mode === 'login'
                    ? 'bg-white text-[#0B1120] shadow-sm'
                    : 'text-[#64748B] hover:text-[#0B1120]'
                }`}
              >
                Entrar
              </button>
              <button
                type="button"
                onClick={() => switchMode('signup')}
                className={`flex-1 h-9 rounded-md text-sm font-medium transition-colors ${
                  mode === 'signup'
                    ? 'bg-white text-[#0B1120] shadow-sm'
                    : 'text-[#64748B] hover:text-[#0B1120]'
                }`}
              >
                Criar conta
              </button>
            </div>

            {mode === 'login' ? (
              <LoginForm onSuccess={() => navigate('/app')} />
            ) : (
              <SignupForm onSwitchToLogin={() => switchMode('login')} />
            )}
          </div>
        </div>
      </div>

      {/* Right — hero panel (desktop only) */}
      <HeroPanel />
    </div>
  );
}
