# Daily Admin Telegram Report — switch cost source to `usage_logs.provider_cost_rub`

**Status:** designed, ready to implement
**Author:** ops + Claude
**Date:** 2026-06-01

## Context

The first three iterations of `/api/cron/daily-admin-report` used either the
WaveSpeed `/usage_stats` endpoint or `SUM(usage_logs.cost_usd)` as the "API
cost" number. Both were wrong:

- `WS /usage_stats` is **per-key**, not per-account. After every key rotation
  it returns 0 for the new key — useless as a durable cost source.
- `usage_logs.cost_usd` is **what we charged the user** (credits debited),
  not what the provider charged us. Multiplying by the FX rate doesn't help;
  the field is already post-markup.

May numbers from `usage_logs` make this stark:

| Bucket     | Calls | `cost_rub` (user-charged) | `provider_cost_rub` (real) |
| ---------- | ----: | ------------------------: | -------------------------: |
| WaveSpeed  |    64 |                   1 449 ₽ |                      362 ₽ |
| OpenRouter |   667 |                   1 256 ₽ |                      244 ₽ |
| **Total**  |   731 |                **2 705**₽ |                   **606**₽ |

The 4.5× gap is the tier-multiplier markup (cheap=10×, mid=5×, high=4×,
premium=2.5×) applied at charge time. Reporting `cost_rub` as "API spend"
double-counts: it's already revenue from credits, which itself was paid out
of subscription revenue we already counted.

## Decision

Use `usage_logs.provider_cost_rub` as the canonical source of "real API
spend" in the daily report. Show `cost_rub` separately as a "credits charged
to users" line so the operator can also see the markup ratio.

WaveSpeed `/balance` stays — `wsBal < $5` is a real ops alert.
WaveSpeed `/usage_stats` is dropped from the report entirely. The
`sync-invoices` cron still snapshots it into `manual_expenses` as an
archive, but the report no longer reads from there.

## Report shape (final)

```
📊 Отчёт за 2026-05-31

💰 Деньги вчера:
• Выручка: 533 ₽ (1 платёж)
• API real cost: 14 ₽ (WS 8 + OR 6)
• Маржа: 97%

📅 MTD 2026-05:
• Выручка: 9 592 ₽ (18 платежей)
• API real cost: 606 ₽ (WS 362 + OR 244)
• Маржа: 94%
• vs пред. MTD: ⬆️ ×3.88 (2 470 ₽)

🆕 Регистрации:
• Вчера: 80 | MTD: 2 272

👥 Подписки:
• Новые: 0 (0 ₽)
• Продления: 1 (490 ₽)
• Топапы: 0 (0 ₽)
• Отмены: 0
• Active: 10 | MRR: 2 470 ₽ | ARPU: 247 ₽

🤖 Топ-3 моделей по cost вчера:
1. anthropic/claude-sonnet-4.6 — 4 ₽ real / 18 ₽ credits (820)
2. google/veo3.1-fast/text-to-video — 3 ₽ / 13 ₽ (1)
3. openai/gpt-5.1 — 1 ₽ / 5 ₽ (340)

📊 Credits эконометрика (MTD):
• Списано credits: 2 705 ₽
• Реальный cost: 606 ₽
• Tier markup: ×4.46

💳 Балансы:
• WaveSpeed: $13.99
• OpenRouter: $52.30

🚨 Алёрты: …
```

## Implementation outline

1. Replace `orY / orM` SUM target: `SUM(provider_cost_rub)::int` (rubles
   directly — drop the FX-conversion dance).
2. Same for the new `wsY / wsM` numbers — bucket WS rows in `usage_logs`
   instead of fetching from WS API.
3. Add a parallel pair of SUMs over `cost_rub` for the "credits charged"
   side; emit them as a single "Credits эконометрика" block with the markup
   ratio.
4. Top-3 models: SELECT model, SUM(provider_cost_rub) AS real,
   SUM(cost_rub) AS charged, COUNT(\*) FROM usage_logs … ORDER BY real DESC.
5. Drop the WS-archive fallback in §2b — no longer needed.
6. Keep WS `/balance` call for `wsBal` alert only.

## Risks / non-goals

- `provider_cost_rub` is only populated by post-2026-04 code (after the
  tier-multiplier refactor PR #58). Pre-2026-04 rows have it as NULL → they
  drop from the "real cost" total. Acceptable: those rows live in
  `manual_expenses` archive already; daily report covers the last day only.
- We are NOT touching `sync-invoices` or `manual_expenses`. Those keep
  acting as a cross-check against the provider invoice.
- We are NOT changing the tier markup or the user-facing pricing.

## Lessons folded in

- `db.execute().rows` — Drizzle wraps the result; the first iteration cast
  to a bare array and silently lost every raw-SQL counter. Inline comment
  added to make it explicit. (Already shipped in 34277f08d0.)
- `cost_usd` ≠ "cost". It's user-charged credits. Provider cost is in
  `provider_cost_rub`. Critical distinction to avoid 4-5× margin errors.
