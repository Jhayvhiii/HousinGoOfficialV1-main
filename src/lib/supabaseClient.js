/**
 * HousinGo Supabase Client
 * Single client instance reading URL and anon key from environment variables.
 * Never use the service_role key in frontend code.
 */

function getEnvVar(key) {
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
    return import.meta.env[key];
  }
  if (typeof window !== 'undefined' && window.__ENV__ && window.__ENV__[key]) {
    return window.__ENV__[key];
  }
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key];
  }
  return '';
}

let clientInstance = null;

export function getSupabaseClient() {
  if (
    clientInstance &&
    typeof clientInstance.from === 'function' &&
    clientInstance.auth &&
    typeof clientInstance.auth.signUp === 'function'
  ) {
    return clientInstance;
  }

  if (
    typeof window !== 'undefined' &&
    window.supabaseClient &&
    typeof window.supabaseClient.from === 'function' &&
    window.supabaseClient.auth &&
    typeof window.supabaseClient.auth.signUp === 'function'
  ) {
    clientInstance = window.supabaseClient;
    return clientInstance;
  }

  // DO NOT replace these strings — they are the env variable NAMES read from .env / Vercel!
  const supabaseUrl = getEnvVar('VITE_SUPABASE_URL');
  const supabaseAnonKey = getEnvVar('VITE_SUPABASE_ANON_KEY');

  if (!supabaseUrl || !supabaseAnonKey) {
    const msg =
      'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env (local) or Vercel Project Settings -> Environment Variables.';
    console.error('❌ ' + msg);
    throw new Error(msg);
  }

  if (typeof window !== 'undefined' && window.supabase && typeof window.supabase.createClient === 'function') {
    clientInstance = window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    window.supabaseClient = clientInstance;
    return clientInstance;
  }

  throw new Error('Supabase JS SDK was not loaded. Check the CDN script tag in index.html.');
}

// Eagerly initialize on load if env & SDK are ready
let initialClient = null;
try {
  initialClient = getSupabaseClient();
} catch (err) {
  console.warn('⚠️ Deferred Supabase client init:', err.message);
}

export const supabase = initialClient;
