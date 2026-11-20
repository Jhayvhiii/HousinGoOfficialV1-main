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

const supabaseUrl = getEnvVar('https://lqoeueckcyxvcnwbcnqm.supabase.co');
const supabaseAnonKey = getEnvVar('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxxb2V1ZWNrY3l4dmNud2JjbnFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ3Mzg3MDQsImV4cCI6MjExMDMxNDcwNH0.DgeCFG9e1i3CDYOzhwcdME70YE1b5gN_EdAA9z2UJ70');

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    '❌ Missing Supabase environment variables! Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file and run with `npm run dev`.'
  );
}

let client = null;
if (supabaseUrl && supabaseAnonKey) {
  if (typeof window !== 'undefined' && window.supabase && typeof window.supabase.createClient === 'function') {
    client = window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  } else {
    console.error('❌ Supabase JS SDK (window.supabase) was not loaded before supabaseClient.js.');
  }
}

export const supabase = client;

if (typeof window !== 'undefined') {
  window.supabaseClient = supabase;
}
