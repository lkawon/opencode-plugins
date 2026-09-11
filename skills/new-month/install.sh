#!/bin/sh
# Install the new-month skill into OpenCode's user skills directory.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SKILLS_DIR="$HOME/.config/opencode/skills"
DEST="$SKILLS_DIR/new-month"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found. Run 'npm install' in $SCRIPT_DIR manually." >&2
  exit 1
fi

(cd "$SCRIPT_DIR" && npm install --omit=dev)
"$SCRIPT_DIR/run.sh" --help >/dev/null

mkdir -p "$SKILLS_DIR"

if [ -L "$DEST" ]; then
  rm "$DEST"
elif [ -e "$DEST" ]; then
  BACKUP="${DEST}.bak.$(date +%Y%m%d%H%M%S)"
  mv "$DEST" "$BACKUP"
  echo "Existing skill moved to $BACKUP"
fi

ln -s "$SCRIPT_DIR" "$DEST"

echo "Installed new-month skill at $DEST"
