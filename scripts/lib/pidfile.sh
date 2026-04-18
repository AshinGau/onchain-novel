#!/usr/bin/env bash
# Shared start/stop/status primitives built on top of pidfiles.
#
# Every managed service has:
#   .local-node/pids/<name>.pid   — pid of the running process
#   .local-node/logs/<name>.log   — combined stdout+stderr
#
# Usage from another script:
#   source "$(dirname "${BASH_SOURCE[0]}")/lib/pidfile.sh"
#   start_bg anvil "anvil --port 8545"
#   stop_bg anvil
#   is_running anvil && echo "up"

if [[ -n "${__ONC_PIDFILE_SH_SOURCED:-}" ]]; then return; fi
__ONC_PIDFILE_SH_SOURCED=1

# Resolve the repo root regardless of CWD. Walks up until it finds config.yaml
# or foundry.toml (the same anchors the TS config loader uses).
_find_repo_root() {
  local dir
  dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  while [[ "$dir" != "/" ]]; do
    if [[ -f "$dir/config.yaml" ]] || [[ -f "$dir/foundry.toml" ]]; then
      echo "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}

REPO_ROOT="$(_find_repo_root)" || { echo "error: could not find repo root" >&2; exit 1; }
STATE_DIR="$REPO_ROOT/.local-node"
PID_DIR="$STATE_DIR/pids"
LOG_DIR="$STATE_DIR/logs"
mkdir -p "$PID_DIR" "$LOG_DIR"

pidfile()  { echo "$PID_DIR/$1.pid"; }
logfile()  { echo "$LOG_DIR/$1.log"; }

read_pid() {
  local f
  f="$(pidfile "$1")"
  [[ -f "$f" ]] && cat "$f" || echo ""
}

is_running() {
  local pid
  pid="$(read_pid "$1")"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

# Return 0 and print the PID if something is listening on $1; else return 1.
# Used to detect orphans that outlived a prior run's pidfile (e.g. npm wrapper
# killed but the child next-server kept the port).
port_listener_pid() {
  local port="$1"
  command -v lsof >/dev/null 2>&1 || return 1
  lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1
}

# start_bg <name> <command…>
# Starts the command in the background, captures its pid, redirects output.
# If already running, returns 0 immediately (idempotent).
start_bg() {
  local name="$1"; shift
  if is_running "$name"; then
    return 0
  fi
  # Clear stale pidfile
  rm -f "$(pidfile "$name")"
  # Start detached, inherit env
  nohup "$@" >"$(logfile "$name")" 2>&1 &
  echo $! > "$(pidfile "$name")"
  # Give the process a moment to fail fast
  sleep 0.2
  is_running "$name"
}

# Collect a pid + all its descendants (depth-first). Used by stop_bg, since
# `bash -c "... npm run dev"` spawns npm → node → next-server; killing only
# the bash wrapper orphans the inner node process and leaves the port bound.
_collect_tree() {
  local root="$1"
  local child
  for child in $(pgrep -P "$root" 2>/dev/null); do
    _collect_tree "$child"
  done
  echo "$root"
}

# stop_bg <name> [signal]
# Graceful TERM to the whole process tree, escalate to KILL if anything
# lingers past the grace window.
stop_bg() {
  local name="$1"
  local sig="${2:-TERM}"
  local pid
  pid="$(read_pid "$name")"
  if [[ -z "$pid" ]]; then
    return 0
  fi
  if kill -0 "$pid" 2>/dev/null; then
    local pids; pids="$(_collect_tree "$pid")"
    # Send TERM to all; ignore errors (some may exit mid-loop).
    local p
    for p in $pids; do kill "-$sig" "$p" 2>/dev/null || true; done
    # Wait up to 5s for the root to die; good enough proxy for tree shutdown.
    for _ in $(seq 1 50); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
    # Re-collect (some children may have re-parented to init) and KILL anything still alive.
    pids="$(_collect_tree "$pid" 2>/dev/null || true)"
    for p in $pids; do
      kill -0 "$p" 2>/dev/null && kill -KILL "$p" 2>/dev/null || true
    done
  fi
  rm -f "$(pidfile "$name")"
}

# Wait for a command to return 0, or give up after N seconds.
# wait_for [--while-alive <svc>] <timeout-seconds> <cmd…>
# If --while-alive <svc> is given, abort early (exit 2) once the managed
# service is no longer running — catches "bound to port but crashed" fast
# instead of wasting the full timeout on a dead process.
wait_for() {
  local guard_svc=""
  if [[ "$1" == "--while-alive" ]]; then
    guard_svc="$2"; shift 2
  fi
  local timeout="$1"; shift
  local elapsed=0
  while (( elapsed < timeout * 10 )); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    if [[ -n "$guard_svc" ]] && ! is_running "$guard_svc"; then
      return 2
    fi
    sleep 0.1
    elapsed=$((elapsed + 1))
  done
  return 1
}
