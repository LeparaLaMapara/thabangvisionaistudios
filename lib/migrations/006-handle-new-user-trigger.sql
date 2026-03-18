-- Migration 006: Create handle_new_user trigger
-- Automatically creates a profile row when a new user signs up via Supabase Auth.
-- This ensures registration works regardless of RLS policies on the profiles table.

create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

-- Drop existing trigger if any to avoid duplicates
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
