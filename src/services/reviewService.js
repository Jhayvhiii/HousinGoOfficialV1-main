/**
 * Review Service
 * Manages property reviews (1-5 stars) in public.reviews.
 */

import { getSupabaseClient } from '../lib/supabaseClient.js';

function getClient() {
  return getSupabaseClient();
}

export const reviewService = {
  async getPropertyReviews(propertyId) {
    const supabase = getClient();
    const { data, error } = await supabase
      .from('reviews')
      .select(`
        *,
        tenant:profiles!reviews_tenant_id_fkey(id, full_name)
      `)
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  async getTenantReviews(tenantId) {
    const supabase = getClient();
    const { data, error } = await supabase
      .from('reviews')
      .select(`
        *,
        property:properties(property_id, title, location, price)
      `)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  async getLandlordReviews(landlordId) {
    const supabase = getClient();
    const { data: props, error: propErr } = await supabase
      .from('properties')
      .select('property_id, title')
      .eq('landlord_id', landlordId);

    if (propErr) throw propErr;
    if (!props || props.length === 0) return [];

    const propIds = props.map(p => p.property_id);
    const { data, error } = await supabase
      .from('reviews')
      .select(`
        *,
        tenant:profiles!reviews_tenant_id_fkey(id, full_name, email),
        property:properties(property_id, title, location)
      `)
      .in('property_id', propIds)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  async upsertReview({ property_id, tenant_id, rating, comment }) {
    const supabase = getClient();
    const numRating = Number(rating);
    if (!Number.isInteger(numRating) || numRating < 1 || numRating > 5) {
      throw new Error('Rating must be a whole number between 1 and 5.');
    }

    // Check if tenant already reviewed this property so they can edit it cleanly
    const { data: existing } = await supabase
      .from('reviews')
      .select('review_id')
      .eq('property_id', property_id)
      .eq('tenant_id', tenant_id)
      .maybeSingle();

    if (existing) {
      const { data, error } = await supabase
        .from('reviews')
        .update({ rating: numRating, comment: (comment || '').trim() })
        .eq('review_id', existing.review_id)
        .select()
        .single();
      if (error) throw error;
      return { ...data, updated: true };
    }

    const { data, error } = await supabase
      .from('reviews')
      .insert([{
        property_id,
        tenant_id,
        rating: numRating,
        comment: (comment || '').trim(),
      }])
      .select()
      .single();

    if (error) throw error;
    return { ...data, updated: false };
  },

  async deleteReview(reviewId) {
    const supabase = getClient();
    const { error } = await supabase
      .from('reviews')
      .delete()
      .eq('review_id', reviewId);

    if (error) throw error;
    return { success: true };
  },
};

if (typeof window !== 'undefined') {
  window.reviewService = reviewService;
}
