/**
 * Property Service
 * Handles listing properties, landlord CRUD, view summaries, and image uploads.
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

export const propertyService = {
  /**
   * Fetch available properties from the available_properties view.
   * Supports search query (ilike on location/title), price filters, and sorting.
   */
  async getAvailableProperties({ search = '', minPrice, maxPrice, sortBy = 'newest' } = {}) {
    const supabase = getClient();
    let query = supabase.from('available_properties').select('*');

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      // Search in location or title
      query = query.or(`location.ilike.${term},title.ilike.${term}`);
    }

    if (minPrice !== undefined && minPrice !== null && minPrice !== '') {
      query = query.gte('price', Number(minPrice));
    }
    if (maxPrice !== undefined && maxPrice !== null && maxPrice !== '') {
      query = query.lte('price', Number(maxPrice));
    }

    if (sortBy === 'price_asc') {
      query = query.order('price', { ascending: true });
    } else if (sortBy === 'price_desc') {
      query = query.order('price', { ascending: false });
    } else {
      query = query.order('created_at', { ascending: false });
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  /**
   * Get single property details by ID from properties table.
   * Joined with landlord profile information.
   */
  async getPropertyById(propertyId) {
    const supabase = getClient();
    const { data, error } = await supabase
      .from('properties')
      .select(`
        *,
        landlord:profiles!properties_landlord_id_fkey(
          id,
          full_name,
          email,
          phone,
          is_verified
        )
      `)
      .eq('property_id', propertyId)
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Get all properties owned by a specific landlord.
   */
  async getLandlordProperties(landlordId) {
    const supabase = getClient();
    const { data, error } = await supabase
      .from('properties')
      .select('*')
      .eq('landlord_id', landlordId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  /**
   * Get statistics from the landlord_property_summary view.
   */
  async getLandlordSummary(landlordId) {
    const supabase = getClient();
    const { data, error } = await supabase
      .from('landlord_property_summary')
      .select('*')
      .eq('landlord_id', landlordId)
      .maybeSingle();

    if (error) {
      console.warn('Error fetching landlord summary view:', error);
      return null;
    }
    return data;
  },

  /**
   * Create a new property listing.
   * RLS requires the landlord to have is_verified = true.
   */
  async createProperty(propertyData) {
    const supabase = getClient();
    const payload = {
      landlord_id: propertyData.landlord_id,
      title: propertyData.title,
      location: propertyData.location,
      price: Number(propertyData.price),
      description: propertyData.description || '',
      availability_status: propertyData.availability_status || 'available',
      image_urls: propertyData.image_urls || [],
    };

    const { data, error } = await supabase
      .from('properties')
      .insert([payload])
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Update an existing property.
   */
  async updateProperty(propertyId, updates) {
    const supabase = getClient();
    const { data, error } = await supabase
      .from('properties')
      .update(updates)
      .eq('property_id', propertyId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Delete a property listing.
   */
  async deleteProperty(propertyId) {
    const supabase = getClient();
    const { error } = await supabase
      .from('properties')
      .delete()
      .eq('property_id', propertyId);

    if (error) throw error;
    return { success: true };
  },

  /**
   * Upload an image to the 'property-images' public bucket.
   * Path requirement: "<user_id>/<filename>"
   */
  async uploadPropertyImage(userId, file) {
    const supabase = getClient();
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = `${userId}/${Date.now()}_${sanitizedName}`;

    const { error: uploadError } = await supabase.storage
      .from('property-images')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage
      .from('property-images')
      .getPublicUrl(filePath);

    return publicUrl;
  },
};

if (typeof window !== 'undefined') {
  window.propertyService = propertyService;
}

