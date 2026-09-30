#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
python3 "$ROOT/install_opencode_plugins.py" llamacpp-and-nvidia

CONFIG_HOME=${XDG_CONFIG_HOME:-"$HOME/.config"}
OPENCODE_DIR="$CONFIG_HOME/opencode"
if command -v bun >/dev/null 2>&1; then
  (cd "$OPENCODE_DIR" && bun install)
elif command -v npm >/dev/null 2>&1; then
  npm --prefix "$OPENCODE_DIR" install --no-audit --no-fund
else
  echo "Error: bun or npm is required to install TUI dependencies." >&2
  exit 1
fi

echo "Restart OpenCode to load the plugin."
