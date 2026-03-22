-- ═══ New bookings table for service bookings ═══

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  reference text unique not null,

  -- Client
  client_id uuid references auth.users(id) not null,
  client_email text not null,

  -- Creator (assigned by admin or from direct booking)
  creator_id uuid references profiles(id),

  -- What
  booking_type text not null check (booking_type in ('production', 'rental', 'crew')),
  project_category text not null,
  project_description text not null,
  deliverables text not null,
  duration_hours integer not null,
  location text,
  preferred_dates text,

  -- Money (stored in ZAR cents as integers)
  subtotal integer not null,
  vat integer not null,
  total integer not null,
  platform_commission integer not null default 15,
  platform_amount integer not null,
  creator_amount integer not null,
  paystack_fee_estimate integer,

  -- Payment
  payment_status text default 'unpaid' check (payment_status in ('unpaid', 'paid', 'refunded')),
  paystack_reference text,
  paystack_access_code text,
  paid_at timestamptz,

  -- Creator payout
  payout_status text default 'pending' check (payout_status in ('pending', 'processing', 'paid', 'failed')),
  payout_reference text,
  paid_out_at timestamptz,

  -- Status
  status text default 'pending' check (status in (
    'pending', 'paid', 'accepted', 'completed', 'paid_out', 'cancelled', 'disputed'
  )),

  -- Rating
  client_rating integer check (client_rating >= 1 and client_rating <= 5),
  client_review text,

  -- Admin
  admin_notes text,

  -- Timestamps
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  accepted_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text
);

alter table bookings enable row level security;

create policy "Clients view own bookings" on bookings
  for select using (auth.uid() = client_id);

create policy "Creators view assigned bookings" on bookings
  for select using (auth.uid() = creator_id);

create policy "Authenticated users create bookings" on bookings
  for insert with check (auth.uid() = client_id);

-- Indexes for common queries
create index if not exists idx_bookings_status on bookings (status);
create index if not exists idx_bookings_client on bookings (client_id);
create index if not exists idx_bookings_creator on bookings (creator_id);
create index if not exists idx_bookings_reference on bookings (reference);

-- Track creator no-shows
alter table profiles add column if not exists no_show_count integer default 0;
