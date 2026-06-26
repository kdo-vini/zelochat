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
import AppShell from './AppShell';
import { UpdateAvailableBanner } from './components/shared/UpdateAvailableBanner';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
            <Route path="/auth/callback" element={<OAuthCallbackPage />} />
            <Route path="/onboarding" element={
              <AuthGuard requireProfile={false}><OnboardingPage /></AuthGuard>
            } />
            <Route path="/app/*" element={
              <AuthGuard><AppShell /></AuthGuard>
            } />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <UpdateAvailableBanner />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
