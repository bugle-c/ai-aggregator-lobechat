# Provider cost correction execution record

Worktree: /home/deploy/projects/ai-aggregator-billing-reconciliation; branch fix/provider-cost-reconciliation. Main checkout untouched except approved plan/spec documents.

## Completed evidence
- Original production investigation: eligible October cohort 5 users; 3 with usage, 50 rows, 9455 credits, 44 chat and 6 media.
- WaveSpeed exact prediction billing lookup found six deduct operations totaling USD0.083 = RUB7.47, matching stored media costs; no media expense discrepancy in cohort.
- Provider converter regression: five failures before implementation; same five passed after actual-cost preservation/cache normalization.
- Canonical billing normalization five behavior cases passed (no pre-fix failure run for this new helper; do not claim RED/GREEN).
- LSP unavailable. Dependencies: pnpm binary absent; corepack available but frozen install fails existing override/lock mismatch. Reused installed dependency directories via symlinks; do not change lockfile to fix unrelated mismatch.

## Implementation in progress
- Parent owns model usage schema/converters, OpenAI stream upstream ID propagation, canonical normalization helper and both chat consumers; customer history Billing.tsx and default translation keys updated for pending getCreditHistory contract.
- ImplementRefundLedger agent owns refund lots/corrections/source-aware spend/holds/gates/balance/history APIs/schema.
- ImplementActualExpenses agent owns expense provenance/actual USD schema, writer, WaveSpeed reconciliation and independent invoice cron.
- Agents instructed no tests/build/lint mid-flight; parent integration checks afterward. No production writes or deploy performed.

## Rulings
- Historical corrected charge requires historical pricing evidence; otherwise unresolved even if provider cost known (independent builder review finding).
- Refunds spend earliest expiry first, separate from ordinary monthly counter; logs retain full credits. Renewal cannot refill lots. Refunds not cashout eligible.
- All unresolved history remains explicit; user's USD1.51 total alone cannot be split into per-request charges.

## Remaining
- Integrate agent changes, actual/estimated finance display in sibling webgpt-admin, historical extraction/report/apply, controlled smoke/tests/UI proof, deployment and verified refund outcome.
- Need preserve original records and dry-run proof before any historical mutation. No arbitrary ratio correction.
- Main todo remains active; not complete.
