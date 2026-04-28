#!/usr/bin/env bash
# Manage the app-layer services: backend, frontend, and the optional keeper.
# All read config.yaml for ports / addresses; secrets (PRIVATE_KEY,
# KEEPER_PRIVATE_KEY, VOTE_ENCRYPTION_KEY) come from env.
#
# Usage:
#   scripts/services.sh start [--dev] [--keeper] [--no-frontend]
#   scripts/services.sh stop
#   scripts/services.sh status
#   scripts/services.sh logs <backend|frontend>
#
# Flags:
#   --dev          run backend with tsx watch, frontend with next dev
#   --keeper       additionally spawn the backend's keeper loop (needs KEEPER_PRIVATE_KEY)
#   --no-frontend  skip starting Next.js
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib/log.sh"
source "$HERE/lib/pidfile.sh"
source "$HERE/lib/read-config.sh"

ROOT="$(_cfg_find_root)"

DEV=false
KEEPER=false
NO_FRONTEND=false
ACTION=""
POSITIONAL=()

parse_args() {
  ACTION="${1:-}"; shift || true
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dev)          DEV=true ;;
      --keeper)       KEEPER=true ;;
      --no-frontend)  NO_FRONTEND=true ;;
      --*)            die "unknown flag: $1" ;;
      *)              POSITIONAL+=("$1") ;;
    esac
    shift
  done
}

_backend_url() {
  local host port
  host="$(cfg backend.host)"
  port="$(cfg backend.port)"
  echo "http://${host}:${port}"
}

_frontend_port() {
  cfg frontend.port
}

_require_built() {
  # Used when not in --dev mode.
  [[ -f "$ROOT/web/backend/dist/index.js" ]] \
    || die "backend not built. Run 'npm run build:backend' or pass --dev"
  if ! $NO_FRONTEND; then
    [[ -d "$ROOT/web/frontend/.next" ]] \
      || die "frontend not built. Run 'npm run build:frontend' or pass --dev"
  fi
}

# If a foreign process already owns the port we're about to bind, the child
# will die with EADDRINUSE and we'd waste the wait_for timeout. Reap it up
# front — almost always an orphan from a prior run whose pidfile went stale.
_free_port() {
  local name="$1" port="$2"
  local holder; holder="$(port_listener_pid "$port" 2>/dev/null || true)"
  [[ -z "$holder" ]] && return 0
  warn "port $port held by pid $holder (stale $name from a prior run?) — terminating tree"
  local pids; pids="$(_collect_tree "$holder")"
  local p
  for p in $pids; do kill -TERM "$p" 2>/dev/null || true; done
  # Short grace, then escalate.
  for _ in $(seq 1 30); do
    port_listener_pid "$port" >/dev/null 2>&1 || return 0
    sleep 0.1
  done
  for p in $pids; do kill -KILL "$p" 2>/dev/null || true; done
  sleep 0.2
  port_listener_pid "$port" >/dev/null 2>&1 \
    && die "could not free port $port — still held by pid $(port_listener_pid "$port")"
  return 0
}

start_backend() {
  if is_running backend; then
    ok "backend already running (pid $(read_pid backend))"
    return 0
  fi
  local port; port="$(cfg backend.port)"
  _free_port backend "$port"
  info "Starting backend ($( $DEV && echo dev || echo prod ))"
  if $DEV; then
    start_bg backend bash -c "cd '$ROOT/web/backend' && npm run dev"
  else
    start_bg backend node "$ROOT/web/backend/dist/index.js"
  fi || die "backend failed to start; see $(logfile backend)"
  local url; url="$(_backend_url)/health"
  local rc=0
  wait_for --while-alive backend 30 curl -sf "$url" || rc=$?
  case "$rc" in
    0) ;;
    2) err "backend process exited before /health responded"
       tail -40 "$(logfile backend)" >&2
       die "backend failed to start — see $(logfile backend)" ;;
    *) err "backend did not respond on $url within 30s"
       tail -40 "$(logfile backend)" >&2
       die "backend health-check timed out" ;;
  esac
  ok "backend running (pid $(read_pid backend), $(_backend_url))"
}

start_frontend() {
  $NO_FRONTEND && return 0
  if is_running frontend; then
    ok "frontend already running (pid $(read_pid frontend))"
    return 0
  fi
  local port; port="$(_frontend_port)"
  _free_port frontend "$port"
  info "Starting frontend on :$port"
  if $DEV; then
    start_bg frontend bash -c "cd '$ROOT/web/frontend' && npm run dev -- --port $port --hostname 0.0.0.0"
  else
    start_bg frontend bash -c "cd '$ROOT/web/frontend' && npm start -- --port $port --hostname 0.0.0.0"
  fi || die "frontend failed to start; see $(logfile frontend)"
  local rc=0
  wait_for --while-alive frontend 60 curl -sf "http://127.0.0.1:$port" || rc=$?
  case "$rc" in
    0) ok "frontend running (pid $(read_pid frontend), http://127.0.0.1:$port)" ;;
    2) err "frontend process exited before :$port accepted connections"
       tail -40 "$(logfile frontend)" >&2
       die "frontend failed to start — see $(logfile frontend)" ;;
    *) warn "frontend didn't answer on :$port yet; see $(logfile frontend)" ;;
  esac
}

start_keeper() {
  $KEEPER || return 0
  : "${KEEPER_PRIVATE_KEY:?--keeper requires KEEPER_PRIVATE_KEY env}"
  # Keeper runs in-process with the backend when KEEPER_PRIVATE_KEY is in env.
  # This flag just ensures the env var is exported before start_backend. If a
  # standalone keeper binary is added later, its start_bg invocation goes here.
  export KEEPER_PRIVATE_KEY
  ok "keeper enabled (runs in-process with backend)"
}

cmd_start() {
  $DEV || _require_built
  start_keeper
  start_backend
  start_frontend
  ok "services ready — $(_backend_url)$(
    $NO_FRONTEND || echo " + http://127.0.0.1:$(_frontend_port)"
  )"
}

cmd_stop() {
  # Keeper runs in-process with backend, so there's no separate keeper pid.
  for svc in frontend backend; do
    if is_running "$svc"; then
      info "Stopping $svc"
      stop_bg "$svc"
      ok "$svc stopped"
    fi
  done
}

cmd_status() {
  local any=false
  for svc in backend frontend; do
    if is_running "$svc"; then
      echo "$svc: running (pid $(read_pid "$svc"))"
      any=true
    else
      echo "$svc: stopped"
    fi
  done
  $any
}

cmd_logs() {
  local svc="${1:-}"
  [[ -n "$svc" ]] || die "usage: $0 logs <backend|frontend>"
  case "$svc" in
    backend|frontend) ;;
    *) die "unknown service '$svc' (keeper runs in-process with backend; use 'backend')" ;;
  esac
  local f; f="$(logfile "$svc")"
  [[ -f "$f" ]] || die "no log at $f"
  tail -f "$f"
}

main() {
  parse_args "$@"
  case "$ACTION" in
    start)  cmd_start ;;
    stop)   cmd_stop ;;
    status) cmd_status ;;
    logs)   cmd_logs "${POSITIONAL[0]:-}" ;;
    *)      die "usage: $0 {start|stop|status|logs} [--dev] [--keeper] [--no-frontend]" ;;
  esac
}

main "$@"
