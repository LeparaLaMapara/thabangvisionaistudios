-- 053 — Somewhere for the platform to record what is wrong with itself
--
-- Every serious defect found this week was silent. Not loud-and-ignored:
-- silent. The mechanism is worth stating precisely, because it was
-- mis-diagnosed at first as "a try/catch swallowed it".
--
-- supabase-js does not throw. It returns { data, error }. So:
--
--     const { data } = await supabase.from('x').update(...)
--
-- discards the error AT THE DESTRUCTURING SITE. The surrounding catch block
-- never runs, because nothing was ever thrown. There are ~24 such sites in
-- app/ and lib/. That single pattern produced: newsletter signups returning
-- success while being discarded, a cron arm querying a table that never
-- existed, dispute refunds no-opping while the dispute was marked resolved,
-- 15 of 23 notification types rejected by a CHECK constraint, and a booking
-- status write that silently failed while an admin was emailed to act on it.
--
-- The lesson is not "add agents". It is that a system which cannot report its
-- own failures cannot be healed by anything, automated or human. This gives
-- findings a durable, queryable, de-duplicated home. Detection comes first;
-- anything that acts on findings comes later and reads from here.

-- ── Did the check itself run, and did it survive? ───────────────────────────
-- Without this we would rebuild the exact bug we are fixing: a checker that
-- crashes looks identical to a system with no problems.
create table if not exists public.ops_check_runs (
  id             uuid primary key default gen_random_uuid(),
  check_id       text        not null,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  duration_ms    integer,
  findings_count integer,
  error          text,                        -- non-null: the CHECK broke, not the system
  run_source     text        not null default 'cron'
);

create index if not exists idx_ops_check_runs_check
  on public.ops_check_runs (check_id, started_at desc);

-- ── What is wrong, de-duplicated ────────────────────────────────────────────
create table if not exists public.ops_findings (
  id                uuid primary key default gen_random_uuid(),
  -- Stable identity for "this same problem, seen again". Must never contain a
  -- timestamp, or this table degenerates back into a log.
  fingerprint       text not null unique,
  check_id          text not null,
  severity          text not null check (severity in ('info', 'warn', 'critical')),
  entity_type       text,
  entity_id         text,
  title             text not null,
  detail            jsonb not null default '{}'::jsonb,
  observed_value    numeric,
  threshold         numeric,
  status            text not null default 'open'
                    check (status in ('open', 'acknowledged', 'resolved', 'muted', 'wont_fix')),
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  seen_count        integer not null default 1,
  last_notified_at  timestamptz,
  muted_until       timestamptz,
  resolved_at       timestamptz,
  resolution_source text check (resolution_source in ('auto', 'agent', 'human'))
);

create index if not exists idx_ops_findings_open
  on public.ops_findings (check_id, last_seen_at desc)
  where status in ('open', 'acknowledged');

create index if not exists idx_ops_findings_entity
  on public.ops_findings (entity_type, entity_id);

-- ── Access ──────────────────────────────────────────────────────────────────
-- Operational internals. Service role only, like newsletter_subscribers: the
-- cron writes with the admin client, and admin screens read through it.
-- Deliberately not readable by anon or authenticated -- finding titles quote
-- booking references and amounts.
alter table public.ops_check_runs enable row level security;
alter table public.ops_findings   enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='ops_check_runs'
                   and policyname='Service role only') then
    create policy "Service role only" on public.ops_check_runs for all using (false);
  end if;
  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='ops_findings'
                   and policyname='Service role only') then
    create policy "Service role only" on public.ops_findings for all using (false);
  end if;
end $$;

comment on table public.ops_findings is
  'Open problems the platform has detected in itself, de-duplicated by fingerprint. Written by /api/cron/invariants. A finding not re-emitted by the latest SUCCESSFUL run of its check is auto-resolved.';
comment on column public.ops_findings.fingerprint is
  'sha-free stable key: check_id:entity_type:entity_id. Never include a timestamp.';
comment on table public.ops_check_runs is
  'One row per check execution. error non-null means the check itself failed, which must never be read as "no problems found".';
