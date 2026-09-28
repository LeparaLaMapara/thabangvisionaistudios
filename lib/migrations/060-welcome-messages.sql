-- 060: welcome new people (TASK-065).
--
-- welcome_messages holds one welcome per person: the primary key is the user,
-- so nobody can be welcomed twice. Ubunye drafts it, the owner sends, edits or
-- discards it at /admin/welcomes. Only the server (service role) writes it;
-- admins can read it.
--
-- notify_signup: when an account is created, the database calls the site's
-- /api/webhooks/signup so the owner hears within a minute. The address and a
-- shared secret live in Vault (names below); if either is missing, or the call
-- fails, the signup goes ahead untouched. A daily sweep in
-- /api/cron/daily-maintenance catches anything this misses.
--
-- After applying, set the two Vault secrets:
--   select vault.create_secret('https://www.thabangvision.com/api/webhooks/signup', 'signup_webhook_url');
--   select vault.create_secret('<same value as SIGNUP_WEBHOOK_SECRET on Vercel>', 'signup_webhook_secret');

create extension if not exists pg_net;

create table if not exists public.welcome_messages (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  email          text,
  first_name     text,
  signup_method  text,
  activity       jsonb not null default '{}'::jsonb,
  subject        text not null,
  body           text not null,
  drafted_by     text not null,
  status         text not null default 'draft'
                 check (status in ('draft', 'sending', 'sent', 'discarded')),
  sent_by        uuid,
  sent_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.welcome_messages enable row level security;

drop policy if exists "Admins read welcome messages" on public.welcome_messages;
create policy "Admins read welcome messages" on public.welcome_messages
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create or replace function public.notify_signup()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  hook_url    text;
  hook_secret text;
begin
  select decrypted_secret into hook_url from vault.decrypted_secrets where name = 'signup_webhook_url';
  select decrypted_secret into hook_secret from vault.decrypted_secrets where name = 'signup_webhook_secret';
  if hook_url is null or hook_secret is null then
    return new;
  end if;

  perform net.http_post(
    url     := hook_url,
    body    := jsonb_build_object('user_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-signup-secret', hook_secret)
  );
  return new;
exception when others then
  -- Never let a notification stop someone signing up.
  raise warning 'notify_signup failed: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.notify_signup() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_notify on auth.users;
create trigger on_auth_user_created_notify
  after insert on auth.users
  for each row execute function public.notify_signup();

-- 060b: set or rotate the two Vault secrets from the server (service role only).
create or replace function public.set_signup_webhook(hook_url text, hook_secret text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  existing uuid;
begin
  select id into existing from vault.secrets where name = 'signup_webhook_url';
  if existing is null then perform vault.create_secret(hook_url, 'signup_webhook_url');
  else perform vault.update_secret(existing, hook_url); end if;

  select id into existing from vault.secrets where name = 'signup_webhook_secret';
  if existing is null then perform vault.create_secret(hook_secret, 'signup_webhook_secret');
  else perform vault.update_secret(existing, hook_secret); end if;
end;
$$;

revoke all on function public.set_signup_webhook(text, text) from public, anon, authenticated;
grant execute on function public.set_signup_webhook(text, text) to service_role;
