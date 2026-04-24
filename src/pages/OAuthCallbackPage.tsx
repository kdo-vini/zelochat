import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';

export default function OAuthCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        navigate('/app', { replace: true });
      }
    });

    // Fallback: session may already be set if Supabase detected it from URL hash
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        navigate('/app', { replace: true });
      }
    });

    // Timeout fallback — if something goes wrong, redirect to auth with error
    const t = setTimeout(() => {
      navigate('/auth?error=oauth_failed', { replace: true });
    }, 8000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(t);
    };
  }, [navigate]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white gap-4">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#E5E7EB] border-t-[#25D366]" />
      <p className="text-sm text-[#64748B]">Autenticando...</p>
    </div>
  );
}
