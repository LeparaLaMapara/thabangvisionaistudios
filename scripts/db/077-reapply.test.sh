#!/usr/bin/env bash
# Re-applies 077 over states production or dev may be in, and checks that 077
# leaves what is not ThabangVision's (or not broken) alone. LOCAL ONLY.
#
# Usage: scripts/db/077-reapply.test.sh postgresql://postgres:postgres@127.0.0.1:54322/postgres
#
# Needs a database already at 077 (rebuild-local.sh). It commits changes
# (fake foreign objects, a custom signup body), re-applies 077 several
# times, and restores the 077 state at the end (drops the fakes, re-applies).
#
#   1. handle_new_user: a custom body (one that skips some users) is kept;
#      the broken 006 body (inserts profiles.email) is replaced; a missing
#      function (and trigger) is created.
#   2. Functions that are not ThabangVision's, with search_path = "" or none,
#      are untouched and 077 still succeeds; a ThabangVision-named function
#      owned by another role is skipped, not an error.
#   3. A table that is not ThabangVision's keeps its anon INSERT grant.
#   1b. A booking_payments status CHECK under another name is replaced.
set -uo pipefail
URL="${1:-}"
[ -n "$URL" ] || { sed -n '2,8p' "$0" >&2; exit 2; }
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=scripts/db/local-guard.sh
. "$ROOT/scripts/db/local-guard.sh"
require_local_url "$URL" || exit 2

MIG="$ROOT/lib/migrations/077-database-integrity.sql"
ERR="$(mktemp)"
q() { psql "$URL" -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }
apply() { psql "$URL" -X -q -v ON_ERROR_STOP=1 -f "$MIG" >/dev/null 2>"$ERR"; }
fails=0
ok() { echo "PASS: $1"; }
bad() { echo "FAIL: $1"; fails=$((fails + 1)); }

cleanup() {
  q "drop table if exists public.trading_positions;
     drop function if exists public.foreign_empty_path();
     drop function if exists public.foreign_no_path();" >/dev/null 2>&1
  q "do \$\$ begin
       if exists (select 1 from pg_proc where proname = 'increment_faq_view' and pg_get_userbyid(proowner) = 'tv077_other') then
         alter function public.increment_faq_view(uuid) owner to postgres;
       end if;
     end \$\$;" >/dev/null 2>&1
  q "revoke create on schema public from tv077_other; drop role if exists tv077_other;" >/dev/null 2>&1
  # Back to the canonical body, then 077 as shipped.
  q "create or replace function public.handle_new_user() returns trigger language plpgsql security definer
     set search_path = public, pg_temp as \$f\$ begin insert into public.profiles (id) values (new.id) on conflict (id) do nothing; return new; end; \$f\$;" >/dev/null
  apply || echo "restore: 077 did not re-apply" >&2
  # 077 redefines objects that later migrations replace (079: is_admin()), so
  # re-apply every later migration too: the database ends where it started.
  for later in $(LC_ALL=C ls "$ROOT"/lib/migrations/[0-9][0-9][0-9]-*.sql | LC_ALL=C sort); do
    name="$(basename "$later")"
    case "$name" in *.test.sql) continue ;; esac
    [ "${name%%-*}" \> "077" ] || continue
    psql "$URL" -X -q -v ON_ERROR_STOP=1 -f "$later" >/dev/null 2>"$ERR" || echo "restore: $name did not re-apply" >&2
  done
}
trap cleanup EXIT

# ── 1. handle_new_user ──────────────────────────────────────────────────────
q "create or replace function public.handle_new_user() returns trigger language plpgsql security definer
   set search_path = public, pg_temp as \$f\$
   begin
     if new.email like '%@multiversity.example' then return new; end if;  -- tv077 custom skip
     insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
     return new;
   end; \$f\$;"
if apply && q "select pg_get_functiondef('public.handle_new_user()'::regprocedure)" | grep -q 'tv077 custom skip'; then
  ok "a custom handle_new_user body (with a skip) is kept"
else bad "a custom handle_new_user body was replaced or 077 failed"; fi

q "create or replace function public.handle_new_user() returns trigger as \$f\$
   begin insert into profiles (id, email) values (new.id, new.email) on conflict (id) do nothing; return new; end;
   \$f\$ language plpgsql security definer;"
if apply && ! q "select pg_get_functiondef('public.handle_new_user()'::regprocedure)" | grep -qi 'email'; then
  ok "the broken 006 body (profiles.email) is replaced"
else bad "the broken 006 body survived"; fi

q "drop trigger if exists on_auth_user_created on auth.users; drop function public.handle_new_user();"
if apply && [ "$(q "select count(*) from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created'
                     and tgfoid = 'public.handle_new_user()'::regprocedure")" = "1" ]; then
  ok "a missing handle_new_user and trigger are created"
else bad "missing handle_new_user/trigger not created"; fi

# ── 2. foreign / unowned functions ──────────────────────────────────────────
q "create function public.foreign_empty_path() returns int language sql security definer set search_path = '' as 'select 1';
   create function public.foreign_no_path() returns int language sql security definer as 'select 1';
   grant execute on function public.foreign_no_path() to anon;
   create role tv077_other;
   grant tv077_other to current_user;
   grant create on schema public to tv077_other;
   alter function public.increment_faq_view(uuid) owner to tv077_other;"
if apply; then
  e="$(q "select coalesce(array_to_string(proconfig, ';'), '<none>') from pg_proc where proname = 'foreign_empty_path'")"
  n="$(q "select coalesce(array_to_string(proconfig, ';'), '<none>') from pg_proc where proname = 'foreign_no_path'")"
  a="$(q "select has_function_privilege('anon', 'public.foreign_no_path()', 'execute')")"
  if [ "$e" = 'search_path=""' ] && [ "$n" = '<none>' ] && [ "$a" = "t" ]; then
    ok "functions that are not ThabangVision's are untouched (search_path \"\" / none, grants) and 077 succeeds"
  else bad "foreign functions changed: empty=[$e] none=[$n] anon=[$a]"; fi
  if grep -q "increment_faq_view(uuid) (owned by tv077_other)" "$ERR"; then
    ok "a ThabangVision function owned by another role is skipped with a NOTICE, not an error"
  else bad "the function owned by another role was not reported as skipped"; fi
else
  bad "077 failed with foreign / unowned functions present: $(grep -m1 ERROR "$ERR")"
fi
q "drop function public.foreign_empty_path(); drop function public.foreign_no_path();
   alter function public.increment_faq_view(uuid) owner to postgres;
   revoke create on schema public from tv077_other; drop role tv077_other;"

# An empty path on one of OUR definer functions becomes pg_catalog, pg_temp.
q "alter function public.ledger_post(jsonb) set search_path = ''"
if apply && [ "$(q "select array_to_string(proconfig, ';') from pg_proc where oid = 'public.ledger_post(jsonb)'::regprocedure")" = "search_path=pg_catalog, pg_temp" ]; then
  ok "an empty search_path on a ThabangVision definer function becomes pg_catalog, pg_temp (no error)"
else bad "empty search_path on ledger_post not handled: $(grep -m1 ERROR "$ERR")"; fi
q "alter function public.ledger_post(jsonb) set search_path = public, pg_temp"

# ── 1b. a status CHECK under another name (production may differ) ───────────
q "alter table public.booking_payments drop constraint booking_payments_status_check;
   alter table public.booking_payments add constraint bp_status_legacy
     check (status in ('pending', 'complete', 'failed', 'refunded')) not valid;"
if apply && [ "$(q "select string_agg(conname, ',') from pg_constraint where conrelid = 'public.booking_payments'::regclass
                     and contype = 'c' and pg_get_constraintdef(oid) ~ 'status'")" = "booking_payments_status_check" ]; then
  ok "a status CHECK under another name is dropped (found by table, not by name)"
else bad "a differently named status CHECK survived 077"; fi

# ── 3. foreign table grants ─────────────────────────────────────────────────
q "create table public.trading_positions (id int primary key); grant insert on public.trading_positions to anon;"
if apply && [ "$(q "select has_table_privilege('anon', 'public.trading_positions', 'INSERT')")" = "t" ] \
   && grep -q "trading_positions" "$ERR"; then
  ok "a table that is not ThabangVision's keeps its anon INSERT grant (and is reported)"
else bad "a foreign table lost its anon grant or was not reported"; fi
q "drop table public.trading_positions;"

echo "077 re-apply checks failed: $fails"
[ "$fails" = 0 ]
