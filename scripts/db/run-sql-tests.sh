#!/usr/bin/env bash
# Run every SQL test script against a LOCAL database rebuilt with
# scripts/db/rebuild-local.sh, and report PASS/FAIL per file.
#
# Usage:
#   scripts/db/run-sql-tests.sh postgresql://postgres:postgres@127.0.0.1:54322/postgres
#   scripts/db/run-sql-tests.sh <url> 077          # only files whose name contains "077"
#
# Tests: lib/migrations/*.test.sql, in name order. Each one runs in a single
# transaction ending in ROLLBACK and aborts at the first failed check
# (ON_ERROR_STOP), so a failure leaves nothing behind. A file passes when psql
# exits 0; the count is the number of "PASS" notices it printed.
#
# For DEV, run one file at a time by hand with psql (docs/database/README.md);
# this script, like rebuild-local.sh, refuses any non-local host.
set -uo pipefail

URL="${1:-}"
[ -n "$URL" ] || { sed -n '2,8p' "$0" >&2; exit 2; }
FILTER="${2:-}"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=scripts/db/local-guard.sh
. "$ROOT/scripts/db/local-guard.sh"
require_local_url "$URL" || exit 2

LOG_DIR="${SQL_TEST_LOG_DIR:-$(mktemp -d)}"
mkdir -p "$LOG_DIR"
pass=0
fail=0
for f in $(LC_ALL=C ls "$ROOT"/lib/migrations/*.test.sql | LC_ALL=C sort); do
  name="$(basename "$f")"
  case "$name" in *"$FILTER"*) ;; *) continue ;; esac
  log="$LOG_DIR/${name%.sql}.log"
  if psql "$URL" -X -q -v ON_ERROR_STOP=1 -f "$f" >"$log" 2>&1; then
    checks="$(grep -cE 'NOTICE: +PASS' "$log" || true)"
    printf 'PASS  %-55s %3s checks\n' "$name" "$checks"
    pass=$((pass + 1))
  else
    printf 'FAIL  %-55s see %s\n' "$name" "$log"
    grep -E 'ERROR|FAIL' "$log" | head -3 | sed 's/^/        /'
    fail=$((fail + 1))
  fi
done

echo "files passed: $pass, failed: $fail (logs in $LOG_DIR)"
[ "$fail" = 0 ]
