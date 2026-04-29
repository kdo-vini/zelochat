import { supabase } from './supabaseClient';

export async function signIn(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signUp(email: string, password: string) {
  const redirectTo =
    typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : undefined;

  return supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: redirectTo },
  });
}

export async function signInWithGoogle() {
  const redirectTo =
    typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : undefined;

  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  });
}

export async function resetPasswordForEmail(email: string, redirectTo?: string) {
  const finalRedirect =
    redirectTo ??
    (typeof window !== 'undefined' ? `${window.location.origin}/auth/reset-password` : undefined);

  return supabase.auth.resetPasswordForEmail(email, { redirectTo: finalRedirect });
}

export async function updateUserPassword(password: string) {
  return supabase.auth.updateUser({ password });
}

/**
 * Clear ZeloChat-namespaced local state. Called on signOut so the next user on
 * a shared device doesn't inherit the previous tenant's businessInfo, profile,
 * dailyContext, or UI prefs. Supabase's own auth-token keys (`sb-…-auth-token`)
 * are cleared by `supabase.auth.signOut()` separately, so we only target our
 * own `zelochat`-prefixed keys here. Wrapped in try/catch because localStorage
 * may be unavailable (private browsing, quota issues, SSR).
 */
function clearLocalAppState(): void {
  if (typeof window === 'undefined') return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && (key.startsWith('zelochat_') || key.startsWith('zelochat:'))) {
        toRemove.push(key);
      }
    }
    toRemove.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    /* localStorage unavailable — fine, signOut still proceeds */
  }
}

export async function signOut() {
  // Clear local app state BEFORE Supabase signOut so even if the network call
  // fails, the previous user's businessInfo/profile/etc. is gone from this
  // device. Cross-tenant leak prevention takes priority over server-side
  // session revocation (which the user can also retry).
  clearLocalAppState();
  return supabase.auth.signOut();
}
