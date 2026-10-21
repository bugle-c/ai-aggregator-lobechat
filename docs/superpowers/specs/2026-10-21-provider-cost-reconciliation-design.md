# Verified provider expenses and October credit refunds

## Approved intent

Correct misleading expense economics and excessive customer credit charges. OpenRouter actual cost must survive response normalization; WaveSpeed actual expense must come from billing operations, not model-price estimates.

User approved: refund customers who paid this month; recalculate only from the start of this month; credit the balance and show a technical-error refund in account history; refunds expire; include customers whose subscription has already expired. User delegated remaining decisions and approved the stated rules below.

## Refund policy

- Eligibility: at least one successful positive-value payment (subscription or top-up) created in October 2026, before the reconciliation cutoff. Use 2026-10-01 00:00 Europe/Moscow (2026-09-30T21:00:00Z) as the lower boundary.
- Reconcile eligible customers' usage from that boundary to the recorded production billing-fix cutoff, not their lifetime usage.
- Only positive, evidenced overcharges are returned; never retroactively debit an undercharged customer.
- Preserve original usage charges. Add a separate auditable correction and balance credit; show `Возврат кредитов из-за технической ошибки` in the customer's account history, with credit amount/date/expiry.
- Active subscription: refund expires at its current subscription expiry captured at grant time. Expired/no active subscription: refund expires 30 days after grant (assistant choice explicitly approved).
- Refunds do not extend the subscription or change entitlement. Do not extend unrelated bonus expiry or merge into a permanent top-up pool.
- Re-running the same reconciliation never grants twice. Record per-original-usage correction identity, provider evidence and campaign cutoff.
- Unknown or ambiguously attributable actual costs remain unresolved, never fabricated or allocated proportionally from account totals.

## Expense accounting

- Store actual provider USD separately from charged cost and token-based estimate, with provenance and upstream generation/prediction ID.
- OpenRouter `usage.cost` is the charge to our account; do not replace it with upstream inference cost or catalog-derived UI `cost`. Preserve explicit zero.
- Normalize billing input into mutually exclusive ordinary/read-cache/write-cache categories and include reasoning output. Preserve native Anthropic exclusive-input semantics.
- Cover both legacy chat completion and AgentRuntime paths plus relevant completion/response converters.
- WaveSpeed `POST /api/v3/billings/search` provides actual financial operations tied to predictions. Account for operation type and reversals; do not count a reserve and final charge twice.
- Actual costs may arrive later than generation completion. Until confirmed, expose estimated/pending status, not an invoice. Keep estimate separate from actual.
- Invoice reconciliation must be independent from the local estimate it checks. No self-summed estimated OpenRouter invoice represented as actual.
- Scope provider history to this application's requests/keys; account-wide data can include unrelated work.

## Known evidence and constraints

- Astra customer's 11 saved replies lack provider cost and trace IDs; exact historical recovery requires additional provider evidence. User reports aggregate actual $1.51; this alone is not per-request allocation proof.
- 1875 overlapping-token calls/807 accounts are candidates, not confirmed overcharge victims.
- OpenRouter activity endpoint returned HTTP403 with current inference key (management key required). This does not block actual cost accounting on new replies or generation-ID lookup.
- WaveSpeed billings/search returned HTTP200 using current configured key, with a deduct price and prediction UUID.
- Current WaveSpeed docs use start_time/end_time; existing cron uses start_date/end_date. Verify live API behavior before relying on historical aggregates.

## Non-goals and safety

No subscription cancellation, payment-method changes, customer cash refunds, new markup policy, blanket historical scale factor, deletion of original records, or unrelated refactoring.

Before production correction: immutable export, dry-run report, attribution validation and idempotency verification. User has authorized the policy and delegated implementation choices; unresolved evidence must remain explicitly blocked, not compensated using guesses.

## Builder decisions

Reuse current TypeScript/Drizzle/PostgreSQL, billing APIs and account-history conventions. Choose the smallest ledger/expiry representation that supports independently expiring refund lots without changing existing bonuses. Review expiry boundaries, repeated imports, concurrent spending, and current-period reset behavior. Tests must exercise these consumer-visible behaviors; smoke the actual billing path and account UI before release.
