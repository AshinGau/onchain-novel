#!/usr/bin/env bash
# =============================================================================
# Local Development Node
#
# Usage:
#   ./script/local-node.sh start   — Start Anvil + deploy contracts + start web backend
#   ./script/local-node.sh stop    — Stop all services
#   ./script/local-node.sh reset   — Clear all data (Anvil state + database) and restart
#   ./script/local-node.sh status  — Show running services
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/web/backend"
FRONTEND_DIR="$ROOT_DIR/web/frontend"
DATA_DIR="$ROOT_DIR/.local-node"
ANVIL_STATE="$DATA_DIR/anvil-state.json"
PID_FILE="$DATA_DIR/pids"
DEPLOY_FLAG="$DATA_DIR/deployed"
ENV_FILE="$DATA_DIR/env"

# ── Config ──
RPC="http://localhost:8545"
DB_NAME="onchain_novel_local"
DB_URL="postgresql://localhost:5432/$DB_NAME"
API_PORT=3001
FRONTEND_PORT=3000

# Anvil default mnemonic
ANVIL_MNEMONIC="test test test test test test test test test test test junk"

# ── Colors ──
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info() { echo -e "${YELLOW}[INFO]${NC} $1"; }
ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; }

# ── PID management ──
save_pid() { echo "$1=$2" >> "$PID_FILE"; }
read_pid() { grep "^$1=" "$PID_FILE" 2>/dev/null | tail -1 | cut -d= -f2; }

is_running() {
    local pid=$(read_pid "$1")
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

kill_service() {
    local name="$1"
    local pid=$(read_pid "$name")
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        # Kill child processes first (next dev / tsx spawn workers)
        pkill -P "$pid" 2>/dev/null || true
        kill "$pid" 2>/dev/null || true
        wait "$pid" 2>/dev/null || true
        ok "Stopped $name (pid $pid)"
    fi
}

# =============================================================================
# STOP
# =============================================================================
do_stop() {
    info "Stopping services..."
    if [ -f "$PID_FILE" ]; then
        kill_service "frontend"
        kill_service "backend"
        kill_service "anvil"
        rm -f "$PID_FILE"
    else
        info "No PID file found, nothing to stop"
    fi
}

# =============================================================================
# STATUS
# =============================================================================
do_status() {
    echo ""
    if is_running "anvil"; then
        ok "Anvil running (pid $(read_pid anvil)) — $RPC"
    else
        err "Anvil not running"
    fi
    if is_running "backend"; then
        ok "Backend running (pid $(read_pid backend)) — http://localhost:$API_PORT"
        local health
        health=$(curl -sf "http://localhost:$API_PORT/health" 2>/dev/null) || true
        if [ -n "$health" ]; then
            local block=$(echo "$health" | jq -r '.indexer.lastBlock' 2>/dev/null)
            info "Indexer at block $block"
        fi
    else
        err "Backend not running"
    fi
    if is_running "frontend"; then
        ok "Frontend running (pid $(read_pid frontend)) — http://localhost:$FRONTEND_PORT"
    else
        err "Frontend not running"
    fi
    echo ""
}

RPC_API="http://localhost:$API_PORT"

# =============================================================================
# RESET
# =============================================================================
do_reset() {
    info "Resetting all local data..."
    do_stop
    rm -rf "$DATA_DIR"
    dropdb --if-exists "$DB_NAME" 2>/dev/null || true
    ok "Cleared Anvil state, database, and deploy flags"
    info "Run './script/local-node.sh start' to start fresh"
}

# =============================================================================
# FRONTEND (reusable)
# =============================================================================
start_frontend() {
    # Need contract addresses
    if [ ! -f "$ENV_FILE" ]; then
        err "Contracts not deployed yet. Run './script/local-node.sh start' first."
        exit 1
    fi
    source "$ENV_FILE"

    if is_running "frontend"; then
        ok "Frontend already running (pid $(read_pid frontend))"
        return
    fi

    info "Starting frontend..."
    cd "$FRONTEND_DIR"
    NEXT_PUBLIC_API_URL="http://localhost:$API_PORT" \
    NEXT_PUBLIC_RPC_URL="$RPC" \
    NEXT_PUBLIC_CHAIN=foundry \
    NEXT_PUBLIC_NOVEL_CORE_ADDRESS="$NOVEL_CORE_ADDRESS" \
    NEXT_PUBLIC_VOTING_ENGINE_ADDRESS="$VOTING_ENGINE_ADDRESS" \
    NEXT_PUBLIC_PRIZE_POOL_ADDRESS="$PRIZE_POOL_ADDRESS" \
    npx next dev --port "$FRONTEND_PORT" > "$DATA_DIR/frontend.log" 2>&1 &
    save_pid "frontend" "$!"
    cd "$ROOT_DIR"

    for i in $(seq 1 30); do
        if curl -sf "http://localhost:$FRONTEND_PORT" &>/dev/null; then break; fi
        sleep 1
    done

    if ! curl -sf "http://localhost:$FRONTEND_PORT" &>/dev/null; then
        err "Frontend failed to start. Logs:"
        tail -20 "$DATA_DIR/frontend.log"
        exit 1
    fi
    ok "Frontend running on http://localhost:$FRONTEND_PORT"
}

stop_frontend() {
    kill_service "frontend"
}

# =============================================================================
# START
# =============================================================================
do_start() {
    mkdir -p "$DATA_DIR"

    # Check if already runnings
    if is_running "anvil" && is_running "backend" && is_running "frontend"; then
        ok "All services already running"
        do_status
        return
    fi

    # Stop stale processes
    do_stop 2>/dev/null

    # ── Check dependencies ──
    for cmd in anvil cast forge node npx jq createdb psql; do
        if ! command -v "$cmd" &>/dev/null; then
            err "Required command '$cmd' not found"
            [ "$cmd" = "createdb" ] && echo "  Install PostgreSQL: brew install postgresql@16 && brew services start postgresql@16"
            exit 1
        fi
    done

    # ── Start Anvil ──
    info "Starting Anvil..."
    if [ -f "$ANVIL_STATE" ]; then
        info "Loading saved state from $ANVIL_STATE"
        anvil --block-time 1 --state "$ANVIL_STATE" --silent &
    else
        info "Fresh Anvil instance"
        anvil --block-time 1 --state "$ANVIL_STATE" --silent &
    fi
    local anvil_pid=$!
    save_pid "anvil" "$anvil_pid"
    sleep 2

    if ! cast block-number --rpc-url "$RPC" &>/dev/null; then
        err "Anvil failed to start"
        exit 1
    fi
    local block=$(cast block-number --rpc-url "$RPC" 2>/dev/null)
    ok "Anvil running on $RPC (block $block)"

    # ── Ensure database exists ──
    if ! psql -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
        info "Creating database $DB_NAME..."
        createdb "$DB_NAME"
        for f in "$BACKEND_DIR"/migrations/*.sql; do
            psql -q "$DB_URL" < "$f" > /dev/null 2>&1
        done
        ok "Database created and migrated"
    else
        # Run migrations idempotently (all use IF NOT EXISTS)
        for f in "$BACKEND_DIR"/migrations/*.sql; do
            psql -q "$DB_URL" < "$f" > /dev/null 2>&1
        done
        ok "Database $DB_NAME exists (migrations applied)"
    fi

    # ── Deploy contracts (only if not yet deployed) ──
    if [ ! -f "$DEPLOY_FLAG" ]; then
        info "Deploying contracts..."
        cd "$ROOT_DIR"

        PK_DEPLOYER="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
        PRIVATE_KEY="$PK_DEPLOYER" forge script script/Deploy.s.sol \
            --rpc-url "$RPC" --broadcast > /dev/null 2>&1

        BROADCAST_JSON="broadcast/Deploy.s.sol/31337/run-latest.json"
        if [ ! -f "$BROADCAST_JSON" ]; then
            err "Deploy failed — broadcast JSON not found"
            exit 1
        fi

        CREATES=$(jq -r '[.transactions[] | select(.transactionType == "CREATE") | .contractAddress] | .[]' "$BROADCAST_JSON")
        CREATES_ARR=($CREATES)
        NOVEL_CORE="${CREATES_ARR[4]}"
        VOTING_ENGINE="${CREATES_ARR[5]}"
        PRIZE_POOL="${CREATES_ARR[6]}"
        CHAPTER_NFT="${CREATES_ARR[7]}"

        # Set keeper reward
        cast send --rpc-url "$RPC" --private-key "$PK_DEPLOYER" "$NOVEL_CORE" \
            "setKeeperRewardAmount(uint256)" "10000000000000" --json > /dev/null 2>&1

        # Save addresses
        cat > "$ENV_FILE" <<EOF
NOVEL_CORE_ADDRESS=$NOVEL_CORE
VOTING_ENGINE_ADDRESS=$VOTING_ENGINE
PRIZE_POOL_ADDRESS=$PRIZE_POOL
CHAPTER_NFT_ADDRESS=$CHAPTER_NFT
EOF
        touch "$DEPLOY_FLAG"
        ok "Contracts deployed"
    else
        ok "Contracts already deployed (reusing)"
    fi

    # Load contract addresses
    source "$ENV_FILE"

    # ── Start Backend ──
    info "Starting backend..."
    cd "$BACKEND_DIR"
    DATABASE_URL="$DB_URL" \
    RPC_URL="$RPC" \
    NOVEL_CORE_ADDRESS="$NOVEL_CORE_ADDRESS" \
    VOTING_ENGINE_ADDRESS="$VOTING_ENGINE_ADDRESS" \
    PRIZE_POOL_ADDRESS="$PRIZE_POOL_ADDRESS" \
    CHAPTER_NFT_ADDRESS="$CHAPTER_NFT_ADDRESS" \
    INDEXER_START_BLOCK=0 \
    INDEXER_BATCH_SIZE=100 \
    INDEXER_POLL_INTERVAL_MS=2000 \
    PORT=$API_PORT \
    npx tsx src/index.ts > "$DATA_DIR/backend.log" 2>&1 &
    local backend_pid=$!
    save_pid "backend" "$backend_pid"
    cd "$ROOT_DIR"

    # Wait for backend
    for i in $(seq 1 15); do
        if curl -sf "http://localhost:$API_PORT/health" &>/dev/null; then break; fi
        sleep 1
    done

    if ! curl -sf "http://localhost:$API_PORT/health" &>/dev/null; then
        err "Backend failed to start. Logs:"
        tail -20 "$DATA_DIR/backend.log"
        exit 1
    fi
    ok "Backend running on http://localhost:$API_PORT"

    start_frontend

    # ══════════════════════════════════════════════════════════════
    # Print connection info
    # ══════════════════════════════════════════════════════════════
    echo ""
    echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  Local Development Node Running${NC}"
    echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  ${GREEN}Frontend:${NC}     http://localhost:$FRONTEND_PORT  ← open in browser"
    echo -e "  ${GREEN}Backend API:${NC}  http://localhost:$API_PORT"
    echo -e "  ${GREEN}Anvil RPC:${NC}    $RPC"
    echo -e "  ${GREEN}Health:${NC}       http://localhost:$API_PORT/health"
    echo ""
    echo -e "  ${GREEN}Contracts:${NC}"
    echo "    NovelCore:     $NOVEL_CORE_ADDRESS"
    echo "    VotingEngine:  $VOTING_ENGINE_ADDRESS"
    echo "    PrizePool:     $PRIZE_POOL_ADDRESS"
    echo "    ChapterNFT:    $CHAPTER_NFT_ADDRESS"
    echo ""
    echo -e "${CYAN}──────────────────────────────────────────────────────────────${NC}"
    echo -e "${CYAN}  MetaMask Setup${NC}"
    echo -e "${CYAN}──────────────────────────────────────────────────────────────${NC}"
    echo ""
    echo "  1. Add Network in MetaMask:"
    echo "     Network Name:  Anvil Local"
    echo "     RPC URL:       $RPC"
    echo "     Chain ID:      31337"
    echo "     Currency:      ETH"
    echo ""
    echo "  2. Import Test Accounts (use private key import):"
    echo ""
    echo "     Mnemonic (all accounts):"
    echo "       $ANVIL_MNEMONIC"
    echo ""
    echo "     Or import individual private keys:"
    echo "     ┌──────────┬────────────────────────────────────────────────────────────────────┬──────────┐"
    echo "     │ Role     │ Private Key                                                        │ ETH      │"
    echo "     ├──────────┼────────────────────────────────────────────────────────────────────┼──────────┤"
    echo "     │ Deployer │ 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 │ 10000    │"
    echo "     │ Creator  │ 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d │ 10000    │"
    echo "     │ Writer A │ 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a │ 10000    │"
    echo "     │ Writer B │ 0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6 │ 10000    │"
    echo "     │ Voter A  │ 0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a │ 10000    │"
    echo "     │ Voter B  │ 0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba │ 10000    │"
    echo "     │ Keeper   │ 0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e │ 10000    │"
    echo "     └──────────┴────────────────────────────────────────────────────────────────────┴──────────┘"
    echo ""
    echo -e "${CYAN}──────────────────────────────────────────────────────────────${NC}"
    echo "  Logs:"
    echo "    Backend:  tail -f $DATA_DIR/backend.log"
    echo "    Frontend: tail -f $DATA_DIR/frontend.log"
    echo ""
    echo "  Commands:"
    echo "    ./script/local-node.sh stop     Stop all services (data preserved)"
    echo "    ./script/local-node.sh reset    Clear all data and stop"
    echo "    ./script/local-node.sh status   Show running services"
    echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
    echo ""
}

# =============================================================================
# MAIN
# =============================================================================
case "${1:-}" in
    start)            do_start ;;
    stop)             do_stop ;;
    reset)            do_reset ;;
    status)           do_status ;;
    start-frontend)   start_frontend ;;
    stop-frontend)    stop_frontend ;;
    restart-frontend) stop_frontend; sleep 1; start_frontend ;;
    *)
        echo "Usage: $0 <command>"
        echo ""
        echo "  start             Start all (Anvil + contracts + backend + frontend)"
        echo "  stop              Stop all services (preserves data)"
        echo "  reset             Clear all data and stop services"
        echo "  status            Show running services"
        echo "  start-frontend    Start frontend only"
        echo "  stop-frontend     Stop frontend only"
        echo "  restart-frontend  Restart frontend (useful after code changes)"
        exit 1
        ;;
esac
