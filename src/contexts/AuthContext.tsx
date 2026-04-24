/**
 * AuthContext — SHIM for Track B development.
 * Track A will replace this with the full implementation.
 * This shim is intentionally minimal and functional enough for Track B pages to compile.
 */
import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../services/supabaseClient';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  token: string | null;
  loading: boolean;
  profileComplete: boolean;
  /** True once the profile check has resolved (at least once) */
  profileChecked: boolean;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  token: null,
  loading: true,
  profileComplete: false,
  profileChecked: false,
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileComplete, setProfileComplete] = useState(false);
  const [profileChecked, setProfileChecked] = useState(false);

  const checkProfile = async (userId: string) => {
    const { data } = await supabase
      .from('empresa_perfil')
      .select('id, zelochat_onboarding_done')
      .eq('user_id', userId)
      .maybeSingle();
    setProfileComplete(!!data?.zelochat_onboarding_done);
    setProfileChecked(true);
  };

  const refreshProfile = async () => {
    if (session?.user?.id) {
      await checkProfile(session.user.id);
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user?.id) {
        void checkProfile(data.session.user.id).finally(() => setLoading(false));
      } else {
        setProfileChecked(true);
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession((prev) => {
        // Only invalidate the profile check when the user actually changes.
        // Supabase fires TOKEN_REFRESHED periodically with the same user — those
        // must not flip profileChecked back to false (would cause AuthGuard to
        // flash the spinner or bounce to /onboarding).
        if (prev?.user?.id !== newSession?.user?.id) {
          setProfileChecked(false);
          setProfileComplete(false);
        }
        return newSession;
      });
      if (newSession?.user?.id) {
        void checkProfile(newSession.user.id);
      } else {
        setProfileComplete(false);
        setProfileChecked(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, token: session?.access_token ?? null, loading, profileComplete, profileChecked, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
