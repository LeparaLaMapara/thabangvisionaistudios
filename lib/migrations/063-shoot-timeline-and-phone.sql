-- 063: photographer booking timeline and phone checks (TASK-069).
--
-- bookings.arrived_at        the creator tapped "I'm here" on the shoot day.
-- profiles.phone_verified_at when the number in profiles.phone was confirmed
--                            with a one-time code.
-- phone_codes                one pending code per person, stored hashed, with
--                            an expiry and an attempt count. Server only.
-- Additive. Apply on dev, then production.

alter table public.bookings add column if not exists arrived_at timestamptz;
alter table public.profiles add column if not exists phone_verified_at timestamptz;

create table if not exists public.phone_codes (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  phone       text not null,
  code_hash   text not null,
  expires_at  timestamptz not null,
  attempts    int not null default 0,
  sent_count  int not null default 1,
  created_at  timestamptz not null default now()
);
alter table public.phone_codes enable row level security;

-- 063b: only the server may mark a phone verified, and a new number is
-- unverified until its code is entered. Users can update their own profile
-- ("Profiles: owner update safe"), so this is enforced in the database.
create or replace function public.guard_phone_verified()
returns trigger
language plpgsql
as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon') then
    if new.phone_verified_at is distinct from old.phone_verified_at then
      new.phone_verified_at := old.phone_verified_at;
    end if;
    if new.phone is distinct from old.phone then
      new.phone_verified_at := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_phone_verified on public.profiles;
create trigger profiles_guard_phone_verified
  before update on public.profiles
  for each row execute function public.guard_phone_verified();
