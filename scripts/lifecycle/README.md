# Subscription lifecycle scripts

Phase 2.3 — daily cron that emails users whose subscriptions expire in 3
days (`expiry-reminder.ts`).

## Files

- `expiry-reminder.ts` — TS entrypoint. Imports the lifecycle email helpers
  from `src/server/modules/lifecycle/`. Run via `npx tsx`.
- `expiry-reminder.sh` — bash wrapper (used by systemd). Sources
  `/etc/webgpt-lifecycle.env` if present, then `exec npx tsx`.
- `expiry-reminder.service` — systemd one-shot unit.
- `expiry-reminder.timer` — daily timer at 07:00 UTC (10:00 MSK), with
  10-minute randomized delay.

## Manual install on the host

```bash
# 1. (one-time) drop a shared env file so both this script and ad-hoc runs
#    pick up the same secrets:
sudo tee /etc/webgpt-lifecycle.env > /dev/null << 'EOF'
DATABASE_URL=postgres://lobechat:...@host/lobechat
BREVO_API_KEY=xkeysib-...
APP_URL=https://ask.gptweb.ru
EOF
sudo chmod 600 /etc/webgpt-lifecycle.env

# 2. install systemd units (point them at the repo path):
sudo cp /home/deploy/projects/ai-aggregator-lobechat/scripts/lifecycle/expiry-reminder.service /etc/systemd/system/
sudo cp /home/deploy/projects/ai-aggregator-lobechat/scripts/lifecycle/expiry-reminder.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now expiry-reminder.timer

# 3. verify:
systemctl list-timers expiry-reminder.timer
journalctl -u expiry-reminder.service --since "1 hour ago"

# Manual dry-run:
sudo -u deploy /home/deploy/projects/ai-aggregator-lobechat/scripts/lifecycle/expiry-reminder.sh --dry-run
```

## Why a TS script (not bash + curl)

The query joins three tables and we need the same template + Brevo helper as
the in-app post-payment confirmation. Keeping it in TS means a single source
of truth for HTML copy and template escaping.
