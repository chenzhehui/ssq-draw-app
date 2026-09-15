#!/usr/bin/env bash
# Headless Linux launcher. No root, desktop, pip, or public listener required.
set -euo pipefail
umask 077

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
ACTION="${1:-start}"
RUN="$ROOT/.run"
PID_FILE="$RUN/server.pid"
LOG="$RUN/server.log"
PYTHON="${PYTHON:-python3}"
PORT="${PORT:-8765}"

fail() { printf '%s\n' "$*" >&2; exit 1; }
case "$ACTION" in
    help|--help|-h)
        printf 'Usage: bash deploy.sh [start|stop|restart|status|logs]\n'
        printf 'Optional on start: PORT=18765 PYTHON=python3 bash deploy.sh start\n'
        exit 0 ;;
    start|stop|restart|status|logs) ;;
    *) fail "Unknown command: $ACTION. Use: bash deploy.sh help" ;;
esac
[[ "$(uname -s)" == Linux ]] || fail 'This launcher requires Linux.'
command -v flock >/dev/null || fail 'flock is required (usually provided by util-linux).'
mkdir -p -- "$RUN"
exec 9>"$RUN/control.lock"
flock -w 10 9 || fail 'Another deployment command is running. Try again shortly.'

# Verify both process start time and the absolute application path before signalling.
running() {
    [[ -f "$PID_FILE" ]] || return 1
    read -r pid started port < "$PID_FILE" || return 1
    [[ "$pid" =~ ^[0-9]+$ && "$started" =~ ^[0-9]+$ && "$port" =~ ^[0-9]+$ ]] || return 1
    [[ -r "/proc/$pid/stat" && -r "/proc/$pid/cmdline" ]] || return 1
    local stat
    local -a fields argv
    IFS= read -r stat < "/proc/$pid/stat" || return 1
    read -r -a fields <<< "${stat##*) }"
    [[ "${fields[0]:-Z}" != Z && "${fields[19]:-}" == "$started" ]] || return 1
    mapfile -d '' -t argv < "/proc/$pid/cmdline" || return 1
    [[ "${argv[4]:-}" == "$ROOT/app.py" ]]
}

show_access() {
    printf 'Running: PID %s, http://127.0.0.1:%s\n' "$pid" "$port"
    printf 'On your own computer, use the same local and remote port:\n'
    printf '  ssh -N -o ExitOnForwardFailure=yes -L %s:127.0.0.1:%s USER@SERVER\n' "$port" "$port"
    printf 'Then open http://127.0.0.1:%s in your local browser.\n' "$port"
}

stop_server() {
    if ! running; then
        printf 'Not running (no matching managed process).\n'
        return
    fi
    kill -TERM "$pid" || fail 'Could not stop the process; check ownership.'
    for ((i=0; i<50; i++)); do
        if ! running; then
            rm -f -- "$PID_FILE"
            printf 'Stopped.\n'
            return
        fi
        sleep 0.1
    done
    fail 'Process has not stopped. No forced kill was sent; inspect it manually.'
}

start_server() {
    if running; then printf 'Already running.\n'; show_access; return; fi
    command -v "$PYTHON" >/dev/null || fail 'Install Python 3.10+ first, or set PYTHON=/path/to/python3.'
    "$PYTHON" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || fail 'Python 3.10+ is required.'
    "$PYTHON" -c 'import sys; p=sys.argv[1]; sys.exit(0 if p.isascii() and p.isdigit() and 1024 <= int(p) <= 65535 else 1)' "$PORT" || fail 'PORT must be an integer from 1024 to 65535.'
    [[ -f "$ROOT/app.py" && -f "$ROOT/engine.py" && -f "$ROOT/static/index.html" ]] || fail 'Upload the entire ssq-draw-app directory first.'
    command -v nohup >/dev/null || fail 'nohup is required (usually provided by coreutils).'
    printf '\n--- Starting %s ---\n' "$(date -Is)" >> "$LOG"
    nohup "$PYTHON" -u -X utf8 "$ROOT/app.py" --strict-port --port "$PORT" < /dev/null >> "$LOG" 2>&1 9>&- &
    pid=$!
    local stat
    local -a fields
    if ! IFS= read -r stat < "/proc/$pid/stat"; then fail "Startup failed. Read $LOG"; fi
    read -r -a fields <<< "${stat##*) }"
    printf '%s %s %s\n' "$pid" "${fields[19]}" "$PORT" > "$PID_FILE"
    for ((i=0; i<30; i++)); do
        sleep 0.2
        if ! running; then tail -n 15 -- "$LOG" >&2; fail 'Startup failed. No fallback port was selected.'; fi
        if "$PYTHON" - "$PORT" <<'PY' 2>/dev/null
import json
import sys
from urllib.request import ProxyHandler, build_opener
with build_opener(ProxyHandler({})).open('http://127.0.0.1:' + sys.argv[1] + '/api/state', timeout=0.5) as response:
    sys.exit(0 if json.load(response).get('app_id') == 'ssq-local-draw' else 1)
PY
        then
            if running; then show_access; printf 'Log: %s\n' "$LOG"; return; fi
        fi
    done
    stop_server
    fail "Health check failed; the managed process was stopped. Read $LOG"
}

case "$ACTION" in
    start) start_server ;;
    stop) stop_server ;;
    restart) stop_server; start_server ;;
    status) if running; then show_access; else printf 'Not running.\n'; exit 3; fi ;;
    logs) if [[ -f "$LOG" ]]; then tail -n 100 -- "$LOG"; else printf 'No log yet.\n'; fi ;;
esac
