#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SESSION_FILE="/tmp/healthdost_kiosk_session.env"
SHUTDOWN_SCRIPT="$PROJECT_ROOT/scripts/pi/shutdown_kiosk.sh"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:5173}"

if [[ -f "$SESSION_FILE" ]]; then
  "$SHUTDOWN_SCRIPT" >/dev/null 2>&1 || true
fi

SERVER_CMD="cd \"$PROJECT_ROOT/server\" && npm run start"
FRONTEND_CMD="cd \"$PROJECT_ROOT/frontend\" && npm run dev"

if command -v lxterminal >/dev/null 2>&1; then
  lxterminal --title="HealthDost Server" --command="bash -lc '$SERVER_CMD'" &
  SERVER_TERM_PID=$!
  lxterminal --title="HealthDost Frontend" --command="bash -lc '$FRONTEND_CMD'" &
  FRONTEND_TERM_PID=$!
elif command -v x-terminal-emulator >/dev/null 2>&1; then
  x-terminal-emulator -T "HealthDost Server" -e bash -lc "$SERVER_CMD" &
  SERVER_TERM_PID=$!
  x-terminal-emulator -T "HealthDost Frontend" -e bash -lc "$FRONTEND_CMD" &
  FRONTEND_TERM_PID=$!
else
  echo "No supported terminal emulator found (lxterminal/x-terminal-emulator)." >&2
  exit 1
fi

sleep 6

CHROMIUM_BIN="chromium-browser"
if ! command -v "$CHROMIUM_BIN" >/dev/null 2>&1; then
  CHROMIUM_BIN="chromium"
fi
if ! command -v "$CHROMIUM_BIN" >/dev/null 2>&1; then
  echo "Chromium not found (checked chromium-browser and chromium)." >&2
  exit 1
fi

"$CHROMIUM_BIN" \
  --kiosk \
  --start-fullscreen \
  --noerrdialogs \
  --disable-infobars \
  "$FRONTEND_URL" >/dev/null 2>&1 &
CHROMIUM_PID=$!

cat > "$SESSION_FILE" <<EOF
SERVER_TERM_PID=$SERVER_TERM_PID
FRONTEND_TERM_PID=$FRONTEND_TERM_PID
CHROMIUM_PID=$CHROMIUM_PID
STARTED_AT=$(date +%s)
FRONTEND_URL=$FRONTEND_URL
PROJECT_ROOT=$PROJECT_ROOT
EOF

exit 0

