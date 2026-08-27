-- 048 — Bring the development database in line with production
--
-- DEVELOPMENT ONLY. Production is the reference: it is live, and every
-- difference below is dev lagging behind, except profiles.email which is a
-- column dev grew and production never had.
--
-- Found by hashing each table's column list on both projects and comparing.
-- Thirty-three of the thirty-six ThabangVision tables matched exactly. These
-- three did not.
--
-- Why it mattered: dev is what the preview deployment and the e2e suite run
-- against, so anything tested there was not testing what production runs. The
-- gear return pipeline in particular could not work on dev at all.


-- ── 1. equipment_bookings: the whole gear-return pipeline was missing ───────
-- Eleven columns, added to production by 20260411000002_gear_return.sql and
-- never applied here. Without them the return, inspection and deposit-release
-- flow has no storage.
alter table public.equipment_bookings
  add column if not exists condition_at_checkout text,
  add column if not exists condition_at_return   text,
  add column if not exists checkout_photos       jsonb,
  add column if not exists return_photos         jsonb,
  add column if not exists return_notes          text,
  add column if not exists returned_at           timestamptz,
  add column if not exists deposit_released      numeric,
  add column if not exists deposit_released_at   timestamptz,
  add column if not exists late_fee              numeric,
  add column if not exists return_reviewed_by    uuid,
  add column if not exists return_reviewed_at    timestamptz;

-- The status vocabulary was also stuck on the pre-return list. Anything moving
-- a booking to return_pending, return_reviewed or disputed would be rejected by
-- the constraint.
alter table public.equipment_bookings
  drop constraint if exists equipment_bookings_status_check;

alter table public.equipment_bookings
  add constraint equipment_bookings_status_check
  check (status = any (array[
    'pending', 'confirmed', 'active',
    'return_pending', 'return_reviewed', 'completed',
    'cancelled', 'overdue', 'disputed'
  ]));


-- ── 2. smart_productions.year: integer here, smallint in production ─────────
-- A silent type drift. Harmless in practice for a four-digit year, but it means
-- the two databases are not the same shape, and "not quite the same" is how
-- surprises get to production.
alter table public.smart_productions
  alter column year type smallint using year::smallint;


-- ── 3. profiles.email: a dev-only column ───────────────────────────────────
-- Dev grew an `email` column that production never had. Nothing in the codebase
-- reads it, and the authoritative email already lives on auth.users.
--
-- Aligning towards production rather than the other way round is deliberate:
-- copying an email into profiles duplicates personal information that then has
-- to be kept in sync, and adds another place it must be disclosed and deleted
-- under POPIA. Production is right; dev is wrong.
alter table public.profiles drop column if exists email;
