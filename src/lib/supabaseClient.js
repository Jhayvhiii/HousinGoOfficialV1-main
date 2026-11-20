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
  if (clientInstance && typeof clientInstance.from === 'function' && clientInstance.auth && typeof clientInstance.auth.signUp === 'function') {
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

  const supabaseUrl = getEnvVar('https://lqoeueckcyxvcnwbcnqm.supabase.co');
  const supabaseAnonKey = getEnvVar('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxxb2V1ZWNrY3l4dmNud2JjbnFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ3Mzg3MDQsImV4cCI6MjExMDMxNDcwNH0.DgeCFG9e1i3CDYOzhwcdME70YE1b5gN_EdAA9z2UJ70');

  if (!supabaseUrl || !supabaseAnonKey) {
    const msg =
      'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env and run with `npm run dev` (or generate env.js for Live Server).';
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
