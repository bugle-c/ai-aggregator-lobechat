#!/usr/bin/env bash
# Phase 2.3 — Bash wrapper for the expiry-reminder cron task.
# Loads env (DATABASE_URL, BREVO_API_KEY, APP_URL) from /etc/webgpt-lifecycle.env
# if present, otherwise relies on systemd EnvironmentFile / inherited env.
#
# Invoked by /etc/systemd/system/expiry-reminder.service.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/home/deploy/projects/ai-aggregator-lobechat}"
ENV_FILE="${LIFECYCLE_ENV_FILE:-/etc/webgpt-lifecycle.env}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

cd "$REPO_DIR"

# Use repo-local tsx via npx so we don't depend on a global install.
exec npx tsx --tsconfig tsconfig.json scripts/lifecycle/expiry-reminder.ts "$@"
