/**
 * Vercel Serverless Function: /api/env (rewritten from /env.js)
 * Exposes ONLY safe public client environment variables to the browser.
 * NEVER expose SUPABASE_SERVICE_ROLE_KEY or STREAM_API_SECRET here.
 */

export default function handler(req, res) {
  const publicEnv = {
    VITE_SUPABASE_URL:
      process.env.VITE_SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      '',
    VITE_SUPABASE_ANON_KEY:
      process.env.VITE_SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      '',
    VITE_STREAM_API_KEY:
      process.env.VITE_STREAM_API_KEY ||
      process.env.STREAM_API_KEY ||
      '',
  };

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(`window.__ENV__ = ${JSON.stringify(publicEnv)};`);
}
