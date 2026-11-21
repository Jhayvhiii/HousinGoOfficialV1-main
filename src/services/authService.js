/**
 * Authentication Service
 * Interacts with Supabase Auth (auth.users) and public.profiles.
 */

import { getSupabaseClient } from '../lib/supabaseClient.js';

function getClient() {
  return getSupabaseClient();
}

export const authService = {
  /**
   * Register a new user with Supabase Auth.
   * Metadata is used by handle_new_user trigger to populate public.profiles.
   * Role can only be 'tenant' or 'landlord'.
   */
  async signUp({ email, password, fullName, role, phone }) {
    const supabase = getClient();
    const cleanRole = (role || 'tenant').toLowerCase().trim();
    if (!['tenant', 'landlord'].includes(cleanRole)) {
      throw new Error("Invalid role selected. Only 'tenant' or 'landlord' are allowed.");
    }

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          full_name: fullName.trim(),
          role: cleanRole,
          phone: phone ? phone.trim() : null,
        },
      },
    });

    if (error) throw error;
    return data;
  },

  /**
   * Sign in with email and password.
   * Checks if user account is suspended.
   */
  async signIn({ email, password }) {
    const supabase = getClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) throw error;

    // Fetch user profile immediately after authentication
    const profile = await this.getProfile(data.user.id);

    if (profile && profile.status === 'suspended') {
      await this.signOut();
      throw new Error('Your account has been suspended by an administrator. Please contact support.');
    }

    return { session: data.session, user: data.user, profile };
  },

  /**
   * Sign out current user.
   */
  async signOut() {
    const supabase = getClient();
    const { error } = await supabase.auth.signOut();
    if (error) console.error('SignOut error:', error);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('housingo_user');
      localStorage.removeItem('housingo_profile');
    }
    return { success: true };
  },

  /**
   * Get the current active session.
   */
  async getSession() {
    const supabase = getClient();
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.warn('Session error:', error);
      return null;
    }
    return data.session;
  },

  /**
   * Get current auth user.
   */
  async getCurrentUser() {
    const supabase = getClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return null;
    return user;
  },

  /**
   * Fetch a user profile by ID from public.profiles.
   */
  async getProfile(userId) {
    if (!userId) return null;
    const supabase = getClient();
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching profile:', error);
      return null;
    }
    return data;
  },

  /**
   * Update current user's profile details (full_name, phone).
   * RLS policy prevents updating role or is_verified.
   */
  async updateProfile(userId, { full_name, phone }) {
    const supabase = getClient();
    const updates = {};
    if (full_name !== undefined) updates.full_name = full_name;
    if (phone !== undefined) updates.phone = phone;

    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Update extended user metadata in Supabase Auth (avatar_url, bio, hobbies,
   * house_address, payment_methods, qrph_url, wishlist, etc.).
   */
  async updateUserMetadata(metaUpdates) {
    const supabase = getClient();
    const { data, error } = await supabase.auth.updateUser({
      data: metaUpdates,
    });
    if (error) throw error;
    return data.user;
  },

  /**
   * Change current user's password.
   */
  async changePassword(newPassword) {
    const supabase = getClient();
    const { data, error } = await supabase.auth.updateUser({
      password: newPassword,
    });
    if (error) throw error;
    return data;
  },

  /**
   * Subscribe to Supabase auth state changes.
   */
  onAuthStateChange(callback) {
    const supabase = getClient();
    return supabase.auth.onAuthStateChange(async (event, session) => {
      let profile = null;
      if (session?.user?.id) {
        profile = await this.getProfile(session.user.id);
      }
      callback(event, session, profile);
    });
  },
};

if (typeof window !== 'undefined') {
  window.authService = authService;
}

