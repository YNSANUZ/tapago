import { getSupabaseClient } from './supabase-client.js';

export async function signInWithGoogle(client = null, origin = globalThis.location?.origin) {
  const supabase = client || getSupabaseClient();
  if (!origin) throw new Error('Não foi possível identificar o endereço do TáPago.');
  const redirectTo = new URL('/tapago/', origin).toString();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) throw error;
}

export async function signOut(client = null) {
  const supabase = client || getSupabaseClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
