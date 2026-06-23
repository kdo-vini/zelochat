import { createClient } from '@supabase/supabase-js';

const env = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env;

const supabaseUrl = env?.VITE_SUPABASE_URL;
const supabaseAnonKey = env?.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Mantém o app funcionando sem auth em dev, mas deixa claro o erro ao usar.
  console.warn(
    '[Supabase] Variáveis ausentes: VITE_SUPABASE_URL e/ou VITE_SUPABASE_ANON_KEY. ' +
      'Configure em .env.local.'
  );
}

export const supabase = createClient(
  supabaseUrl ?? 'http://127.0.0.1:54321',
  supabaseAnonKey ?? 'public-anon-key-placeholder',
);
