#!/usr/bin/env bash
# 078: two sessions reserve the last Ubunye message slot at the same moment.
# LOCAL ONLY. Usage: scripts/db/078-concurrency.test.sh postgresql://postgres:postgres@127.0.0.1:54322/postgres
#
#   1. Existing row at limit - 1: session A reserves and holds its transaction
#      open for 2 s; session B reserves 0.5 s later. B waits on A's row lock,
#      re-checks the count and is refused. Exactly one slot is given.
#   2. New day (no row yet), limit 1: both sessions insert at once; one gets
#      the slot, the other is refused (no unique-violation error).
# Fixtures are committed and deleted at the end.
set -uo pipefail
URL="${1:-}"
[ -n "$URL" ] || { sed -n '2,3p' "$0" >&2; exit 2; }
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=scripts/db/local-guard.sh
. "$ROOT/scripts/db/local-guard.sh"
require_local_url "$URL" || exit 2

q() { psql "$URL" -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }
U=$(cat /proc/sys/kernel/random/uuid)
fails=0
q "insert into auth.users (id, email) values ('$U', 'race-078@example.invalid');
   insert into public.profiles (id) values ('$U') on conflict (id) do nothing;
   insert into public.ubunye_usage (user_id, date, message_count) values ('$U', date '2031-02-01', 4);" >/dev/null

race() { # $1 date, $2 limit
  local a b
  a=$(psql "$URL" -X -q -At -c "begin; select coalesce(public.ubunye_reserve_message('$U', date '$1', $2)::text, 'refused'); select pg_sleep(2); commit;" 2>&1 | head -1) &
  local pa=$!
  sleep 0.5
  b=$(psql "$URL" -X -q -At -c "select coalesce(public.ubunye_reserve_message('$U', date '$1', $2)::text, 'refused');" 2>&1)
  wait $pa
  echo "$b"
}

B=$(race 2031-02-01 5)
N=$(q "select message_count from public.ubunye_usage where user_id = '$U' and date = date '2031-02-01'")
if [ "$N" = "5" ] && [ "$B" = "refused" ]; then echo "PASS 1: at limit - 1, two concurrent reserves give exactly one slot (count 5, second refused)"
else echo "FAIL 1: count $N, second session said: $B"; fails=$((fails + 1)); fi

B=$(race 2031-02-02 1)
N=$(q "select message_count from public.ubunye_usage where user_id = '$U' and date = date '2031-02-02'")
if [ "$N" = "1" ] && [ "$B" = "refused" ]; then echo "PASS 2: first messages of a new day: one slot, the other refused, no unique-violation"
else echo "FAIL 2: count $N, second session said: $B"; fails=$((fails + 1)); fi

q "delete from public.ubunye_usage where user_id = '$U'; delete from public.profiles where id = '$U'; delete from auth.users where id = '$U';" >/dev/null
[ "$fails" -eq 0 ]
