/**
 * Inquiry Service
 * Handles direct messaging/inquiries between tenants and landlords.
 * Used for database messaging and fallback.
 */

import { getSupabaseClient } from '../lib/supabaseClient.js';

const LANDLORD_PROFILE_SYNC_PREFIX = '[LANDLORD_PROFILE_SYNC]';

function getClient() {
  return getSupabaseClient();
}

export const inquiryService = {
  /**
   * Send an inquiry message to another user.
   * RLS requires sender_id = auth.uid() and sender_id <> receiver_id.
   */
  async sendInquiry({ receiver_id, property_id = null, message }) {
    const supabase = getClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('You must be logged in to send a message.');

    if (user.id === receiver_id) {
      throw new Error('You cannot send a message to yourself.');
    }

    if (!message || !message.trim()) {
      throw new Error('Message cannot be empty.');
    }

    const { data, error } = await supabase
      .from('inquiries')
      .insert([{
        sender_id: user.id,
        receiver_id,
        property_id: property_id || null,
        message: message.trim(),
        date_sent: new Date().toISOString(),
      }])
      .select(`
        *,
        sender:profiles!inquiries_sender_id_fkey(id, full_name, role),
        receiver:profiles!inquiries_receiver_id_fkey(id, full_name, role)
      `)
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Get all inquiries involving current user (as sender or receiver).
   */
  async getUserInquiries(userId) {
    const supabase = getClient();
    const { data, error } = await supabase
      .from('inquiries')
      .select(`
        *,
        sender:profiles!inquiries_sender_id_fkey(id, full_name, email, role),
        receiver:profiles!inquiries_receiver_id_fkey(id, full_name, email, role),
        property:properties(property_id, title, location)
      `)
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
      .order('date_sent', { ascending: true });

    if (error) throw error;
    return (data || []).filter(row => !(row.message || '').startsWith(LANDLORD_PROFILE_SYNC_PREFIX));
  },

  /**
   * Private Admin-only sync for Landlord Account Profile edits (including verification docs).
   * Stored in inquiries addressed to Admin users so Tenants cannot read it under RLS,
   * and mirrored to localStorage as an instant fallback.
   */
  async syncLandlordProfileForAdmin(landlordId, profilePayload) {
    if (!landlordId) return { ok: false, payload: null };
    const payload = {
      ...profilePayload,
      updated_at: new Date().toISOString(),
    };

    // Always mirror locally keyed by landlordId as a fast fallback
    try {
      const storeKey = 'housingo_landlord_admin_profiles_v1';
      const existing = JSON.parse(localStorage.getItem(storeKey) || '{}');
      existing[landlordId] = payload;
      localStorage.setItem(storeKey, JSON.stringify(existing));
    } catch {
      // ignore storage quota errors
    }

    const supabase = getClient();
    const { data: admins, error: adminErr } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'admin');

    if (adminErr || !admins || admins.length === 0) {
      console.warn('No admin profile visible for landlord sync:', adminErr);
      return { ok: false, payload, reason: 'no_admin_visible' };
    }

    const encoded = `${LANDLORD_PROFILE_SYNC_PREFIX}${JSON.stringify(payload)}`;
    const rows = admins
      .filter(a => a.id && a.id !== landlordId)
      .map(a => ({
        sender_id: landlordId,
        receiver_id: a.id,
        property_id: null,
        message: encoded,
        date_sent: payload.updated_at,
      }));

    if (!rows.length) return { ok: false, payload, reason: 'no_target_admin' };

    const { error } = await supabase.from('inquiries').insert(rows);
    if (error) {
      console.warn('Could not sync landlord profile to admin inquiries:', error);
      return { ok: false, payload, reason: error.message };
    }
    return { ok: true, payload };
  },

  /**
   * Fetch the latest Admin-only synced Account Profile for a Landlord.
   * Checks Supabase inquiries first and compares timestamps with local fallback.
   */
  async getLatestLandlordProfileSync(landlordId) {
    if (!landlordId) return null;
    let remoteProfile = null;
    let localProfile = null;

    try {
      const store = JSON.parse(localStorage.getItem('housingo_landlord_admin_profiles_v1') || '{}');
      if (store && store[landlordId]) localProfile = store[landlordId];
    } catch {
      localProfile = null;
    }

    try {
      const supabase = getClient();
      const { data, error } = await supabase
        .from('inquiries')
        .select('message, date_sent')
        .eq('sender_id', landlordId)
        .order('date_sent', { ascending: false })
        .limit(30);

      if (!error && Array.isArray(data)) {
        const match = data.find(row => typeof row.message === 'string' && row.message.startsWith(LANDLORD_PROFILE_SYNC_PREFIX));
        if (match) {
          const raw = match.message.slice(LANDLORD_PROFILE_SYNC_PREFIX.length);
          const parsed = JSON.parse(raw);
          remoteProfile = { ...parsed, updated_at: parsed.updated_at || match.date_sent };
        }
      }
    } catch (err) {
      console.warn('Could not fetch remote landlord profile sync:', err);
    }

    if (remoteProfile && localProfile) {
      return new Date(localProfile.updated_at || 0) > new Date(remoteProfile.updated_at || 0)
        ? localProfile
        : remoteProfile;
    }
    return remoteProfile || localProfile || null;
  },

  /**
   * Group inquiries into conversations by other user.
   */
  async getConversations(userId) {
    const inquiries = await this.getUserInquiries(userId);
    const conversationsMap = new Map();

    for (const inq of inquiries) {
      const isSender = inq.sender_id === userId;
      const otherUser = isSender ? inq.receiver : inq.sender;
      if (!otherUser) continue;

      const otherUserId = otherUser.id;
      if (!conversationsMap.has(otherUserId)) {
        conversationsMap.set(otherUserId, {
          user: otherUser,
          property: inq.property,
          lastMessage: inq.message,
          lastDate: inq.date_sent,
          messages: [],
        });
      }

      const conv = conversationsMap.get(otherUserId);
      conv.lastMessage = inq.message;
      conv.lastDate = inq.date_sent;
      if (inq.property) conv.property = inq.property;
      conv.messages.push(inq);
    }

    return Array.from(conversationsMap.values()).sort(
      (a, b) => new Date(b.lastDate) - new Date(a.lastDate)
    );
  },
};

if (typeof window !== 'undefined') {
  window.inquiryService = inquiryService;
}

