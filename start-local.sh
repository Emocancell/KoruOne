#!/usr/bin/env bash
set -euo pipefail
docker compose up -d
printf 'Infrastructure started. See 05-PLATFORM/deployment/README.md for app startup.\n'
