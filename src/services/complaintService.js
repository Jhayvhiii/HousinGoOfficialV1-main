/**
 * Complaint Service
 * Manages user complaints in public.complaints.
 */

function getClient() {
  if (typeof window !== 'undefined' && window.supabaseClient) return window.supabaseClient;
  if (typeof window !== 'undefined' && window.supabase) return window.supabase;
  throw new Error('Supabase client is not initialized.');
}

export const complaintService = {
  async fileComplaint({ reported_by, property_id = null, reported_user_id = null, reason }) {
    const supabase = getClient();
    if (!reason || !reason.trim()) {
      throw new Error('Please describe the reason for your complaint.');
    }

    const { data, error } = await supabase
      .from('complaints')
      .insert([{
        reported_by,
        property_id: property_id || null,
        reported_user_id: reported_user_id || null,
        reason: reason.trim(),
        status: 'open',
      }])
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async getMyComplaints(userId) {
    const supabase = getClient();
    const { data, error } = await supabase
      .from('complaints')
      .select(`
        *,
        property:properties(property_id, title, location)
      `)
      .eq('reported_by', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  async getAllComplaints(statusFilter = '') {
    const supabase = getClient();
    let query = supabase
      .from('complaints')
      .select(`
        *,
        reporter:profiles!complaints_reported_by_fkey(id, full_name, email, role),
        reported_user:profiles!complaints_reported_user_id_fkey(id, full_name, email),
        handler:profiles!complaints_handled_by_fkey(id, full_name),
        property:properties(property_id, title, location)
      `)
      .order('created_at', { ascending: false });

    if (statusFilter) {
      query = query.eq('status', statusFilter);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async updateComplaintStatus(complaintId, status, adminId) {
    const supabase = getClient();
    const valid = ['open', 'under_review', 'resolved', 'dismissed'];
    if (!valid.includes(status)) {
      throw new Error(`Invalid complaint status: ${status}`);
    }

    const updates = {
      status,
      handled_by: adminId,
      resolved_at: (status === 'resolved' || status === 'dismissed') ? new Date().toISOString() : null,
    };

    const { data, error } = await supabase
      .from('complaints')
      .update(updates)
      .eq('complaint_id', complaintId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },
};

if (typeof window !== 'undefined') {
  window.complaintService = complaintService;
}
