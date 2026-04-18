#!/usr/bin/env bash
# Manage the postgres database used by the backend. Connection string comes
# from config.yaml:backend.databaseUrl (overridden by DATABASE_URL env).
#
# Usage:
#   scripts/db.sh create   # create DB if missing
#   scripts/db.sh drop     # drop DB if present
#   scripts/db.sh migrate  # apply web/backend/migrations/*.sql
#   scripts/db.sh reset    # drop + create + migrate
#   scripts/db.sh psql     # open interactive psql shell
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib/log.sh"
source "$HERE/lib/read-config.sh"

_db_url() {
  if [[ -n "${DATABASE_URL:-}" ]]; then
    echo "$DATABASE_URL"
  else
    cfg backend.databaseUrl
  fi
}

# Extract just the database name from the URL (last path segment).
_db_name() {
  _db_url | sed -nE 's|.*/([^/?]+)(\?.*)?$|\1|p'
}

# Drop the final "/dbname" to get the server URL for admin commands.
_db_admin_url() {
  _db_url | sed -E 's|/[^/?]+(\?.*)?$||'
}

cmd_create() {
  command -v createdb >/dev/null 2>&1 || die "createdb not found (install postgres)"
  local name; name="$(_db_name)"
  if psql -Atqc 'SELECT 1' "$(_db_url)" >/dev/null 2>&1; then
    ok "database '$name' already exists"
    return 0
  fi
  info "Creating database '$name'"
  createdb "$name" || die "createdb failed"
  ok "database '$name' created"
}

cmd_drop() {
  command -v dropdb >/dev/null 2>&1 || die "dropdb not found"
  local name; name="$(_db_name)"
  info "Dropping database '$name'"
  # Terminate any lingering connections first — otherwise dropdb fails with
  # "database is being accessed by other users" if any backend/indexer/psql
  # session is still open. Connect to 'postgres' maintenance DB, not the one
  # we're about to drop.
  local admin; admin="$(_db_admin_url)/postgres"
  psql -q "$admin" -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$name' AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true
  dropdb --if-exists "$name" || die "dropdb failed"
  ok "database '$name' dropped"
}

cmd_migrate() {
  # Idempotent: if the schema is already applied (sentinel table present), skip.
  # Lets `dev.sh start` be called repeatedly without spamming "already exists"
  # errors. Use `db.sh reset` (or `dev.sh reset`) for a clean re-migration.
  if psql -Atqc "SELECT 1 FROM pg_tables WHERE tablename = 'novels'" "$(_db_url)" 2>/dev/null | grep -q 1; then
    ok "schema already present — skipping migrations"
    return 0
  fi
  local root; root="$(_cfg_find_root)"
  local migrations="$root/web/backend/migrations"
  [[ -d "$migrations" ]] || die "migrations dir not found: $migrations"
  info "Applying migrations from $migrations"
  for f in "$migrations"/*.sql; do
    step "$(basename "$f")"
    psql -q "$(_db_url)" < "$f" >/dev/null || die "migration failed: $f"
  done
  ok "migrations applied"
}

cmd_reset() {
  cmd_drop
  cmd_create
  cmd_migrate
}

cmd_psql() {
  exec psql "$(_db_url)"
}

main() {
  local action="${1:-}"
  case "$action" in
    create)  cmd_create ;;
    drop)    cmd_drop ;;
    migrate) cmd_migrate ;;
    reset)   cmd_reset ;;
    psql)    cmd_psql ;;
    *)       die "usage: $0 {create|drop|migrate|reset|psql}" ;;
  esac
}

main "$@"
