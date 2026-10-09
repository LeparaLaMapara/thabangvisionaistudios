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
--   notifications.type gains listing_approved / listing_rejected /
--   listing_suspended (appended to whatever list is live, not replaced).
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
--   * refuses changes to listing_status / review fields from anyone but the
--     server (service_role), postgres (SQL editor, SECURITY DEFINER RPCs) or
--     supabase_admin — same "trusted caller" rule as 067;
--   * finally asserts is_published = (listing_status = 'published').
--
-- BACKFILL
--   published rows (studio or community)  -> 'published'
--   everything else                       -> 'draft' (the column default)
--   The set_updated_at trigger is switched off for the backfill only, so
--   updated_at (sitemap lastmod) does not jump for every published listing.
--
-- NOT DONE HERE (needs app changes first)
--   The public SELECT policy exposes every column of a published row,
--   including serial_number, owner_attestations and review_notes.
--   getRentalBySlug() still selects '*', so a column-level REVOKE would break
--   the public detail page. Fix the query first, then revoke.
--
-- Apply on dev, run 072-listing-review.test.sql, then production.

begin;

-- ── 1. Columns ───────────────────────────────────────────────────────────────

alter table public.smart_rentals
  add column if not exists listing_status text not null default 'draft',
  add column if not exists review_notes text,
  add column if not exists reviewed_by uuid,
  add column if not exists reviewed_at timestamptz,
  add column if not exists submitted_at timestamptz,
  add column if not exists ai_fields jsonb,
  add column if not exists owner_attestations jsonb,
  add column if not exists replacement_value_evidence text;

alter table public.smart_rentals drop constraint if exists smart_rentals_listing_status_check;
alter table public.smart_rentals add constraint smart_rentals_listing_status_check
  check (listing_status in ('draft', 'pending_review', 'published', 'rejected', 'suspended'));

comment on column public.smart_rentals.listing_status is
  'Review state (072). is_published is derived from it: true only when listing_status = ''published''.';
comment on column public.smart_rentals.ai_fields is
  'Fields the AI suggested and whether the owner confirmed them. A listing with unconfirmed AI fields cannot be submitted.';
comment on column public.smart_rentals.owner_attestations is
  'Owner declarations at submission: owns_or_authorised, condition_working, location_accurate, terms_version, accepted_at. Declared by the owner, not checked by us.';

-- ── 2. Backfill (before the trigger exists) ─────────────────────────────────

do $$
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

  -- Only rows still at the default are touched, so a re-run is a no-op.
  update public.smart_rentals
     set listing_status = 'published'
   where is_published = true
     and listing_status = 'draft';

  if has_updated_at_trigger then
    execute 'alter table public.smart_rentals enable trigger set_updated_at';
  end if;
end $$;

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
    if not trusted and (
         new.listing_status is distinct from 'draft'
      or new.reviewed_by is not null
      or new.reviewed_at is not null
      or new.review_notes is not null
      or new.submitted_at is not null
    ) then
      raise exception 'listing review fields are set by the server only'
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
    if not trusted and (
         new.listing_status is distinct from old.listing_status
      or new.reviewed_by is distinct from old.reviewed_by
      or new.reviewed_at is distinct from old.reviewed_at
      or new.review_notes is distinct from old.review_notes
      or new.submitted_at is distinct from old.submitted_at
    ) then
      raise exception 'listing review fields are set by the server only'
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
  on public.smart_rentals (submitted_at)
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
-- Run only after reverting the app code that reads listing_status. Listings
-- that were pending_review/rejected/suspended become plain unpublished rows.
--
-- begin;
-- drop trigger if exists smart_rentals_listing_status_guard on public.smart_rentals;
-- drop function if exists public.smart_rentals_listing_status_guard();
-- drop index if exists public.idx_smart_rentals_review_queue;
-- drop index if exists public.idx_smart_rentals_owner_status;
-- alter table public.smart_rentals drop constraint if exists smart_rentals_listing_status_check;
-- alter table public.smart_rentals
--   drop column if exists listing_status,
--   drop column if exists review_notes,
--   drop column if exists reviewed_by,
--   drop column if exists reviewed_at,
--   drop column if exists submitted_at,
--   drop column if exists ai_fields,
--   drop column if exists owner_attestations,
--   drop column if exists replacement_value_evidence;
-- -- notifications: the three listing_* types can stay in the check list; they
-- -- are harmless. To remove them, re-create notifications_type_check from the
-- -- list in the latest migration that defines it, after deleting any
-- -- listing_* rows.
-- commit;
