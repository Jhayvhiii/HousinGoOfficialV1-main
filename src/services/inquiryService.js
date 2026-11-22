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
   * Stored in inquiries addressed to Admin users so Tenants cannot read it under RLS.
   */
  async syncLandlordProfileForAdmin(landlordId, profilePayload) {
    if (!landlordId) return null;
    const supabase = getClient();
    const { data: admins, error: adminErr } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'admin');

    if (adminErr || !admins || admins.length === 0) return null;

    const payload = {
      ...profilePayload,
      updated_at: new Date().toISOString(),
    };
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

    if (!rows.length) return null;

    const { error } = await supabase.from('inquiries').insert(rows);
    if (error) {
      console.warn('Could not sync landlord profile to admin:', error);
      return null;
    }
    return payload;
  },

  /**
   * Fetch the latest Admin-only synced Account Profile for a Landlord.
   */
  async getLatestLandlordProfileSync(landlordId) {
    if (!landlordId) return null;
    const supabase = getClient();
    const { data, error } = await supabase
      .from('inquiries')
      .select('message, date_sent')
      .eq('sender_id', landlordId)
      .like('message', `${LANDLORD_PROFILE_SYNC_PREFIX}%`)
      .order('date_sent', { ascending: false })
      .limit(1);

    if (error || !data || data.length === 0) return null;

    try {
      const raw = (data[0].message || '').slice(LANDLORD_PROFILE_SYNC_PREFIX.length);
      const parsed = JSON.parse(raw);
      return { ...parsed, updated_at: parsed.updated_at || data[0].date_sent };
    } catch {
      return null;
    }
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

