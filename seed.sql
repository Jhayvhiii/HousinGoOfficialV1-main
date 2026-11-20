-- ============================================================================
-- HousinGo Sample Data Seed Script (run manually in Supabase SQL Editor)
-- ============================================================================
-- PREREQUISITES:
-- 1. Go to Supabase Dashboard -> Authentication -> Users -> "Add user"
--    and create at least TWO test users first:
--
--    a) Landlord user:
--       Email: landlord@housingo.ph
--       Password: Password123!
--       User Metadata (JSON): {"full_name": "Juan Landlord", "role": "landlord", "phone": "09171234567"}
--       (Then verify them: UPDATE public.profiles SET is_verified = true WHERE email = 'landlord@housingo.ph';)
--
--    b) Tenant user:
--       Email: tenant@housingo.ph
--       Password: Password123!
--       User Metadata (JSON): {"full_name": "Maria Tenant", "role": "tenant", "phone": "09187654321"}
--
-- 2. Paste this entire file into Supabase SQL Editor and click Run.
--    It is safe and idempotent: it does nothing if users are missing or properties already exist.
-- ============================================================================

DO $$
DECLARE
    v_landlord_id uuid;
    v_tenant_id   uuid;
    v_existing    integer;
    v_prop_1      uuid;
    v_prop_2      uuid;
    v_prop_3      uuid;
BEGIN
    SELECT id INTO v_landlord_id
    FROM public.profiles
    WHERE role = 'landlord'
    ORDER BY created_at ASC
    LIMIT 1;

    SELECT id INTO v_tenant_id
    FROM public.profiles
    WHERE role = 'tenant'
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_landlord_id IS NULL OR v_tenant_id IS NULL THEN
        RAISE NOTICE 'Seed skipped: create at least 1 landlord and 1 tenant in Supabase Auth first.';
        RETURN;
    END IF;

    SELECT count(*) INTO v_existing FROM public.properties;
    IF v_existing > 0 THEN
        RAISE NOTICE 'Seed skipped: properties table already contains % rows.', v_existing;
        RETURN;
    END IF;

    -- Ensure the seed landlord is verified
    UPDATE public.profiles SET is_verified = true WHERE id = v_landlord_id;

    -- Insert 10 realistic Philippine rental properties (text only, no external image URLs)
    INSERT INTO public.properties (landlord_id, title, location, price, description, availability_status, image_urls)
    VALUES
      (v_landlord_id, 'East Rembo Cozy Studio near BGC', 'Brgy. East Rembo, Taguig City', 9500.00,
       'Clean studio unit walking distance to BGC and Market! Market!. Includes private bathroom, Wi-Fi ready, and sub-metered electricity.', 'available', '{}')
    RETURNING property_id INTO v_prop_1;

    INSERT INTO public.properties (landlord_id, title, location, price, description, availability_status, image_urls)
    VALUES
      (v_landlord_id, 'Affordable Female Bed Spacer — East Rembo', '15th Ave, Brgy. East Rembo, Taguig City', 4500.00,
       'Air-conditioned 4-person room with free Wi-Fi, water included, CCTV hallway, and shared kitchen access. Ideal for BGC employees.', 'available', '{}')
    RETURNING property_id INTO v_prop_2;

    INSERT INTO public.properties (landlord_id, title, location, price, description, availability_status, image_urls)
    VALUES
      (v_landlord_id, 'Modern 1BR Condo Unit in Poblacion', 'Poblacion, Makati City', 22000.00,
       'Semi-furnished 1-bedroom condo with balcony, aircon, induction stove, and 24/7 security. Near Rockwell and Ayala.', 'available', '{}')
    RETURNING property_id INTO v_prop_3;

    INSERT INTO public.properties (landlord_id, title, location, price, description, availability_status, image_urls)
    VALUES
      (v_landlord_id, 'Quiet Single Room near Katipunan LRT', 'Loyola Heights, Quezon City', 7500.00,
       'Solo room with study desk, electric fan, fiber Wi-Fi, and shared clean bath. Perfect for students and reviewees.', 'available', '{}'),
      (v_landlord_id, 'Spacious 2BR Apartment in Kapitolyo', 'Brgy. Kapitolyo, Pasig City', 18500.00,
       'Bright 2-bedroom apartment with laundry area, kitchen cabinets, and 1 parking slot. Pet-friendly for small pets.', 'available', '{}'),
      (v_landlord_id, 'Sunshine Boarding House — Solo Room', 'Brgy. Pembo, Taguig City', 6000.00,
       'Well-ventilated solo room with own sub-meter, curfew-free entry, and nearby sari-sari stores and jeepney route.', 'available', '{}'),
      (v_landlord_id, 'IT Park Executive Studio Condo', 'Lahug, Cebu City', 16000.00,
       'Fully furnished studio right beside Cebu IT Park. Includes aircon, refrigerator, hot shower, and pool access.', 'available', '{}'),
      (v_landlord_id, 'Single Family 3BR Townhouse', 'Marikina Heights, Marikina City', 28000.00,
       'Flood-free 3-bedroom townhouse with 2 baths, gated garage, dirty kitchen, and peaceful neighborhood.', 'available', '{}'),
      (v_landlord_id, 'BGC View Loft-Type 2BR Condo', 'McKinley West, Taguig City', 35000.00,
       'Upscale loft-style 2-bedroom unit with skyline view, inverter aircons, gym & pool access, and 24/7 concierge.', 'available', '{}'),
      (v_landlord_id, 'Budget Boarding House near Ortigas', 'Brgy. San Antonio, Pasig City', 5500.00,
       'Clean shared boarding house 10 minutes from Ortigas CBD. Water included, free drinking water station, strong Wi-Fi.', 'occupied', '{}');

    -- Sample Applications
    INSERT INTO public.applications (property_id, tenant_id, status)
    VALUES
      (v_prop_1, v_tenant_id, 'pending'),
      (v_prop_3, v_tenant_id, 'approved')
    ON CONFLICT (property_id, tenant_id) DO NOTHING;

    -- Sample Inquiries (Tenant -> Landlord, Landlord -> Tenant)
    INSERT INTO public.inquiries (sender_id, receiver_id, property_id, message)
    VALUES
      (v_tenant_id, v_landlord_id, v_prop_1, 'Hi! Is the East Rembo Cozy Studio still available for viewing this Saturday afternoon?'),
      (v_landlord_id, v_tenant_id, v_prop_1, 'Hello! Yes, it is available. We can schedule a viewing at 2:00 PM on Saturday.');

    -- Sample Reviews
    INSERT INTO public.reviews (property_id, tenant_id, rating, comment)
    VALUES
      (v_prop_1, v_tenant_id, 5, 'Very clean studio and super close to BGC! The landlord responds quickly.'),
      (v_prop_2, v_tenant_id, 4, 'Affordable and safe area with reliable Wi-Fi. Great value for money.')
    ON CONFLICT (property_id, tenant_id) DO NOTHING;

    -- Sample Complaint
    INSERT INTO public.complaints (reported_by, property_id, reported_user_id, reason, status)
    VALUES
      (v_tenant_id, v_prop_2, v_landlord_id, 'Listing mentions aircon included, please clarify if electricity is sub-metered.', 'open');

    RAISE NOTICE 'HousinGo seed completed: 10 properties, 2 applications, 2 inquiries, 2 reviews, 1 complaint inserted.';
END $$;
