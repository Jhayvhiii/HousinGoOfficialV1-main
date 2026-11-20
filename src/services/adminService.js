/**
 * Admin Service
 * Handles admin_reports view, user management, landlord verification,
 * property moderation, and system_records audit logging.
 */

import { getSupabaseClient } from '../lib/supabaseClient.js';

function getClient() {
  return getSupabaseClient();
}

export const adminService = {
  async getAdminReports() {
    const supabase = getClient();
    const { data, error } = await supabase
      .from('admin_reports')
      .select('*')
      .maybeSingle();

    if (error) {
      console.warn('Could not read admin_reports view:', error);
      return null;
    }
    return data;
  },

  async getUsers({ search = '', role = '', status = '' } = {}) {
    const supabase = getClient();
    let query = supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (role) query = query.eq('role', role);
    if (status) query = query.eq('status', status);
    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      query = query.or(`full_name.ilike.${term},email.ilike.${term}`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async verifyLandlord(adminId, userId, isVerified) {
    const supabase = getClient();
    const { data, error } = await supabase
      .from('profiles')
      .update({ is_verified: Boolean(isVerified) })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;

    await this.logAction(adminId, isVerified ? 'verify_landlord' : 'unverify_landlord', {
      target_user_id: userId,
      target_email: data.email,
      is_verified: Boolean(isVerified),
    });

    return data;
  },

  async updateUserStatus(adminId, userId, newStatus) {
    const supabase = getClient();
    const valid = ['active', 'suspended', 'pending'];
    if (!valid.includes(newStatus)) throw new Error(`Invalid status: ${newStatus}`);

    const { data, error } = await supabase
      .from('profiles')
      .update({ status: newStatus })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;

    await this.logAction(adminId, `set_user_status_${newStatus}`, {
      target_user_id: userId,
      target_email: data.email,
      status: newStatus,
    });

    return data;
  },

  async getAllProperties({ search = '', status = '' } = {}) {
    const supabase = getClient();
    let query = supabase
      .from('properties')
      .select(`
        *,
        landlord:profiles!properties_landlord_id_fkey(id, full_name, email, is_verified)
      `)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('availability_status', status);
    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      query = query.or(`title.ilike.${term},location.ilike.${term}`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async moderateProperty(adminId, propertyId, availabilityStatus) {
    const supabase = getClient();
    const valid = ['available', 'occupied', 'hidden', 'removed'];
    if (!valid.includes(availabilityStatus)) throw new Error(`Invalid status: ${availabilityStatus}`);

    const { data, error } = await supabase
      .from('properties')
      .update({ availability_status: availabilityStatus })
      .eq('property_id', propertyId)
      .select()
      .single();

    if (error) throw error;

    await this.logAction(adminId, `moderate_property_${availabilityStatus}`, {
      property_id: propertyId,
      title: data.title,
      availability_status: availabilityStatus,
    });

    return data;
  },

  async deleteProperty(adminId, propertyId, title = '') {
    const supabase = getClient();
    const { error } = await supabase
      .from('properties')
      .delete()
      .eq('property_id', propertyId);

    if (error) throw error;

    await this.logAction(adminId, 'delete_property', {
      property_id: propertyId,
      title,
    });

    return { success: true };
  },

  async logAction(adminId, action, details = {}) {
    if (!adminId) return null;
    const supabase = getClient();
    const { data, error } = await supabase
      .from('system_records')
      .insert([{
        admin_id: adminId,
        action,
        details,
      }])
      .select()
      .single();

    if (error) {
      console.error('Failed to write system_records audit log:', error);
      return null;
    }
    return data;
  },

  async getSystemRecords(limit = 30) {
    const supabase = getClient();
    const { data, error } = await supabase
      .from('system_records')
      .select(`
        *,
        admin:profiles!system_records_admin_id_fkey(id, full_name, email)
      `)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  },
};

if (typeof window !== 'undefined') {
  window.adminService = adminService;
}
