# UptimeRobot setup

External liveness monitoring for the gptweb.ru stack. Free tier (50 monitors, 5-minute interval) is plenty for three URLs.

## 1. Register

1. Sign up at <https://uptimerobot.com> with `yourcashtg@gmail.com` (same inbox as the Brevo cron alerts).
2. Verify the email. Skip the paid-tier upsell — free plan is all we need.

## 2. Alert contacts

Dashboard -> My Settings -> Alert Contacts -> Add Alert Contact:

- **E-mail** -> `yourcashtg@gmail.com`. Verify the confirmation email.
- Optional: **Telegram** -> follow the on-screen UptimeRobot bot handshake.

Enable both contacts on every monitor you create below (default action when the status changes to DOWN or UP).

## 3. Monitors

Dashboard -> Add New Monitor. Create three:

### 3.1 `ask.gptweb.ru` health (DB-aware)

| Field               | Value                                 |
| ------------------- | ------------------------------------- |
| Monitor Type        | **Keyword**                           |
| Friendly Name       | `ask.gptweb.ru /webapi/health`        |
| URL                 | `https://ask.gptweb.ru/webapi/health` |
| Keyword Type        | **Exists**                            |
| Keyword             | `"status":"ok"`                       |
| Monitoring Interval | **5 minutes**                         |
| HTTP Method         | GET                                   |
| Timeout             | 30 s                                  |
| Alert Contacts      | email + telegram                      |

Fires DOWN when the response no longer contains the literal `"status":"ok"` — covers both app-level failures (Next.js crash, 502) and DB-level failures (the handler returns `"status":"degraded"` with HTTP 503 when `SELECT 1` fails against `lobe-postgres`).

### 3.2 `ask.gptweb.ru` root

| Field               | Value                    |
| ------------------- | ------------------------ |
| Monitor Type        | **HTTP(s)**              |
| Friendly Name       | `ask.gptweb.ru /`        |
| URL                 | `https://ask.gptweb.ru/` |
| Monitoring Interval | **5 minutes**            |
| HTTP Method         | GET                      |
| Alert Contacts      | email + telegram         |

UptimeRobot treats 2xx and 3xx as UP by default, which is what we want — unauthenticated `/` redirects (307) are healthy.

### 3.3 `gptweb.ru` landing

| Field               | Value                |
| ------------------- | -------------------- |
| Monitor Type        | **HTTP(s)**          |
| Friendly Name       | `gptweb.ru /`        |
| URL                 | `https://gptweb.ru/` |
| Monitoring Interval | **5 minutes**        |
| HTTP Method         | GET                  |
| Alert Contacts      | email + telegram     |

Catches the landing / marketing site outage independently from the chat app.

## 4. Reading alerts

- `Monitor is DOWN` — first check the status dashboard; a single missed probe can be a blip. UptimeRobot re-checks after 1 minute before raising.
- For `/webapi/health` DOWN with a keyword miss: `curl -sS https://ask.gptweb.ru/webapi/health` yourself. If you get HTTP 503 with `"db":"error"` -> check `docker logs lobe-postgres` and `docker logs lobehub`.
- For `/` or landing DOWN: usually a container restart or TLS/Cloudflare hiccup; `docker ps` + `docker logs` on the container in question.
- `Monitor is UP` mail is the all-clear; no action needed.

## 5. Maintenance windows

Not configured — our deploys are fast enough (<3 min) that brief DOWN flaps during rollouts are acceptable noise. Revisit if deploy cadence grows beyond a few per day.

## 6. Related pieces

- App-level alarm for billing drift: `scripts/monitoring/check-api-delta.sh` + `api-delta-check.timer` (runs daily 09:00 MSK, emails via Brevo).
- Health endpoint source: `src/app/(backend)/webapi/health/route.ts`.
