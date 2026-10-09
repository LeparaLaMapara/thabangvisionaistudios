-- 072 — Community listing review (Phase 2, spec §8.1–8.2)
--
-- WHY
--   POST /api/listings published a community listing the moment it was saved.
--   Nothing recorded whether a person had looked at it, which details the AI
--   had guessed, or what the owner had declared about the gear. smart_rentals
--   had no review or moderation columns at all.
--
-- WHAT (additive, idempotent)
--   smart_rentals
--     listing_status   draft | pending_review | published | rejected | suspended
--                      (public on purpose: it drives the public flag)
--   listing_private (NEW, one row per listing, keyed by rental_id)
--     review_notes     what the reviewer told the owner (shown to the owner)
--     reviewed_by      admin user id of the last review decision
--     reviewed_at      when that decision was made
--     submitted_at     when the owner last submitted the listing
--     ai_fields        which fields the AI suggested, and whether the owner has
--                      confirmed each one: {"title": {"status": "suggested",
--                      "suggested_at": "..."}, ...}. Unconfirmed = not trusted.
--     owner_attestations  what the owner declared: ownership or lawful
--                      authority, condition/working, accurate location, the
--                      owner terms version and accepted_at.
--     replacement_value_evidence  optional URL or note backing the value.
--   These live in their own table, not on smart_rentals, because the public
--   SELECT policy on smart_rentals returns every column of a published row.
--   RLS on listing_private: the owner reads their own rows, admins
--   (is_admin()) read all; no client role can write. The server writes with
--   the service role.
--   notifications.type gains listing_approved / listing_rejected /
--   listing_suspended (appended to whatever list is live, not replaced).
--
--   If an earlier draft of this file put the private columns on
--   smart_rentals, section 2b copies them into listing_private and drops them.
--
-- is_published STAYS the public flag (every public query and the RLS policy
-- read it). This file keeps it consistent with listing_status in the
-- database, not only in app code: the BEFORE trigger below
--   * derives is_published from listing_status whenever the status changes,
--     and on every INSERT of a community row (so a stale client that sends
--     is_published=true gets a draft);
--   * refuses an UPDATE that sets is_published=true on a community row whose
--     status is not 'published' (publish goes through review, not the flag);
--   * records a direct unpublish (is_published=false) as status 'draft';
--   * for studio rows, lets the existing admin publish toggle keep working by
--     mapping is_published true/false to 'published'/'draft';
--   * refuses a change to listing_status from anyone but the server
--     (service_role), postgres (SQL editor, SECURITY DEFINER RPCs) or
--     supabase_admin — same "trusted caller" rule as 067;
--   * finally asserts is_published = (listing_status = 'published').
--
-- BACKFILL (public.listing_review_backfill_072(), section 2c; safe to re-run)
--   published studio rows                 -> 'published'
--   published community rows that were never submitted or reviewed under
--   this flow (no listing_private row with submitted_at or reviewed_at)
--                                         -> 'pending_review'  (TAKEN OFFLINE)
--   everything else                       -> 'draft' (the column default)
--   Community gear published before 072 went live with no review, usually no
--   replacement value and so a zero deposit. Leaving it 'published' would
--   let it be hired with no deposit and count towards the owner's
--   "established" threshold (3 live listings), which lets their next listing
--   skip review. Applying 072 therefore takes those listings OFFLINE until
--   the owner adds a replacement value and the declarations and a person
--   approves (or the owner edits and resubmits). FOUNDER DECISION: see
--   docs/marketplace/listings.md, "Applying migration 072".
--
--   AI-drafted community rows (is_ai_generated) with no recorded AI flags
--   get listing_private.ai_fields marking every field the onboarding AI
--   fills in (title, brand, model, category, day rate, and week rate,
--   description and what's included where set) as 'suggested', so the owner
--   must confirm or edit them before submitting.
--
--   The set_updated_at trigger is switched off for the status backfill only,
--   so updated_at (sitemap lastmod) does not jump for every listing.
--
-- NOT DONE HERE
--   serial_number (062) is still returned by the public SELECT on published
--   rows. getRentalBySlug() selects '*', so a column REVOKE would break the
--   public detail page. Switch it to explicit columns first, then revoke.
--
-- Apply on dev, run 072-listing-review.test.sql, then production.

begin;

-- ── 1. Columns ───────────────────────────────────────────────────────────────

alter table public.smart_rentals
  add column if not exists listing_status text not null default 'draft';

alter table public.smart_rentals drop constraint if exists smart_rentals_listing_status_check;
alter table public.smart_rentals add constraint smart_rentals_listing_status_check
  check (listing_status in ('draft', 'pending_review', 'published', 'rejected', 'suspended'));

comment on column public.smart_rentals.listing_status is
  'Review state (072). is_published is derived from it: true only when listing_status = ''published''.';
create table if not exists public.listing_private (
  rental_id uuid primary key references public.smart_rentals(id) on delete cascade,
  review_notes text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  submitted_at timestamptz,
  ai_fields jsonb,
  owner_attestations jsonb,
  replacement_value_evidence text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.listing_private is
  'Review and owner-only data for a smart_rentals listing (072). Not public: owner reads own, admin reads all, server writes.';
comment on column public.listing_private.ai_fields is
  'Fields the AI suggested and whether the owner confirmed them. A listing with unconfirmed AI fields cannot be submitted.';
comment on column public.listing_private.owner_attestations is
  'Owner declarations at submission: owns_or_authorised, condition_working, location_accurate, terms_version, accepted_at. Declared by the owner, not checked by us.';

alter table public.listing_private enable row level security;

revoke all on public.listing_private from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.listing_private from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on public.listing_private from authenticated';
    execute 'grant select on public.listing_private to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on public.listing_private to service_role';
  end if;
end $$;

-- The owner check reads smart_rentals, whose own RLS hides an owner's
-- unpublished rows from them. A SECURITY DEFINER helper answers only "does
-- the caller own this rental?" so the policy works for drafts too.
create or replace function public.caller_owns_rental(p_rental_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.smart_rentals r
     where r.id = p_rental_id
       and r.owner_id = auth.uid()
  );
$$;

revoke all on function public.caller_owns_rental(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.caller_owns_rental(uuid) to authenticated';
  end if;
end $$;

drop policy if exists "Owners read own listing_private" on public.listing_private;
create policy "Owners read own listing_private"
  on public.listing_private for select
  to authenticated
  using (public.caller_owns_rental(rental_id));

drop policy if exists "Admins read listing_private" on public.listing_private;
create policy "Admins read listing_private"
  on public.listing_private for select
  to authenticated
  using (public.is_admin());

-- ── 2. Backfill: see 2c (it needs listing_private, filled by 2b) ───────────

-- ── 2b. Move private columns from an earlier draft of 072, if present ──────

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'smart_rentals' and column_name = 'owner_attestations'
  ) then
    execute $m$
      insert into public.listing_private
        (rental_id, review_notes, reviewed_by, reviewed_at, submitted_at, ai_fields, owner_attestations, replacement_value_evidence)
      select id, review_notes, reviewed_by, reviewed_at, submitted_at, ai_fields, owner_attestations, replacement_value_evidence
        from public.smart_rentals
       where review_notes is not null or reviewed_by is not null or reviewed_at is not null
          or submitted_at is not null or ai_fields is not null or owner_attestations is not null
          or replacement_value_evidence is not null
      on conflict (rental_id) do nothing
    $m$;
    alter table public.smart_rentals
      drop column if exists review_notes,
      drop column if exists reviewed_by,
      drop column if exists reviewed_at,
      drop column if exists submitted_at,
      drop column if exists ai_fields,
      drop column if exists owner_attestations,
      drop column if exists replacement_value_evidence;
  end if;
end $$;

-- ── 2c. Backfill (before the status trigger exists on a first run) ──────────
--
-- A function so 072-listing-review.test.sql can run the same code against
-- fixtures. Idempotent: every step only touches rows not yet in their
-- backfilled state, and a listing that has been submitted or reviewed under
-- this flow is never taken offline by a re-run. Only the migration owner
-- (postgres) can run it.

create or replace function public.listing_review_backfill_072()
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  has_updated_at_trigger boolean;
begin
  select exists (
    select 1 from pg_trigger
     where tgrelid = 'public.smart_rentals'::regclass
       and tgname = 'set_updated_at'
       and not tgisinternal
  ) into has_updated_at_trigger;

  if has_updated_at_trigger then
    execute 'alter table public.smart_rentals disable trigger set_updated_at';
  end if;

  -- (a) Status from the old public flag. Only rows still at the default.
  update public.smart_rentals
     set listing_status = 'published'
   where is_published = true
     and listing_status = 'draft';

  -- (b) Community gear that went live without review: offline until a person
  --     approves it. is_published is set here too because on a first run the
  --     status trigger (section 3) does not exist yet.
  update public.smart_rentals r
     set listing_status = 'pending_review',
         is_published = false
   where coalesce(r.owner_type, 'studio') = 'community'
     and r.listing_status = 'published'
     and not exists (
       select 1 from public.listing_private p
        where p.rental_id = r.id
          and (p.reviewed_at is not null or p.submitted_at is not null)
     );

  if has_updated_at_trigger then
    execute 'alter table public.smart_rentals enable trigger set_updated_at';
  end if;

  -- (c) AI-drafted listings with no recorded AI flags: every field the
  --     onboarding AI fills in is unconfirmed until the owner says otherwise.
  insert into public.listing_private as lp (rental_id, ai_fields)
  select r.id, f.ai_fields
    from public.smart_rentals r
    cross join lateral (
      select jsonb_object_agg(
               field,
               jsonb_build_object('status', 'suggested', 'suggested_at', to_jsonb(coalesce(r.created_at, now())))
             ) as ai_fields
        from unnest(array_remove(array[
               'title', 'brand', 'model', 'category', 'price_per_day',
               case when r.price_per_week is not null then 'price_per_week' end,
               case when nullif(btrim(coalesce(r.description, '')), '') is not null then 'description' end,
               case when coalesce(cardinality(r.rental_includes), 0) > 0 then 'rental_includes' end
             ], null)) as field
    ) f
   where r.is_ai_generated = true
     and coalesce(r.owner_type, 'studio') = 'community'
     and not exists (
       select 1 from public.listing_private p
        where p.rental_id = r.id and p.ai_fields is not null
     )
  on conflict (rental_id) do update
     set ai_fields = excluded.ai_fields,
         updated_at = now()
   where lp.ai_fields is null;
end;
$$;

revoke all on function public.listing_review_backfill_072() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.listing_review_backfill_072() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.listing_review_backfill_072() from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on function public.listing_review_backfill_072() from service_role';
  end if;
end $$;

select public.listing_review_backfill_072();

-- ── 3. Keep is_published and listing_status consistent ──────────────────────

create or replace function public.smart_rentals_listing_status_guard()
returns trigger
language plpgsql
security invoker  -- current_user must be the caller, not the function owner (see 067)
set search_path = public
as $$
declare
  trusted boolean := current_user in ('postgres', 'service_role', 'supabase_admin');
  community boolean := coalesce(new.owner_type, 'studio') = 'community';
begin
  if tg_op = 'INSERT' then
    if not trusted and new.listing_status is distinct from 'draft' then
      raise exception 'listing_status is set by the server only'
        using errcode = '42501';
    end if;

    if community then
      -- A new community listing is never live just because a client said so.
      new.is_published := (new.listing_status = 'published');
    elsif new.listing_status = 'draft' and coalesce(new.is_published, false) then
      -- Studio rows: the admin "publish" flag keeps working.
      new.listing_status := 'published';
    else
      new.is_published := (new.listing_status = 'published');
    end if;
  else
    if not trusted and new.listing_status is distinct from old.listing_status then
      raise exception 'listing_status is set by the server only'
        using errcode = '42501';
    end if;

    if new.listing_status is distinct from old.listing_status then
      new.is_published := (new.listing_status = 'published');
    elsif new.is_published is distinct from old.is_published then
      if community then
        if coalesce(new.is_published, false) then
          raise exception 'a community listing goes live through review (listing_status), not by setting is_published'
            using errcode = '23514';
        end if;
        -- A direct unpublish is recorded as a draft so the two never disagree.
        new.listing_status := 'draft';
      else
        new.listing_status := case when coalesce(new.is_published, false) then 'published' else 'draft' end;
      end if;
    end if;
  end if;

  if coalesce(new.is_published, false) <> (new.listing_status = 'published') then
    raise exception 'is_published (%) does not match listing_status (%)', new.is_published, new.listing_status
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists smart_rentals_listing_status_guard on public.smart_rentals;
create trigger smart_rentals_listing_status_guard
  before insert or update on public.smart_rentals
  for each row execute function public.smart_rentals_listing_status_guard();

-- ── 4. Indexes ──────────────────────────────────────────────────────────────

create index if not exists idx_smart_rentals_review_queue
  on public.smart_rentals (created_at)
  where listing_status = 'pending_review' and deleted_at is null;

create index if not exists idx_smart_rentals_owner_status
  on public.smart_rentals (owner_id, listing_status)
  where deleted_at is null;

-- ── 5. Notification types (append to the live list, never replace it) ───────

do $$
declare
  def text;
  current_types text[];
  wanted text[] := array['listing_approved', 'listing_rejected', 'listing_suspended'];
  merged text[];
begin
  if to_regclass('public.notifications') is null then
    return;
  end if;

  select pg_get_constraintdef(c.oid) into def
    from pg_constraint c
   where c.conrelid = 'public.notifications'::regclass
     and c.conname = 'notifications_type_check';

  if def is null then
    return;  -- no list enforced, nothing to extend
  end if;

  select coalesce(array_agg(m[1]), '{}') into current_types
    from regexp_matches(def, '''([^'']+)''', 'g') as m;

  if current_types @> wanted then
    return;
  end if;

  select array_agg(t order by t) into merged
    from (select distinct unnest(current_types || wanted) as t) s;

  alter table public.notifications drop constraint notifications_type_check;
  execute format(
    'alter table public.notifications add constraint notifications_type_check check (type = any (%L::text[]))',
    merged
  );
end $$;

commit;

-- ── ROLLBACK (manual) ───────────────────────────────────────────────────────
-- Run only after reverting the app code that reads listing_status and
-- listing_private. Listings
-- that were pending_review/rejected/suspended become plain unpublished rows.
--
-- Community listings the backfill took offline (2c b) stay offline after a
-- rollback: is_published is not restored. To put one back exactly as before
-- 072, set is_published = true on it by hand AFTER dropping the trigger
-- below (there is no record of which rows they were other than
-- listing_status = 'pending_review' with no listing_private.submitted_at, so
-- list them before rolling back:
--   select r.id from public.smart_rentals r
--    where r.owner_type = 'community' and r.listing_status = 'pending_review'
--      and not exists (select 1 from public.listing_private p
--                       where p.rental_id = r.id and p.submitted_at is not null);
-- ).
--
-- begin;
-- drop trigger if exists smart_rentals_listing_status_guard on public.smart_rentals;
-- drop function if exists public.smart_rentals_listing_status_guard();
-- drop function if exists public.listing_review_backfill_072();
-- drop index if exists public.idx_smart_rentals_review_queue;
-- drop index if exists public.idx_smart_rentals_owner_status;
-- alter table public.smart_rentals drop constraint if exists smart_rentals_listing_status_check;
-- alter table public.smart_rentals drop column if exists listing_status;
-- drop table if exists public.listing_private;  -- loses review notes, AI flags and owner declarations
-- drop function if exists public.caller_owns_rental(uuid);
-- -- notifications: the three listing_* types can stay in the check list; they
-- -- are harmless. To remove them, re-create notifications_type_check from the
-- -- list in the latest migration that defines it, after deleting any
-- -- listing_* rows.
-- commit;
