#!/usr/bin/env bash
# One-shot "install everything needed to work on this repo" script.
#
# Covers:
#   - foundry (anvil, forge, cast)
#   - node >= 20
#   - postgres (server + client)
#   - yq, jq (YAML/JSON parsers used by shell scripts)
#   - repo npm deps (workspace install)
#   - forge submodules
#   - local postgres database
#   - config.local.yaml scaffold (if missing)
#
# Supports: macOS (Homebrew) and Debian/Ubuntu (apt) and RHEL/Fedora (dnf/yum).
# On unsupported systems it prints what's missing and exits.
#
# Usage:
#   scripts/bootstrap.sh              # install everything
#   scripts/bootstrap.sh --check      # only verify, don't install
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib/log.sh"

CHECK_ONLY=false
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=true

ROOT="$(cd "$HERE/.." && pwd)"

# ────────────────────────────────────────────────────────────────────────────
# Platform detection
# ────────────────────────────────────────────────────────────────────────────
detect_platform() {
  if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "macos"
  elif command -v apt-get >/dev/null 2>&1; then
    echo "debian"
  elif command -v dnf >/dev/null 2>&1; then
    echo "fedora"
  elif command -v yum >/dev/null 2>&1; then
    echo "rhel"
  else
    echo "unknown"
  fi
}
PLATFORM="$(detect_platform)"

# Wrap package manager calls so the rest of the script reads platform-agnostic.
pkg_install() {
  case "$PLATFORM" in
    macos)          brew install "$@" ;;
    debian)         sudo apt-get install -y "$@" ;;
    fedora)         sudo dnf install -y "$@" ;;
    rhel)           sudo yum install -y "$@" ;;
    *)              die "no package manager for platform '$PLATFORM'. Install manually: $*" ;;
  esac
}

pkg_update() {
  case "$PLATFORM" in
    macos)          brew update >/dev/null 2>&1 || true ;;
    debian)         sudo apt-get update -y ;;
    fedora|rhel)    : ;;
  esac
}

# ────────────────────────────────────────────────────────────────────────────
# Individual checks + installers
# ────────────────────────────────────────────────────────────────────────────

ensure_cmd() {
  local cmd="$1"
  local human="${2:-$1}"
  local install_fn="${3:-}"
  if command -v "$cmd" >/dev/null 2>&1; then
    ok "$human found: $(command -v "$cmd")"
    return 0
  fi
  if $CHECK_ONLY; then
    warn "$human missing"
    return 1
  fi
  if [[ -z "$install_fn" ]]; then
    die "$human missing and no installer configured"
  fi
  info "Installing $human"
  "$install_fn"
  command -v "$cmd" >/dev/null 2>&1 || die "$human still not on PATH after install"
  ok "$human installed"
}

install_brew() {
  # Homebrew bootstrap (macOS only).
  info "Installing Homebrew"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
}

install_node() {
  case "$PLATFORM" in
    macos)      pkg_install node ;;
    debian)     curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
                sudo apt-get install -y nodejs ;;
    fedora|rhel)curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo -E bash -
                pkg_install nodejs ;;
    *)          die "install node manually (>=20)" ;;
  esac
}

install_postgres() {
  case "$PLATFORM" in
    macos)      pkg_install postgresql@16
                brew services start postgresql@16 ;;
    debian)     pkg_install postgresql postgresql-contrib
                sudo systemctl enable --now postgresql ;;
    fedora|rhel)pkg_install postgresql-server postgresql-contrib
                sudo postgresql-setup --initdb || true
                sudo systemctl enable --now postgresql ;;
  esac
}

install_yq()  { pkg_install yq; }
install_jq()  { pkg_install jq; }
install_curl(){ pkg_install curl; }
install_git() { pkg_install git; }

install_foundry() {
  info "Installing foundry via foundryup"
  curl -L https://foundry.paradigm.xyz | bash
  # foundryup writes to ~/.foundry/bin; add it to PATH for this session.
  export PATH="$HOME/.foundry/bin:$PATH"
  foundryup
}

# ────────────────────────────────────────────────────────────────────────────
# Flow
# ────────────────────────────────────────────────────────────────────────────

info "Platform: $PLATFORM"

# On macOS, make sure brew itself is present before we rely on pkg_install.
if [[ "$PLATFORM" == "macos" ]] && ! command -v brew >/dev/null 2>&1; then
  $CHECK_ONLY && die "Homebrew missing"
  install_brew
fi

# Refresh package lists (apt/brew) before any installs.
$CHECK_ONLY || pkg_update

# --- Required runtimes ---
ensure_cmd git     "git"      install_git
ensure_cmd curl    "curl"     install_curl
ensure_cmd node    "node"     install_node
ensure_cmd psql    "postgres client" install_postgres
ensure_cmd jq      "jq"       install_jq
ensure_cmd yq      "yq"       install_yq

# Node ≥ 20 sanity check.
if command -v node >/dev/null 2>&1; then
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  if (( node_major < 20 )); then
    $CHECK_ONLY && warn "node $node_major < 20, upgrade needed" \
      || { info "Upgrading node"; install_node; }
  fi
fi

# Foundry (anvil/forge/cast). forge is the deciding command.
if ! command -v forge >/dev/null 2>&1; then
  $CHECK_ONLY && warn "foundry (forge/anvil/cast) missing" \
    || install_foundry
else
  ok "foundry found: $(command -v forge)"
fi

# --- Repo-local setup ---
if $CHECK_ONLY; then
  warn "skipping npm install / forge install / db / config scaffold in --check mode"
  exit 0
fi

info "Installing npm workspace deps"
(cd "$ROOT" && npm install)

info "Fetching forge submodules"
(cd "$ROOT" && forge install --no-commit >/dev/null 2>&1 || true)

# Seed config files from templates BEFORE anything that reads config.yaml
# (db.sh, deploy.sh, dev.sh all call `cfg` which requires the file to exist).
if [[ ! -f "$ROOT/config.yaml" ]] && [[ -f "$ROOT/config.yaml.example" ]]; then
  cp "$ROOT/config.yaml.example" "$ROOT/config.yaml"
  ok "Created config.yaml from template"
fi
if [[ ! -f "$ROOT/config.local.yaml" ]] && [[ -f "$ROOT/config.local.yaml.example" ]]; then
  cp "$ROOT/config.local.yaml.example" "$ROOT/config.local.yaml"
  ok "Created config.local.yaml from template"
fi

info "Ensuring database exists"
"$HERE/db.sh" create || warn "db create failed — inspect above output"

ok "Bootstrap complete. Next: PRIVATE_KEY=0x... scripts/dev.sh start"
