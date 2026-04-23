import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  // Mantém o app funcionando sem auth em dev, mas deixa claro o erro ao usar.
  console.warn(
    '[Supabase] Variáveis ausentes: VITE_SUPABASE_URL e/ou VITE_SUPABASE_ANON_KEY. ' +
      'Configure em .env.local.'
  );
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '');

