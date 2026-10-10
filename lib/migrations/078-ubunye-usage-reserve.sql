-- 078: Ubunye daily message slots, reserved atomically
--
-- Before: the runtime read ubunye_usage.message_count, compared it with the
-- limit, and later wrote count + 1 (read-then-write). Parallel prompts sent at
-- limit - 1 were all answered, increments could be lost, and two first
-- messages of a new day raced on UNIQUE (user_id, date).
--
-- Now: one atomic statement reserves a slot before the model is called, and
-- the slot is given back if no reply ever starts (Phase 5, D-68: a failed
-- reply does not use up a message).
--
-- Both functions are SECURITY DEFINER with a pinned search_path and are
-- executable by service_role only: the app calls them with the service-role
-- client after it has checked who the user is. Idempotent; safe to re-run.

/**
 * Reserves one of today's messages for p_user, if fewer than p_limit are used.
 * Returns the new count, or NULL when the limit is reached (nothing changed).
 *
 * INSERT ... ON CONFLICT DO UPDATE ... WHERE is a single statement: the row
 * is locked and the WHERE is re-checked against the latest committed count,
 * so concurrent callers can never take more than p_limit slots, and the first
 * messages of a new day cannot both insert.
 */
create or replace function public.ubunye_reserve_message(p_user uuid, p_date date, p_limit integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if p_user is null or p_date is null then
    raise exception 'ubunye_reserve_message: user and date are required';
  end if;
  -- A limit of 0 (or less) means no messages for this caller.
  if p_limit is null or p_limit <= 0 then
    return null;
  end if;

  insert into public.ubunye_usage as u (user_id, date, message_count)
  values (p_user, p_date, 1)
  on conflict (user_id, date)
    do update set message_count = u.message_count + 1
    where u.message_count < p_limit
  returning u.message_count into v_count;

  return v_count; -- NULL when the WHERE refused the update
end;
$$;

/**
 * Gives back a slot reserved by ubunye_reserve_message (the reply never
 * started). Atomic, and never takes the count below 0.
 */
create or replace function public.ubunye_release_message(p_user uuid, p_date date)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.ubunye_usage
     set message_count = message_count - 1
   where user_id = p_user
     and date = p_date
     and message_count > 0;
$$;

revoke all on function public.ubunye_reserve_message(uuid, date, integer) from public, anon, authenticated;
revoke all on function public.ubunye_release_message(uuid, date) from public, anon, authenticated;
grant execute on function public.ubunye_reserve_message(uuid, date, integer) to service_role;
grant execute on function public.ubunye_release_message(uuid, date) to service_role;

notify pgrst, 'reload schema';
