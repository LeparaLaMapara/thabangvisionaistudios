-- ============================================================================
-- Thabang Vision AI Studios — Complete Database Schema
-- All tables, indexes, triggers, and RLS policies
-- Safe to run multiple times (IF NOT EXISTS on everything)
-- Run this in the Supabase SQL Editor
-- ============================================================================


-- ============================================================================
-- 0. Utility function (used by multiple triggers)
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;


-- ============================================================================
-- 1. SMART PRODUCTIONS — Portfolio / project showcase
-- ============================================================================

create table if not exists public.smart_productions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  client text,
  year smallint,
  project_type text not null default 'film',
  sub_category text,
  description text,
  video_provider text,
  video_url text,
  tags text[],
  thumbnail_url text,
  cover_public_id text,
  gallery jsonb,
  is_published boolean not null default false,
  is_featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_productions_slug on public.smart_productions(slug);
create index if not exists idx_productions_published on public.smart_productions(is_published) where deleted_at is null;
create index if not exists idx_productions_year on public.smart_productions(year desc nulls last);

drop trigger if exists smart_productions_updated_at on public.smart_productions;
create trigger smart_productions_updated_at
  before update on public.smart_productions
  for each row execute function public.set_updated_at();


-- ============================================================================
-- 2. SMART RENTALS — Equipment rental catalog
-- ============================================================================

create table if not exists public.smart_rentals (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text,
  category text not null,
  sub_category text,
  brand text,
  model text,
  price_per_day numeric(10,2),
  price_per_week numeric(10,2),
  deposit_amount numeric(10,2),
  currency text not null default 'ZAR',
  thumbnail_url text,
  cover_public_id text,
  gallery jsonb,
  is_available boolean not null default true,
  quantity integer not null default 1,
  is_published boolean not null default false,
  is_featured boolean not null default false,
  is_archived boolean not null default false,
  tags text[],
  features text[],
  rental_includes text[],
  metadata jsonb,
  video_provider text,
  video_url text,
  video_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_rentals_slug on public.smart_rentals(slug);
create index if not exists idx_rentals_category on public.smart_rentals(category);
create index if not exists idx_rentals_published on public.smart_rentals(is_published) where deleted_at is null;
create index if not exists idx_rentals_available on public.smart_rentals(is_available) where is_published = true and deleted_at is null;

drop trigger if exists smart_rentals_updated_at on public.smart_rentals;
create trigger smart_rentals_updated_at
  before update on public.smart_rentals
  for each row execute function public.set_updated_at();


-- ============================================================================
-- 3. CAREERS — Job listings
-- ============================================================================

create table if not exists public.careers (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  department text,
  location text,
  description text,
  employment_type text check (employment_type is null or employment_type in ('full-time', 'part-time', 'contract', 'freelance')),
  requirements text[],
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_careers_published on public.careers(is_published) where deleted_at is null;

drop trigger if exists careers_updated_at on public.careers;
create trigger careers_updated_at
  before update on public.careers
  for each row execute function public.set_updated_at();


-- ============================================================================
-- 4. PRESS — News / press articles
-- ============================================================================

create table if not exists public.press (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  content text,
  excerpt text,
  cover_url text,
  cover_public_id text,
  author text,
  category text,
  published_at timestamptz,
  is_published boolean not null default false,
  is_featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_press_slug on public.press(slug);
create index if not exists idx_press_published on public.press(is_published) where deleted_at is null;

drop trigger if exists press_updated_at on public.press;
create trigger press_updated_at
  before update on public.press
  for each row execute function public.set_updated_at();


-- ============================================================================
-- 5. PROFILES — User profiles (linked to auth.users)
-- ============================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  bio text,
  avatar_url text,
  avatar_public_id text,
  skills text[],
  social_links jsonb,
  location text,
  phone text,
  is_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_verified on public.profiles(is_verified) where is_verified = true;
create index if not exists idx_profiles_display_name on public.profiles(display_name);

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create profile on user signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ============================================================================
-- 6. CONTACT MESSAGES — Stored contact form submissions
-- ============================================================================

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  subject text,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_contact_messages_read on public.contact_messages(is_read) where is_read = false;


-- ============================================================================
-- 7. EQUIPMENT BOOKINGS — Rental booking system
-- ============================================================================

create table if not exists public.equipment_bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  rental_id uuid not null references public.smart_rentals(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  total_price numeric(10,2) not null,
  deposit_amount numeric(10,2) not null default 0,
  currency text not null default 'ZAR',
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'active', 'completed', 'cancelled')),
  notes text,
  payfast_payment_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  constraint bookings_date_order check (end_date > start_date)
);

create index if not exists idx_bookings_user_id on public.equipment_bookings(user_id);
create index if not exists idx_bookings_rental_id on public.equipment_bookings(rental_id);
create index if not exists idx_bookings_status on public.equipment_bookings(status);
create index if not exists idx_bookings_dates on public.equipment_bookings(rental_id, start_date, end_date)
  where status in ('pending', 'confirmed', 'active');

drop trigger if exists equipment_bookings_updated_at on public.equipment_bookings;
create trigger equipment_bookings_updated_at
  before update on public.equipment_bookings
  for each row execute function public.set_updated_at();


-- ============================================================================
-- 8. BOOKING PAYMENTS — Payment records for bookings
-- ============================================================================

create table if not exists public.booking_payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.equipment_bookings(id) on delete cascade,
  payfast_payment_id text,
  amount numeric(10,2) not null,
  currency text not null default 'ZAR',
  status text not null default 'pending' check (status in ('pending', 'processing', 'succeeded', 'failed', 'refunded')),
  created_at timestamptz not null default now()
);

create index if not exists idx_booking_payments_booking on public.booking_payments(booking_id);
create index if not exists idx_booking_payments_payfast on public.booking_payments(payfast_payment_id) where payfast_payment_id is not null;


-- ============================================================================
-- 9. INVOICES — Auto-generated invoices for bookings
-- ============================================================================

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.equipment_bookings(id) on delete cascade,
  invoice_number text not null unique,
  amount numeric(10,2) not null,
  currency text not null default 'ZAR',
  status text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'void')),
  pdf_url text,
  created_at timestamptz not null default now()
);

create index if not exists idx_invoices_booking on public.invoices(booking_id);
create index if not exists idx_invoices_number on public.invoices(invoice_number);


-- ============================================================================
-- 10. LISTINGS — Marketplace peer-to-peer listings
-- ============================================================================

create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('gear', 'service')),
  title text not null,
  slug text not null unique,
  description text,
  price numeric(10,2) not null default 0,
  pricing_model text not null default 'fixed' check (pricing_model in ('fixed', 'hourly', 'daily', 'weekly', 'monthly')),
  currency text not null default 'ZAR',
  category text,
  sub_category text,
  thumbnail_url text,
  cover_public_id text,
  gallery jsonb,
  location text,
  condition text check (condition is null or condition in ('new', 'like-new', 'good', 'fair', 'poor')),
  is_published boolean not null default false,
  is_featured boolean not null default false,
  tags text[],
  features text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_listings_user_id on public.listings(user_id);
create index if not exists idx_listings_slug on public.listings(slug);
create index if not exists idx_listings_type on public.listings(type);
create index if not exists idx_listings_category on public.listings(category);
create index if not exists idx_listings_is_published on public.listings(is_published) where deleted_at is null;

drop trigger if exists listings_updated_at on public.listings;
create trigger listings_updated_at
  before update on public.listings
  for each row execute function public.set_updated_at();


-- ============================================================================
-- 11. ORDERS — Marketplace purchase orders
-- ============================================================================

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'paid', 'shipped', 'delivered', 'completed', 'cancelled', 'refunded')),
  total numeric(10,2) not null,
  platform_fee numeric(10,2) not null default 0,
  seller_payout numeric(10,2) not null default 0,
  currency text not null default 'ZAR',
  payfast_payment_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_orders_buyer_id on public.orders(buyer_id);
create index if not exists idx_orders_seller_id on public.orders(seller_id);
create index if not exists idx_orders_listing_id on public.orders(listing_id);
create index if not exists idx_orders_status on public.orders(status);

drop trigger if exists orders_updated_at on public.orders;
create trigger orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();


-- ============================================================================
-- 12. REVIEWS — Post-order reviews
-- ============================================================================

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id) on delete cascade,
  reviewee_id uuid not null references public.profiles(id) on delete cascade,
  rating smallint not null check (rating >= 1 and rating <= 5),
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, reviewer_id)
);

create index if not exists idx_reviews_reviewee_id on public.reviews(reviewee_id);
create index if not exists idx_reviews_order_id on public.reviews(order_id);

drop trigger if exists reviews_updated_at on public.reviews;
create trigger reviews_updated_at
  before update on public.reviews
  for each row execute function public.set_updated_at();


-- ============================================================================
-- 13. SUBSCRIPTION PLANS — Available subscription tiers
-- ============================================================================

create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  price numeric(10,2) not null,
  currency text not null default 'ZAR',
  interval text not null check (interval in ('month', 'year')),
  features jsonb,
  payfast_plan_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);


-- ============================================================================
-- 14. SUBSCRIPTIONS — User subscription records
-- ============================================================================

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_id uuid not null references public.subscription_plans(id) on delete cascade,
  payfast_token text,
  status text not null default 'active' check (status in ('active', 'past_due', 'cancelled', 'expired')),
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_subscriptions_user_id on public.subscriptions(user_id);
create index if not exists idx_subscriptions_status on public.subscriptions(status);

drop trigger if exists subscriptions_updated_at on public.subscriptions;
create trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();


-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- ─── Smart Productions RLS ──────────────────────────────────────────────────

alter table public.smart_productions enable row level security;

drop policy if exists "Productions: public read published" on public.smart_productions;
create policy "Productions: public read published"
  on public.smart_productions for select
  using (is_published = true and deleted_at is null);

-- ─── Smart Rentals RLS ─────────────────────────────────────────────────────

alter table public.smart_rentals enable row level security;

drop policy if exists "Rentals: public read published" on public.smart_rentals;
create policy "Rentals: public read published"
  on public.smart_rentals for select
  using (is_published = true and deleted_at is null);

-- ─── Careers RLS ────────────────────────────────────────────────────────────

alter table public.careers enable row level security;

drop policy if exists "Careers: public read published" on public.careers;
create policy "Careers: public read published"
  on public.careers for select
  using (is_published = true and deleted_at is null);

-- ─── Press RLS ──────────────────────────────────────────────────────────────

alter table public.press enable row level security;

drop policy if exists "Press: public read published" on public.press;
create policy "Press: public read published"
  on public.press for select
  using (is_published = true and deleted_at is null);

-- ─── Profiles RLS ──────────────────────────────────────────────────────────

alter table public.profiles enable row level security;

drop policy if exists "Profiles: public read" on public.profiles;
create policy "Profiles: public read"
  on public.profiles for select
  using (true);

drop policy if exists "Profiles: owner update" on public.profiles;
create policy "Profiles: owner update"
  on public.profiles for update
  to authenticated
  using (id = auth.uid());

drop policy if exists "Profiles: auto insert on signup" on public.profiles;
create policy "Profiles: auto insert on signup"
  on public.profiles for insert
  with check (true);

-- ─── Contact Messages RLS ──────────────────────────────────────────────────

alter table public.contact_messages enable row level security;

drop policy if exists "Contact: anyone can insert" on public.contact_messages;
create policy "Contact: anyone can insert"
  on public.contact_messages for insert
  with check (true);

-- ─── Equipment Bookings RLS ────────────────────────────────────────────────

alter table public.equipment_bookings enable row level security;

drop policy if exists "Bookings: owner read own" on public.equipment_bookings;
create policy "Bookings: owner read own"
  on public.equipment_bookings for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Bookings: authenticated insert" on public.equipment_bookings;
create policy "Bookings: authenticated insert"
  on public.equipment_bookings for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Bookings: owner update" on public.equipment_bookings;
create policy "Bookings: owner update"
  on public.equipment_bookings for update
  to authenticated
  using (user_id = auth.uid());

-- ─── Booking Payments RLS ──────────────────────────────────────────────────

alter table public.booking_payments enable row level security;

drop policy if exists "BookingPayments: owner read via booking" on public.booking_payments;
create policy "BookingPayments: owner read via booking"
  on public.booking_payments for select
  to authenticated
  using (
    booking_id in (
      select id from public.equipment_bookings where user_id = auth.uid()
    )
  );

-- ─── Invoices RLS ──────────────────────────────────────────────────────────

alter table public.invoices enable row level security;

drop policy if exists "Invoices: owner read via booking" on public.invoices;
create policy "Invoices: owner read via booking"
  on public.invoices for select
  to authenticated
  using (
    booking_id in (
      select id from public.equipment_bookings where user_id = auth.uid()
    )
  );

-- ─── Listings RLS ──────────────────────────────────────────────────────────

alter table public.listings enable row level security;

drop policy if exists "Listings: public read published" on public.listings;
create policy "Listings: public read published"
  on public.listings for select
  using (is_published = true and deleted_at is null);

drop policy if exists "Listings: owner read own" on public.listings;
create policy "Listings: owner read own"
  on public.listings for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Listings: authenticated insert" on public.listings;
create policy "Listings: authenticated insert"
  on public.listings for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Listings: owner update" on public.listings;
create policy "Listings: owner update"
  on public.listings for update
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Listings: owner delete" on public.listings;
create policy "Listings: owner delete"
  on public.listings for delete
  to authenticated
  using (user_id = auth.uid());

-- ─── Orders RLS ────────────────────────────────────────────────────────────

alter table public.orders enable row level security;

drop policy if exists "Orders: buyer read own" on public.orders;
create policy "Orders: buyer read own"
  on public.orders for select
  to authenticated
  using (buyer_id = auth.uid());

drop policy if exists "Orders: seller read own" on public.orders;
create policy "Orders: seller read own"
  on public.orders for select
  to authenticated
  using (seller_id = auth.uid());

drop policy if exists "Orders: buyer insert" on public.orders;
create policy "Orders: buyer insert"
  on public.orders for insert
  to authenticated
  with check (buyer_id = auth.uid());

drop policy if exists "Orders: buyer update" on public.orders;
create policy "Orders: buyer update"
  on public.orders for update
  to authenticated
  using (buyer_id = auth.uid());

drop policy if exists "Orders: seller update" on public.orders;
create policy "Orders: seller update"
  on public.orders for update
  to authenticated
  using (seller_id = auth.uid());

-- ─── Reviews RLS ───────────────────────────────────────────────────────────

alter table public.reviews enable row level security;

drop policy if exists "Reviews: public read" on public.reviews;
create policy "Reviews: public read"
  on public.reviews for select
  using (true);

drop policy if exists "Reviews: authenticated insert" on public.reviews;
create policy "Reviews: authenticated insert"
  on public.reviews for insert
  to authenticated
  with check (reviewer_id = auth.uid());

drop policy if exists "Reviews: owner update" on public.reviews;
create policy "Reviews: owner update"
  on public.reviews for update
  to authenticated
  using (reviewer_id = auth.uid());

-- ─── Subscription Plans RLS ────────────────────────────────────────────────

alter table public.subscription_plans enable row level security;

drop policy if exists "Plans: public read active" on public.subscription_plans;
create policy "Plans: public read active"
  on public.subscription_plans for select
  using (is_active = true);

-- ─── Subscriptions RLS ─────────────────────────────────────────────────────

alter table public.subscriptions enable row level security;

drop policy if exists "Subscriptions: owner read" on public.subscriptions;
create policy "Subscriptions: owner read"
  on public.subscriptions for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Subscriptions: authenticated insert" on public.subscriptions;
create policy "Subscriptions: authenticated insert"
  on public.subscriptions for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Subscriptions: owner update" on public.subscriptions;
create policy "Subscriptions: owner update"
  on public.subscriptions for update
  to authenticated
  using (user_id = auth.uid());
