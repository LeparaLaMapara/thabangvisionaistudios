-- 091: People complete (TASK-085 slice 2, docs/processes/roles-and-proof.md).
-- Needs 090 and pgvector (001). Additive only: no table, column or policy is
-- dropped. Safe to run more than once. DEV first.
--
--   1. roles: proof_format (look | listen | thing | trust), code_prefix (the
--      neutral profile code, e.g. MA-1042), sound recordist gets a clip step.
--   2. person_roles: profile_code (blind label), facts (reviewed, PII-free),
--      facts_source, facts_reviewed_at, comes_with, available_days.
--   3. role_evidence: media_kind (audio for Listen clips), on_time (for job
--      evidence: the record line "on time N/N").
--   4. person_faces: ONE face photo per person, private (role-documents
--      bucket), revealed only on a confirmed booking; face_check for the
--      reviewer (compared with the ID-check selfie; no automatic matching).
--   5. role_booking_requests: who, where, when; 'confirmed' is the placeholder
--      for "booked and paid, payment held" (payment for roles is not built).
--      Read and written only by the server (reveal rules in lib/roles/reveal.ts).
--   6. person_role_embeddings + match_person_roles(): competence-only profile
--      vectors (gemini-embedding-2, 768 dims), service role only.
--   7. team_signals: data shape for later Teams (co-booking pairs, client
--      rating per booking, private "would work with again"). Service role only.
--
-- ROLLBACK: scripts/db/rollback/091-people-complete.sql

begin;

-- ── 1. roles ────────────────────────────────────────────────────────────────

alter table public.roles add column if not exists proof_format text not null default 'look';
alter table public.roles add column if not exists code_prefix text;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.roles'::regclass and conname = 'roles_proof_format_check') then
    alter table public.roles add constraint roles_proof_format_check check (proof_format in ('look', 'listen', 'thing', 'trust'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.roles'::regclass and conname = 'roles_code_prefix_check') then
    alter table public.roles add constraint roles_code_prefix_check check (code_prefix is null or code_prefix ~ '^[A-Z]{2,3}$');
  end if;
end $$;

update public.roles r set proof_format = v.fmt, code_prefix = v.prefix
  from (values
    ('photographer-videographer', 'look', 'PV'),
    ('makeup-artist', 'look', 'MA'),
    ('model', 'look', 'MO'),
    ('driver-with-vehicle', 'trust', 'DV'),
    ('gaffer', 'look', 'GF'),
    ('sound-recordist', 'listen', 'SR'),
    ('hairstylist', 'look', 'HS'),
    ('wardrobe-stylist', 'look', 'WS'),
    ('editor', 'look', 'ED'),
    ('drone-pilot', 'look', 'DP'),
    ('location-studio', 'thing', 'LS')
  ) as v(slug, fmt, prefix)
 where r.slug = v.slug;

update public.roles
   set proof_task = $j$[
     {"key":"listen","title":"A sound clip","help":"A clip up to 30 seconds: dialogue you recorded somewhere noisy, cleaned up.","kind":"audio","min":1}
   ]$j$::jsonb
 where slug = 'sound-recordist';

-- Guidelines: work proof shows the work, not the person (models excepted).
update public.roles
   set guidelines = guidelines || E'\nReject proof that is just a selfie of the creator (except models).'
 where status = 'live' and slug <> 'model' and guidelines not like '%just a selfie%';
update public.roles
   set guidelines = guidelines || E'\nModels are the one exception to "work, not the person": the digitals are the work.'
 where slug = 'model' and guidelines not like '%one exception%';

-- ── 2. person_roles ─────────────────────────────────────────────────────────

create sequence if not exists public.person_role_code_seq start 1001;

alter table public.person_roles add column if not exists profile_code text;
alter table public.person_roles add column if not exists facts jsonb not null default '{}'::jsonb;
alter table public.person_roles add column if not exists facts_source text;
alter table public.person_roles add column if not exists facts_reviewed_at timestamptz;
alter table public.person_roles add column if not exists comes_with jsonb not null default '{}'::jsonb;
alter table public.person_roles add column if not exists available_days text[] not null default '{}';
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.person_roles'::regclass and conname = 'person_roles_profile_code_key') then
    alter table public.person_roles add constraint person_roles_profile_code_key unique (profile_code);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.person_roles'::regclass and conname = 'person_roles_facts_shape') then
    alter table public.person_roles add constraint person_roles_facts_shape check (jsonb_typeof(facts) = 'object' and length(facts::text) <= 8000);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.person_roles'::regclass and conname = 'person_roles_facts_source_check') then
    alter table public.person_roles add constraint person_roles_facts_source_check check (facts_source is null or facts_source in ('cv', 'voice', 'text', 'manual'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.person_roles'::regclass and conname = 'person_roles_comes_with_shape') then
    alter table public.person_roles add constraint person_roles_comes_with_shape check (jsonb_typeof(comes_with) = 'object' and length(comes_with::text) <= 2000);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.person_roles'::regclass and conname = 'person_roles_days_check') then
    alter table public.person_roles add constraint person_roles_days_check check (available_days <@ array['mon','tue','wed','thu','fri','sat','sun']);
  end if;
end $$;

-- Codes for existing rows, then for every new row.
update public.person_roles pr
   set profile_code = coalesce(r.code_prefix, 'PR') || '-' || nextval('public.person_role_code_seq')
  from public.roles r
 where r.slug = pr.role_slug and pr.profile_code is null;

grant update (facts, facts_source, comes_with, available_days) on public.person_roles to authenticated;

-- Equal chance, enforced in data access: browsers (anon and signed-in) can
-- read only the public columns of an approved profile. Never user_id (it
-- leads to a name), answers (it held a date of birth), the reviewer's note or
-- who reviewed. The person's own private columns are read by the server
-- after it checks who is asking (lib/supabase/queries/roles.ts).
revoke select on public.person_roles from anon, authenticated;
grant select (id, role_slug, status, evidence_level, headline, about, area, price_cents, per_km_cents,
              legal_verified_at, submitted_at, approved_at, is_demo, created_at, updated_at,
              profile_code, facts, facts_reviewed_at, comes_with, available_days)
  on public.person_roles to anon, authenticated;

create or replace function public.person_roles_stamp()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' and new.profile_code is null then
    new.profile_code := coalesce((select code_prefix from public.roles where slug = new.role_slug), 'PR')
                        || '-' || nextval('public.person_role_code_seq');
  end if;
  if tg_op = 'UPDATE' then
    new.profile_code := old.profile_code;
    if new.status = 'submitted' and old.status is distinct from 'submitted' then new.submitted_at := now(); end if;
    if new.status = 'approved' and old.status is distinct from 'approved' then new.approved_at := now(); end if;
    if new.facts is distinct from old.facts then new.facts_reviewed_at := now(); end if;
  end if;
  if (select auth.uid()) is not null and not (select public.is_admin()) then
    if new.status not in ('draft', 'submitted') then
      raise exception 'person_roles: only a reviewer can set status %', new.status using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
grant usage on sequence public.person_role_code_seq to authenticated, service_role;

-- The evidence policies asked "is this my profile?" by reading
-- person_roles.user_id, which browsers may no longer read. They now ask a
-- definer function that answers yes or no and reveals nothing else.
create or replace function public.owns_person_role(p_person_role_id uuid, p_editable boolean default false)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.person_roles pr
     where pr.id = p_person_role_id
       and pr.user_id = (select auth.uid())
       and (not p_editable or pr.status in ('draft', 'submitted', 'changes_requested'))
  );
$$;
revoke all on function public.owns_person_role(uuid, boolean) from public, anon;
grant execute on function public.owns_person_role(uuid, boolean) to authenticated, service_role;

alter policy "Role evidence: own read" on public.role_evidence
  using (public.owns_person_role(person_role_id, false));
alter policy "Role evidence: own insert" on public.role_evidence
  with check (
    kind in ('photo', 'video', 'document', 'link', 'vouch')
    and source in ('captured_in_app', 'uploaded', 'vouched')
    and (kind = 'vouch') = (source = 'vouched')
    and public.owns_person_role(person_role_id, true)
  );
alter policy "Role evidence: own delete" on public.role_evidence
  using (verified_at is null and public.owns_person_role(person_role_id, true));

-- ── 3. role_evidence ────────────────────────────────────────────────────────

alter table public.role_evidence add column if not exists media_kind text;
alter table public.role_evidence add column if not exists on_time boolean;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.role_evidence'::regclass and conname = 'role_evidence_media_kind_check') then
    alter table public.role_evidence add constraint role_evidence_media_kind_check check (media_kind is null or media_kind in ('image', 'video', 'audio'));
  end if;
end $$;
grant insert (media_kind) on public.role_evidence to authenticated;

-- ── 4. person_faces (private; one per person) ───────────────────────────────

create table if not exists public.person_faces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- A path in the private role-documents bucket.
  storage_ref text not null check (length(storage_ref) <= 400),
  captured_at timestamptz,
  face_check text check (face_check is null or face_check in ('to_compare', 'same_person', 'different_person', 'no_id_selfie')),
  checked_by uuid references auth.users(id) on delete set null,
  checked_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.person_faces enable row level security;
revoke all on public.person_faces from public, anon, authenticated;
grant select on public.person_faces to authenticated;
grant all on public.person_faces to service_role;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'person_faces' and policyname = 'Faces: own read') then
    create policy "Faces: own read" on public.person_faces for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'person_faces' and policyname = 'Faces: admin read') then
    create policy "Faces: admin read" on public.person_faces for select to authenticated using ((select public.is_admin()));
  end if;
end $$;

-- ── 5. Booking requests (who, where, when) ──────────────────────────────────

create table if not exists public.role_booking_requests (
  id uuid primary key default gen_random_uuid(),
  person_role_id uuid not null references public.person_roles(id) on delete cascade,
  client_id uuid not null references auth.users(id) on delete cascade,
  requested_date date not null,
  arrival_time time not null,
  duration_hours numeric(4, 1) not null check (duration_hours between 0.5 and 24),
  area text not null check (length(area) between 2 and 80),
  address text check (address is null or length(address) <= 200),
  note text check (note is null or length(note) <= 500),
  -- confirmed = booked and paid, payment held (placeholder: payment for roles is not built).
  status text not null default 'requested' check (status in ('requested', 'confirmed', 'withdrawn', 'declined', 'completed')),
  confirmed_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_role_booking_requests_person on public.role_booking_requests (person_role_id, created_at);
create index if not exists idx_role_booking_requests_client on public.role_booking_requests (client_id, created_at);
alter table public.role_booking_requests enable row level security;
revoke all on public.role_booking_requests from public, anon, authenticated;
grant all on public.role_booking_requests to service_role;

-- ── 6. Profile embeddings ───────────────────────────────────────────────────

create table if not exists public.person_role_embeddings (
  person_role_id uuid primary key references public.person_roles(id) on delete cascade,
  embedding extensions.vector(768) not null,
  model text not null check (length(model) <= 80),
  dims integer not null check (dims = 768),
  document_hash text not null check (length(document_hash) <= 128),
  updated_at timestamptz not null default now()
);
create index if not exists person_role_embeddings_hnsw
  on public.person_role_embeddings using hnsw (embedding extensions.vector_cosine_ops);
alter table public.person_role_embeddings enable row level security;
revoke all on public.person_role_embeddings from public, anon, authenticated;
grant all on public.person_role_embeddings to service_role;

create or replace function public.match_person_roles(
  p_query extensions.vector(768),
  p_role text default null,
  p_limit integer default 50
)
returns table (person_role_id uuid, similarity double precision)
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select e.person_role_id, 1 - (e.embedding <=> p_query) as similarity
    from public.person_role_embeddings e
    join public.person_roles pr on pr.id = e.person_role_id
   where pr.status = 'approved'
     and (p_role is null or pr.role_slug = p_role)
   order by e.embedding <=> p_query
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;
revoke all on function public.match_person_roles(extensions.vector, text, integer) from public, anon, authenticated;
grant execute on function public.match_person_roles(extensions.vector, text, integer) to service_role;

-- ── 7. Team signals (data shape only) ───────────────────────────────────────

create table if not exists public.team_signals (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('co_booking', 'client_rating', 'work_again')),
  booking_request_id uuid references public.role_booking_requests(id) on delete set null,
  person_role_id uuid not null references public.person_roles(id) on delete cascade,
  other_person_role_id uuid references public.person_roles(id) on delete cascade,
  rating smallint check (rating is null or rating between 1 and 5),
  -- Private: never shown to the other person.
  would_work_again boolean,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((kind = 'client_rating') = (rating is not null)),
  check ((kind = 'work_again') = (would_work_again is not null)),
  check (kind = 'client_rating' or other_person_role_id is not null)
);
alter table public.team_signals enable row level security;
revoke all on public.team_signals from public, anon, authenticated;
grant all on public.team_signals to service_role;

notify pgrst, 'reload schema';

commit;
