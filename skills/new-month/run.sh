#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

find_node() {
  for candidate in \
    "${NEW_MONTH_NODE:-}" \
    "$(command -v node 2>/dev/null || true)" \
    "/opt/homebrew/opt/node@22/bin/node" \
    "/opt/homebrew/bin/node" \
    "$HOME/.local/share/google-drive-mcp/node_modules/node/bin/node"
  do
    [ -n "$candidate" ] || continue
    [ -x "$candidate" ] || continue
    major=$("$candidate" -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || true)
    if [ -n "$major" ] && [ "$major" -ge 18 ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

NODE_BIN=$(find_node) || {
  echo "Node.js >= 18 is required. Install it or set NEW_MONTH_NODE." >&2
  exit 1
}

case "${1:-}" in
  verify)
    shift
    SCRIPT="verify-formulas.mjs"
    ;;
  repair)
    shift
    SCRIPT="repair-c.mjs"
    ;;
  *)
    SCRIPT="new-month.mjs"
    ;;
esac

exec "$NODE_BIN" "$SCRIPT_DIR/$SCRIPT" "$@"
