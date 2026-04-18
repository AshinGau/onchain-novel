#!/usr/bin/env bash
# Manage a local anvil node. Reads the RPC URL from config.yaml so the port
# matches what every other service expects.
#
# Usage:
#   scripts/anvil.sh start    # idempotent
#   scripts/anvil.sh stop
#   scripts/anvil.sh status   # exit 0 if running, 1 otherwise
#   scripts/anvil.sh reset    # stop, wipe state, start fresh
#   scripts/anvil.sh logs     # tail -f the log
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib/log.sh"
source "$HERE/lib/pidfile.sh"
source "$HERE/lib/read-config.sh"

NAME="anvil"
STATE_FILE="$STATE_DIR/anvil-state.json"

_anvil_port() {
  local url
  url="$(cfg chain.rpcUrl)"
  # Extract port from URL. Default 8545.
  local port
  port="$(echo "$url" | sed -nE 's|.*:([0-9]+).*|\1|p')"
  echo "${port:-8545}"
}

_anvil_cmd() {
  command -v anvil >/dev/null 2>&1 || die "anvil not installed (run scripts/bootstrap.sh)"
}

cmd_start() {
  _anvil_cmd
  if is_running "$NAME"; then
    ok "anvil already running (pid $(read_pid "$NAME"))"
    return 0
  fi
  local port
  port="$(_anvil_port)"
  # --state makes anvil persist chain state to a file on shutdown and restore
  # it on startup, so `anvil.sh stop` + `anvil.sh start` resumes the chain at
  # the same block. `anvil.sh reset` explicitly removes the file.
  info "Starting anvil on port $port (state: $STATE_FILE)"
  start_bg "$NAME" anvil --host 0.0.0.0 --port "$port" --block-time 1 --silent --state "$STATE_FILE" \
    || die "anvil failed to start; see $(logfile "$NAME")"
  # Wait for JSON-RPC readiness.
  if ! wait_for 10 cast block-number --rpc-url "http://127.0.0.1:$port"; then
    die "anvil did not accept RPC within 10s"
  fi
  ok "anvil running (pid $(read_pid "$NAME"), port $port)"
}

cmd_stop() {
  if is_running "$NAME"; then
    info "Stopping anvil"
    stop_bg "$NAME"
    ok "anvil stopped"
  else
    ok "anvil already stopped"
  fi
}

cmd_status() {
  if is_running "$NAME"; then
    echo "running (pid $(read_pid "$NAME"), port $(_anvil_port))"
    return 0
  fi
  echo "stopped"
  return 1
}

cmd_reset() {
  cmd_stop
  # Wipe the persisted chain state so the next `start` begins from block 0.
  rm -f "$STATE_FILE"
  ok "anvil state wiped"
  cmd_start
}

cmd_logs() {
  local f
  f="$(logfile "$NAME")"
  [[ -f "$f" ]] || die "no log at $f"
  tail -f "$f"
}

main() {
  local action="${1:-}"
  case "$action" in
    start)   cmd_start ;;
    stop)    cmd_stop ;;
    status)  cmd_status ;;
    reset)   cmd_reset ;;
    logs)    cmd_logs ;;
    *)       die "usage: $0 {start|stop|status|reset|logs}" ;;
  esac
}

main "$@"
