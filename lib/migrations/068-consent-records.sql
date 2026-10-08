-- 068: consent records (versioned, append-only acceptance history).
--
-- What this adds
--   public.consent_records  one row per acceptance (or withdrawal) of one
--                           versioned legal document, per purpose:
--                           terms, privacy, biometric (identity check),
--                           rental_agreement, owner_terms.
--   Read by lib/consent (hasCurrentConsent / checkConsents) and written by
--   POST /api/consent and, at checkout, by the checkout route.
--
-- Why not extend migration 027?
--   027 added four mutable COLUMNS to public.profiles (popia_consent_at,
--   popia_consent_version, popia_consent_ip, marketing_opt_in). A column holds
--   only the latest acceptance and is overwritten on the next one, so it can
--   neither keep history nor hold several purposes at different versions,
--   and it lives on a row the user can update. It does not fit an
--   append-only, per-purpose record. 027 is LEFT AS IT IS: the verification
--   upload still checks profiles.popia_consent_at (app/api/verifications),
--   and the identity-check consent screen keeps writing it. New consents are
--   recorded here in addition. An optional, commented-out backfill of the
--   027 history is at the end of this file.
--
-- Rules (enforced below)
--   * A signed-in user may INSERT rows only for their own user_id.
--   * A signed-in user may SELECT only their own rows.
--   * No client UPDATE or DELETE, ever. Withdrawal is a NEW row with
--     withdrawn_at set; the latest row per (user, purpose) is the current
--     state. History is never rewritten.
--   * anon has no access at all.
--   * For client roles the database stamps accepted_at (and withdrawn_at, if
--     given) with the current time, so a client cannot back- or forward-date a record.
--     The service role may set them (for a documented backfill).
--   * Rows disappear only when the auth user is deleted (ON DELETE CASCADE).
--     Whether consent evidence must outlive account deletion is an open
--     legal-review item (docs/implementation/legal-review-checklist.md).
--
-- Lawful basis and retention (documented, pending legal review)
--   * terms / rental_agreement / owner_terms: record of contract acceptance
--     (performance of a contract; evidence for disputes).
--   * privacy: acknowledgement of the privacy notice.
--   * biometric: explicit consent for processing the ID image and selfie,
--     including an automated face comparison (POPIA s26/27 special personal
--     information); withdrawable.
--   * Retention: for the life of the account (cascade on deletion). The
--     privacy notice states "account life plus 5 years" for consent records;
--     reconciling that with the cascade is REQUIRES_LEGAL_REVIEW.
--
-- Idempotent: safe to run twice. Apply on DEV first and run
-- 068-consent-records.test.sql. Not applied to production by this change.
--
-- ROLLBACK (destroys the consent history; take a copy first):
--   -- create table public.consent_records_backup as table public.consent_records;
--   drop trigger if exists consent_records_stamp on public.consent_records;
--   drop function if exists public.consent_records_stamp();
--   drop table if exists public.consent_records;

begin;

create table if not exists public.consent_records (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references auth.users (id) on delete cascade,
  consent_purpose  text        not null,
  document_version text        not null,
  accepted_at      timestamptz not null default now(),
  withdrawn_at     timestamptz,
  source           text        not null,
  ip_hash          text,
  user_agent       text
);

-- Constraints are (re)created by name so a re-run converges.
alter table public.consent_records drop constraint if exists consent_records_purpose_check;
alter table public.consent_records add constraint consent_records_purpose_check
  check (consent_purpose in ('terms', 'privacy', 'biometric', 'rental_agreement', 'owner_terms'));

alter table public.consent_records drop constraint if exists consent_records_source_check;
alter table public.consent_records add constraint consent_records_source_check
  check (source in ('signup', 'oauth_onboarding', 'checkout', 'verification', 'listing'));

-- Which purposes may be recorded from which place: the same table as
-- PURPOSES_BY_SOURCE in lib/consent/documents.ts. Without it a signed-in
-- client inserting directly could record, say, a biometric consent "from
-- signup", and hasCurrentConsent (which does not look at the source) would
-- accept it. Keep the two lists in step.
alter table public.consent_records drop constraint if exists consent_records_purpose_source_check;
alter table public.consent_records add constraint consent_records_purpose_source_check
  check (
    (source = 'signup'           and consent_purpose in ('terms', 'privacy'))
    or (source = 'oauth_onboarding' and consent_purpose in ('terms', 'privacy'))
    or (source = 'checkout'         and consent_purpose in ('terms', 'privacy', 'rental_agreement'))
    or (source = 'verification'     and consent_purpose in ('biometric', 'privacy'))
    or (source = 'listing'          and consent_purpose in ('owner_terms', 'terms', 'privacy'))
  );

-- Versions are dates: "2026-10-08" (STUDIO.legal.documents) or the older
-- "2026.04.20" style (STUDIO.legal.popia.version).
alter table public.consent_records drop constraint if exists consent_records_version_check;
alter table public.consent_records add constraint consent_records_version_check
  check (document_version ~ '^[0-9]{4}[-.][0-9]{2}[-.][0-9]{2}$');

alter table public.consent_records drop constraint if exists consent_records_withdrawn_check;
alter table public.consent_records add constraint consent_records_withdrawn_check
  check (withdrawn_at is null or withdrawn_at >= accepted_at);

alter table public.consent_records drop constraint if exists consent_records_lengths_check;
alter table public.consent_records add constraint consent_records_lengths_check
  check (
    (ip_hash is null or char_length(ip_hash) <= 128)
    and (user_agent is null or char_length(user_agent) <= 512)
  );

create index if not exists consent_records_user_purpose_idx
  on public.consent_records (user_id, consent_purpose, accepted_at desc);

comment on table public.consent_records is
  'Append-only history of acceptances/withdrawals of versioned legal documents (068). Latest row per (user_id, consent_purpose) is the current state.';
comment on column public.consent_records.document_version is
  'Version string of the document accepted, from STUDIO.legal.documents.*.version.';
comment on column public.consent_records.withdrawn_at is
  'Set on a withdrawal row. Withdrawal never edits an earlier row.';
comment on column public.consent_records.ip_hash is
  'One-way (optionally keyed) hash of the request IP. The IP itself is not stored.';

-- ─── Server-side timestamps for client roles ────────────────────────────────
-- SECURITY INVOKER on purpose: current_user is the caller's role.
create or replace function public.consent_records_stamp()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    -- clock_timestamp(), not now(): two rows written in one transaction
    -- (an acceptance then a withdrawal) must still order correctly.
    new.accepted_at := clock_timestamp();
    if new.withdrawn_at is not null then
      new.withdrawn_at := new.accepted_at;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists consent_records_stamp on public.consent_records;
create trigger consent_records_stamp
  before insert on public.consent_records
  for each row execute function public.consent_records_stamp();

-- ─── Privileges ─────────────────────────────────────────────────────────────
alter table public.consent_records enable row level security;

revoke all on public.consent_records from anon;
revoke all on public.consent_records from authenticated;
revoke update, delete, truncate on public.consent_records from anon, authenticated;
grant select, insert on public.consent_records to authenticated;
grant all on public.consent_records to service_role;

-- ─── Row level security ─────────────────────────────────────────────────────
drop policy if exists "consent_records_insert_own" on public.consent_records;
create policy "consent_records_insert_own"
  on public.consent_records
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "consent_records_select_own" on public.consent_records;
create policy "consent_records_select_own"
  on public.consent_records
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Deliberately NO update or delete policy, and no policy for anon.
-- service_role bypasses RLS (Supabase default) for admin reads.

commit;

-- ─── OPTIONAL backfill from migration 027 (NOT run by default) ──────────────
-- Copies the existing POPIA verification consents into the history as
-- 'biometric' rows at their old version, so the record of what was accepted
-- before 068 is not lost. They will NOT count as current (the version
-- differs), so those users are asked to accept the new notice. Run as the
-- service role only after founder approval; idempotent.
--
-- insert into public.consent_records (user_id, consent_purpose, document_version, accepted_at, source)
-- select p.id, 'biometric', p.popia_consent_version, p.popia_consent_at, 'verification'
-- from public.profiles p
-- where p.popia_consent_at is not null
--   and p.popia_consent_version ~ '^[0-9]{4}[-.][0-9]{2}[-.][0-9]{2}$'
--   and not exists (
--     select 1 from public.consent_records c
--     where c.user_id = p.id
--       and c.consent_purpose = 'biometric'
--       and c.document_version = p.popia_consent_version
--       and c.accepted_at = p.popia_consent_at
--   );
