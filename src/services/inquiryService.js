/**
 * Inquiry Service
 * Handles direct messaging/inquiries between tenants and landlords.
 * Used for database messaging and fallback.
 */

function getClient() {
  if (typeof window !== 'undefined' && window.supabaseClient) {
    return window.supabaseClient;
  }
  if (typeof window !== 'undefined' && window.supabase) {
    return window.supabase;
  }
  throw new Error('Supabase client is not initialized.');
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
    return data || [];
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

