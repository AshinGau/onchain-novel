#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Contracts must be deployed — scripts/deploy.sh writes addresses into config.yaml.
if ! command -v yq >/dev/null 2>&1; then
  echo "Error: yq not installed. Run ./scripts/bootstrap.sh first."
  exit 1
fi

NOVEL_CORE="$(yq eval '.contracts.novelCore' "$ROOT/config.yaml")"
if [[ -z "$NOVEL_CORE" ]] || [[ "$NOVEL_CORE" == "null" ]] || [[ "$NOVEL_CORE" == "\"\"" ]]; then
  echo "Error: contracts.novelCore empty in config.yaml. Start the stack first:"
  echo "  ./scripts/dev.sh start"
  exit 1
fi

echo "=== Initializing 34 story-genesis novels on local chain ==="
echo ""

node "$SCRIPT_DIR/create-novels.mjs"
