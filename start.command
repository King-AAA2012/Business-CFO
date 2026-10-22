#!/bin/bash
# AI Business CFO launcher for macOS (and Linux). Double-click in Finder, or run: ./start.command
cd "$(dirname "$0")" || exit 1
PORT="${PORT:-4600}"

pause() { read -r -p "Press Enter to close this window..." _; }
open_url() { if command -v open >/dev/null; then open "$1"; elif command -v xdg-open >/dev/null; then xdg-open "$1" >/dev/null 2>&1; fi; }

echo ""
echo "  AI Business CFO"
echo "  ---------------"

# Homebrew installs Node outside the default PATH of Finder-launched shells.
for p in /opt/homebrew/bin /usr/local/bin; do [ -d "$p" ] && PATH="$p:$PATH"; done
export PATH

if ! command -v node >/dev/null; then
  echo "  Node.js is not installed."
  if command -v brew >/dev/null; then
    read -r -p "  Install it now with Homebrew? [Y/n] " a
    if [[ ! "$a" =~ ^[Nn] ]]; then brew install node || { pause; exit 1; }; fi
  fi
  if ! command -v node >/dev/null; then
    echo "  Download the LTS installer from https://nodejs.org, install it, then double-click start.command again."
    open_url "https://nodejs.org/en/download"
    pause; exit 1
  fi
fi

if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a<22||(a===22&&b<13)||(a===23&&b<4)?1:0)'; then
  echo "  Your Node.js $(node -v) is too old. Version 22.13 or newer is needed."
  echo "  Install the LTS version from https://nodejs.org (or run: brew upgrade node), then try again."
  open_url "https://nodejs.org/en/download"
  pause; exit 1
fi

if [ ! -d node_modules ]; then
  echo "  First run: installing components (needs internet, about a minute)..."
  npm install --no-fund --no-audit || { echo "  Install failed. Check your internet connection and try again."; pause; exit 1; }
fi

echo "  Starting... keep this window open while you use the app. Close it (or press Ctrl+C) to stop."
(sleep 2; open_url "http://localhost:$PORT") &
PORT="$PORT" node server/index.js
pause
