/**
 * Vercel Serverless Function: /api/stream-token
 * Validates the user's Supabase JWT from the Authorization header,
 * then signs a GetStream user token using server-side env vars:
 *   - VITE_SUPABASE_URL (or SUPABASE_URL)
 *   - VITE_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY)
 *   - STREAM_API_KEY
 *   - STREAM_API_SECRET
 */

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function createStreamJwt(userId, secret) {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64UrlEncode(JSON.stringify({
    user_id: userId,
    iat: Math.floor(Date.now() / 1000),
  }));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${header}.${payload}.${signature}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const streamApiKey = process.env.STREAM_API_KEY;
  const streamApiSecret = process.env.STREAM_API_SECRET;

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ error: 'Supabase environment variables are not configured on the server.' });
  }
  if (!streamApiKey || !streamApiSecret) {
    return res.status(503).json({
      error: 'GetStream is not configured on the server. Using Supabase inquiries fallback.',
      fallback: true,
    });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization Bearer token.' });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired Supabase session.' });
    }

    const streamUserId = `user_${user.id}`;
    const streamToken = createStreamJwt(streamUserId, streamApiSecret);

    return res.status(200).json({
      apiKey: streamApiKey,
      userId: streamUserId,
      token: streamToken,
    });
  } catch (err) {
    console.error('Stream token error:', err);
    return res.status(500).json({ error: 'Failed to generate Stream token.' });
  }
}
