#!/usr/bin/env bash
set -euo pipefail

SESSION_FILE="/tmp/healthdost_kiosk_session.env"

terminate_pid() {
  local pid="$1"
  if [[ -z "${pid:-}" ]]; then
    return 0
  fi
  if ! kill -0 "$pid" >/dev/null 2>&1; then
    return 0
  fi
  kill -TERM "$pid" >/dev/null 2>&1 || true
  sleep 1
  if kill -0 "$pid" >/dev/null 2>&1; then
    kill -KILL "$pid" >/dev/null 2>&1 || true
  fi
}

terminate_tree() {
  local root_pid="$1"
  [[ -z "${root_pid:-}" ]] && return 0
  if ! kill -0 "$root_pid" >/dev/null 2>&1; then
    return 0
  fi
  # Kill children first, then parent.
  while IFS= read -r child; do
    [[ -z "$child" ]] && continue
    terminate_tree "$child"
  done < <(pgrep -P "$root_pid" || true)
  terminate_pid "$root_pid"
}

terminate_matching() {
  local pattern="$1"
  if [[ -z "$pattern" ]]; then
    return 0
  fi
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    terminate_pid "$pid"
  done < <(pgrep -f "$pattern" || true)
}

# Load session vars when available, but continue with fallback cleanup regardless.
if [[ -f "$SESSION_FILE" ]]; then
  source "$SESSION_FILE" || true
  terminate_tree "${CHROMIUM_PID:-}"
  terminate_tree "${FRONTEND_TERM_PID:-}"
  terminate_tree "${SERVER_TERM_PID:-}"
fi

# Fallback cleanup: terminal emulators may fork, so kill known process patterns too.
PROJECT_ROOT="${PROJECT_ROOT:-$HOME/Downloads/final_healthdost-sensors}"
terminate_matching "HealthDost Server"
terminate_matching "HealthDost Frontend"
terminate_matching "$PROJECT_ROOT/server"
terminate_matching "$PROJECT_ROOT/frontend"
terminate_matching "npm run start"
terminate_matching "npm run dev"
terminate_matching "vite"
terminate_matching "lxterminal --title=HealthDost"
terminate_matching "chromium.*--kiosk"
terminate_matching "chromium-browser.*--kiosk"
terminate_matching "chromium.*${FRONTEND_URL:-http://localhost:5173}"
terminate_matching "chromium-browser.*${FRONTEND_URL:-http://localhost:5173}"
terminate_matching "^/usr/lib/chromium/chromium "
terminate_matching "chrome_crashpad_handler"

rm -f "$SESSION_FILE"
exit 0

