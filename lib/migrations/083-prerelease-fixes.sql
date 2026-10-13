-- 083: pre-release fixes found by the 067 to 082 rehearsal on a copy of prod
--
-- See docs/release/2026-10-rehearsal-067-082.md. Four independent parts, each
-- idempotent (if exists / if not exists); safe to re-run, and a no-op on a
-- database that never had the hand-made objects (dev, a local rebuild).
--
--   F1. storage.objects: drop "Admins view all verification docs". It was made
--       by hand on prod (no repo file creates it) as FOR SELECT TO authenticated
--       USING (bucket_id = 'verifications'), with no admin check: any signed-in
--       user can list and download every ID document. The app never needs it;
--       admin pages sign these files with the service role
--       (app/api/admin/verifications/[id]/route.ts). Also drop the two
--       hand-made duplicates "Users view own verification docs" and "Users
--       upload own verification docs" (same rules as 003's "Users can read /
--       upload own verification docs", which stay and which 067 manages).
--       F1 was run on its own on prod as a hotfix on 2026-10-13 (recorded
--       there as hotfix_close_verification_docs_leak); running it again here
--       is harmless.
--   F2. smart_productions: migration 035 never reached prod or dev. Add
--       submitted_at and its two indexes. Since #73 the code no longer reads
--       or writes submitted_at (lib/supabase/queries/smartProductions.ts uses
--       created_at), so F2 is schema catch-up only; it stays because it is
--       harmless. The unique index refuses with a clear message if a creator has two live
--       rows (prod and dev had none on 2026-10-12). That refusal rolls back
--       the whole file, F1 included, which is one more reason F1 also runs on
--       its own first.
--   F3. rls_auto_enable(): a platform function on prod (the ensure_rls event
--       trigger) pinned to search_path = pg_catalog only, which fails check 4
--       of rls-coverage.test.sql. Pin it to pg_catalog, pg_temp. Skipped when
--       the function does not exist (dev, local).
--   F4. public.orders / public.listings: 077 E4 and E10 drop the open insert
--       and update policies under their DEV names. Prod has the same policies
--       under other names, so 077 alone leaves them on prod: buyers could insert
--       orders with any seller, total and status, and users could insert or
--       update listings (self-publishing into the sitemap, search and Ubunye).
--       Drop the prod names. "Orders: buyer update" and "Orders: seller update"
--       stay: app/api/orders/[id]/route.ts still updates orders with the user's
--       session (follow-up: move that route to the service role, then drop them).
--
-- ORDER. Run 083 on prod BEFORE 067, right after the app is deployed (see
-- docs/release/2026-10-apply-order.md). Nothing in it depends on 067 to 082,
-- and nothing in 067 to 082 recreates what it drops. Run first, 067's test
-- passes (F1) and rls-coverage passes after 077, 079 and 080 (F3). Run last,
-- the end state is the same, but those tests fail in between and the F1 hole
-- stays open for the whole release. The file keeps the number 083 so existing
-- files are not renumbered; scripts/db/rebuild-local.sh applies it after 082,
-- where on a fresh build every part is a no-op apart from F2 being already done
-- by 035.
--
-- Apply as postgres (prod's supautils.policy_grants lets postgres manage
-- policies on storage.objects).

-- One transaction: a failure leaves nothing applied.
begin;
set local lock_timeout = '5s';

-- ═══ F1. verification documents ════════════════════════════════════════════
drop policy if exists "Admins view all verification docs" on storage.objects;
drop policy if exists "Users view own verification docs" on storage.objects;
drop policy if exists "Users upload own verification docs" on storage.objects;

-- ═══ F2. migration 035 (smart_productions.submitted_at) ════════════════════
alter table public.smart_productions add column if not exists submitted_at timestamptz;

create index if not exists idx_smart_productions_creator_id
  on public.smart_productions (creator_id)
  where creator_id is not null;

do $$
declare
  v_dups integer;
begin
  if to_regclass('public.idx_smart_productions_one_per_creator') is null then
    select count(*) into v_dups
      from (select creator_id
              from public.smart_productions
             where creator_id is not null and deleted_at is null
             group by creator_id
            having count(*) > 1) d;
    if v_dups > 0 then
      raise exception '083 F2: % creator(s) have more than one live smart_productions row; resolve them before the unique index', v_dups;
    end if;
  end if;
end $$;

create unique index if not exists idx_smart_productions_one_per_creator
  on public.smart_productions (creator_id)
  where creator_id is not null and deleted_at is null;

-- ═══ F3. rls_auto_enable() search_path ═════════════════════════════════════
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    alter function public.rls_auto_enable() set search_path = pg_catalog, pg_temp;
  else
    raise notice '083 F3: public.rls_auto_enable() not present, nothing to do';
  end if;
end $$;

-- ═══ F4. prod names of the policies 077 E4 / E10 drop ══════════════════════
drop policy if exists "Orders: buyer insert" on public.orders;              -- E4
drop policy if exists "Listings: authenticated insert" on public.listings;  -- E10
drop policy if exists "Listings: owner update" on public.listings;          -- E10

notify pgrst, 'reload schema';

commit;

-- ── ROLLBACK (manual) ───────────────────────────────────────────────────────
--   NEVER recreate "Admins view all verification docs": it exposes every ID
--   document to every signed-in user. The two F1 duplicates are not needed
--   either (003's policies cover the same rules).
--   begin;
--   -- F2
--   drop index if exists public.idx_smart_productions_one_per_creator;
--   drop index if exists public.idx_smart_productions_creator_id;
--   alter table public.smart_productions drop column if exists submitted_at;
--   -- F3 (prod only)
--   alter function public.rls_auto_enable() set search_path = pg_catalog;
--   -- F4 (reopens the 077 E4 / E10 holes on prod)
--   create policy "Orders: buyer insert" on public.orders
--     for insert to authenticated with check (buyer_id = auth.uid());
--   create policy "Listings: authenticated insert" on public.listings
--     for insert to authenticated with check (user_id = auth.uid());
--   create policy "Listings: owner update" on public.listings
--     for update to authenticated using (user_id = auth.uid());
--   commit;
