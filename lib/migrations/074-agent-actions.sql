-- 074 — Ubunye prepared actions (Phase 2, spec §8.6–8.9)
--
-- WHY
--   * Ubunye's booking tool created a booking and a payment link with no
--     approval enforced in code: the "quote, then confirm" script lived only in
--     the prompt, and the model could quote and book in one turn.
--   (The guest message limit, which was counted from a number the browser
--   sends, now uses the shared server-side rate_limit_hit counter instead.)
--
-- WHAT
--   1. agent_actions: a proposal the model PREPARED (server-calculated amount,
--      what the approval screen shows, expiry, the hash of the current approval
--      nonce). Only the signed-in person's approval request commits it, once.
--      It also carries the pending proposal across turns, so a bare "yes"
--      refers to it (spec §8.9).
--
-- SAFETY
--   Additive, re-runnable, rollback at the end. Clients can read their own
--   proposals; every write goes through the server (service role).

begin;

create table if not exists public.agent_actions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid,
  kind text not null check (kind in ('gear_booking', 'service_booking')),
  state text not null default 'prepared'
    check (state in ('prepared', 'committing', 'committed', 'failed', 'cancelled', 'superseded')),
  amount_cents integer not null check (amount_cents >= 0),
  quote_version integer not null default 1,
  payload jsonb not null,
  summary jsonb not null,
  nonce_hash text not null,
  expires_at timestamptz not null,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  committed_at timestamptz
);

create index if not exists idx_agent_actions_pending
  on public.agent_actions (user_id, conversation_id, created_at desc) where state = 'prepared';

alter table public.agent_actions enable row level security;
drop policy if exists "Own agent actions" on public.agent_actions;
create policy "Own agent actions" on public.agent_actions for select to authenticated using (user_id = auth.uid());
revoke all on public.agent_actions from public, anon, authenticated;
grant select on public.agent_actions to authenticated;
grant all on public.agent_actions to service_role;

-- A new proposal of the same kind in the same conversation replaces the old
-- one, so an earlier quote can never be approved by mistake.
create or replace function public.agent_actions_supersede() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.agent_actions
     set state = 'superseded', updated_at = now()
   where user_id = new.user_id
     and conversation_id is not distinct from new.conversation_id
     and kind = new.kind
     and state = 'prepared'
     and id <> new.id;
  return new;
end;
$$;
drop trigger if exists agent_actions_supersede on public.agent_actions;
create trigger agent_actions_supersede before insert on public.agent_actions
  for each row execute function public.agent_actions_supersede();


commit;

-- ── ROLLBACK (manual) ────────────────────────────────────────────────────────
--   begin;
--   drop function if exists public.agent_actions_supersede() cascade;
--   drop table if exists public.agent_actions;
--   commit;
