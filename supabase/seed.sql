-- ═══════════════════════════════════════════════════════════════
-- ThabangVision Labs — Dev Seed Data
-- Run with: npx supabase db reset (applies migrations + this seed)
-- All data is fake / for testing only
-- ═══════════════════════════════════════════════════════════════

-- ─── Smart Rentals (10 items across categories) ───
INSERT INTO smart_rentals (slug, title, description, category, sub_category, brand, model, price_per_day, price_per_week, deposit_amount, currency, thumbnail_url, is_available, quantity, is_published, is_featured, tags, features, rental_includes)
VALUES
  ('sony-a7iv', 'Sony A7 IV', 'Full-frame hybrid camera with 33MP sensor. Ideal for video and stills.', 'Cameras & Optics', 'Mirrorless', 'Sony', 'A7 IV', 1500, 7500, 5000, 'ZAR', '/placeholder-camera.jpg', true, 2, true, true, ARRAY['mirrorless','full-frame','4k'], ARRAY['33MP Exmor R sensor','4K 60fps','10-bit 4:2:2','Real-time Eye AF'], ARRAY['Body','Battery x2','Charger','Strap','SD Card 128GB']),
  ('canon-r6ii', 'Canon EOS R6 Mark II', '24.2MP full-frame mirrorless with blazing 40fps continuous shooting.', 'Cameras & Optics', 'Mirrorless', 'Canon', 'EOS R6 II', 1400, 7000, 4500, 'ZAR', '/placeholder-camera.jpg', true, 1, true, false, ARRAY['mirrorless','full-frame','canon'], ARRAY['24.2MP CMOS','4K 60fps','Up to 40fps','IBIS'], ARRAY['Body','Battery x2','Charger','Strap']),
  ('sony-85mm-gm', 'Sony 85mm f/1.4 GM II', 'Premium portrait lens with stunning bokeh and razor sharpness.', 'Cameras & Optics', 'Lenses', 'Sony', '85mm f/1.4 GM II', 600, 3000, 3000, 'ZAR', '/placeholder-lens.jpg', true, 1, true, true, ARRAY['portrait','prime','sony-e'], ARRAY['f/1.4 aperture','11-blade circular aperture','Nano AR II coating'], ARRAY['Lens','Front/Rear caps','Hood','Pouch']),
  ('dji-ronin-rs3', 'DJI RS 3 Pro', '3-axis gimbal stabilizer for cinema cameras up to 4.5kg.', 'Stabilisation', 'Gimbals', 'DJI', 'RS 3 Pro', 500, 2500, 2000, 'ZAR', '/placeholder-gimbal.jpg', true, 2, true, false, ARRAY['gimbal','stabilizer','3-axis'], ARRAY['4.5kg payload','LiDAR focusing','Touchscreen','12hr battery'], ARRAY['Gimbal','Suitcase','Cables','Phone holder']),
  ('aputure-600d', 'Aputure LS 600d Pro', '600W daylight LED. Bowens mount. Silent fan mode for film sets.', 'Lighting', 'LED Panels', 'Aputure', 'LS 600d Pro', 800, 4000, 3000, 'ZAR', '/placeholder-light.jpg', true, 3, true, true, ARRAY['lighting','led','daylight'], ARRAY['600W output','5600K daylight','Bowens mount','Bluetooth control'], ARRAY['Light head','Controller','Power cable','Reflector']),
  ('rode-ntg5', 'Rode NTG5', 'Broadcast-grade short shotgun mic. Ultra-lightweight for boom ops.', 'Audio', 'Microphones', 'Rode', 'NTG5', 300, 1500, 1000, 'ZAR', '/placeholder-mic.jpg', true, 2, true, false, ARRAY['shotgun','broadcast','location-sound'], ARRAY['Short shotgun','RF-bias technology','Lightweight 76g','Low self-noise'], ARRAY['Microphone','Windshield','Shock mount','XLR cable']),
  ('dji-mini-4-pro', 'DJI Mini 4 Pro', 'Sub-250g drone with 4K/60fps and omnidirectional obstacle sensing.', 'Drones', 'Consumer', 'DJI', 'Mini 4 Pro', 700, 3500, 2500, 'ZAR', '/placeholder-drone.jpg', true, 1, true, true, ARRAY['drone','4k','sub-250g'], ARRAY['4K/60fps','48MP photos','Omnidirectional sensing','34min flight'], ARRAY['Drone','Controller','Battery x3','Charger','Case']),
  ('atomos-ninja-v', 'Atomos Ninja V', '5" HDR monitor-recorder. ProRes/DNx recording over HDMI.', 'Monitors', 'Recording Monitors', 'Atomos', 'Ninja V', 450, 2250, 1500, 'ZAR', '/placeholder-monitor.jpg', true, 2, true, false, ARRAY['monitor','recorder','prores'], ARRAY['5" 1000nit HDR','ProRes/DNxHR','HDMI input','AtomOS'], ARRAY['Monitor','SSD 500GB','Battery x2','Sunhood','HDMI cable']),
  ('manfrotto-504x', 'Manfrotto 504X Fluid Head + 645 Tripod', 'Professional video tripod system. 12kg payload.', 'Support', 'Tripods', 'Manfrotto', '504X + 645', 350, 1750, 1500, 'ZAR', '/placeholder-tripod.jpg', true, 3, true, false, ARRAY['tripod','fluid-head','video'], ARRAY['12kg payload','Flat base','Bridging technology','75mm half ball'], ARRAY['Head','Legs','Spreader','Bag']),
  ('smallrig-matte-box', 'SmallRig Mini Matte Box', 'Lightweight matte box with top flag and filter trays.', 'Rigging', 'Matte Boxes', 'SmallRig', 'Mini Matte Box', 200, 1000, 500, 'ZAR', '/placeholder-rig.jpg', true, 2, true, false, ARRAY['matte-box','rigging','filter'], ARRAY['Lightweight carbon fiber','4x5.65 filter trays','Top flag','15mm rod mount'], ARRAY['Matte box','Filter trays x2','Top flag','Rod clamp']);

-- ─── Smart Productions (3 portfolio pieces) ───
INSERT INTO smart_productions (slug, title, client, year, project_type, description, thumbnail_url, tags, is_published, is_featured)
VALUES
  ('ubuntu-documentary', 'Ubuntu: Stories of Community', 'SABC', 2025, 'Documentary', 'A 6-part documentary series exploring ubuntu philosophy in modern South African communities. Shot across Gauteng, KZN, and the Western Cape.', '/placeholder-production.jpg', ARRAY['documentary','ubuntu','sabc'], true, true),
  ('gold-reef-fashion', 'Gold Reef Fashion Film', 'Johannesburg Fashion Week', 2025, 'Fashion Film', 'A cinematic fashion film shot at Gold Reef City, blending Joburg heritage with contemporary African design.', '/placeholder-production.jpg', ARRAY['fashion','johannesburg','cinematic'], true, true),
  ('startup-series', 'The Hustle: SA Startup Stories', 'Independent', 2026, 'Web Series', 'A 4-episode web series following three tech startups from pitch to launch. Produced in partnership with Silicon Cape.', '/placeholder-production.jpg', ARRAY['startup','web-series','tech'], true, false);

-- ─── Press Articles (2 articles) ───
INSERT INTO press (title, slug, content, excerpt, author, category, is_published, is_featured, published_at)
VALUES
  ('ThabangVision Launches AI-Powered Equipment Platform', 'thabangvision-launches-ai-platform', 'ThabangVision Labs has launched its AI-powered creative production and equipment rental platform, designed specifically for the South African film and photography industry. The platform features verified creators, intelligent gear matching, and an AI assistant called Ubunye that helps filmmakers find the right crew and equipment for their projects.', 'ThabangVision Labs launches AI-powered platform for SA filmmakers.', 'ThabangVision Team', 'Company News', true, true, NOW() - INTERVAL '7 days'),
  ('The Future of Film Equipment Rental in South Africa', 'future-film-rental-sa', 'As South Africa''s creative industry continues to grow, the demand for accessible, affordable equipment rental is at an all-time high. ThabangVision is addressing this gap by building a platform that connects gear owners with filmmakers, using AI to optimize pricing and availability.', 'How AI is changing equipment rental for SA filmmakers.', 'ThabangVision Team', 'Industry', true, false, NOW() - INTERVAL '14 days');

-- ─── Career Listings (2 openings) ───
INSERT INTO careers (title, department, location, description, employment_type, requirements, is_published)
VALUES
  ('Full-Stack Developer', 'Engineering', 'Johannesburg, Remote', 'Join our engineering team to build the next generation of creative production tools. You''ll work on our Next.js platform, Supabase backend, and AI integrations.', 'Full-time', ARRAY['3+ years TypeScript/React','Experience with Next.js','Supabase or PostgreSQL','Passion for the creative industry'], true),
  ('Content Creator', 'Marketing', 'Johannesburg', 'Create compelling content showcasing our platform and the South African creative community. Video, photo, and written content across social channels.', 'Contract', ARRAY['Portfolio of creative work','Video editing skills (Premiere/DaVinci)','Social media experience','Based in Johannesburg'], true);

-- ─── Subscription Plans (3 tiers matching prod pricing) ───
INSERT INTO subscription_plans (name, slug, description, price, currency, interval, features, is_active)
VALUES
  ('Starter', 'starter', 'For individual creators getting started', 0, 'ZAR', 'monthly', '["List up to 3 items","Basic analytics","Email support","Community access"]'::jsonb, true),
  ('Pro Creator', 'pro-creator', 'For active creators and small studios', 299, 'ZAR', 'monthly', '["Unlimited listings","Priority search placement","Advanced analytics","Verified badge","Priority support","Custom storefront"]'::jsonb, true),
  ('Studio', 'studio', 'For production houses and rental companies', 799, 'ZAR', 'monthly', '["Everything in Pro","Team accounts (up to 5)","API access","Bulk upload","Dedicated account manager","Custom branding","Invoice management"]'::jsonb, true);
