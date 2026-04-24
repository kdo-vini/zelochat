import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

interface AuthGuardProps {
  children: ReactNode;
  requireProfile?: boolean;
}

export default function AuthGuard({ children, requireProfile = true }: AuthGuardProps) {
  const { session, loading, profileComplete, profileChecked } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-white">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#E5E7EB] border-t-[#25D366]" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/auth" replace state={{ from: location.pathname }} />;
  }

  if (requireProfile) {
    if (!profileChecked) {
      return (
        <div className="flex h-screen w-screen items-center justify-center bg-white">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#E5E7EB] border-t-[#25D366]" />
        </div>
      );
    }
    if (!profileComplete) {
      return <Navigate to="/onboarding" replace />;
    }
  }

  return <>{children}</>;
}
