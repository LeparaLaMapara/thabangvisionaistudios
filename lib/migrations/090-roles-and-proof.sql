-- 090: many roles, honest proof (TASK-085, docs/processes/roles-and-proof.md).
--
-- Roles are data, not code. A role says what the law asks for (and nothing
-- more), what the guided "profile maker" walks a person through, the
-- published standard a reviewer checks against, and the price unit.
--
--   1. roles            the catalogue (4 live, 7 coming soon, seeded below)
--   2. person_roles     one row per person per role: draft, submitted,
--                       approved or changes_requested, plus the evidence level
--   3. role_evidence    the proof: photos and videos captured in the app,
--                       uploads, legal documents (private), vouches, jobs
--   4. role_interest    "coming soon, leave your number" (server writes only)
--   5. a private storage bucket `role-documents` for legal documents
--   6. feature flag `roles_v1` (OFF): shows "Join" in the main navigation
--
-- Who may do what:
--   - anyone reads the roles, approved person_roles and the public evidence of
--     approved profiles (never legal documents, never drafts);
--   - a signed-in person reads and writes only their own drafts and evidence;
--     they can never set their own status to approved, their level, the
--     reviewer's note or the legal check (column grants + trigger);
--   - admins (is_admin()) read everything; the review API writes with the
--     service role after requireAdmin().
--
-- Safe to run more than once. Apply by hand: DEV first. The flag is inserted
-- OFF; switch it on per environment from /admin/flags.
--
-- ROLLBACK: scripts/db/rollback/090-roles-and-proof.sql

begin;

-- ── 1. The role catalogue ───────────────────────────────────────────────────

create table if not exists public.roles (
  slug text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name text not null check (length(name) between 2 and 60),
  role_group text not null check (role_group in ('on_camera', 'hair_makeup', 'crew', 'camera', 'post', 'transport', 'places')),
  description text not null check (length(description) between 5 and 200),
  status text not null default 'coming_soon' check (status in ('live', 'coming_soon')),
  -- Null: no age rule beyond the site's terms. Model is 18.
  min_age integer check (min_age is null or min_age between 13 and 99),
  -- [{code, label, required, basis: 'law'|'platform', when?, ask?, help?}]
  legal_requirements jsonb not null default '[]'::jsonb check (jsonb_typeof(legal_requirements) = 'array'),
  -- [{key, title, help, kind: 'photo'|'video'|'pair'|'text', min, capture?, tips?}]
  proof_task jsonb not null default '[]'::jsonb check (jsonb_typeof(proof_task) = 'array'),
  -- The published review standard, plain words.
  guidelines text not null default '',
  pricing_unit text not null check (pricing_unit in ('hour', 'half_day', 'day', 'look', 'day_plus_km', 'project')),
  -- {typical, low, high, per_km?} in cents. Prices live here, not in code.
  suggested_price_cents jsonb not null default '{}'::jsonb check (jsonb_typeof(suggested_price_cents) = 'object'),
  -- Roles that already have an onboarding flow (photographer/videographer: /onboarding).
  existing_flow_href text check (existing_flow_href is null or existing_flow_href ~ '^/[a-z0-9/_-]*$'),
  sort integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.roles enable row level security;
revoke all on public.roles from public, anon, authenticated;
grant select on public.roles to anon, authenticated;
grant all on public.roles to service_role;

drop policy if exists "Roles: anyone reads the catalogue" on public.roles;
create policy "Roles: anyone reads the catalogue" on public.roles
  for select to anon, authenticated using (status in ('live', 'coming_soon'));

-- ── 2. A person in a role ───────────────────────────────────────────────────

create table if not exists public.person_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role_slug text not null references public.roles(slug) on update cascade,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'changes_requested')),
  evidence_level text not null default 'new' check (evidence_level in ('new', 'shown', 'vouched', 'proven', 'trusted')),
  headline text check (headline is null or length(headline) <= 80),
  about text check (about is null or length(about) <= 600),
  area text check (area is null or length(area) <= 80),
  price_cents integer check (price_cents is null or price_cents between 0 and 100000000),
  per_km_cents integer check (per_km_cents is null or per_km_cents between 0 and 100000),
  -- Answers the maker asks (carries_passengers, date_of_birth, seats, ...).
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  reviewer_note text check (reviewer_note is null or length(reviewer_note) <= 1000),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  -- Set by a reviewer when the role's legal documents were checked.
  legal_verified_at timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, role_slug)
);
create index if not exists idx_person_roles_status on public.person_roles (status, submitted_at);
create index if not exists idx_person_roles_role on public.person_roles (role_slug) where status = 'approved';

alter table public.person_roles enable row level security;
revoke all on public.person_roles from public, anon, authenticated;
grant select on public.person_roles to anon, authenticated;
grant insert (user_id, role_slug, headline, about, area, price_cents, per_km_cents, answers) on public.person_roles to authenticated;
grant update (headline, about, area, price_cents, per_km_cents, answers, status) on public.person_roles to authenticated;
grant delete on public.person_roles to authenticated;
grant all on public.person_roles to service_role;

drop policy if exists "Person roles: public reads approved" on public.person_roles;
create policy "Person roles: public reads approved" on public.person_roles
  for select to anon, authenticated using (status = 'approved');
drop policy if exists "Person roles: own read" on public.person_roles;
create policy "Person roles: own read" on public.person_roles
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Person roles: admin read" on public.person_roles;
create policy "Person roles: admin read" on public.person_roles
  for select to authenticated using ((select public.is_admin()));
drop policy if exists "Person roles: own draft insert" on public.person_roles;
create policy "Person roles: own draft insert" on public.person_roles
  for insert to authenticated with check (user_id = (select auth.uid()) and status = 'draft');
drop policy if exists "Person roles: own draft update" on public.person_roles;
create policy "Person roles: own draft update" on public.person_roles
  for update to authenticated
  using (user_id = (select auth.uid()) and status in ('draft', 'submitted', 'changes_requested'))
  with check (user_id = (select auth.uid()) and status in ('draft', 'submitted'));
drop policy if exists "Person roles: own draft delete" on public.person_roles;
create policy "Person roles: own draft delete" on public.person_roles
  for delete to authenticated using (user_id = (select auth.uid()) and status in ('draft', 'changes_requested'));

-- Stamps and status rules. A signed-in non-admin may only move their own row
-- to draft or submitted; submitting stamps submitted_at. Admins and the
-- service role (no auth.uid()) are not limited here.
create or replace function public.person_roles_stamp()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.status = 'submitted' and old.status is distinct from 'submitted' then
    new.submitted_at := now();
  end if;
  if tg_op = 'UPDATE' and new.status = 'approved' and old.status is distinct from 'approved' then
    new.approved_at := now();
  end if;
  if (select auth.uid()) is not null and not (select public.is_admin()) then
    if new.status not in ('draft', 'submitted') then
      raise exception 'person_roles: only a reviewer can set status %', new.status using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists person_roles_stamp on public.person_roles;
create trigger person_roles_stamp before insert or update on public.person_roles
  for each row execute function public.person_roles_stamp();

-- ── 3. The proof ────────────────────────────────────────────────────────────

create table if not exists public.role_evidence (
  id uuid primary key default gen_random_uuid(),
  person_role_id uuid not null references public.person_roles(id) on delete cascade,
  -- Which proof_task step (or legal requirement code) this answers.
  step_key text check (step_key is null or step_key ~ '^[a-z0-9_-]{1,40}$'),
  kind text not null check (kind in ('photo', 'video', 'document', 'vouch', 'link', 'booking')),
  source text not null check (source in ('captured_in_app', 'uploaded', 'vouched', 'assessed', 'booking')),
  legal_code text check (legal_code is null or legal_code ~ '^[a-z0-9_]{1,40}$'),
  -- Where the file lives: the storage abstraction's provider and id.
  -- Cloudinary public_id for work (public); a path in the private
  -- `role-documents` bucket for legal documents.
  storage_provider text check (storage_provider is null or storage_provider in ('cloudinary', 'supabase', 'local')),
  storage_ref text check (storage_ref is null or length(storage_ref) <= 400),
  url text check (url is null or (length(url) <= 600 and url ~ '^(https://|/)')),
  -- Documents are never public.
  is_public boolean not null default true,
  -- Before/after pairs share a group id.
  pair_group text check (pair_group is null or pair_group ~ '^[a-z0-9-]{1,40}$'),
  pair_side text check (pair_side is null or pair_side in ('before', 'after')),
  captured_at timestamptz,
  -- PhotoMetadata from lib/metadata (device, date taken, size; no GPS kept).
  device_summary jsonb check (device_summary is null or jsonb_typeof(device_summary) = 'object'),
  -- A vouch's name and number, a link, a caption.
  note text check (note is null or length(note) <= 500),
  booking_id uuid,
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  constraint role_evidence_document_private check (kind <> 'document' or is_public = false)
);
create index if not exists idx_role_evidence_person_role on public.role_evidence (person_role_id, created_at);

alter table public.role_evidence enable row level security;
revoke all on public.role_evidence from public, anon, authenticated;
grant select on public.role_evidence to anon, authenticated;
grant insert (person_role_id, step_key, kind, source, legal_code, storage_provider, storage_ref, url, is_public,
              pair_group, pair_side, captured_at, device_summary, note) on public.role_evidence to authenticated;
grant delete on public.role_evidence to authenticated;
grant all on public.role_evidence to service_role;

drop policy if exists "Role evidence: public reads approved public work" on public.role_evidence;
create policy "Role evidence: public reads approved public work" on public.role_evidence
  for select to anon, authenticated using (
    is_public and kind <> 'document'
    and exists (select 1 from public.person_roles pr where pr.id = person_role_id and pr.status = 'approved')
  );
drop policy if exists "Role evidence: own read" on public.role_evidence;
create policy "Role evidence: own read" on public.role_evidence
  for select to authenticated using (
    exists (select 1 from public.person_roles pr where pr.id = person_role_id and pr.user_id = (select auth.uid()))
  );
drop policy if exists "Role evidence: admin read" on public.role_evidence;
create policy "Role evidence: admin read" on public.role_evidence
  for select to authenticated using ((select public.is_admin()));
-- A person adds only their own proof, only while the profile is not approved,
-- and only what they can honestly claim: their own photos, videos, documents,
-- links, or a vouch request (verified later by a person). Never a job.
drop policy if exists "Role evidence: own insert" on public.role_evidence;
create policy "Role evidence: own insert" on public.role_evidence
  for insert to authenticated with check (
    kind in ('photo', 'video', 'document', 'link', 'vouch')
    and source in ('captured_in_app', 'uploaded', 'vouched')
    and (kind = 'vouch') = (source = 'vouched')
    and exists (
      select 1 from public.person_roles pr
       where pr.id = person_role_id and pr.user_id = (select auth.uid())
         and pr.status in ('draft', 'submitted', 'changes_requested')
    )
  );
drop policy if exists "Role evidence: own delete" on public.role_evidence;
create policy "Role evidence: own delete" on public.role_evidence
  for delete to authenticated using (
    verified_at is null
    and exists (
      select 1 from public.person_roles pr
       where pr.id = person_role_id and pr.user_id = (select auth.uid())
         and pr.status in ('draft', 'submitted', 'changes_requested')
    )
  );

-- ── 4. Interest in coming-soon roles ────────────────────────────────────────
-- Written only by the server (rate limited, /api/roles/interest). Admins read.

create table if not exists public.role_interest (
  id uuid primary key default gen_random_uuid(),
  role_slug text not null references public.roles(slug) on update cascade on delete cascade,
  name text check (name is null or length(name) <= 80),
  phone text not null check (phone ~ '^\+?[0-9 ]{9,16}$'),
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_role_interest_role on public.role_interest (role_slug, created_at);

alter table public.role_interest enable row level security;
revoke all on public.role_interest from public, anon, authenticated;
grant select on public.role_interest to authenticated;
grant all on public.role_interest to service_role;

drop policy if exists "Role interest: admin read" on public.role_interest;
create policy "Role interest: admin read" on public.role_interest
  for select to authenticated using ((select public.is_admin()));

-- ── 5. Private bucket for legal documents ───────────────────────────────────
-- Uploads use one-time signed URLs from /api/roles/[slug]/document; only the
-- service role reads (the admin review shows short-lived signed links).

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('role-documents', 'role-documents', false)
    on conflict (id) do update set public = false;
  end if;
end $$;

-- ── 6. Feature flag (off) ───────────────────────────────────────────────────

do $$
begin
  if to_regclass('public.feature_flags') is not null then
    insert into public.feature_flags (key, enabled, description)
    values ('roles_v1', false, 'Many roles, honest proof: show "Join" (/join) in the main navigation.')
    on conflict (key) do nothing;
  end if;
end $$;

-- ── 7. Seed the catalogue ───────────────────────────────────────────────────
-- Upsert so a re-run puts back the published wording. Prices are suggestions
-- the owner sets (docs/processes/roles-and-proof.md "Decisions").

insert into public.roles (slug, name, role_group, description, status, min_age, legal_requirements, proof_task, guidelines, pricing_unit, suggested_price_cents, existing_flow_href, sort)
values
(
  'photographer-videographer', 'Photographer or videographer', 'camera',
  'Photos and video for shoots, events and brands.',
  'live', null, '[]'::jsonb,
  $j$[
    {"key":"best_work","title":"Your best work","help":"Pick 3 to 6 photos or short clips you are proud of. From your camera or phone.","kind":"photo","min":3,"tips":["Only your own work","No watermarks or logos","Different kinds of shoots if you have them"]},
    {"key":"live_shot","title":"Take one now","help":"Take a portrait of someone near a window, right now, in the app. This shows the work is really yours.","kind":"photo","min":1,"capture":"environment","tips":["Stand them facing the window","Phone at eye level","Tap to focus on the eyes"]},
    {"key":"kit","title":"Your kit","help":"One photo of the camera and lenses you will bring.","kind":"photo","min":1,"capture":"environment","tips":["Lay it out on a plain surface","Daylight is best"]}
  ]$j$::jsonb,
  $g$We check:
1. The work is yours. The photo you take in the app should look like the person who made the rest.
2. Sharp where it matters. Eyes in focus on portraits, steady video.
3. Good light. Faces are not too dark or burnt out.
4. Honest kit. The kit photo matches what you say you bring.
If we ask for changes, we say exactly what to fix. Most people get approved on the second try.$g$,
  'hour', '{"typical":150000,"low":60000,"high":300000}'::jsonb, '/onboarding', 10
),
(
  'makeup-artist', 'Make-up artist', 'hair_makeup',
  'Make-up for shoots, music videos, weddings and events.',
  'live', null, '[]'::jsonb,
  $j$[
    {"key":"before_after","title":"Before and after","help":"Take a photo of the face before you start, then the same face when you finish. Same spot, same light.","kind":"pair","min":1,"capture":"environment","tips":["Stand near a window, no flash","Same angle for both photos","Ask your model first"]},
    {"key":"angles","title":"Three angles","help":"The finished look from the front, the left and the right.","kind":"photo","min":3,"capture":"environment","tips":["Hold the phone at eye level","Fill the screen with the face"]},
    {"key":"close_up","title":"Close-up of the eyes","help":"One close photo that shows your detail work.","kind":"photo","min":1,"capture":"environment","tips":["Tap the eyes to focus","Steady hands, take two"]},
    {"key":"kit","title":"Your kit","help":"A photo of your kit, clean and ready.","kind":"photo","min":1,"capture":"environment","tips":["Brushes clean","Products closed"]}
  ]$j$::jsonb,
  $g$We check:
1. The before and after are the same person, same light, taken in the app.
2. Even skin, clean blending, no harsh lines at the jaw or hairline.
3. The look holds up close (the eye photo).
4. A clean kit. Clients care about hygiene.
No certificate needed. If we ask for changes, we tell you which photo to retake and how.$g$,
  'look', '{"typical":65000,"low":35000,"high":150000}'::jsonb, null, 20
),
(
  'model', 'Model', 'on_camera',
  'On camera for brands, music videos and campaigns. 18 and older.',
  'live', 18,
  $j$[
    {"code":"age_18","label":"18 or older","required":true,"basis":"law","help":"We confirm your age from your ID check. No other documents."}
  ]$j$::jsonb,
  $j$[
    {"key":"digitals","title":"Simple photos (digitals)","help":"No make-up or very little, plain wall, daylight. Front face, side face, full body front, full body side.","kind":"photo","min":4,"capture":"environment","tips":["Ask a friend to take them","Plain fitted clothes","No filters, no editing"]},
    {"key":"walk","title":"A short walk","help":"A 10 second video walking towards the camera and turning.","kind":"video","min":1,"capture":"environment","tips":["Film in landscape","Walk naturally"]},
    {"key":"best_work","title":"Past shoots (if you have them)","help":"Any photos from past shoots. Not needed to get started.","kind":"photo","min":0,"tips":["Only photos you have the right to share"]}
  ]$j$::jsonb,
  $g$We check:
1. You are 18 or older (from your ID check).
2. The digitals are clear, unedited and show you as you are today.
3. The walk video is you.
You do not need an agency, a portfolio or past shoots. We never ask for revealing photos, and nobody on ThabangVision may.$g$,
  'hour', '{"typical":45000,"low":25000,"high":120000}'::jsonb, null, 30
),
(
  'driver-with-vehicle', 'Driver with vehicle', 'transport',
  'You drive your own vehicle: crew, models or gear to the shoot. Never self-drive hire.',
  'live', 18,
  $j$[
    {"code":"drivers_licence","label":"Driving licence for your vehicle","required":true,"basis":"law","help":"A photo of the front of your card."},
    {"code":"prdp","label":"Professional driving permit (PrDP, category P)","required":true,"basis":"law","when":"carries_passengers","ask":"Will you drive people (crew or models), not only gear?","help":"The law asks for a PrDP when you carry people for pay. It is on the back of your licence card."},
    {"code":"licence_disc","label":"Valid licence disc","required":true,"basis":"law","help":"A photo of the disc on the windscreen."},
    {"code":"roadworthy","label":"Roadworthy certificate","required":true,"basis":"law","when":"carries_passengers","help":"Needed every year for vehicles that carry people for pay."},
    {"code":"commercial_insurance","label":"Insurance that covers paid trips","required":true,"basis":"platform","help":"The law does not ask for this, but ThabangVision does: if something happens on a paid trip, everyone must be covered."}
  ]$j$::jsonb,
  $j$[
    {"key":"outside","title":"Your vehicle outside","help":"Front corner, side and back, in daylight.","kind":"photo","min":3,"capture":"environment","tips":["Clean vehicle","Number plate can show"]},
    {"key":"inside","title":"Inside and boot","help":"The seats, and the boot with the doors open.","kind":"photo","min":2,"capture":"environment","tips":["Show how much fits"]}
  ]$j$::jsonb,
  $g$We check:
1. Your licence (and PrDP if you carry people) is valid and matches your ID.
2. The licence disc is current. The roadworthy and insurance cover paid trips.
3. The vehicle in the photos is the one on the disc, clean and in good shape.
The driver always comes with the vehicle. We never list a vehicle for someone else to drive.$g$,
  'day_plus_km', '{"typical":180000,"low":120000,"high":300000,"per_km":600}'::jsonb, null, 40
),
('gaffer', 'Gaffer (lighting)', 'crew', 'Lights the set and keeps it safe.', 'coming_soon', null, '[]'::jsonb,
  $j$[{"key":"setup","title":"A light set-up","help":"Before and after photos of a space you lit.","kind":"pair","min":1,"capture":"environment"}]$j$::jsonb,
  'Coming soon.', 'day', '{"typical":250000,"low":150000,"high":450000}'::jsonb, null, 50),
('sound-recordist', 'Sound recordist', 'crew', 'Clean sound on set: boom, lapels and the mix.', 'coming_soon', null, '[]'::jsonb,
  $j$[{"key":"sample","title":"A sound sample","help":"A short clip recorded in a noisy place, cleaned up.","kind":"video","min":1}]$j$::jsonb,
  'Coming soon.', 'day', '{"typical":250000,"low":150000,"high":450000}'::jsonb, null, 60),
('hairstylist', 'Hairstylist', 'hair_makeup', 'Hair for shoots, shows and events.', 'coming_soon', null, '[]'::jsonb,
  $j$[{"key":"before_after","title":"Before and after","help":"Same head, same light, start and finish.","kind":"pair","min":1,"capture":"environment"}]$j$::jsonb,
  'Coming soon.', 'look', '{"typical":60000,"low":30000,"high":150000}'::jsonb, null, 70),
('wardrobe-stylist', 'Wardrobe stylist', 'hair_makeup', 'Finds and styles the clothes for the shoot.', 'coming_soon', null, '[]'::jsonb,
  $j$[{"key":"looks","title":"Three looks","help":"Three outfits you styled, on a person.","kind":"photo","min":3,"capture":"environment"}]$j$::jsonb,
  'Coming soon.', 'day', '{"typical":200000,"low":100000,"high":400000}'::jsonb, null, 80),
('editor', 'Editor', 'post', 'Cuts photos and video into the final piece.', 'coming_soon', null, '[]'::jsonb,
  $j$[{"key":"before_after","title":"Before and after","help":"The raw and your finished version.","kind":"pair","min":1}]$j$::jsonb,
  'Coming soon.', 'hour', '{"typical":65000,"low":30000,"high":120000}'::jsonb, null, 90),
('drone-pilot', 'Drone pilot', 'camera', 'Aerial photos and video, flown legally.', 'coming_soon', null,
  $j$[
    {"code":"sacaa_rpl","label":"SACAA remote pilot licence (RPL)","required":true,"basis":"law"},
    {"code":"sacaa_roc","label":"Operator certificate (ROC), yours or the operator you fly for","required":true,"basis":"law"},
    {"code":"drone_registration","label":"Drone registered with SACAA","required":true,"basis":"law"}
  ]$j$::jsonb,
  $j$[{"key":"aerials","title":"Aerial work","help":"Three aerial photos or clips you flew.","kind":"photo","min":3}]$j$::jsonb,
  'Coming soon.', 'day', '{"typical":350000,"low":200000,"high":700000}'::jsonb, null, 100),
('location-studio', 'Location or studio', 'places', 'A studio, house or space people can shoot in.', 'coming_soon', null, '[]'::jsonb,
  $j$[{"key":"space","title":"The space","help":"Wide photos of every room you rent, in daylight.","kind":"photo","min":4,"capture":"environment"}]$j$::jsonb,
  'Coming soon.', 'hour', '{"typical":50000,"low":25000,"high":200000}'::jsonb, null, 110)
on conflict (slug) do update set
  name = excluded.name,
  role_group = excluded.role_group,
  description = excluded.description,
  status = excluded.status,
  min_age = excluded.min_age,
  legal_requirements = excluded.legal_requirements,
  proof_task = excluded.proof_task,
  guidelines = excluded.guidelines,
  pricing_unit = excluded.pricing_unit,
  suggested_price_cents = excluded.suggested_price_cents,
  existing_flow_href = excluded.existing_flow_href,
  sort = excluded.sort,
  updated_at = now();

notify pgrst, 'reload schema';

commit;
