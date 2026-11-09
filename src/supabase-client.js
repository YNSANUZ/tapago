import { createClient } from '@supabase/supabase-js';

let client;

export function hasSupabaseConfig(env = import.meta.env || {}) {
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || env.VITE_SUPABASE_ANON_KEY?.trim();
  return Boolean(env.VITE_SUPABASE_URL?.trim() && key);
}

export function getSupabaseClient(env = import.meta.env || {}) {
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) throw new Error('O TáPago ainda não foi conectado ao backend.');
  if (!client) {
    client = createClient(url, key, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    });
  }
  return client;
}
