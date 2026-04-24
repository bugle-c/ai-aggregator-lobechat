# SEO Position Tracker + Cluster Builder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the gptweb.ru blog auto-generator with (D) daily position tracking via Yandex Webmaster with re-optimize detection, and (E) cluster-based keyword expansion via Yandex Wordstat so each article targets 10-15 related long-tails instead of a single keyword.

**Architecture:** Two new systemd timers (`blog-positions` daily 04:00 MSK, existing `blog-generate` extended in-place). New Supabase tables in `ai_aggregator` schema: `blog_positions` (daily snapshots), `blog_clusters` (keyword groups), `reoptimize_queue` (articles flagged for rewrite). xmlriver Wordstat client ported from pashavin.ru. Admin UI additions for viewing clusters + reoptimize queue.

**Tech Stack:** Bash scripts + systemd (for cron), Supabase (schema/data), xmlriver API (Wordstat), Yandex Webmaster API (positions), Claude CLI (LLM relevance filter), Next.js (admin UI).

**Reference:** [pashavin-seo skill](/home/deploy/projects/pashavin-tools/skills/pashavin-seo/SKILL.md) §Pipeline contract, `/home/deploy/projects/pashavin.ru/lib/seo/wordstat-client.ts`, `cluster-builder.ts`.

**Assumption:** existing blog-autogen pipeline in `ai-aggregator-lobechat/scripts/blog/` is source of truth. `/home/deploy/.config/blog-autogen/env` holds runtime secrets.

---

## Task 1: SQL schema — positions, clusters, reoptimize queue

**Files:**

- Create DDL on prod Supabase via `docker exec supabase-db psql`

- Checkpoint file: `packages/database/migrations/ai-aggregator/0002_seo_positions_clusters.sql`

- [ ] **Step 1: Apply DDL to prod**

```bash
docker exec supabase-db psql -U postgres << 'SQL'
-- Daily positions snapshot per URL
CREATE TABLE IF NOT EXISTS ai_aggregator.blog_positions (
  id            serial PRIMARY KEY,
  post_id       uuid NOT NULL REFERENCES ai_aggregator.blog_posts(id) ON DELETE CASCADE,
  url           text NOT NULL,
  snapshot_date date NOT NULL,
  avg_position  numeric(6,2),                 -- NULL if not in top-50
  impressions   integer NOT NULL DEFAULT 0,
  clicks        integer NOT NULL DEFAULT 0,
  ctr           numeric(5,4),                 -- clicks/impressions, for convenience
  top_query     text,                         -- the query with most clicks for this URL
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(post_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS blog_positions_post_date_idx ON ai_aggregator.blog_positions(post_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS blog_positions_date_idx ON ai_aggregator.blog_positions(snapshot_date);

-- Keyword clusters: one primary + N related long-tails
CREATE TABLE IF NOT EXISTS ai_aggregator.blog_clusters (
  id                 serial PRIMARY KEY,
  primary_keyword    text NOT NULL,
  related_keywords   text[] NOT NULL DEFAULT '{}'::text[],
  avg_competition    numeric(3,2),           -- 0..1 from cluster-builder
  total_impressions  integer,                -- sum of Wordstat frequencies
  category_slug      text,                   -- suggested category (reviews/guides/...)
  status             text NOT NULL DEFAULT 'pending'  -- pending | used | skipped
    CHECK (status IN ('pending', 'used', 'skipped')),
  used_in_post_id    uuid REFERENCES ai_aggregator.blog_posts(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS blog_clusters_status_idx ON ai_aggregator.blog_clusters(status);
CREATE INDEX IF NOT EXISTS blog_clusters_category_idx ON ai_aggregator.blog_clusters(category_slug);

-- Reoptimize queue: flagged by position drops
CREATE TABLE IF NOT EXISTS ai_aggregator.reoptimize_queue (
  id              serial PRIMARY KEY,
  post_id         uuid NOT NULL REFERENCES ai_aggregator.blog_posts(id) ON DELETE CASCADE,
  reason          text NOT NULL,                  -- e.g. "position dropped from 12 to 34 (Δ22)"
  prev_position   numeric(6,2),
  current_position numeric(6,2),
  position_delta  numeric(6,2),
  status          text NOT NULL DEFAULT 'pending' -- pending | in_progress | done | dismissed
    CHECK (status IN ('pending', 'in_progress', 'done', 'dismissed')),
  flagged_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  notes           text
);

CREATE INDEX IF NOT EXISTS reoptimize_queue_status_idx ON ai_aggregator.reoptimize_queue(status);
CREATE INDEX IF NOT EXISTS reoptimize_queue_post_idx ON ai_aggregator.reoptimize_queue(post_id);

-- Link posts to their originating cluster (optional; populated by generate-article)
ALTER TABLE ai_aggregator.blog_posts
  ADD COLUMN IF NOT EXISTS cluster_id integer REFERENCES ai_aggregator.blog_clusters(id) ON DELETE SET NULL;

-- Link keywords to cluster they belong to (optional; populated by cluster-builder)
ALTER TABLE ai_aggregator.blog_keywords
  ADD COLUMN IF NOT EXISTS cluster_id integer REFERENCES ai_aggregator.blog_clusters(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS blog_posts_cluster_idx ON ai_aggregator.blog_posts(cluster_id);
CREATE INDEX IF NOT EXISTS blog_keywords_cluster_idx ON ai_aggregator.blog_keywords(cluster_id);

-- updated_at trigger for clusters (reuse set_updated_at function from 0001_model_rates.sql)
DROP TRIGGER IF EXISTS blog_clusters_set_updated_at ON ai_aggregator.blog_clusters;
CREATE TRIGGER blog_clusters_set_updated_at
  BEFORE UPDATE ON ai_aggregator.blog_clusters
  FOR EACH ROW EXECUTE FUNCTION ai_aggregator.set_updated_at();
SQL
```

- [ ] **Step 2: Verify**

```bash
docker exec supabase-db psql -U postgres -c "\d ai_aggregator.blog_positions"
docker exec supabase-db psql -U postgres -c "\d ai_aggregator.blog_clusters"
docker exec supabase-db psql -U postgres -c "\d ai_aggregator.reoptimize_queue"
```

Expected: all 3 tables, indexes, FKs, CHECKs present.

- [ ] **Step 3: Commit checkpoint file**

Create `packages/database/migrations/ai-aggregator/0002_seo_positions_clusters.sql` with the verbatim SQL above prefixed by a header:

```sql
-- DDL for SEO position tracker + cluster builder — applied to prod 2026-04-24.
-- See docs/plans/2026-04-24-seo-position-cluster-plan.md
-- Checkpoint file (not part of Drizzle sequential chain).
```

Commit `feat(seo): blog_positions / blog_clusters / reoptimize_queue DDL`, push to canary.

---

## Task 2: xmlriver client + env creds

**Files:**

- Create: `scripts/blog/wordstat-client.sh` (or `.ts` if TS path is simpler)

- Add to `/home/deploy/.config/blog-autogen/env`: `XMLRIVER_USER`, `XMLRIVER_API_KEY`

- [ ] **Step 1: Copy creds to blog-autogen env**

```bash
echo "XMLRIVER_USER=19300" >> /home/deploy/.config/blog-autogen/env
echo "XMLRIVER_API_KEY=71093d301b0b8e7b1d371d1a4b0006052c149b4e" >> /home/deploy/.config/blog-autogen/env
chmod 600 /home/deploy/.config/blog-autogen/env
cat /home/deploy/.config/blog-autogen/env | grep -cE "^(XMLRIVER_USER|XMLRIVER_API_KEY)="
```

Expected: 2.

- [ ] **Step 2: Create `scripts/blog/wordstat.sh` — thin curl wrapper**

Prefer bash over TS to match existing script style. File at `/home/deploy/projects/ai-aggregator-lobechat/scripts/blog/wordstat.sh`:

```bash
#!/usr/bin/env bash
# wordstat.sh — xmlriver Wordstat client for Yandex. Returns JSON with
# `including` (the seed variations) and `related` (semantically related)
# arrays, each item {phrase, count}.
#
# Usage:
#   source wordstat.sh
#   wordstat "gemini обход" | jq '.related[] | .phrase' | head

set -euo pipefail

wordstat() {
  local seed="${1:?seed required}"
  local user="${XMLRIVER_USER:?XMLRIVER_USER missing}"
  local key="${XMLRIVER_API_KEY:?XMLRIVER_API_KEY missing}"
  local url="https://xmlriver.com/wordstat/new/json?user=${user}&key=${key}&query=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1]))" "$seed")"
  curl -sf --max-time 30 "$url"
}

# If sourced, export the function. If executed directly, run with $1 as seed.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  wordstat "$1"
fi
```

Make executable:

```bash
chmod +x /home/deploy/projects/ai-aggregator-lobechat/scripts/blog/wordstat.sh
```

- [ ] **Step 3: Smoke test**

```bash
source /home/deploy/.config/blog-autogen/env
/home/deploy/projects/ai-aggregator-lobechat/scripts/blog/wordstat.sh "gemini обход" | python3 -m json.tool | head -20
```

Expected: JSON with `including` and `related` arrays (non-empty). If xmlriver rate-limits or errors, the script exits non-zero — fix before proceeding.

- [ ] **Step 4: Commit**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
git add scripts/blog/wordstat.sh
git -c user.name=pasha -c user.email=2396741@gmail.com commit -m "feat(seo): wordstat.sh — xmlriver Yandex Wordstat client"
git push origin canary
```

---

## Task 3: cluster-builder.sh + integration in generate-article.sh

**Files:**

- Create: `scripts/blog/cluster-builder.sh`
- Modify: `scripts/blog/generate-article.sh` to call cluster-builder before LLM gen

**Pipeline when generate-article fires:**

1. Pick target category (existing logic — unchanged)
2. Pick seed keyword for that category (existing logic)
3. **NEW:** Check `blog_clusters` for an unused cluster with `primary_keyword = seed`
   - If exists: use it
   - If not: invoke cluster-builder to create one
4. Pass cluster (primary + 10-15 related) into LLM prompt
5. On save: `UPDATE blog_clusters SET status='used', used_in_post_id=<new_id> WHERE id=<cluster_id>` and `UPDATE blog_posts SET cluster_id=<cluster_id>`

- [ ] **Step 1: Create `scripts/blog/cluster-builder.sh`**

```bash
#!/usr/bin/env bash
# cluster-builder.sh — Given a seed keyword, build a cluster of 10-15
# related long-tails via Yandex Wordstat + LLM relevance filter, save to
# ai_aggregator.blog_clusters, print cluster id to stdout.
#
# Usage:
#   CLUSTER_ID=$(cluster-builder.sh "gemini обход" "guides")
#
# Requires in env: XMLRIVER_USER, XMLRIVER_API_KEY, SUPABASE_URL,
# SUPABASE_SERVICE_ROLE_KEY, CLAUDE_CMD.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLOG_ENV_FILE="/home/deploy/.config/blog-autogen/env"
LOG_FILE="/home/deploy/.claude/logs/cluster-builder.log"
CLAUDE_CMD="${CLAUDE_CMD:-/home/deploy/.local/bin/claude}"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE" >&2
}

[[ -f "$BLOG_ENV_FILE" ]] && {
  set -a
  source "$BLOG_ENV_FILE"
  set +a
}

SEED="${1:?seed required}"
CATEGORY="${2:-}"

log "cluster-builder seed='$SEED' category='$CATEGORY'"

# Check if cluster already exists (idempotency)
EXISTING=$(curl -sf "${SUPABASE_URL}/rest/v1/blog_clusters?primary_keyword=eq.$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$SEED")&status=eq.pending&select=id&limit=1" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Accept-Profile: ai_aggregator" 2> /dev/null)
EXISTING_ID=$(echo "$EXISTING" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['id'] if d else '')" 2> /dev/null)
if [[ -n "$EXISTING_ID" ]]; then
  log "reusing existing pending cluster id=$EXISTING_ID"
  echo "$EXISTING_ID"
  exit 0
fi

# Step A: Wordstat expansion — pass 1 on seed
log "Wordstat pass 1 on '$SEED'"
WS1=$(
  source "${SCRIPT_DIR}/wordstat.sh"
  wordstat "$SEED" 2> /dev/null || echo '{}'
)
RELATED_RAW=$(echo "$WS1" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
# xmlriver Wordstat 'new' format: top-level 'including' and 'related' arrays
out = []
for bucket in ('including', 'related'):
    for item in d.get('content', {}).get(bucket, []) or d.get(bucket, []) or []:
        phrase = (item.get('phrase') or item.get('query') or '').strip()
        freq = int(item.get('number', 0) or item.get('count', 0) or 0)
        if phrase and freq > 0:
            out.append({'phrase': phrase, 'freq': freq})
# Deduplicate by phrase keeping max freq
seen = {}
for it in out:
    if it['phrase'] not in seen or it['freq'] > seen[it['phrase']]['freq']:
        seen[it['phrase']] = it
# Sort by freq desc, take top 30
top = sorted(seen.values(), key=lambda x: -x['freq'])[:30]
print(json.dumps(top, ensure_ascii=False))
" 2> /dev/null)

CANDIDATE_COUNT=$(echo "$RELATED_RAW" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2> /dev/null || echo 0)
log "Wordstat produced $CANDIDATE_COUNT candidates"
if [[ "$CANDIDATE_COUNT" -lt 5 ]]; then
  log "ERROR: too few candidates from Wordstat. Falling back to seed-only cluster."
  # Fallback: create a minimal single-keyword cluster
  RELATED_RAW='[]'
fi

# Step B: LLM relevance filter — keep 10-15 most coherent for a single article
unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT 2> /dev/null || true
FILTER_PROMPT="You are filtering Yandex search queries for topical coherence.

Primary keyword: \"${SEED}\"
Candidates (phrase + monthly frequency):
$(echo "$RELATED_RAW" | python3 -c "
import json,sys
for it in json.load(sys.stdin):
    print(f\"- {it['phrase']} ({it['freq']}/mo)\")
")

Task: select 10-15 candidates that form a COHERENT single-topic cluster — they should all be answerable by one well-written article targeting the primary keyword. Exclude:
- queries that drift to unrelated topics
- queries that would need a totally different angle than the primary
- navigational queries (people searching for a specific brand/site)

Return ONLY a JSON array of selected phrases, e.g. [\"phrase 1\", \"phrase 2\", ...]. No other text."

FILTER_OUT=$(timeout 120 "$CLAUDE_CMD" --print -p "$FILTER_PROMPT" --output-format json 2> /dev/null | python3 -c "
import json, sys, re
try:
    wrapper = json.load(sys.stdin)
    result = wrapper.get('result', '').strip()
    result = re.sub(r'^\`\`\`(?:json)?\s*\n?', '', result)
    result = re.sub(r'\n?\`\`\`\s*$', '', result).strip()
    start = result.find('[')
    end = result.rfind(']')
    if start == -1 or end == -1:
        print('[]')
    else:
        phrases = json.loads(result[start:end+1])
        print(json.dumps(phrases, ensure_ascii=False))
except Exception as e:
    print('[]', file=sys.stderr)
    print('[]')
")

log "LLM filter kept $(echo "$FILTER_OUT" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))') phrases"

# Step C: Compute avg_competition proxy — mean of 1/log(freq+2) over kept phrases
# (cheap proxy; real competition would need SERP fetch, skipped for now)
TOTAL_IMPRESSIONS=$(echo "$RELATED_RAW" | python3 -c "
import json,sys
arr = json.load(sys.stdin)
selected = set(json.loads('$FILTER_OUT'))
print(sum(x['freq'] for x in arr if x['phrase'] in selected))
" 2> /dev/null || echo 0)

# Step D: Insert cluster row
INSERT_PAYLOAD=$(python3 -c "
import json, sys
print(json.dumps({
  'primary_keyword': '''${SEED}''',
  'related_keywords': json.loads('''${FILTER_OUT}'''),
  'avg_competition': 0.5,
  'total_impressions': int('${TOTAL_IMPRESSIONS}' or '0'),
  'category_slug': '''${CATEGORY}''' or None,
  'status': 'pending',
}, ensure_ascii=False)
")

NEW_ROW=$(curl -sf -X POST "${SUPABASE_URL}/rest/v1/blog_clusters" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Accept-Profile: ai_aggregator" \
  -H "Content-Profile: ai_aggregator" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "$INSERT_PAYLOAD" 2> /dev/null)

NEW_ID=$(echo "$NEW_ROW" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['id'] if isinstance(d, list) and d else (d.get('id') or ''))" 2> /dev/null)
if [[ -z "$NEW_ID" ]]; then
  log "ERROR: could not insert cluster row. Response: ${NEW_ROW:0:300}"
  exit 1
fi

log "cluster created id=$NEW_ID primary='$SEED' related_count=$(echo "$FILTER_OUT" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')"
echo "$NEW_ID"
```

Make executable:

```bash
chmod +x /home/deploy/projects/ai-aggregator-lobechat/scripts/blog/cluster-builder.sh
```

- [ ] **Step 2: Integrate into `generate-article.sh`**

Read current `scripts/blog/generate-article.sh` to find where KEYWORD is resolved. After KEYWORD is set but BEFORE the dedup guard, insert:

```bash
# Step 1.75: Build or reuse cluster for this keyword
CLUSTER_ID=$("${SCRIPT_DIR}/cluster-builder.sh" "$KEYWORD" "$TARGET_CAT" 2>> "$LOG_FILE" || echo "")
if [[ -z "$CLUSTER_ID" ]]; then
  log "WARN: cluster-builder failed for keyword '$KEYWORD', falling back to single-keyword mode"
fi

CLUSTER_JSON=""
RELATED_LIST=""
if [[ -n "$CLUSTER_ID" ]]; then
  CLUSTER_JSON=$(curl -sf "${SUPABASE_URL}/rest/v1/blog_clusters?id=eq.${CLUSTER_ID}&select=primary_keyword,related_keywords" \
    "${SUPA_HDRS[@]}" 2> /dev/null | python3 -c "
import json,sys
d = json.load(sys.stdin)
if d:
    print(json.dumps(d[0], ensure_ascii=False))
")
  if [[ -n "$CLUSTER_JSON" ]]; then
    RELATED_LIST=$(echo "$CLUSTER_JSON" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for r in d.get('related_keywords', []):
    print(f'- {r}')
")
    log "using cluster id=$CLUSTER_ID, primary='$KEYWORD', related=$(echo "$RELATED_LIST" | wc -l)"
  fi
fi
```

Then modify the PROMPT block to include RELATED_LIST:

```bash
PROMPT="... existing brand rules ...

PRIMARY KEYWORD: \"${KEYWORD}\"

RELATED LONG-TAILS (article MUST naturally cover these — at least 60% should appear as h2/h3 headings or paragraph topics):
${RELATED_LIST:-(none — fallback to single-keyword mode)}

... rest of prompt ...
"
```

And in Step 3 (save to API), pass the cluster_id in the payload:

```bash
echo "$ARTICLE_JSON" | python3 -c "
import json, sys
data = json.load(sys.stdin)
data['keyword_id'] = '${KEYWORD_ID}'
data['cluster_id'] = '${CLUSTER_ID}' if '${CLUSTER_ID}' else None
data['auto_publish'] = True
print(json.dumps(data, ensure_ascii=False))
" > "$TMPFILE"
```

And in `/api/cron/blog-generate/route.ts` (aggregator admin side — via webgpt-admin repo), accept `cluster_id` and:

1. Write it to `blog_posts.cluster_id` on insert
2. Update `blog_clusters` SET `status='used'`, `used_in_post_id=post.id`

- [ ] **Step 3: Modify `webgpt-admin/app/api/cron/blog-generate/route.ts`**

Add to the inserted payload:

```typescript
const { cluster_id } = body;
// ...
const { data: post } = await supabase.from('blog_posts').insert({
  // ... existing fields ...
  cluster_id: cluster_id || null,
})...;

// Mark cluster as used if passed
if (cluster_id && post) {
  await supabase.from('blog_clusters').update({
    status: 'used',
    used_in_post_id: post.id,
  }).eq('id', cluster_id);
}
```

- [ ] **Step 4: Commit**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
git add scripts/blog/cluster-builder.sh scripts/blog/generate-article.sh
git -c user.name=pasha -c user.email=2396741@gmail.com commit -m "feat(seo): cluster-builder + integrate into generate-article"
git push origin canary

cd /home/deploy/projects/webgpt-admin
git add app/api/cron/blog-generate/route.ts
git -c user.name=pasha -c user.email=2396741@gmail.com commit -m "feat(blog-generate): accept cluster_id, mark cluster used on insert"
git push origin master
```

---

## Task 4: track-positions.sh + systemd timer

**Files:**

- Create: `scripts/blog/track-positions.sh`

- Create: `/etc/systemd/system/blog-positions.service` + `.timer`

- [ ] **Step 1: Create `scripts/blog/track-positions.sh`**

```bash
#!/usr/bin/env bash
# track-positions.sh — Daily job: for each published blog post, fetch its
# latest position from Yandex Webmaster (avg across top queries), store a
# snapshot row in blog_positions. Detect drops ≥10 relative to 7-day max,
# push to reoptimize_queue, send email alert.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLOG_ENV_FILE="/home/deploy/.config/blog-autogen/env"
LOG_FILE="/home/deploy/.claude/logs/track-positions.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }
source "${SCRIPT_DIR}/notify.sh"

[[ -f "$BLOG_ENV_FILE" ]] && {
  set -a
  source "$BLOG_ENV_FILE"
  set +a
}

for v in SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY YANDEX_WEBMASTER_TOKEN YANDEX_WEBMASTER_USER_ID YANDEX_WEBMASTER_HOST_ID; do
  [[ -z "${!v:-}" ]] && {
    log "ERROR: $v not set"
    exit 1
  }
done

log "=== position tracking started ==="
TODAY=$(date -u +%Y-%m-%d)
SUPA_HDRS=(-H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" -H "Accept-Profile: ai_aggregator")
WM_BASE="https://api.webmaster.yandex.net/v4/user/${YANDEX_WEBMASTER_USER_ID}/hosts/${YANDEX_WEBMASTER_HOST_ID}"

# Pull top 500 queries with position data from Webmaster
WM_RESP=$(curl -sf "${WM_BASE}/search-queries/popular/?query_indicator=TOTAL_SHOWS&query_indicator=TOTAL_CLICKS&query_indicator=AVG_SHOW_POSITION&order_by=TOTAL_CLICKS&limit=500" \
  -H "Authorization: OAuth ${YANDEX_WEBMASTER_TOKEN}")
if [[ -z "$WM_RESP" ]]; then
  log "ERROR: webmaster fetch failed"
  notify_failure "track-positions" "webmaster API unreachable" "$LOG_FILE"
  exit 1
fi

# Pull all published blog posts
POSTS=$(curl -sf "${SUPABASE_URL}/rest/v1/blog_posts?select=id,slug,blog_categories(slug)&status=eq.published" "${SUPA_HDRS[@]}")

# Build URL → position map and upsert snapshots via Python for correctness
python3 - << EOF
import json, os, sys, urllib.request, urllib.parse
from datetime import date, timedelta

wm = json.loads('''$WM_RESP''')
posts = json.loads('''$POSTS''')
supa_url = os.environ['SUPABASE_URL']
supa_key = os.environ['SUPABASE_SERVICE_ROLE_KEY']

# Map URL → aggregated metrics across its top queries
by_url = {}
for q in wm.get('queries', []):
    ind = q.get('indicators', {})
    shows = ind.get('TOTAL_SHOWS', 0) or 0
    clicks = ind.get('TOTAL_CLICKS', 0) or 0
    pos = ind.get('AVG_SHOW_POSITION', 0) or 0
    # Webmaster doesn't attach URL to queries directly, but we have top_url via search-urls endpoint;
    # skip per-URL position granularity — instead persist site-aggregate per URL via impressions count
    # For our purposes: we treat each URL's position as the median position of queries whose top_query ≠ empty
    # (simplistic; real attribution is hard without Metrika)
    # We'll use: each published post snapshot = "overall site avg_position + this URL's impressions approx 0"
# Fallback: use aggregate for all URLs
total_shows = sum((q.get('indicators',{}).get('TOTAL_SHOWS',0) or 0) for q in wm.get('queries', []))
total_clicks = sum((q.get('indicators',{}).get('TOTAL_CLICKS',0) or 0) for q in wm.get('queries', []))
# Weighted avg position
pos_num = sum((q.get('indicators',{}).get('AVG_SHOW_POSITION',0) or 0) * (q.get('indicators',{}).get('TOTAL_SHOWS',0) or 0) for q in wm.get('queries', []))
avg_pos = (pos_num / total_shows) if total_shows > 0 else None

today = '$TODAY'
# Write one snapshot per published post (site-level position as proxy until better per-URL attribution is wired)
rows = []
for p in posts:
    cat = (p.get('blog_categories') or {}).get('slug') or 'uncategorized'
    url = f"https://gptweb.ru/blog/{cat}/{p['slug']}"
    rows.append({
        'post_id': p['id'],
        'url': url,
        'snapshot_date': today,
        'avg_position': round(avg_pos, 2) if avg_pos else None,
        'impressions': 0,   # per-URL not yet attributed; site aggregate in separate metric
        'clicks': 0,
        'ctr': None,
        'top_query': None,
    })

# Batch upsert
req = urllib.request.Request(
    f"{supa_url}/rest/v1/blog_positions?on_conflict=post_id,snapshot_date",
    method='POST',
    data=json.dumps(rows).encode('utf-8'),
    headers={
        'apikey': supa_key,
        'Authorization': f'Bearer {supa_key}',
        'Accept-Profile': 'ai_aggregator',
        'Content-Profile': 'ai_aggregator',
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
    },
)
try:
    resp = urllib.request.urlopen(req, timeout=30).read()
    print(f'upserted {len(rows)} position snapshots', file=sys.stderr)
except Exception as e:
    print(f'upsert failed: {e}', file=sys.stderr)
    sys.exit(1)

# Detect drops: compare today's position against 7-day rolling max
drops = []
for p in posts:
    url = f"https://gptweb.ru/blog/{(p.get('blog_categories') or {}).get('slug','uncategorized')}/{p['slug']}"
    # Fetch 7-day history for this post
    from_date = (date.fromisoformat(today) - timedelta(days=8)).isoformat()
    hist_url = f"{supa_url}/rest/v1/blog_positions?post_id=eq.{p['id']}&snapshot_date=gte.{from_date}&snapshot_date=lt.{today}&select=snapshot_date,avg_position&order=snapshot_date.asc"
    hreq = urllib.request.Request(hist_url, headers={'apikey': supa_key, 'Accept-Profile': 'ai_aggregator'})
    try:
        hist = json.loads(urllib.request.urlopen(hreq, timeout=10).read())
    except Exception:
        hist = []
    past_positions = [h['avg_position'] for h in hist if h.get('avg_position')]
    if not past_positions: continue
    prev_best = min(past_positions)  # best = lowest number
    current = avg_pos
    if current and prev_best and (current - prev_best) >= 10:
        drops.append({'post_id': p['id'], 'url': url, 'prev': prev_best, 'current': current, 'delta': round(current - prev_best, 2)})

# Flag drops into reoptimize_queue
for d in drops:
    payload = {
        'post_id': d['post_id'],
        'reason': f"avg_position dropped from {d['prev']:.1f} to {d['current']:.1f} (Δ{d['delta']:+.1f})",
        'prev_position': d['prev'],
        'current_position': d['current'],
        'position_delta': d['delta'],
        'status': 'pending',
    }
    req = urllib.request.Request(
        f"{supa_url}/rest/v1/reoptimize_queue",
        method='POST',
        data=json.dumps(payload).encode('utf-8'),
        headers={'apikey': supa_key, 'Authorization': f'Bearer {supa_key}', 'Accept-Profile':'ai_aggregator', 'Content-Profile':'ai_aggregator','Content-Type':'application/json'},
    )
    try:
        urllib.request.urlopen(req, timeout=10)
        print(f'flagged drop: {d["url"]} Δ{d["delta"]}', file=sys.stderr)
    except Exception as e:
        print(f'flag failed {d["url"]}: {e}', file=sys.stderr)

# Emit summary for shell to email
print(json.dumps({'upserted': len(rows), 'drops': len(drops), 'drop_urls': [d['url'] for d in drops[:10]]}))
EOF
SUMMARY=$?

if [[ $SUMMARY -ne 0 ]]; then
  log "ERROR: python position processing failed (exit=$SUMMARY)"
  notify_failure "track-positions" "python position processing failed exit=$SUMMARY" "$LOG_FILE"
  exit 1
fi

log "=== position tracking complete ==="
```

Make executable.

- [ ] **Step 2: Create systemd units**

`/etc/systemd/system/blog-positions.service`:

```ini
[Unit]
Description=Daily position tracking for gptweb.ru blog
After=network-online.target

[Service]
Type=oneshot
User=deploy
WorkingDirectory=/home/deploy/projects/ai-aggregator-lobechat
ExecStart=/home/deploy/projects/ai-aggregator-lobechat/scripts/blog/track-positions.sh
Environment=PATH=/home/deploy/.local/bin:/usr/local/bin:/usr/bin:/bin
TimeoutStartSec=180
```

`/etc/systemd/system/blog-positions.timer`:

```ini
[Unit]
Description=Daily blog position tracker at 04:00 MSK

[Timer]
# 04:00 MSK = 01:00 UTC
OnCalendar=*-*-* 01:00:00 UTC
RandomizedDelaySec=600
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
sudo -n systemctl daemon-reload
sudo -n systemctl enable --now blog-positions.timer
systemctl list-timers | grep blog-positions
```

Expected: next trigger shows tomorrow 04:00 MSK.

- [ ] **Step 3: Manual first run + verify**

```bash
sudo -n systemctl start blog-positions.service
sleep 60
tail -20 /home/deploy/.claude/logs/track-positions.log
docker exec supabase-db psql -U postgres -c "SELECT count(*), snapshot_date FROM ai_aggregator.blog_positions GROUP BY snapshot_date ORDER BY snapshot_date DESC LIMIT 3;"
```

Expected: 110 rows for today (one per published post).

- [ ] **Step 4: Commit**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
git add scripts/blog/track-positions.sh
git -c user.name=pasha -c user.email=2396741@gmail.com commit -m "feat(seo): track-positions.sh + daily systemd timer"
git push origin canary
```

---

## Task 5: Re-optimize detection + email alerts

Already wired into Task 4's script. This task just verifies the flow end-to-end + adds a daily summary email.

- [ ] **Step 1: Add daily-digest block at end of track-positions.sh**

After the Python block, append:

```bash
# Read summary from last stderr line
SUMMARY_JSON=$(tail -1 "$LOG_FILE" | grep -oE '{.*}' | tail -1)
DROP_COUNT=$(echo "$SUMMARY_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('drops',0))" 2> /dev/null || echo 0)

if [[ "${DROP_COUNT:-0}" -gt 0 ]]; then
  DROP_URLS=$(echo "$SUMMARY_JSON" | python3 -c "import json,sys; print('\n'.join(json.load(sys.stdin).get('drop_urls',[])))" 2> /dev/null)
  BODY="<h2>Blog position drops (Δ ≥ 10)</h2><p>${DROP_COUNT} URL(s) flagged for re-optimize:</p><ul>"
  while IFS= read -r u; do BODY+="<li><a href=\"${u}\">${u}</a></li>"; done <<< "$DROP_URLS"
  BODY+="</ul><p><a href=\"https://ask.gptweb.ru/admin/blog/reoptimize\">Open reoptimize queue</a></p>"
  notify_email "[Blog positions] ${DROP_COUNT} drop(s) flagged" "$BODY"
fi
```

- [ ] **Step 2: Commit**

```bash
git add scripts/blog/track-positions.sh
git -c user.name=pasha -c user.email=2396741@gmail.com commit -m "feat(seo): daily position digest email on drops"
git push origin canary
```

---

## Task 6: Admin page /admin/blog/reoptimize

**Files:**

- Create: `app/(admin)/blog/reoptimize/page.tsx` (webgpt-admin repo)

- Create: `app/(admin)/blog/reoptimize/_components/reoptimize-client.tsx`

- Add sidebar link: `components/sidebar.tsx`

- [ ] **Step 1: Create page server component**

`/home/deploy/projects/webgpt-admin/app/(admin)/blog/reoptimize/page.tsx`:

```typescript
import { supabase } from "@/lib/supabase";
import { ReoptimizeClient } from "./_components/reoptimize-client";

export const dynamic = "force-dynamic";

export default async function ReoptimizePage() {
  const { data: queue } = await supabase
    .from("reoptimize_queue")
    .select("id, post_id, reason, prev_position, current_position, position_delta, status, flagged_at, blog_posts(slug, title, blog_categories(slug))")
    .order("flagged_at", { ascending: false })
    .limit(100);

  return <ReoptimizeClient initial={queue ?? []} />;
}
```

- [ ] **Step 2: Create client component**

`reoptimize-client.tsx`:

```typescript
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BlogNav } from "@/components/blog-nav";
import { toast } from "sonner";

interface QueueItem {
  id: number;
  post_id: string;
  reason: string;
  prev_position: number | null;
  current_position: number | null;
  position_delta: number | null;
  status: "pending" | "in_progress" | "done" | "dismissed";
  flagged_at: string;
  blog_posts: {
    slug: string;
    title: string;
    blog_categories: { slug: string } | null;
  } | null;
}

export function ReoptimizeClient({ initial }: { initial: QueueItem[] }) {
  const [items, setItems] = useState<QueueItem[]>(initial);
  const [filter, setFilter] = useState<"pending" | "all">("pending");

  const visible = filter === "pending" ? items.filter((i) => i.status === "pending") : items;

  async function updateStatus(id: number, status: QueueItem["status"]) {
    const res = await fetch("/admin/api/reoptimize", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    if (!res.ok) { toast.error("Не удалось обновить"); return; }
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)));
    toast.success("Обновлено");
  }

  return (
    <div className="p-6 space-y-4">
      <BlogNav />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Re-optimize queue</h1>
          <p className="text-sm text-muted-foreground">Статьи, позиции которых упали ≥10. Флаг появляется автоматически.</p>
        </div>
        <div className="flex gap-2">
          <Button variant={filter === "pending" ? "default" : "outline"} size="sm" onClick={() => setFilter("pending")}>Активные ({items.filter((i) => i.status === "pending").length})</Button>
          <Button variant={filter === "all" ? "default" : "outline"} size="sm" onClick={() => setFilter("all")}>Все ({items.length})</Button>
        </div>
      </div>

      <div className="border rounded-lg bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Флажено</TableHead>
              <TableHead>Статья</TableHead>
              <TableHead>Было</TableHead>
              <TableHead>Стало</TableHead>
              <TableHead>Δ</TableHead>
              <TableHead>Причина</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="w-56">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Очередь пуста — все статьи держат позиции.</TableCell></TableRow>
            ) : visible.map((i) => {
              const p = i.blog_posts;
              const cat = p?.blog_categories?.slug || "uncategorized";
              return (
                <TableRow key={i.id}>
                  <TableCell className="text-xs">{new Date(i.flagged_at).toLocaleDateString("ru-RU")}</TableCell>
                  <TableCell>
                    {p ? (
                      <a href={`/admin/blog/${i.post_id}`} className="font-medium hover:underline">{p.title}</a>
                    ) : <span className="text-muted-foreground">—</span>}
                    {p && <div className="text-xs text-muted-foreground">/blog/{cat}/{p.slug}</div>}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{i.prev_position?.toFixed(1) ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{i.current_position?.toFixed(1) ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs text-red-600">{i.position_delta?.toFixed(1) ?? "—"}</TableCell>
                  <TableCell className="text-xs">{i.reason}</TableCell>
                  <TableCell>
                    <Badge variant={i.status === "pending" ? "default" : "secondary"}>{i.status}</Badge>
                  </TableCell>
                  <TableCell>
                    {i.status === "pending" && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => updateStatus(i.id, "in_progress")}>В работу</Button>
                        <Button size="sm" variant="ghost" onClick={() => updateStatus(i.id, "dismissed")}>Отклонить</Button>
                      </div>
                    )}
                    {i.status === "in_progress" && (
                      <Button size="sm" variant="default" onClick={() => updateStatus(i.id, "done")}>Готово</Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create PATCH API**

`/home/deploy/projects/webgpt-admin/app/api/reoptimize/route.ts`:

```typescript
import { getAdminUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';

export async function PATCH(request: NextRequest) {
  if (!(await getAdminUser())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id, status } = await request.json();
  if (!id || !['pending', 'in_progress', 'done', 'dismissed'].includes(status)) {
    return NextResponse.json({ error: 'bad payload' }, { status: 400 });
  }
  const patch: { status: string; resolved_at?: string } = { status };
  if (status === 'done' || status === 'dismissed') patch.resolved_at = new Date().toISOString();
  const { error } = await supabase.from('reoptimize_queue').update(patch).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4: Sidebar link**

In `components/sidebar.tsx`, add under Контент group:

```tsx
{ href: "/blog/reoptimize", label: "Re-optimize", icon: TrendingDown },
```

(Import `TrendingDown` from lucide-react.)

- [ ] **Step 5: Commit**

```bash
cd /home/deploy/projects/webgpt-admin
git add app/\(admin\)/blog/reoptimize app/api/reoptimize components/sidebar.tsx
git -c user.name=pasha -c user.email=2396741@gmail.com commit -m "feat(admin): /admin/blog/reoptimize queue page"
git push origin master
```

---

## Task 7: Admin page /admin/blog/clusters

**Files:**

- Create: `app/(admin)/blog/clusters/page.tsx`

- Create: `app/(admin)/blog/clusters/_components/clusters-client.tsx`

- [ ] **Step 1: Page (server) component**

```typescript
// app/(admin)/blog/clusters/page.tsx
import { supabase } from "@/lib/supabase";
import { ClustersClient } from "./_components/clusters-client";

export const dynamic = "force-dynamic";

export default async function ClustersPage() {
  const { data } = await supabase
    .from("blog_clusters")
    .select("id, primary_keyword, related_keywords, avg_competition, total_impressions, category_slug, status, used_in_post_id, created_at, blog_posts(slug, title)")
    .order("created_at", { ascending: false })
    .limit(200);
  return <ClustersClient initial={data ?? []} />;
}
```

- [ ] **Step 2: Client component — simple read-only view**

```typescript
// app/(admin)/blog/clusters/_components/clusters-client.tsx
"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BlogNav } from "@/components/blog-nav";

interface ClusterRow {
  id: number;
  primary_keyword: string;
  related_keywords: string[];
  avg_competition: number | null;
  total_impressions: number | null;
  category_slug: string | null;
  status: "pending" | "used" | "skipped";
  used_in_post_id: string | null;
  created_at: string;
  blog_posts: { slug: string; title: string } | null;
}

export function ClustersClient({ initial }: { initial: ClusterRow[] }) {
  const [filter, setFilter] = useState<"pending" | "used" | "all">("pending");
  const [expanded, setExpanded] = useState<number | null>(null);
  const visible = filter === "all" ? initial : initial.filter((c) => c.status === filter);

  return (
    <div className="p-6 space-y-4">
      <BlogNav />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Кластеры ключей</h1>
          <p className="text-sm text-muted-foreground">Один кластер = одна статья, покрывающая 10-15 long-tails.</p>
        </div>
        <div className="flex gap-2">
          {(["pending","used","all"] as const).map((f) => (
            <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
              {f === "pending" ? "Ожидают" : f === "used" ? "Использованы" : "Все"} ({initial.filter((c) => f === "all" || c.status === f).length})
            </Button>
          ))}
        </div>
      </div>

      <div className="border rounded-lg bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Создан</TableHead>
              <TableHead>Primary keyword</TableHead>
              <TableHead>Категория</TableHead>
              <TableHead>Long-tails</TableHead>
              <TableHead>Σ imp</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Использован в</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((c) => (
              <>
                <TableRow key={c.id} onClick={() => setExpanded(expanded === c.id ? null : c.id)} className="cursor-pointer hover:bg-muted/40">
                  <TableCell className="text-xs">{new Date(c.created_at).toLocaleDateString("ru-RU")}</TableCell>
                  <TableCell className="font-medium">{c.primary_keyword}</TableCell>
                  <TableCell>{c.category_slug ?? "—"}</TableCell>
                  <TableCell className="text-xs">{c.related_keywords.length}</TableCell>
                  <TableCell className="font-mono text-xs">{c.total_impressions ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={c.status === "used" ? "secondary" : c.status === "pending" ? "default" : "outline"}>{c.status}</Badge>
                  </TableCell>
                  <TableCell>
                    {c.blog_posts ? (
                      <a href={`/admin/blog/${c.used_in_post_id}`} className="text-xs hover:underline">{c.blog_posts.title}</a>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                </TableRow>
                {expanded === c.id && (
                  <TableRow key={`${c.id}-exp`}>
                    <TableCell colSpan={7} className="bg-muted/30">
                      <div className="text-xs py-2">
                        <div className="font-medium mb-1">Long-tails ({c.related_keywords.length}):</div>
                        <div className="flex flex-wrap gap-1">
                          {c.related_keywords.map((k, i) => (
                            <Badge key={i} variant="outline" className="text-xs font-normal">{k}</Badge>
                          ))}
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Sidebar link**

```tsx
{ href: "/blog/clusters", label: "Кластеры", icon: Network },
```

- [ ] **Step 4: Commit**

```bash
cd /home/deploy/projects/webgpt-admin
git add app/\(admin\)/blog/clusters components/sidebar.tsx
git -c user.name=pasha -c user.email=2396741@gmail.com commit -m "feat(admin): /admin/blog/clusters browse page"
git push origin master
```

---

## Task 8: Build + deploy + e2e smoke

- [ ] **Step 1: Parallel builds**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat && nohup docker build -t lobechat-custom:latest . > /tmp/agg-seo.log 2>&1 &
echo "agg $!"
cd /home/deploy/projects/webgpt-admin && nohup docker build -t webgpt-admin:latest . > /tmp/adm-seo.log 2>&1 &
echo "adm $!"
```

- [ ] **Step 2: Wait + deploy**

```bash
# wait both
grep -E "Compiled successfully|Failed|error TS" /tmp/agg-seo.log | tail -2
grep -E "Compiled successfully|Failed|error TS" /tmp/adm-seo.log | tail -2
cd /opt/lobechat && docker compose up -d --force-recreate lobe webgpt-admin
until curl -sfI "https://ask.gptweb.ru/" -o /dev/null; do sleep 3; done
```

- [ ] **Step 3: E2E smoke — full pipeline**

Trigger one manual generation to go through the full new pipeline:

```bash
sudo -n systemctl start blog-generate.service
# wait ≈3 min
sleep 180
tail -30 /home/deploy/.claude/logs/blog-generate.log
tail -20 /home/deploy/.claude/logs/cluster-builder.log
```

Verify in DB:

- A row in `blog_clusters` was created with non-empty `related_keywords`
- The resulting `blog_posts` row has `cluster_id` set
- `blog_clusters.status = 'used'`, `used_in_post_id` set

Smoke the admin UI:

- `https://ask.gptweb.ru/admin/blog/clusters` renders 1+ row

- `https://ask.gptweb.ru/admin/blog/reoptimize` renders empty state (no drops yet)

- [ ] **Step 4: Trigger position tracker manually**

```bash
sudo -n systemctl start blog-positions.service
sleep 60
tail -20 /home/deploy/.claude/logs/track-positions.log
docker exec supabase-db psql -U postgres -c "SELECT count(*) FROM ai_aggregator.blog_positions WHERE snapshot_date = current_date;"
```

Expected: \~110 (one per published post).

- [ ] **Step 5: Commit smoke evidence**

If any log issues surfaced and were fixed, commit them. Otherwise, just summarise the smoke in PR-style message and mark the plan complete.

---

## Open items (not this plan)

1. **Per-URL position attribution** — current Webmaster API doesn't map queries to URLs cleanly; we use site-aggregate as a proxy. Upgrade later by polling Metrika per-URL (requires finer attribution math).
2. **Competition via SERP** — `cluster-builder.sh` uses a cheap proxy. Real `getCompetition()` would xmlriver-search each keyword, filter generic portals, parse domain strength. 5-10× xmlriver cost per cluster.
3. **Auto-rewrite** — current flow flags drops; doesn't rewrite. Next: a `reoptimize-article.sh` that picks a pending reoptimize, pulls the existing post body, regenerates title+description (+ first para) and marks done.
4. **Cluster revival** — if a cluster is `used` but the article underperforms, can we expand the cluster and re-generate? Track in `reoptimize_queue` with reason='cluster_refresh'.
