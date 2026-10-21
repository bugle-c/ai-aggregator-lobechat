# Provider Expense Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Separate verified upstream expenses from estimates, stop incorrect future chat charges, and reconcile recoverable history without inventing actual costs.

**Architecture:** Preserve upstream cost independently of UI cost, normalize mutually exclusive token categories at both chat billing consumers, and reconcile provider invoices independently of usage estimates. Historical account adjustments require attributable evidence and an auditable correction ledger; aggregate invoices must never be distributed arbitrarily across users.

**Tech Stack:** TypeScript, model-runtime, Next.js, PostgreSQL/Drizzle, Supabase finance tables, Vitest.

**Spec:** [Approved design](../specs/2026-10-21-provider-cost-reconciliation-design.md). User approved scope and delegated remaining implementation decisions. Support identity is separate; no cancellation authorized.

## Global Constraints

- No blanket ratio correction or balance reset. Preserve original records before any historical mutation.
- Keep verified, estimated, and unknown amounts distinct. Unknown is not zero.
- Preserve existing customer pricing policy; distinguish its markup from actual expense.
- No production historical write until dry-run totals and attribution are reviewed.
- OpenRouter activity access currently returns HTTP403: management key required. No such environment key found in lobehub or webgpt-admin.
- Historical provider data must be scoped to this service/key, not unrelated usage on the same provider account.
- Refund cohort: successful positive payments in October; usage window begins 2026-09-30T21:00:00Z and ends at recorded production fix cutoff. Refund only positive evidenced overcharges.
- Expiry: active subscription's captured expiry, otherwise grant +30 days. Do not alter other bonus expiry. Show `Возврат кредитов из-за технической ошибки` in customer history.
- WaveSpeed billings/search access verified HTTP200; all six October-cohort prediction IDs have exact billing records, totaling $0.083 and matching recorded RUB7.47. Use financial operations for per-prediction actuals; do not rely solely on daily aggregates.

## Review Focus

- Explicit upstream zero cost must survive serialization and must not fall back to catalog pricing.
- OpenAI inclusive input and Anthropic exclusive input must not share a blind subtraction rule.
- Reasoning output must not disappear from fallback cost calculation.
- Provider API failure or expired retention must not overwrite archived invoices with zero or estimates.
- Repeated reconciliation must not issue duplicate customer credits.

## Evidence

- Production read-only SQL: 1875 overlapping-token candidate calls across 807 accounts; this is NOT the confirmed overcharge population.
- 2510 assistant messages, 1311 with numeric metadata.cost, none with trace_id. Existing cost may be catalog-derived; numeric presence alone is not proof of upstream provenance.
- All 11 Astra messages for the reported customer lack metadata.cost; recorded Astra expense RUB537.0731 exactly matches the faulty token fallback.
- OpenAI converter drops raw usage.cost. withUsageCost can calculate cost from catalog prices.
- Legacy chat consumer maps inputCacheMissTokens to cache writes and includes cached input in ordinary input.
- sync-invoices currently constructs OpenRouter invoices from our own usage_logs, so it is not an independent reconciliation source.

### Task 1: Correct future usage transport and billing

**Files:**
- Modify packages/types/src/message/common/metadata.ts (ModelUsage and ModelUsageSchema).
- Modify packages/model-runtime/src/core/usageConverters/openai.ts and existing openai.test.ts.
- Modify src/app/(backend)/webapi/chat/[provider]/route.ts.
- Modify src/server/modules/AgentRuntime/RuntimeExecutors.ts.
- Extend src/server/modules/analytics/__tests__/writeUsageLog.providerCost.test.ts.
- Reuse src/server/modules/billing/checkUsageLimit.ts and compute-cost.ts contracts.

**Interfaces:** ModelUsage.providerCostUsd?: number is actual upstream USD only; cost retains UI semantics. Billing already accepts providerCostUsd. Ordinary input, cache reads, and cache writes passed to compute-cost must be mutually exclusive.

- [ ] Run language-server references for ModelUsage/ModelUsageSchema and changed exported converter before edits.
- [ ] Add behavior regressions: raw cost 0.0151 survives with/without pricing; zero survives; absent actual cost is not manufactured from UI cost; input1000/read800/write100 yields ordinary100; all-cached input preserves zero; native Anthropic input remains exclusive; total output includes reasoning.
- [ ] Preserve providerCostUsd through converter and metadata schema; normalize cache writes separately from cache misses.
- [ ] Cut over both billing consumers to canonical normalized usage and explicit raw-provider fallbacks. Never pass u.cost as unconditional actual upstream cost.
- [ ] Verify chat expense override $1.51 produces RUB135.9000 at FX90 independently of inflated token estimates; retain media behavior and configured customer markup.
- [ ] Run focused converter/billing tests once after implementation, then replay an OpenRouter-shaped streamed completion through the actual lobehub mapping and inspect persisted expense and credits. Use a throwaway fixture, not a customer-billable live call.

### Task 2: Make invoice reporting independent

**Files:** src/app/(backend)/api/cron/sync-invoices/route.ts; finance readers and provider mapping in webgpt-admin identified by the finance investigation; expense schema migrations following existing conventions.

**Interfaces:** Daily invoice records retain provider, service/key scope, UTC date, actual USD, source/provenance, and reconciliation status. Estimates must not be exposed as invoices.

- [ ] Obtain authorized OpenRouter management-key access through secure configuration, or an exported provider report. Do not request credentials in chat.
- [ ] Replace the OpenRouter self-sum with provider activity data scoped to the application's key; retain provider-reported USD as source amount.
- [ ] Mark existing self-summed OpenRouter invoices as unverified estimates while retaining original values/audit evidence; do not silently claim they are actual.
- [ ] Separate actual invoice totals, estimated request costs, and attribution gaps in finance views; do not sum the same expense twice.
- [ ] Exercise success, API403, partial-date coverage, and repeated imports; missing dates/errors must not overwrite valid archived values.

### Task 3: Reconcile history and customer impacts safely

**Files:** Add a reconciliation script in scripts following existing database-operation conventions; use existing usage_logs, messages.metadata and finance expense storage. Final migration shape depends on verified recovery-source identifiers, not inferred timestamp matches.

**Interfaces:** Dry-run report contains immutable original row IDs/amounts, source evidence IDs, proposed actual cost, proposed customer credit correction, confidence, and unresolved reason. Apply mode requires reviewed report identity and idempotent correction IDs.

- [ ] Export immutable originals and verify restoration before historical writes.
- [ ] Import available provider history; activity API supplies recent daily aggregates, not automatically per-customer proof. Use generation-level evidence where available.
- [ ] Match exact upstream IDs when stored; where absent, require unambiguous validated matching and leave ambiguous rows unresolved.
- [ ] Keep correctly priced existing rows unchanged. Do not infer historical markup from today's catalog.
- [ ] Produce global/provider/day differences and per-customer proposed corrections separately. Report unmatched history as unknown, not invented actual expense.
- [ ] Apply only evidence-validated corrections under the approved policy after dry-run and backup verification. Keep unresolved rows untouched. User approved refunds and delegated execution; no arbitrary proportional allocation.
- [ ] Re-run dry-run to prove no duplicate corrections; reconcile independent provider totals with ledger totals and explicitly report remaining attribution gaps.

### Task 4: Expiring refund lots and customer history

**Files:** packages/database/src/schemas/billing.ts; credit-holds.ts; schema export/migrations; src/server/services/billing/index.ts; src/server/modules/billing/checkUsageLimit.ts; image/video chargeBeforeGenerate.ts and chargeAfterGenerate.ts; stale-hold cron; subscription/spend/quote routers; customer Billing.tsx and desktop/mobile Plans; locales.

**Interfaces:** Separate refund lots (granted/remaining/expiresAt/campaign) and per-usage corrections (original/adjusted/evidence) with unique campaign/usage identity. Preserve source allocations on holds. Ordinary tokensUsedMonth excludes credits funded from refund lots; usage logs retain full charge. Balance = ordinary remaining + unexpired refund remaining. Refunds spend first by expiry and never become withdrawable referral balance.

- [ ] Add transactional grant/spend/reserve/settle service, locking billing row then lots consistently. Duplicate corrections grant zero. Capture active subscription expiry or grant+30 days.
- [ ] Make resets/renewals preserve remaining lot amounts. Restore failed reservations to their original funding sources, never resurrect expired refunds or subtract an old-period hold from a new counter.
- [ ] Integrate all balance gates/displays, free quota paid-credit bypass, media holds and stale cleanup with guarded idempotent settlement.
- [ ] Add typed payment/refund history union sorted before limiting; display credit units, grant/expiry and approved Russian label without fake payment rows.

Customer API contract: `subscription.getPayments` remains payment-only; `subscription.getCreditHistory` returns the typed payment/refund union. `subscription.getBillingState`, `spend.getUsageSummary`, and `spend.getCreditState` expose `creditsRemaining` (ordinary remaining plus unexpired refunds), `refundRemaining`, and `totalAvailable` (ordinary cap plus unexpired refunds). Existing `creditBalance` stays the ordinary top-up pool. Quotes use `creditsRemaining` for affordability. Refunds bypass the free daily quota but never unlock paid-plan models.

- [ ] Verify concurrency, duplicate grants/completions, expiry boundary, renewal/reset, partial hold settlement and Russian account UI using disposable DB and browser smoke.
- [ ] Historical pricing ruling: reconstruct only where original transaction pricing/FX/rounding can be established; otherwise retain unresolved status even when actual provider expense is known.

Backend implementation: `BillingService.spendCredits` serializes against the billing row and consumes independently expiring lots by expiry before ordinary credits. `reserveCredits` records lot allocations and usage period; `settleCreditHold` returns unused funds to those sources exactly once, without crediting a later ordinary period. Expired lots remain audited but unusable. Migration `20261021_refund_credit_lots.sql` adds the ledger and legacy hold-period capture; register/apply it through the deployment migration process before enabling these paths.

Image batches transfer their existing reserved sources transactionally into unique per-image child holds before task creation. Splitting changes no lot balance or expiry; each completion/error owns its independent settlement. Child holds retain the original reservation timestamp and ordinary usage period.

Historical dry run: `bun scripts/billing/reconcile-october.ts <reviewed-evidence.json>`. Apply requires both `--apply` and `--reviewed-sha256=<dry-run-sha256>` plus the immutable backup reference in the report. Input identifies campaign/fixCutoff and exact usage/provider request IDs, actual USD and canonical historical pricing (`source`, `sourceReference`, `capturedAt`, `captureStage`, markup, exchangeRate, creditValueRub, minimumCredits, zeroCostCredits=0, rounding=ceil). The shared Zod contract validates both reviewed input and persisted evidence semantically; `usage_log_write` snapshots alone are not historical charging proof. The script enumerates the full eligible payment/usage cohort and lists omitted evidence rows as unresolved rather than hiding them. Only chat pricing is recomputed from actual USD, with verified zero costing zero credits; media prices remain unchanged. No historical writes were executed during implementation.

### Completion

- [ ] Update KNOWLEDGE.md and finance operational documentation with actual-vs-estimated semantics, source retention, and reconciliation procedure.
- [ ] Deploy corrected billing only after replay smoke proof; verify a controlled production path and daily reconciliation source without charging an uninvolved customer.
- [ ] Report exact corrected coverage and unresolved historical period/source prerequisites; never label all history fixed unless all differences are attributable.
