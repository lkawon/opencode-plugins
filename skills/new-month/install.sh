#!/bin/sh
# Install the new-month skill into OpenCode's user skills directory.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SKILLS_DIR="$HOME/.config/opencode/skills"
DEST="$SKILLS_DIR/new-month"
TEMP="$SKILLS_DIR/.new-month-install.$$"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found. Install Node.js and npm first." >&2
  exit 1
fi

mkdir -p "$SKILLS_DIR"
trap 'rm -rf "$TEMP"' EXIT INT TERM
mkdir "$TEMP"

for file in \
  .gitignore README.md SKILL.md auth.mjs install.sh login-oauth.mjs new-month.mjs \
  package.json package-lock.json repair-c.mjs run.sh verify-formulas.mjs
do
  cp "$SCRIPT_DIR/$file" "$TEMP/$file"
done

chmod +x "$TEMP/install.sh" "$TEMP/run.sh"
(cd "$TEMP" && npm install --omit=dev)
"$TEMP/run.sh" --help >/dev/null

if [ -L "$DEST" ]; then
  rm "$DEST"
elif [ -e "$DEST" ]; then
  BACKUP="${DEST}.bak.$(date +%Y%m%d%H%M%S)"
  mv "$DEST" "$BACKUP"
  echo "Existing skill moved to $BACKUP"
fi

mv "$TEMP" "$DEST"
trap - EXIT INT TERM

echo "Installed new-month skill at $DEST"
