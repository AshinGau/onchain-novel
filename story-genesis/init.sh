#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Ensure local node is running
if [ ! -f "$ROOT/.local-node/env" ]; then
  echo "Error: local node not running. Start it first:"
  echo "  ./script/local-node.sh start"
  exit 1
fi

echo "=== Initializing 34 story-genesis novels on local chain ==="
echo ""

node "$SCRIPT_DIR/create-novels.mjs"
