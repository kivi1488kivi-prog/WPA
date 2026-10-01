#!/usr/bin/env bash
# Wrapper; real implementation (cross-platform): local-up.ts   →   npm run local:up
cd "$(dirname "$0")/../.." && exec npx tsx tools/local-stack/local-up.ts "$@"
