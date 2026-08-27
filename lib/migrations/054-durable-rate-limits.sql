-- 054 — Rate limiting that survives a cold start
--
-- lib/auth/index.ts kept counters in a module-level Map. On Vercel every
-- lambda instance has its own module scope and the scope dies with the
-- instance, so "5 requests per minute" was really "5 per minute PER WARM
-- INSTANCE, until it is recycled". Under any concurrency the real ceiling was
-- unbounded, and it reset constantly.
--
-- That applied to the sensitive tier too: payouts, suspensions, role changes
-- and dispute resolution. Every one of those protections read stronger than it
-- behaved.
--
-- Fixed windows rather than a sliding log: one row per (key, window), a single
-- atomic upsert per request, no scan. A fixed window permits at most 2x the
-- limit across a boundary, which is the accepted trade and is still infinitely
-- better than no shared state at all.

create table if not exists public.rate_limits (
  key          text        not null,
  window_start timestamptz not null,
  count        integer     not null default 0,
  primary key (key, window_start)
);

-- Sweeping old windows is cheap and keeps the table small.
create index if not exists idx_rate_limits_window
  on public.rate_limits (window_start);

alter table public.rate_limits enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='rate_limits'
                   and policyname='Service role only') then
    create policy "Service role only" on public.rate_limits for all using (false);
  end if;
end $$;

/**
 * Records one hit and reports whether it is allowed.
 *
 * The INSERT ... ON CONFLICT DO UPDATE is a single atomic statement, so
 * concurrent lambdas cannot both read a stale count and both decide they are
 * under the limit. That atomicity is the entire point of moving this out of
 * process memory.
 */
create or replace function public.rate_limit_hit(
  p_key            text,
  p_limit          integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window timestamptz;
  v_count  integer;
begin
  if p_limit <= 0 or p_window_seconds <= 0 then
    raise exception 'rate_limit_hit: limit and window must be positive';
  end if;

  -- Floor now() to the start of its fixed window.
  v_window := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limits as rl (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start)
    do update set count = rl.count + 1
  returning rl.count into v_count;

  return v_count <= p_limit;
end;
$$;

-- Callable only by the service role. Every caller reaches it through the admin
-- client from a server route; nothing in the browser may spend or reset a
-- counter.
revoke execute on function public.rate_limit_hit(text, integer, integer)
  from public, anon, authenticated;

/** Housekeeping. Called from the maintenance cron. */
create or replace function public.rate_limits_prune(p_older_than_hours integer default 24)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from public.rate_limits
   where window_start < now() - make_interval(hours => p_older_than_hours);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.rate_limits_prune(integer)
  from public, anon, authenticated;

comment on table public.rate_limits is
  'Shared rate-limit counters. Replaces a module-level Map that was per-lambda-instance and therefore not a limit at all on serverless.';
