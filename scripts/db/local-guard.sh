# Sourced by the scripts in scripts/db/. `require_local_url URL` returns 0 only
# when URL is a postgres:// URL whose single host is localhost, 127.0.0.1 or
# ::1, and clears the PG* variables that could send psql somewhere else.
# These scripts must never reach a Supabase project (dev or production).
require_local_url() {
  local url="$1" rest authority hostport host
  case "$url" in
    postgres://*|postgresql://*) ;;
    *) echo "refusing: give a postgres:// or postgresql:// URL" >&2; return 2 ;;
  esac
  case "$url" in
    *host=*|*hostaddr=*|*service=*) echo "refusing: host/hostaddr/service query parameters are not allowed" >&2; return 2 ;;
  esac
  rest="${url#*://}"
  authority="${rest%%/*}"
  authority="${authority%%\?*}"
  hostport="${authority##*@}"
  case "$hostport" in
    \[*\]*) host="${hostport%%]*}]" ;;
    *) host="${hostport%%:*}" ;;
  esac
  case "$host" in
    localhost|127.0.0.1|::1|\[::1\]) ;;
    *) echo "refusing: host '$host' is not local. scripts/db/ only touches a local database." >&2; return 2 ;;
  esac
  # Environment variables must not redirect psql elsewhere.
  unset PGHOST PGHOSTADDR PGSERVICE PGSERVICEFILE
  return 0
}
