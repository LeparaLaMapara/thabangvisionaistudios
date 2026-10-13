#!/usr/bin/env bash
# Rebuild ThabangVision's schema from the repo, in the canonical order, into an
# EMPTY local Supabase database (`supabase start` / `supabase db reset`).
#
# Usage:
#   scripts/db/rebuild-local.sh postgresql://postgres:postgres@127.0.0.1:54322/postgres
#   scripts/db/rebuild-local.sh <url> --through 076    # stop after migration 076
#   scripts/db/rebuild-local.sh <url> --list           # print the order, apply nothing
#   scripts/db/rebuild-local.sh <url> --allow-existing # apply over a non-empty schema
#
# Canonical order (docs/database/README.md explains why):
#   1. supabase/migrations/20260311000000_base_schema.sql
#   2. lib/migrations/NNN-*.sql in byte order (LC_ALL=C), where two files share a
#      number both run, in name order. Skipped: *.test.sql and
#      001-pgvector-openai.sql (the 1536-dimension alternative to
#      001-pgvector-gemini.sql; only one of the two may run).
#   3. The four April migrations that exist only in supabase/migrations/
#      (20260411000001..4) run immediately BEFORE the first 029 file, because
#      029 alters onboarding_progress, which 20260411000003 creates.
#   The other supabase/migrations/2026031*/2026032* files are older copies of
#   lib/migrations 001-026 and are NOT applied.
#
# Safety: refuses any URL whose host is not localhost / 127.0.0.1 / ::1.
# This script must never point at a Supabase project.
set -euo pipefail

usage() { sed -n '2,10p' "$0" >&2; exit 2; }

URL="${1:-}"
[ -n "$URL" ] || usage
shift
THROUGH=""
LIST_ONLY=0
ALLOW_EXISTING=0
while [ $# -gt 0 ]; do
  case "$1" in
    --through) THROUGH="${2:?--through needs a migration number, e.g. 076}"; shift 2 ;;
    --list) LIST_ONLY=1; shift ;;
    --allow-existing) ALLOW_EXISTING=1; shift ;;
    *) usage ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=scripts/db/local-guard.sh
. "$ROOT/scripts/db/local-guard.sh"
require_local_url "$URL" || exit 2

BASE="$ROOT/supabase/migrations/20260311000000_base_schema.sql"
APRIL=(
  "$ROOT/supabase/migrations/20260411000001_user_suspension.sql"
  "$ROOT/supabase/migrations/20260411000002_gear_return.sql"
  "$ROOT/supabase/migrations/20260411000003_onboarding.sql"
  "$ROOT/supabase/migrations/20260411000004_disputes.sql"
)

ORDER=("$BASE")
april_done=0
while IFS= read -r f; do
  name="$(basename "$f")"
  case "$name" in
    *.test.sql|001-pgvector-openai.sql) continue ;;
  esac
  num="${name%%-*}"
  if [ -n "$THROUGH" ] && [ "$((10#$num))" -gt "$((10#$THROUGH))" ]; then break; fi
  if [ "$april_done" = 0 ] && [ "$((10#$num))" -ge 29 ]; then
    ORDER+=("${APRIL[@]}")
    april_done=1
  fi
  ORDER+=("$f")
done < <(LC_ALL=C ls "$ROOT"/lib/migrations/[0-9][0-9][0-9]-*.sql | LC_ALL=C sort)
if [ "$april_done" = 0 ] && { [ -z "$THROUGH" ] || [ "$((10#$THROUGH))" -ge 29 ]; }; then
  ORDER+=("${APRIL[@]}")
fi

for f in "${ORDER[@]}"; do [ -f "$f" ] || { echo "missing file: $f" >&2; exit 1; }; done

if [ "$LIST_ONLY" = 1 ]; then
  for f in "${ORDER[@]}"; do echo "${f#"$ROOT"/}"; done
  exit 0
fi

PSQL=(psql "$URL" -X -q -v ON_ERROR_STOP=1)

existing="$("${PSQL[@]}" -At -c "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'profiles'")"
if [ "$existing" != "0" ] && [ "$ALLOW_EXISTING" = 0 ]; then
  echo "refusing: public.profiles already exists. Reset first (supabase db reset) or pass --allow-existing." >&2
  exit 2
fi

n=0
for f in "${ORDER[@]}"; do
  n=$((n + 1))
  rel="${f#"$ROOT"/}"
  if ! out="$("${PSQL[@]}" -f "$f" 2>&1)"; then
    echo "FAILED at $rel" >&2
    echo "$out" >&2
    exit 1
  fi
  printf '%3d  %s\n' "$n" "$rel"
done

"${PSQL[@]}" -c "notify pgrst, 'reload schema';"
echo "Applied $n files. PostgREST schema reload requested."
