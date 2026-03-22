-- ═══ Cart system for bulk equipment rentals ═══

create table if not exists cart_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  rental_id uuid not null references smart_rentals(id) on delete cascade,
  quantity integer not null default 1 check (quantity >= 1 and quantity <= 5),
  created_at timestamptz default now(),
  unique(user_id, rental_id)
);

create index if not exists idx_cart_items_user on cart_items(user_id);

alter table cart_items enable row level security;

create policy "Users read own cart" on cart_items for select using (auth.uid() = user_id);
create policy "Users insert own cart" on cart_items for insert with check (auth.uid() = user_id);
create policy "Users update own cart" on cart_items for update using (auth.uid() = user_id);
create policy "Users delete own cart" on cart_items for delete using (auth.uid() = user_id);

-- Link equipment bookings from same cart checkout
alter table equipment_bookings add column if not exists checkout_group_id uuid;
create index if not exists idx_bookings_checkout_group on equipment_bookings(checkout_group_id);
