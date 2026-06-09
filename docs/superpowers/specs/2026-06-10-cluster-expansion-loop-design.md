# Cluster-expansion loop — design

**Status:** approved 2026-06-10
**Scope:** Add a traffic-driven feedback loop to the SEO blog automation
so that clusters which bring **real delivered traffic** automatically get
more articles written for their uncovered related keywords. Producer side
lives in `track-positions.sh` (already runs daily, already has fresh
`blog_positions`). Consumer side is a slot-parity branch in
`generate-article.sh`. Capped at \~50% of daily generation slots.
**Out of scope:** changing the cluster-builder, news pipeline, or the SEO
gate; any UI; predicting traffic; expanding VPN clusters (hard-excluded).

## Why now

The blog has a rescue loop (declining posts → `reoptimize_queue` → title/
meta rewrite) but **no exploitation loop**: a cluster that performs well
gets no extra investment. As traffic grows, the highest-leverage move is
to write more around proven winners. The data already exists —
`blog_positions` (real impressions/clicks per post) joined to clusters via
`blog_posts.cluster_id`. Real traffic is tiny today (top cluster \~17
clicks/7d), so the feature will mostly "sleep" until traffic grows; that
is acceptable and by design (a score floor gates it).

Critical distinction baked into the whole design: `blog_clusters.
total_impressions` is **Wordstat search volume** (potential), NOT our
delivered traffic. The top clusters by that field are all VPN. We must use
`blog_positions` (real delivered) and exclude VPN, or we'd amplify exactly
the content RKN told us to remove.

## Architecture

```
DAILY 04:00 MSK
track-positions.sh
  ├─ (existing) write blog_positions snapshots, flag drops → reoptimize_queue
  └─ (NEW) cluster-expansion producer:
        1. blended_score per cluster = SUM(clicks)×5 + SUM(impressions), 7d
           join blog_posts.cluster_id, only status='published'
        2. exclude VPN clusters (same regex as generator guard)
        3. keep clusters with blended_score >= MIN_SCORE (floor 5)
        4. top-N (N=5) by blended_score
        5. for each: find UNCOVERED related_keywords
             (not present in blog_keywords at all, any status)
        6. insert up to KW_PER_CLUSTER (2) per cluster as:
             status=pending, priority=high, source='cluster_expansion',
             category_slug=<cluster.category>, cluster_id=<id>
        7. Telegram summary: "N clusters expanded, M keywords seeded"

8 SLOTS/DAY 08..22 MSK
generate-article.sh
  ├─ slot parity: even-hour slots (08,12,16,20) = EXPANSION, else NORMAL
  ├─ EXPANSION slot:
  │     pick pending source='cluster_expansion' (priority.asc, impressions.desc)
  │     → its category_slug OVERRIDES category-of-the-day
  │     → reuse cluster_id (cluster-builder reuses, doesn't rebuild)
  │     → same guards (vpn/saturation/dedup) → generate
  │     → if none pending: fall through to NORMAL (slot not wasted)
  └─ NORMAL slot (existing behavior + one tweak):
        keyword queries add source=neq.cluster_expansion
        so normal slots never steal high-priority expansion keywords
```

## Data model

No new tables. One migration on the existing constraint:

```sql
-- blog_keywords.source currently: CHECK (source IN ('yandex_api','manual','ai_generated'))
ALTER TABLE ai_aggregator.blog_keywords DROP CONSTRAINT IF EXISTS blog_keywords_source_check;
ALTER TABLE ai_aggregator.blog_keywords ADD CONSTRAINT blog_keywords_source_check
  CHECK (source IN ('yandex_api','manual','ai_generated','cluster_expansion'));
```

Reused columns on `blog_keywords`: `source` (new value), `priority`
(`'high'`), `category_slug`, `cluster_id`, `status` (`'pending'`),
`impressions` (set to the cluster's blended_score so ordering surfaces the
hottest cluster's keywords first).

## Producer — winning-cluster detection (track-positions.sh)

Appended after the existing drop-flagging block. Pure SQL + a VPN regex in
the WHERE clause. The selection query:

```sql
WITH cluster_traffic AS (
  SELECT bc.id, bc.primary_keyword, bc.category_slug, bc.related_keywords,
         COALESCE(SUM(pos.clicks),0)*5 + COALESCE(SUM(pos.impressions),0) AS blended
  FROM ai_aggregator.blog_clusters bc
  JOIN ai_aggregator.blog_posts bp
       ON bp.cluster_id = bc.id AND bp.status='published'
  LEFT JOIN ai_aggregator.blog_positions pos
       ON pos.post_id = bp.id AND pos.snapshot_date > now() - interval '7 days'
  WHERE bc.primary_keyword !~* '(vpn|впн|vless|v2ray|xray|amnezia|shadowsocks|wireguard|hiddify|outline|прокси|proxy|обход|разблок|dpi|byebyedpi)'
  GROUP BY bc.id, bc.primary_keyword, bc.category_slug, bc.related_keywords
)
SELECT id, category_slug, blended, related_keywords
FROM cluster_traffic
WHERE blended >= :MIN_SCORE
ORDER BY blended DESC
LIMIT :TOP_N;
```

For each returned cluster, iterate `related_keywords[]`; for each candidate
keyword run the same VPN regex (defense in depth) and a coverage check:

```sql
-- covered if it already exists in blog_keywords (any status)
SELECT 1 FROM ai_aggregator.blog_keywords WHERE lower(keyword)=lower(:kw) LIMIT 1;
```

Insert up to `KW_PER_CLUSTER` uncovered keywords. Idempotent: re-runs skip
already-seeded keywords; clusters that cool off drop out of top-N and stop
seeding (natural decay).

## Consumer — slot-parity branch (generate-article.sh)

Near the top, after category-of-the-day is resolved, compute:

```bash
SLOT_HOUR_MSK=$(TZ=Europe/Moscow date +%H) # 08,10,...,22
# even/4 boundary → expansion on 08,12,16,20; normal on 10,14,18,22
if (((10#$SLOT_HOUR_MSK / 2) % 2 == 0)); then EXPANSION_SLOT=1; else EXPANSION_SLOT=0; fi
```

(Exact parity formula finalized in the plan; the property required is
deterministic 4-expansion / 4-normal split across the 8 daily hours, and
any manual off-cadence run lands deterministically in one bucket.)

- **`CLUSTER_EXPANSION_ENABLED=0`** → always NORMAL (kill-switch).
- **EXPANSION_SLOT and a pending `cluster_expansion` keyword exists** →
  expansion path: that keyword's `category_slug` overrides `TARGET_CAT`,
  `cluster_id` is read from the keyword row so cluster-builder reuses it.
  All existing guards still run.
- **EXPANSION_SLOT but none pending** → fall through to NORMAL (no wasted
  slot).
- **NORMAL slot** → existing behavior, but every `blog_keywords` SELECT
  gains `&source=neq.cluster_expansion` so high-priority expansion rows
  don't get consumed on normal slots (which would break the 50% cap).

## Flags (env, defaults in scripts)

| Flag                               | Default | Meaning                                      |
| ---------------------------------- | ------- | -------------------------------------------- |
| `CLUSTER_EXPANSION_ENABLED`        | `1`     | Master kill-switch (producer + consumer)     |
| `CLUSTER_EXPANSION_TOP_N`          | `5`     | Clusters expanded per producer run           |
| `CLUSTER_EXPANSION_MIN_SCORE`      | `5`     | Blended-score floor (dead clusters excluded) |
| `CLUSTER_EXPANSION_KW_PER_CLUSTER` | `2`     | Keywords seeded per cluster per run          |

Set in `/home/deploy/.config/blog-autogen/env` if overriding; scripts
default-on.

## Observability

- Producer logs `expanded cluster=<id> score=<n> seeded=<kw>` per keyword.
- Producer sends a Telegram summary via `notify_success`:
  `"cluster-expansion: <N> clusters, <M> keywords seeded"` (skipped when
  M=0 to avoid noise).
- Consumer logs `EXPANSION slot: using cluster=<id> kw=<kw> cat=<cat>` or
  `EXPANSION slot: no pending expansion keywords, falling back to normal`.

## Testing

bash, isolating pure functions:

1. **blended_score / top-N selection** — seed `blog_clusters` + `blog_posts`
   - `blog_positions` fixtures with known traffic; assert the right cluster
     ids come back in the right order, VPN cluster excluded, sub-floor cluster
     excluded.
2. **coverage check** — a related_keyword already in `blog_keywords` (any
   status) is not re-seeded.
3. **VPN double-guard** — a VPN keyword inside a non-VPN cluster's
   related_keywords is not seeded.
4. **slot-parity function** — table test hour→{expansion,normal}: exactly
   4/4 across 08..22, deterministic for off-cadence hours.
5. **normal-path exclusion** — assert the normal-slot keyword query carries
   `source=neq.cluster_expansion`.
6. **migration** — constraint accepts `'cluster_expansion'`, still rejects
   garbage.

Producer/consumer integration is verified on the live DB after deploy by
seeding one synthetic winning cluster and watching the next expansion slot
pick it up (then cleaning the fixture).

## Risk register

| Risk                                                                            | Mitigation                                                                             |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Constraint rejects insert                                                       | Migration ships FIRST, before producer                                                 |
| Expansion exceeds 50%                                                           | Hard slot-parity + `source=neq` on normal path; normal keeps its global-queue fallback |
| VPN leaks into related_keywords                                                 | Double guard: producer WHERE-regex + generator `is_valid_keyword`                      |
| One cluster floods the feed                                                     | `KW_PER_CLUSTER=2` + existing saturation guard (topic in 3+ titles/7d → skip)          |
| Tiny traffic now → 0 expansion                                                  | Expected. Floor=5 passes 0-1 cluster today; feature sleeps until traffic grows         |
| Producer dies mid-run                                                           | Idempotent inserts; next run resumes; no partial-state corruption                      |
| Stuck high-priority expansion keyword never generates (e.g. always fails dedup) | `mark_keyword_skipped` path already exists; skipped keywords leave the pending set     |

## Migration plan

Four commits:

1. **Migration** — add `'cluster_expansion'` to the source CHECK constraint
   (applied via `docker exec supabase-db psql`; SQL file committed for
   record).
2. **Producer** — append the winning-cluster detection + seeding block to
   `track-positions.sh` + flags + Telegram summary.
3. **Consumer** — slot-parity branch + `source=neq.cluster_expansion` on
   normal-path queries in `generate-article.sh`.
4. **Docs** — update `docs/seo_blog_instruction.md` §15 (move from backlog
   to "implemented", document the loop + flags + runbook entry).

Each commit is independently revertable. Shell scripts run from disk so no
container deploy is needed; the migration is the only stateful step.

## Verification

- bash unit tests (above) pass.
- Migration: constraint accepts the new source value.
- Live: seed a synthetic non-VPN winning cluster (give one of its posts a
  fake `blog_positions` row with clicks), run `track-positions.sh`
  manually, confirm an expansion keyword appears with
  `source='cluster_expansion'`, then confirm the next even-hour
  `generate-article.sh` run picks it (or dry-run the selection query).
  Clean up the fixture afterward.
- Confirm a normal-hour run does NOT consume the expansion keyword.
