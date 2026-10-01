#!/usr/bin/env bash
# Thin wrapper kept for the bash-based test scripts. Real implementation (cross-platform): reset-local.ts
cd "$(dirname "$0")/../.." && exec npx tsx scripts/db/reset-local.ts "$@"
