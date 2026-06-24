import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import AuthGuard from './components/shared/AuthGuard';
import LandingPage from './pages/LandingPage';
import AuthPage from './pages/AuthPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import OAuthCallbackPage from './pages/OAuthCallbackPage';
import OnboardingPage from './pages/OnboardingPage';
import ZeloMenuCartPage from './pages/ZeloMenuCartPage';
import ZeloMenuStorePage from './pages/ZeloMenuStorePage';
import AppShell from './AppShell';
import { UpdateAvailableBanner } from './components/shared/UpdateAvailableBanner';

// No subdomínio público `menu.zelopdv.com.br`, o slug da loja vive na raiz
// (`/casadossalgados`, D-006). Nos outros domínios (app/dev) a loja fica em
// `/menu/:slug`. Detecção por host porque é um build único de SPA.
const IS_MENU_HOST =
  typeof window !== 'undefined' && /^menu\./i.test(window.location.hostname);

function MenuHostHome() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 text-center">
      <div>
        <p className="text-[18px] font-semibold text-[var(--color-ink)]">Cardápio online</p>
        <p className="mt-1 text-[14px] text-[var(--color-ink-muted)]">
          Abra o link da loja — por exemplo, menu.zelopdv.com.br/sua-loja
        </p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
        {IS_MENU_HOST ? (
          <Routes>
            <Route path="/menu/carrinho/:token" element={<ZeloMenuCartPage />} />
            <Route path="/:slug" element={<ZeloMenuStorePage />} />
            <Route path="/" element={<MenuHostHome />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        ) : (
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
            <Route path="/auth/callback" element={<OAuthCallbackPage />} />
            <Route path="/onboarding" element={
              <AuthGuard requireProfile={false}><OnboardingPage /></AuthGuard>
            } />
            <Route path="/menu/carrinho/:token" element={<ZeloMenuCartPage />} />
            <Route path="/menu/:slug" element={<ZeloMenuStorePage />} />
            <Route path="/app/*" element={
              <AuthGuard><AppShell /></AuthGuard>
            } />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
        <UpdateAvailableBanner />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
