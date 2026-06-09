# Cluster-Expansion Loop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the SEO blog automatically write more articles for clusters that bring real delivered traffic, capped at \~50% of daily generation slots, with VPN clusters hard-excluded.

**Architecture:** A **producer** appended to `scripts/blog/track-positions.sh` (runs daily 04:00 MSK, already has fresh `blog_positions`) computes a blended traffic score per cluster, takes the top-N non-VPN winners above a floor, and seeds their uncovered `related_keywords` into `blog_keywords` as `source='cluster_expansion' priority='high'`. A **consumer** branch in `scripts/blog/generate-article.sh` uses deterministic slot-parity (expansion on the 08/12/16/20 MSK slots, normal on 10/14/18/22) to spend \~50% of slots on these high-priority expansion keywords; normal slots explicitly exclude `source=cluster_expansion` so they can't steal them. One DB migration adds `'cluster_expansion'` to the `blog_keywords.source` CHECK constraint.

**Tech Stack:** bash, Supabase self-hosted PostgreSQL (schema `ai_aggregator`, container `supabase-db`), PostgREST (Accept-Profile: ai_aggregator), Claude CLI, systemd timers. The `deploy` user CAN `docker exec supabase-db psql` without sudo — the producer uses that for its CTE; the consumer uses REST to match the existing script style.

**Spec:** `docs/superpowers/specs/2026-06-10-cluster-expansion-loop-design.md` (commit `e729190b10`).

**Read first (current shape):**

- `scripts/blog/track-positions.sh` — producer host; appends after the drop-flag block (`log "=== position tracking complete ==="` is the current last line). Env loaded via `set -a; source /home/deploy/.config/blog-autogen/env; set +a`; `notify.sh` sourced; `SUPA_HDRS` array exists.
- `scripts/blog/generate-article.sh` — consumer host. `is_valid_keyword()` has the VPN regex (returns 2 on VPN). `TARGET_CAT/_ID/_NAME` resolved near the top. Keyword loop at `for attempt in $(seq 1 $MAX_KEYWORD_ATTEMPTS)`: category-hinted REST query, then global fallback via `${API_URL}/api/cron/blog-keywords/next`.
- `scripts/blog/notify.sh` — `notify_success` / `notify_failure` (Telegram).

**Conventions / gotchas (do not relearn the hard way):**

- Talk to the blog DB with `docker exec supabase-db psql -U postgres -d postgres -c "..."`. The schema is `ai_aggregator`. Strip noise with `2>&1 | grep -vE 'WARNING|DETAIL|HINT|collation'`.
- bash regex is case-sensitive; lowercase first (`${kw,,}`) before matching VPN terms, OR use psql `!~*` (case-insensitive) in SQL.
- Shell scripts run **from disk** via systemd timers — no container deploy needed. The migration is the only stateful step.
- The 4 flags default-on in the scripts; override only via `/home/deploy/.config/blog-autogen/env`.

---

## Task 1: Migration — allow `'cluster_expansion'` in `blog_keywords.source`

**Files:**

- Create: `supabase-migrations/2026-06-10_blog_keywords_source_cluster_expansion.sql`

**Step 1: Write the migration SQL file**

Create `supabase-migrations/2026-06-10_blog_keywords_source_cluster_expansion.sql`:

```sql
-- Allow cluster-expansion-seeded keywords. The producer in track-positions.sh
-- inserts blog_keywords rows with source='cluster_expansion' for the uncovered
-- related_keywords of high-traffic clusters. The prior constraint only allowed
-- yandex_api / manual / ai_generated, so the insert would 23514 without this.
ALTER TABLE ai_aggregator.blog_keywords
  DROP CONSTRAINT IF EXISTS blog_keywords_source_check;
ALTER TABLE ai_aggregator.blog_keywords
  ADD CONSTRAINT blog_keywords_source_check
  CHECK (source IN ('yandex_api','manual','ai_generated','cluster_expansion'));
```

**Step 2: Apply the migration**

Run:

```bash
docker exec -i supabase-db psql -U postgres -d postgres < /home/deploy/projects/ai-aggregator-lobechat/supabase-migrations/2026-06-10_blog_keywords_source_cluster_expansion.sql 2>&1 | grep -vE 'WARNING|DETAIL|HINT|collation'
```

Expected: two `ALTER TABLE` lines, no error.

**Step 3: Verify the constraint accepts the new value and rejects garbage**

Run:

```bash
docker exec supabase-db psql -U postgres -d postgres -c "
BEGIN;
INSERT INTO ai_aggregator.blog_keywords (keyword, status, source, priority) VALUES ('__test_ce__','pending','cluster_expansion','high');
SELECT 'accepted cluster_expansion' AS ok;
ROLLBACK;
" 2>&1 | grep -vE 'WARNING|DETAIL|HINT|collation'
docker exec supabase-db psql -U postgres -d postgres -c "
BEGIN;
INSERT INTO ai_aggregator.blog_keywords (keyword, status, source, priority) VALUES ('__test_bad__','pending','garbage_src','high');
ROLLBACK;
" 2>&1 | grep -E 'violates check|ERROR' | head -1
```

Expected: first prints `accepted cluster_expansion`; second prints a check-constraint violation for `garbage_src`.

**Step 4: Commit**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
git add supabase-migrations/2026-06-10_blog_keywords_source_cluster_expansion.sql
git commit -m "feat(blog): migration — allow cluster_expansion in blog_keywords.source

Producer seeds expansion keywords with source='cluster_expansion';
the old CHECK constraint only allowed yandex_api/manual/ai_generated.
Applied to live supabase-db; SQL committed for record."
```

---

## Task 2: Slot-parity helper + table test (pure function, TDD)

This is the consumer's deterministic 50% gate. Build and test it in isolation FIRST, then wire it into the generator in Task 4.

**Files:**

- Create: `scripts/blog/lib/slot-parity.sh` (sourced helper)
- Create: `scripts/blog/tests/test-slot-parity.sh`

**Step 1: Write the failing test**

Create `scripts/blog/tests/test-slot-parity.sh`:

```bash
#!/usr/bin/env bash
# Table test for is_expansion_slot(): exactly 4 expansion / 4 normal across
# the 8 generation hours, deterministic for off-cadence hours.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../lib/slot-parity.sh"

fail=0
check() { # check <hour> <expected 1|0>
  local got
  is_expansion_slot "$1"
  got=$?
  # is_expansion_slot returns 0 (true) for expansion, 1 for normal — map to 1/0
  local got_bin=0
  [[ $got -eq 0 ]] && got_bin=1
  if [[ "$got_bin" != "$2" ]]; then
    echo "FAIL hour=$1 expected=$2 got=$got_bin"
    fail=1
  fi
}

# The 8 real slots
check 08 1
check 10 0
check 12 1
check 14 0
check 16 1
check 18 0
check 20 1
check 22 0
# Off-cadence hours must still be deterministic. Under (n/2)%2==0:
#   09 → 09/2=4, 4%2=0 → expansion (1)
#   00 → 00/2=0, 0%2=0 → expansion (1)
#   23 → 23/2=11, 11%2=1 → normal (0)
check 09 1
check 00 1
check 23 0

if [[ $fail -eq 0 ]]; then echo "PASS: slot-parity table test (4/4 split)"; else exit 1; fi
```

Make it executable: `chmod +x scripts/blog/tests/test-slot-parity.sh`.

**Step 2: Run it to verify it fails**

Run: `bash scripts/blog/tests/test-slot-parity.sh`
Expected: FAIL — `slot-parity.sh: No such file or directory`.

**Step 3: Write the helper**

Create `scripts/blog/lib/slot-parity.sh`:

```bash
#!/usr/bin/env bash
# slot-parity.sh — deterministic expansion/normal slot split for the
# cluster-expansion consumer. 8 generation slots/day (08,10,…,22 MSK).
# Expansion on 08,12,16,20; normal on 10,14,18,22 → exactly 50%.
#
# is_expansion_slot <hour>  -> exit 0 (expansion) | exit 1 (normal)
# Pure function of the hour; no DB, no env. Off-cadence hours resolve
# deterministically via the same formula so a manual run is predictable.
is_expansion_slot() {
  local h="$1"
  # 10# forces base-10 so leading-zero hours (08,09) don't parse as octal.
  local n=$((10#$h))
  if (((n / 2) % 2 == 0)); then
    return 0 # expansion
  else
    return 1 # normal
  fi
}
```

Make it executable: `chmod +x scripts/blog/lib/slot-parity.sh`.

**Step 4: Run the test to verify it passes**

Run: `bash scripts/blog/tests/test-slot-parity.sh`
Expected: `PASS: slot-parity table test (4/4 split)`.

**Step 5: Commit**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
git add scripts/blog/lib/slot-parity.sh scripts/blog/tests/test-slot-parity.sh
git commit -m "feat(blog): slot-parity helper for 50% expansion cap (TDD)

is_expansion_slot(hour) splits the 8 daily slots 4/4: expansion on
08/12/16/20 MSK, normal on 10/14/18/22. Pure function, table-tested,
deterministic for off-cadence hours. Consumer wires it in Task 4."
```

---

## Task 3: Producer — winning-cluster detection + seeding (track-positions.sh)

**Files:**

- Modify: `scripts/blog/track-positions.sh` (append before final `log "=== position tracking complete ==="`)

**Step 1: Read the current tail**

Run: `tail -20 scripts/blog/track-positions.sh`
Confirm the last functional line is `log "=== position tracking complete ==="`. You will insert the producer block immediately BEFORE it.

**Step 2: Insert the producer block**

Insert this block right before the final `log "=== position tracking complete ==="`:

```bash
# ── Cluster-expansion producer ──────────────────────────────────────────
# Seed uncovered related_keywords of high-traffic clusters so the generator
# writes more around proven winners. Blended score = clicks*5 + impressions
# over 7d (real delivered traffic from blog_positions, NOT Wordstat volume).
# VPN clusters are hard-excluded (RKN). See spec
# docs/superpowers/specs/2026-06-10-cluster-expansion-loop-design.md.
CE_ENABLED="${CLUSTER_EXPANSION_ENABLED:-1}"
CE_TOP_N="${CLUSTER_EXPANSION_TOP_N:-5}"
CE_MIN_SCORE="${CLUSTER_EXPANSION_MIN_SCORE:-5}"
CE_KW_PER_CLUSTER="${CLUSTER_EXPANSION_KW_PER_CLUSTER:-2}"

if [[ "$CE_ENABLED" == "1" ]]; then
  log "cluster-expansion: scanning winners (top_n=$CE_TOP_N min_score=$CE_MIN_SCORE kw/cluster=$CE_KW_PER_CLUSTER)"
  # One psql call does selection + per-cluster seeding atomically using a
  # DO block. Returns NOTICE lines we parse for the log/summary. deploy can
  # docker exec without sudo (verified). The VPN regex mirrors the
  # generator's is_valid_keyword guard (defense in depth).
  #
  # ⚠️ heredoc is UNQUOTED on purpose: bash interpolates ${CE_*} and ${VPN_RE}
  # into the SQL. psql does NOT substitute :vars inside dollar-quoted blocks,
  # so we can't use `-v`. The plpgsql body is dollar-quoted with $BODY$ (not
  # $$) to avoid colliding with bash $$=PID; the $BODY$ tags are backslash-
  # escaped so bash leaves them literal. The only `$` in the SQL is the
  # escaped $BODY$ tags — everything else is plain.
  VPN_RE='(vpn|впн|vless|v2ray|xray|amnezia|shadowsocks|wireguard|hiddify|outline|прокси|proxy|обход|разблок|dpi|byebyedpi)'
  CE_OUT=$(
    docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 2>&1 << SQL | grep -vE 'WARNING|DETAIL|HINT|collation'
DO \$BODY\$
DECLARE
  topn int := ${CE_TOP_N};
  minscore int := ${CE_MIN_SCORE};
  percluster int := ${CE_KW_PER_CLUSTER};
  c record;
  kw text;
  seeded_in_cluster int;
  total_seeded int := 0;
  total_clusters int := 0;
BEGIN
  FOR c IN
    WITH cluster_traffic AS (
      SELECT bc.id, bc.primary_keyword, bc.category_slug, bc.related_keywords,
             COALESCE(SUM(pos.clicks),0)*5 + COALESCE(SUM(pos.impressions),0) AS blended
      FROM ai_aggregator.blog_clusters bc
      JOIN ai_aggregator.blog_posts bp
           ON bp.cluster_id = bc.id AND bp.status='published'
      LEFT JOIN ai_aggregator.blog_positions pos
           ON pos.post_id = bp.id AND pos.snapshot_date > now() - interval '7 days'
      WHERE bc.primary_keyword !~* '${VPN_RE}'
      GROUP BY bc.id, bc.primary_keyword, bc.category_slug, bc.related_keywords
    )
    SELECT id, category_slug, blended, related_keywords
    FROM cluster_traffic
    WHERE blended >= minscore
    ORDER BY blended DESC
    LIMIT topn
  LOOP
    seeded_in_cluster := 0;
    IF c.related_keywords IS NOT NULL THEN
      FOREACH kw IN ARRAY c.related_keywords LOOP
        EXIT WHEN seeded_in_cluster >= percluster;
        CONTINUE WHEN kw IS NULL OR length(trim(kw)) = 0;
        CONTINUE WHEN kw ~* '${VPN_RE}';                     -- VPN double-guard
        CONTINUE WHEN EXISTS (                               -- coverage check
          SELECT 1 FROM ai_aggregator.blog_keywords WHERE lower(keyword)=lower(kw)
        );
        -- NOTE: impressions here holds the BLENDED traffic score, NOT Wordstat
        -- volume — intentional (spec) so the consumer orders hottest first.
        -- Consumers that read blog_keywords.impressions as search-volume will
        -- mis-read these source='cluster_expansion' rows. LEAST() guards the
        -- int column against a future >2.1B blended score.
        INSERT INTO ai_aggregator.blog_keywords
          (keyword, status, source, priority, category_slug, cluster_id, impressions)
        VALUES (kw, 'pending', 'cluster_expansion', 'high',
                c.category_slug, c.id, LEAST(c.blended, 2147483647)::int);
        seeded_in_cluster := seeded_in_cluster + 1;
        total_seeded := total_seeded + 1;
        RAISE NOTICE 'CE_SEEDED cluster=% score=% kw=%', c.id, c.blended, kw;
      END LOOP;
      IF seeded_in_cluster > 0 THEN total_clusters := total_clusters + 1; END IF;
    END IF;
  END LOOP;
  RAISE NOTICE 'CE_SUMMARY clusters=% keywords=%', total_clusters, total_seeded;
END
\$BODY\$;
SQL
  )
  echo "$CE_OUT" | grep -E 'CE_SEEDED|CE_SUMMARY' | while IFS= read -r line; do log "cluster-expansion: $line"; done
  CE_SUMMARY_LINE=$(echo "$CE_OUT" | grep -oE 'CE_SUMMARY clusters=[0-9]+ keywords=[0-9]+' | tail -1)
  CE_KW_COUNT=$(echo "$CE_SUMMARY_LINE" | grep -oE 'keywords=[0-9]+' | cut -d= -f2)
  CE_CL_COUNT=$(echo "$CE_SUMMARY_LINE" | grep -oE 'clusters=[0-9]+' | cut -d= -f2)
  if [[ "${CE_KW_COUNT:-0}" -gt 0 ]]; then
    notify_success "cluster-expansion" "Засеяно ${CE_KW_COUNT} ключей по ${CE_CL_COUNT} выигрышным кластерам"
    log "cluster-expansion: seeded ${CE_KW_COUNT} keywords across ${CE_CL_COUNT} clusters"
  else
    log "cluster-expansion: no clusters above floor (min_score=$CE_MIN_SCORE) — nothing seeded"
  fi
else
  log "cluster-expansion: disabled (CLUSTER_EXPANSION_ENABLED=$CE_ENABLED)"
fi
# ────────────────────────────────────────────────────────────────────────
```

**Step 3: Syntax check**

Run: `bash -n scripts/blog/track-positions.sh && echo "SYNTAX OK"`
Expected: `SYNTAX OK`.

**Step 4: Dry-run the selection against the live DB (no harmful writes — uses a ROLLBACK probe)**

Run this read-only probe to confirm the selection query is valid and see what (if anything) qualifies today:

```bash
docker exec supabase-db psql -U postgres -d postgres -c "
WITH cluster_traffic AS (
  SELECT bc.id, bc.primary_keyword, bc.category_slug,
         COALESCE(SUM(pos.clicks),0)*5 + COALESCE(SUM(pos.impressions),0) AS blended
  FROM ai_aggregator.blog_clusters bc
  JOIN ai_aggregator.blog_posts bp ON bp.cluster_id = bc.id AND bp.status='published'
  LEFT JOIN ai_aggregator.blog_positions pos ON pos.post_id = bp.id AND pos.snapshot_date > now() - interval '7 days'
  WHERE bc.primary_keyword !~* '(vpn|впн|vless|v2ray|xray|amnezia|shadowsocks|wireguard|hiddify|outline|прокси|proxy|обход|разблок|dpi|byebyedpi)'
  GROUP BY bc.id, bc.primary_keyword, bc.category_slug
)
SELECT id, primary_keyword, category_slug, blended FROM cluster_traffic
WHERE blended >= 5 ORDER BY blended DESC LIMIT 5;
" 2>&1 | grep -vE 'WARNING|DETAIL|HINT|collation'
```

Expected: 0 or a few rows (real traffic is tiny today; the only non-VPN cluster with traffic was `дядя ваня личный кабинет` ≈5). Either is fine — it proves the query runs.

**Step 5: Run the real producer once and verify idempotency**

Run the full script once (it also does position tracking — that's fine, idempotent daily):

```bash
bash scripts/blog/track-positions.sh 2>&1 | grep -i cluster-expansion
```

Expected: log lines `cluster-expansion: scanning winners …` and either `CE_SEEDED …` + a seeded count, or `no clusters above floor`.

Then verify any seeded rows and that a second run does NOT duplicate them:

```bash
docker exec supabase-db psql -U postgres -d postgres -c "SELECT id, keyword, category_slug, cluster_id, impressions FROM ai_aggregator.blog_keywords WHERE source='cluster_expansion' ORDER BY created_at DESC LIMIT 10;" 2>&1 | grep -vE 'WARNING|DETAIL|HINT|collation'
bash scripts/blog/track-positions.sh 2>&1 | grep -i 'cluster-expansion:' | tail -3
docker exec supabase-db psql -U postgres -d postgres -c "SELECT COUNT(*) AS ce_total FROM ai_aggregator.blog_keywords WHERE source='cluster_expansion';" 2>&1 | grep -vE 'WARNING|DETAIL|HINT|collation'
```

Expected: the count is the same after the second run (coverage check prevents dupes).

**Step 6: Commit**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
git add scripts/blog/track-positions.sh
git commit -m "feat(blog): cluster-expansion producer in track-positions.sh

After the daily drop-flagging, scan clusters by blended real-traffic
score (clicks*5 + impressions, 7d, from blog_positions — NOT Wordstat
volume), exclude VPN, keep >= floor, take top-N, and seed up to
KW_PER_CLUSTER uncovered related_keywords into blog_keywords as
source='cluster_expansion' priority='high'. Idempotent (coverage check).
Telegram summary when keywords are seeded. Flags ENABLED/TOP_N/MIN_SCORE/
KW_PER_CLUSTER default-on. Double VPN guard (WHERE-regex + per-keyword)."
```

---

## Task 4: Consumer — slot-parity branch + normal-path source exclusion (generate-article.sh)

**Files:**

- Modify: `scripts/blog/generate-article.sh`

**Step 1: Read the relevant regions**

Run:

```bash
grep -n 'Target category for today\|for attempt in\|KW_CAT_MATCH=\|blog-keywords/next\|SCRIPT_DIR' scripts/blog/generate-article.sh
```

Note: (a) where `TARGET_CAT` is finalized (the `log "Target category for today…"` line), (b) the category-hinted `KW_CAT_MATCH` REST query, (c) the global-fallback `${API_URL}/api/cron/blog-keywords/next` call.

**Step 2: Source the slot-parity helper near the top**

After the line that sources `notify.sh` (find it: `grep -n 'source.*notify.sh' scripts/blog/generate-article.sh`), add:

```bash
source "${SCRIPT_DIR}/lib/slot-parity.sh"
```

**Step 3: Add the expansion-slot decision + keyword pre-pick right AFTER `TARGET_CAT` is finalized**

Immediately after the `log "Target category for today: $TARGET_CAT ($TARGET_CAT_NAME)"` line, insert:

```bash
# ── Cluster-expansion consumer: slot-parity gate ────────────────────────
# ~50% of daily slots prefer high-priority cluster_expansion keywords.
# Expansion on 08/12/16/20 MSK, normal on 10/14/18/22 (is_expansion_slot).
# On an expansion slot with a pending expansion keyword, that keyword's
# category OVERRIDES the category-of-the-day. Otherwise fall through to
# normal rotation (slot never wasted). See spec 2026-06-10.
CE_ENABLED="${CLUSTER_EXPANSION_ENABLED:-1}"
EXPANSION_KEYWORD=""
EXPANSION_KW_ID=""
EXPANSION_CLUSTER_ID=""
SLOT_HOUR_MSK=$(TZ=Europe/Moscow date +%H)
if [[ "$CE_ENABLED" == "1" ]] && is_expansion_slot "$SLOT_HOUR_MSK"; then
  CE_ROW=$(curl -sf "${SUPABASE_URL}/rest/v1/blog_keywords?select=id,keyword,category_slug,cluster_id&status=eq.pending&source=eq.cluster_expansion&order=priority.asc,impressions.desc&limit=1" "${SUPA_HDRS[@]}" 2> /dev/null)
  if [[ -n "$CE_ROW" && "$CE_ROW" != "[]" ]]; then
    EXPANSION_KEYWORD=$(echo "$CE_ROW" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d[0]['keyword'] if d else '')")
    EXPANSION_KW_ID=$(echo "$CE_ROW" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d[0]['id'] if d else '')")
    EXPANSION_CLUSTER_ID=$(echo "$CE_ROW" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d[0].get('cluster_id') or '')")
    EXP_CAT=$(echo "$CE_ROW" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d[0].get('category_slug') or '')")
    if [[ -n "$EXPANSION_KEYWORD" && -n "$EXP_CAT" ]]; then
      # Override category-of-the-day with the winning cluster's category.
      EXP_CAT_ROW=$(curl -sf "${SUPABASE_URL}/rest/v1/blog_categories?select=slug,name,id&slug=eq.${EXP_CAT}&is_active=eq.true&limit=1" "${SUPA_HDRS[@]}" 2> /dev/null)
      if [[ -n "$EXP_CAT_ROW" && "$EXP_CAT_ROW" != "[]" ]]; then
        TARGET_CAT=$(echo "$EXP_CAT_ROW" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d[0]['slug'])")
        TARGET_CAT_ID=$(echo "$EXP_CAT_ROW" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d[0]['id'])")
        TARGET_CAT_NAME=$(echo "$EXP_CAT_ROW" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d[0]['name'])")
        log "EXPANSION slot ($SLOT_HOUR_MSK MSK): using cluster=$EXPANSION_CLUSTER_ID kw='$EXPANSION_KEYWORD' cat=$TARGET_CAT (overrode category-of-the-day)"
      else
        log "EXPANSION slot: cluster category '$EXP_CAT' inactive/missing — falling back to normal"
        EXPANSION_KEYWORD=""
      fi
    fi
  else
    log "EXPANSION slot ($SLOT_HOUR_MSK MSK): no pending expansion keywords, falling back to normal rotation"
  fi
fi
# ────────────────────────────────────────────────────────────────────────
```

**Step 4: Use the pre-picked expansion keyword as attempt-1 candidate, and exclude expansion-source on normal queries**

In the `for attempt in $(seq 1 $MAX_KEYWORD_ATTEMPTS)` loop, BEFORE the existing `KW_CAT_MATCH=` line, add the expansion short-circuit and gate the normal queries:

```bash
# Cluster-expansion: on attempt 1, if we pre-picked an expansion keyword,
# use it directly (its cluster_id is known so cluster-builder reuses it).
if [[ $attempt -eq 1 && -n "$EXPANSION_KEYWORD" ]]; then
  CANDIDATE_KEYWORD="$EXPANSION_KEYWORD"
  CANDIDATE_ID="$EXPANSION_KW_ID"
  log "Attempt 1/${MAX_KEYWORD_ATTEMPTS} keyword (cluster-expansion): '$CANDIDATE_KEYWORD' (id=$CANDIDATE_ID, cluster=$EXPANSION_CLUSTER_ID)"
else
  # Normal path. Exclude cluster_expansion source so normal slots (and
  # later attempts on expansion slots) don't consume high-priority
  # expansion keywords — that would break the 50% cap.
  KW_CAT_MATCH=$(curl -sf "${SUPABASE_URL}/rest/v1/blog_keywords?select=id,keyword&status=eq.pending&category_slug=eq.${TARGET_CAT}&source=neq.cluster_expansion&order=priority.asc,impressions.desc&limit=1" "${SUPA_HDRS[@]}" 2> /dev/null)
  if [[ -n "$KW_CAT_MATCH" && "$KW_CAT_MATCH" != "[]" ]]; then
    CANDIDATE_KEYWORD=$(echo "$KW_CAT_MATCH" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['keyword'] if d else '')")
    CANDIDATE_ID=$(echo "$KW_CAT_MATCH" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['id'] if d else '')")
    log "Attempt ${attempt}/${MAX_KEYWORD_ATTEMPTS} keyword (category-hinted): '$CANDIDATE_KEYWORD' (id=$CANDIDATE_ID)"
  else
    [[ $attempt -eq 1 ]] && log "No category-hinted keyword for '$TARGET_CAT', falling back to global queue"
    # Direct REST global fallback (was the /api/cron/blog-keywords/next
    # endpoint; replaced with REST so we can exclude cluster_expansion
    # in-script without an app deploy).
    GLOBAL_ROW=$(curl -sf "${SUPABASE_URL}/rest/v1/blog_keywords?select=id,keyword&status=eq.pending&source=neq.cluster_expansion&order=priority.asc,impressions.desc&limit=1" "${SUPA_HDRS[@]}" 2> /dev/null)
    if [[ -z "$GLOBAL_ROW" || "$GLOBAL_ROW" == "[]" ]]; then
      log "No pending keywords at all. Triggering collection..."
      curl -sf -X POST "${API_URL}/api/cron/blog-keywords" -H "Authorization: Bearer ${CRON_SECRET}" || true
      exit 0
    fi
    CANDIDATE_KEYWORD=$(echo "$GLOBAL_ROW" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['keyword'] if d else '')")
    CANDIDATE_ID=$(echo "$GLOBAL_ROW" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['id'] if d else '')")
    log "Attempt ${attempt}/${MAX_KEYWORD_ATTEMPTS} keyword (fallback): '$CANDIDATE_KEYWORD' (id=$CANDIDATE_ID)"
  fi
fi
```

Then **DELETE the original keyword-fetch block** that this replaces. It is the
contiguous span from `KW_CAT_MATCH=$(curl ...` (currently \~line 177) through the
`fi` that closes the global-fallback `else` (currently \~line 195) — i.e.
everything from the old category-hinted query down to and including the `fi`
immediately BEFORE `if [[ -z "$CANDIDATE_KEYWORD" || -z "$CANDIDATE_ID" ]]; then`.
Find the exact span first:

```bash
grep -n 'KW_CAT_MATCH=\|blog-keywords/next\|CANDIDATE_KEYWORD" || -z "\$CANDIDATE_ID' scripts/blog/generate-article.sh
```

Delete from the `KW_CAT_MATCH=` line through the `fi` right before the
`-z "$CANDIDATE_KEYWORD"` guard, inclusive. The new block above is its FULL
replacement — leaving any of the old lines causes a double-fetch (the old
un-excluded category query would run first and could grab an expansion keyword
on attempt 1, breaking the 50% cap) or a bash syntax error from an orphaned
`if/else/fi`.

**Step 5: Syntax check**

Run: `bash -n scripts/blog/generate-article.sh && echo "SYNTAX OK"`
Expected: `SYNTAX OK`.

**Step 6: Verify normal-path queries now carry the exclusion, expansion query is present**

Run:

```bash
grep -c 'source=neq.cluster_expansion' scripts/blog/generate-article.sh # expect 2 (category-hinted + global)
grep -c 'source=eq.cluster_expansion' scripts/blog/generate-article.sh  # expect 1 (the pre-pick)
grep -c 'is_expansion_slot' scripts/blog/generate-article.sh            # expect >=1
grep -c 'blog-keywords/next' scripts/blog/generate-article.sh           # expect 0 (endpoint call removed)
# Double-fetch guard: the OLD category-hinted query had no source filter.
# If any category_slug query WITHOUT source=neq remains, the old block wasn't
# fully deleted.
grep -nE 'category_slug=eq\.\$\{TARGET_CAT\}&order' scripts/blog/generate-article.sh # every hit MUST contain source=neq.cluster_expansion
```

Expected counts as annotated. The last grep: inspect each hit — if any
`category_slug=...&order` query line lacks `source=neq.cluster_expansion`, the
old block survived the delete; remove it.

**Step 7: Commit**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
git add scripts/blog/generate-article.sh
git commit -m "feat(blog): cluster-expansion consumer — slot-parity 50% cap

Expansion slots (08/12/16/20 MSK) prefer pending source=cluster_expansion
keywords; the keyword's category overrides category-of-the-day and its
cluster_id is reused. Normal slots (and later attempts) exclude
source=cluster_expansion so they can't steal the high-priority expansion
keywords (preserves the 50% cap). Global fallback switched from the
/api/cron/blog-keywords/next endpoint to a direct REST query so the
exclusion works without an app deploy. Kill-switch CLUSTER_EXPANSION_ENABLED."
```

---

## Task 5: Live end-to-end verification with a synthetic winner

Prove producer→consumer works without waiting for organic traffic.

**Step 1: Seed a synthetic non-VPN winning cluster**

Pick a real published non-VPN post + its cluster, give one of its posts a fake high-traffic `blog_positions` row dated today:

```bash
docker exec supabase-db psql -U postgres -d postgres -c "
-- find a non-VPN cluster that has a published post and related_keywords
SELECT bc.id AS cluster_id, bp.id AS post_id, bc.category_slug, array_length(bc.related_keywords,1) AS n_related
FROM ai_aggregator.blog_clusters bc
JOIN ai_aggregator.blog_posts bp ON bp.cluster_id=bc.id AND bp.status='published'
WHERE bc.primary_keyword !~* '(vpn|впн|vless|amnezia|прокси|proxy)'
  AND bc.related_keywords IS NOT NULL AND array_length(bc.related_keywords,1) > 0
LIMIT 1;
" 2>&1 | grep -vE 'WARNING|DETAIL|HINT|collation'
```

Take the `post_id` from the output and insert a fake winner row (replace `<POST_ID>`):

```bash
docker exec supabase-db psql -U postgres -d postgres -c "
INSERT INTO ai_aggregator.blog_positions (post_id, snapshot_date, impressions, clicks, ctr, avg_position)
VALUES ('<POST_ID>', now()::date, 200, 50, 0.25, 3.0);
" 2>&1 | grep -vE 'WARNING|DETAIL|HINT|collation'
```

**Step 2: Run the producer, confirm seeding**

```bash
bash scripts/blog/track-positions.sh 2>&1 | grep -i 'cluster-expansion'
docker exec supabase-db psql -U postgres -d postgres -c "SELECT keyword, category_slug, cluster_id FROM ai_aggregator.blog_keywords WHERE source='cluster_expansion' ORDER BY created_at DESC LIMIT 5;" 2>&1 | grep -vE 'WARNING|DETAIL|HINT|collation'
```

Expected: `CE_SEEDED cluster=… kw=…` lines and rows present.

**Step 3: Confirm an expansion-slot consumer would pick it (dry, no generation)**

Simulate the consumer's pre-pick query for an expansion hour without running Claude:

```bash
source scripts/blog/lib/slot-parity.sh
for h in 08 10 12 14 16 18 20 22; do is_expansion_slot $h && echo "$h EXPANSION" || echo "$h normal"; done
set -a
source /home/deploy/.config/blog-autogen/env
set +a
SUPA_HDRS=(-H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" -H "Accept-Profile: ai_aggregator")
curl -sf "${SUPABASE_URL}/rest/v1/blog_keywords?select=id,keyword,category_slug,cluster_id&status=eq.pending&source=eq.cluster_expansion&order=priority.asc,impressions.desc&limit=1" "${SUPA_HDRS[@]}"
```

Expected: the 4/4 split prints, and the curl returns the seeded keyword JSON (what an expansion slot would consume).

**Step 4: Confirm a normal-slot query does NOT return it**

```bash
curl -sf "${SUPABASE_URL}/rest/v1/blog_keywords?select=id,keyword&status=eq.pending&source=neq.cluster_expansion&category_slug=eq.<EXP_CAT>&order=priority.asc,impressions.desc&limit=1" "${SUPA_HDRS[@]}"
```

(Use the seeded keyword's `category_slug` for `<EXP_CAT>`.) Expected: returns a DIFFERENT keyword or `[]` — never the cluster_expansion one.

**Step 5: Clean up the fixture**

```bash
docker exec supabase-db psql -U postgres -d postgres -c "
DELETE FROM ai_aggregator.blog_positions WHERE post_id='<POST_ID>' AND impressions=200 AND clicks=50;
DELETE FROM ai_aggregator.blog_keywords WHERE source='cluster_expansion' AND keyword='__test%';
" 2>&1 | grep -vE 'WARNING|DETAIL|HINT|collation'
```

> Note: leave any REAL cluster_expansion keywords that were seeded from organic traffic — only delete the synthetic fixture row(s). If unsure, list them first and delete by exact keyword.

**Step 6: No commit** (verification only). If a fix was needed, it goes into the relevant prior task's file + an amend/fixup commit.

---

## Task 6: Docs — promote cluster-expansion into the instruction body

**Files:**

- Modify: `docs/seo_blog_instruction.md`

**Step 1: Move §15 backlog entry into the live section**

In `docs/seo_blog_instruction.md`:

1. In **§8** (реоптимизация), after the "это механика «спасение падающих»…" paragraph, replace the sentence that says cluster-expansion "пока нет" with a short subsection documenting that it now EXISTS: producer in track-positions.sh, consumer slot-parity in generate-article.sh, flags, and the seeding/coverage behavior.
2. Add a **runbook row** to §13:
   `| Expansion не сеет ключи | Трафик ниже floor (min_score=5) ИЛИ все related покрыты | Норма пока трафик мал; проверь \`CLUSTER_EXPANSION\_\*\` флаги + дай трафику вырасти |\`
3. In **§15**, replace the "в реализации" entry with a one-line "✅ реализовано (см. §8)" pointer (keep the spec link).
4. Add the 4 flags to **§12** env table (optional override).

**Step 2: Refresh the LIVE STATE block (keeps counts current)**

Run: `bash scripts/blog/refresh-instruction-state.sh`
Expected: exit 0; the LIVE-STATE block updates.

**Step 3: Commit**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
git add docs/seo_blog_instruction.md
git commit -m "docs(blog): cluster-expansion loop is live — promote into instruction body

Moves the feature out of §15 backlog into §8 (next to reoptimization),
adds a §13 runbook row and the 4 flags to §12. The loop now exists:
producer seeds winning-cluster keywords, consumer spends ~50% of slots
on them via slot-parity."
```

---

## After all tasks

- Push the chain: `git push origin canary`.
- Shell scripts are already live (run from disk). The migration is applied. No container deploy needed.
- The producer fires on the next `blog-positions.timer` (04:00 MSK); the consumer on the next expansion slot (08/12/16/20 MSK).
- Watch the first organic seeding in Telegram (`✅ cluster-expansion: Засеяно N ключей…`) — but expect silence until real traffic crosses the floor (min_score=5), which is correct.
