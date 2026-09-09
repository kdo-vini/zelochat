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

    // Timeout fallback — if something goes wrong, redirect to auth with error.
    // P1.38 — bump 8s → 20s. Conexões 3G/4G lentas no celular do dono da
    // lanchonete demoravam mais de 8s pra Supabase resolver o callback,
    // resultando em "OAuth falhou" injusto. 20s é largo o suficiente pra
    // 99% dos cenários e ainda evita que o user fique olhando spinner
    // infinito se algo travar de verdade.
    const t = setTimeout(() => {
      navigate('/auth?error=oauth_failed', { replace: true });
    }, 20000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(t);
    };
  }, [navigate]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white gap-4">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#E5E7EB] border-t-[var(--color-brand)]" />
      <p className="text-sm text-[#64748B]">Autenticando...</p>
    </div>
  );
}
