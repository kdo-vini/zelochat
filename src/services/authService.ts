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

export async function signOut() {
  return supabase.auth.signOut();
}
