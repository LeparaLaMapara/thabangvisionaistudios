#!/usr/bin/env bash
# Checks scripts/db/local-guard.sh: local URLs pass, anything that could reach
# another host is refused. Touches no database.
#   scripts/db/local-guard.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=scripts/db/local-guard.sh
. "$ROOT/scripts/db/local-guard.sh"
fails=0
expect() {  # expect ok|refuse URL [PGHOST]
  local want="$1" url="$2" got
  if PGHOST="${3:-}" require_local_url "$url" 2>/dev/null; then got=ok; else got=refuse; fi
  if [ "$got" = "$want" ]; then echo "PASS: $want $url ${3:+(PGHOST=$3)}"; else echo "FAIL: expected $want, got $got: $url ${3:+(PGHOST=$3)}"; fails=$((fails + 1)); fi
}
expect ok     'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
expect ok     'postgres://postgres@localhost/postgres'
expect ok     'postgresql://u:p@[::1]:5432/db'
expect refuse 'postgresql://postgres:x@db.zbdsqvpxpsygbuqnuekm.supabase.co:5432/postgres'
expect refuse 'postgresql://u:p@localhost:1,remote.example.com/db'
expect refuse 'postgresql://u:p@127.0.0.1,remote.example.com:5432/db'
expect refuse 'postgresql://u:p@localhost.evil.example/db'
expect refuse 'postgresql://u@127.0.0.1/db?host=remote.example.com'
expect refuse 'postgresql://u@127.0.0.1/db?hostaddr=10.0.0.1'
expect refuse 'postgresql://u@127.0.0.1/db?service=prod'
expect refuse 'host=127.0.0.1 dbname=postgres'
expect refuse 'postgresql://u@127.0.0.1/db' 'localhost,remote.example.com'
echo "local-guard checks failed: $fails"
[ "$fails" = 0 ]
