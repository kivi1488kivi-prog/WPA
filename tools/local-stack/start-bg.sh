#!/usr/bin/env bash
# Wrapper; real implementation (cross-platform): start-bg.ts   →   npm run local:start / local:stop
cd "$(dirname "$0")/../.." && exec npx tsx tools/local-stack/start-bg.ts "$@"
