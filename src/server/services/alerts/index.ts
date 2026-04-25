/**
 * Alert delivery service.
 *
 * Lightweight adapter used by billing sanity-check cron and other
 * background jobs to surface anomalies. Always logs to stderr (basic
 * audit trail). When `TELEGRAM_ALERT_BOT_TOKEN` and
 * `TELEGRAM_ALERT_CHAT_ID` are configured, also forwards a Markdown
 * message to that chat.
 *
 * Telegram delivery is best-effort: failures are swallowed so a flaky
 * Telegram API never breaks the calling cron / webhook.
 */

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface Alert {
  body: string;
  metadata?: Record<string, unknown>;
  severity: AlertSeverity;
  title: string;
}

const SEVERITY_TAG: Record<AlertSeverity, string> = {
  critical: '[CRITICAL]',
  info: '[INFO]',
  warning: '[WARNING]',
};

export async function sendAlert(alert: Alert): Promise<void> {
  const tag = SEVERITY_TAG[alert.severity];
  // Always log — gives us an audit trail even when Telegram isn't configured.
  // We use console.error for everything (including info) so the line lands in
  // stderr-tailing logging pipelines uniformly.
  console.error(`[alert] ${tag} ${alert.title}\n${alert.body}`);

  const botToken = process.env.TELEGRAM_ALERT_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ALERT_CHAT_ID;
  if (!botToken || !chatId) return;

  try {
    // Markdown escaping is intentionally light — these alerts are operator-
    // facing; if a payload trips the parser we'd rather have a noisy log
    // than a silent drop, so we don't try to be clever.
    const text = `${tag} *${alert.title}*\n\n${alert.body}`;
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      body: JSON.stringify({
        chat_id: chatId,
        parse_mode: 'Markdown',
        text,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (!res.ok) {
      console.error(`[alert] telegram delivery returned ${res.status}: ${await res.text()}`);
    }
  } catch (err) {
    console.error('[alert] telegram delivery failed:', err);
  }
}
