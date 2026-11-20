/**
 * Application Service
 * Handles tenant applications and landlord application reviews.
 */

import { getSupabaseClient } from '../lib/supabaseClient.js';

function getClient() {
  return getSupabaseClient();
}

export const applicationService = {
  /**
   * Submit an application for a property.
   * Catches unique constraint (property_id, tenant_id) and returns a friendly message.
   */
  async applyToProperty({ property_id, tenant_id }) {
    const supabase = getClient();
    try {
      const { data, error } = await supabase
        .from('applications')
        .insert([{
          property_id,
          tenant_id,
          status: 'pending',
          application_date: new Date().toISOString(),
        }])
        .select()
        .single();

      if (error) {
        // Postgres unique violation code is 23505
        if (error.code === '23505' || error.message?.includes('duplicate key') || error.message?.includes('unique constraint')) {
          throw new Error('You have already applied for this property! Check your applications in the Tenant Dashboard.');
        }
        throw error;
      }
      return data;
    } catch (err) {
      if (err.code === '23505' || err.message?.includes('duplicate key') || err.message?.includes('unique constraint')) {
        throw new Error('You have already applied for this property! Check your applications in the Tenant Dashboard.');
      }
      throw err;
    }
  },

  /**
   * Get all applications submitted by a specific tenant.
   */
  async getTenantApplications(tenantId) {
    const supabase = getClient();
    const { data, error } = await supabase
      .from('applications')
      .select(`
        *,
        property:properties(
          property_id,
          title,
          location,
          price,
          availability_status,
          image_urls,
          landlord:profiles!properties_landlord_id_fkey(
            id,
            full_name,
            email,
            phone
          )
        )
      `)
      .eq('tenant_id', tenantId)
      .order('application_date', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  /**
   * Get all applications for a specific property (viewed by landlord).
   */
  async getPropertyApplications(propertyId) {
    const supabase = getClient();
    const { data, error } = await supabase
      .from('applications')
      .select(`
        *,
        tenant:profiles!applications_tenant_id_fkey(
          id,
          full_name,
          email,
          phone
        )
      `)
      .eq('property_id', propertyId)
      .order('application_date', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  /**
   * Get all applications for all properties owned by a landlord.
   */
  async getLandlordApplications(landlordId) {
    const supabase = getClient();
    // First find property IDs owned by landlord
    const { data: properties, error: propErr } = await supabase
      .from('properties')
      .select('property_id')
      .eq('landlord_id', landlordId);

    if (propErr) throw propErr;
    if (!properties || properties.length === 0) return [];

    const propertyIds = properties.map(p => p.property_id);

    const { data, error } = await supabase
      .from('applications')
      .select(`
        *,
        property:properties(property_id, title, location, price),
        tenant:profiles!applications_tenant_id_fkey(id, full_name, email, phone)
      `)
      .in('property_id', propertyIds)
      .order('application_date', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  /**
   * Tenant cancels their own application.
   */
  async cancelApplication(applicationId) {
    const supabase = getClient();
    const { data, error } = await supabase
      .from('applications')
      .update({ status: 'cancelled' })
      .eq('application_id', applicationId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Landlord updates status of an application ('approved' | 'rejected').
   */
  async updateStatus(applicationId, newStatus) {
    const supabase = getClient();
    const validStatuses = ['approved', 'rejected', 'cancelled', 'pending'];
    if (!validStatuses.includes(newStatus)) {
      throw new Error(`Invalid application status: ${newStatus}`);
    }

    const { data, error } = await supabase
      .from('applications')
      .update({ status: newStatus })
      .eq('application_id', applicationId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },
};

if (typeof window !== 'undefined') {
  window.applicationService = applicationService;
}

