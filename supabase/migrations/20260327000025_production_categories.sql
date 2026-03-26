-- Migration 025: Production Categories
-- Moves categories from constants.ts to database for admin management.

create table if not exists production_categories (
  id                   uuid primary key default gen_random_uuid(),
  slug                 text unique not null,
  name                 text not null,
  description          text,
  sub_types            text[] default '{}',
  cover_image_url      text,
  cover_image_public_id text,
  starting_rate        integer not null default 0,
  starting_unit        text not null default 'session',
  project_type         text not null,
  creator_keywords     text[] default '{}',
  icon                 text,
  display_order        integer not null default 0,
  is_published         boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index if not exists idx_production_categories_slug
  on production_categories (slug);

create index if not exists idx_production_categories_published
  on production_categories (display_order)
  where is_published = true;

alter table production_categories enable row level security;

create policy "production_categories_public_read"
  on production_categories for select
  using (is_published = true);

create or replace trigger set_production_categories_updated_at
  before update on production_categories
  for each row
  execute function update_updated_at();

insert into production_categories (slug, name, description, sub_types, starting_rate, starting_unit, project_type, creator_keywords, display_order)
values
  ('photography', 'Photography', 'Professional photo sessions for portraits, products, fashion, and real estate.', array['Portrait & Headshot', 'Product & Commercial', 'Real Estate & Interior', 'Fashion & Editorial'], 1500, 'session', 'photography', array['Photography', 'Portrait', 'Product Photography', 'Real Estate Photography'], 0),
  ('video-production', 'Video Production', 'Cinematic video from music videos to documentaries and short films.', array['Music Video', 'Documentary', 'Short Film', 'Promo & Ad'], 2850, 'project', 'film', array['Cinematography', 'Music Video', 'Documentary', 'Filmmaking'], 1),
  ('weddings-ceremonies', 'Weddings & Ceremonies', 'Full photo and video coverage for weddings, lobola, matric dances, and more.', array['Wedding (Photo + Video)', 'Lobola & Umembeso', 'Matric Dance', 'Graduation', 'Baby Shower'], 9000, 'package', 'wedding', array['Wedding', 'Photography', 'Cinematography', 'Event'], 2),
  ('event-coverage', 'Event Coverage', 'Capture every moment at corporate events, product launches, and festivals.', array['Corporate Conference', 'Product Launch', 'Concert & Festival', 'Birthday & Private'], 5000, 'event', 'event', array['Event', 'Corporate', 'Photography', 'Cinematography'], 3),
  ('content-creation', 'Content Creation', 'Social media, YouTube, and brand content optimized for engagement.', array['Social Media (IG/TikTok)', 'YouTube', 'Brand Content', 'Influencer Shoot'], 1500, 'session', 'content', array['Content Creation', 'Social Media', 'Photography', 'Short-Form Video'], 4),
  ('corporate-brand', 'Corporate & Brand', 'Team headshots, office culture, product photography, and brand films.', array['Team Headshots', 'Office & Culture', 'Product Photography', 'Annual Report', 'Brand Film'], 2850, 'project', 'corporate', array['Corporate', 'Photography', 'Cinematography', 'Product Photography'], 5)
on conflict (slug) do nothing;

alter table smart_productions
  add column if not exists production_category_id uuid references production_categories(id);

update smart_productions sp
set production_category_id = pc.id
from production_categories pc
where sp.project_type = pc.project_type
  and sp.production_category_id is null;
