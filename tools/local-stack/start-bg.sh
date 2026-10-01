#!/usr/bin/env bash
# Start/restart the local stack in the background (pid in .local-stack/pid).
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p .local-stack
if [[ -f .local-stack/pid ]] && kill -0 "$(cat .local-stack/pid)" 2>/dev/null; then kill "$(cat .local-stack/pid)"; sleep 0.5; fi
set -a; [[ -f .env.local ]] && . ./.env.local; set +a
nohup node --import tsx tools/local-stack/server.ts > .local-stack/server.log 2>&1 &
echo $! > .local-stack/pid
for i in $(seq 1 40); do curl -sf "http://localhost:${LOCAL_STACK_PORT:-54321}/health" >/dev/null && { echo "local stack up (pid $(cat .local-stack/pid))"; exit 0; }; sleep 0.25; done
echo "local stack failed to start"; cat .local-stack/server.log; exit 1
