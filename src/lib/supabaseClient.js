/**
 * HousinGo Supabase Client
 * Single client instance reading URL and anon key from environment variables.
 * Never use service_role key here.
 */

function getEnvVar(key) {
  // Check Vite / ESM import.meta.env if available
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
    return import.meta.env[key];
  }
  // Check window.__ENV__ (served by dev-server or Vercel static inject)
  if (typeof window !== 'undefined' && window.__ENV__ && window.__ENV__[key]) {
    return window.__ENV__[key];
  }
  // Check process.env if available (bundler/node)
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key];
  }
  return '';
}

const supabaseUrl = getEnvVar('VITE_SUPABASE_URL') || 'https://myeqpxnpyurmxqtovdec.supabase.co';
const supabaseAnonKey = getEnvVar('VITE_SUPABASE_ANON_KEY') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15ZXFweG5weXVybXhxdG92ZGVjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI1MzA0MzgsImV4cCI6MjA3ODEwNjQzOH0.X5aSsAzjvHvaaiOjM9f_M7gajFOpobn3IX623WFUzBA';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('⚠️ Supabase credentials missing. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env');
}

// Support both window.supabase from CDN and ES module createClient
let createClientFn = null;
if (typeof window !== 'undefined' && window.supabase && typeof window.supabase.createClient === 'function') {
  createClientFn = window.supabase.createClient.bind(window.supabase);
}

export async function getCreateClient() {
  if (createClientFn) return createClientFn;
  try {
    const mod = await import('@supabase/supabase-js');
    return mod.createClient;
  } catch (err) {
    if (typeof window !== 'undefined' && window.supabase?.createClient) {
      return window.supabase.createClient.bind(window.supabase);
    }
    throw new Error('Supabase SDK not loaded. Ensure CDN script or npm package is present.');
  }
}

// Global client instance
export const supabase = (typeof window !== 'undefined' && window.supabase?.createClient)
  ? window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

if (typeof window !== 'undefined' && supabase) {
  window.supabaseClient = supabase;
}
