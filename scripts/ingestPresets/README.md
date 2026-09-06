# Preset ingest (spec Ф4 — автосинхронизация)

Pulls new style presets from the meigen.ai catalogue, applies the auto-publish
rules, converts the media into our own CDN and inserts rows into `presets` with
full attribution back to the original X post.

This is a **standalone Node script run by system cron on the host**, not a
Next.js route: one run downloads hundreds of MB and shells out to `ffmpeg`,
which no `maxDuration` budget survives. It reuses the app's `.env` / `.env.local`
for `DATABASE_URL`, the S3 credentials and the Telegram alert bot, and imports
nothing from the server runtime except `src/server/services/alerts`.

## Running

```bash
cd /home/deploy/projects/ai-aggregator-lobechat

# safe: fetch + filter + report only, no downloads and no writes
npx tsx scripts/ingestPresets/index.ts --dry-run

# real run, bounded
npx tsx scripts/ingestPresets/index.ts --modality=video --limit=10

# re-label rows already ingested with heuristic titles: table only …
npx tsx scripts/ingestPresets/index.ts --relabel=20
# … and actually write
npx tsx scripts/ingestPresets/index.ts --relabel=20 --apply
```

### Flags

| Flag                            | Default | Meaning                                                                                                    |
| ------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| `--dry-run`                     | off     | Fetch + filter + label + report. No downloads, no S3, no DB writes. **LLM calls do happen** (to see labels). |
| `--limit=N`                     | `40`    | Cap on newly ingested items for the whole run, spent across modalities.                                    |
| `--max-pages=N`                 | `15`    | Cap on catalogue pages per modality (page = 20 items).                                                     |
| `--modality=video\|image\|both` | `both`  | Which catalogue(s) to walk.                                                                                |
| `--no-llm`                      | off     | Skip the LLM step: keyword-table titles/categories, regex-only i2v — the pre-2026-09-06 behaviour.         |
| `--relabel[=N]`                 | —       | Instead of ingesting, re-classify the `N` (default 100) oldest ingested rows. **Dry-run unless `--apply`.** |
| `--since=<iso>`                 | —       | With `--relabel`: only rows with `ingested_at >=` this timestamp (see the note on the first 40 rows).      |
| `--apply`                       | off     | Only meaningful with `--relabel`: write the new labels.                                                    |

### Requirements

- `ffmpeg` with `libx264` and `libwebp` on the host (`ffmpeg -version`).
- `DATABASE_URL`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
  `S3_BUCKET` — already in `.env.local`, host-reachable (`127.0.0.1:5433`,
  `localhost:9000`).
- `OPENROUTER_API_KEY` (already in `.env.local`) for the LLM labelling step.
  Without it the run fails at startup unless `--no-llm` is given — a silently
  degraded label set is worse than a loud failure.
- `TELEGRAM_ALERT_BOT_TOKEN` + `TELEGRAM_ALERT_CHAT_ID` for the failure alert.
  They live on the `lobehub` container, **not** in `.env.local` — without them
  a failure still logs to stderr but no Telegram message goes out. Add them to
  `.env.local` (or the cron environment) when installing the job.

## Crontab

Daily at 04:20 MSK, well clear of the 03:00 backup window. **Not installed —
the operator installs it.**

```cron
20 4 * * * cd /home/deploy/projects/ai-aggregator-lobechat && /usr/bin/npx tsx scripts/ingestPresets/index.ts >> /var/log/preset-ingest.log 2>&1
```

A failed run exits non-zero and fires a `[CRITICAL] Preset ingest failed`
Telegram alert; a successful run prints the summary block below.

## What a run does

1. **Incremental discovery.** Walks `?offset=0,20,40…` and stops at the first
   page where _every_ `external_id` is already in `presets`. Also bounded by
   `--max-pages` and `--limit`, so a run is always finite.
2. **Filters.** Every item gets one of three verdicts:
   - `skip` — safety stop-list hit or duplicate. **Nothing is stored.**
   - `queue` — a quality rule failed. Row inserted with `active=false`; it is a
     moderation queue, never a delete. Flip it on with an `UPDATE`.
   - `publish` — everything passed. Row inserted with `active=true`.
3. **LLM labels** (`classify.ts`, merged in `labeling.ts`). Every item that
   survived step 2 as `publish` or `queue` gets one `openai/gpt-5-mini` call
   via OpenRouter returning `{ title_ru, summary_ru, category, requires_image,
   unsafe }` as JSON, validated with zod. Then:
   - `title` / `category` / `description` come from the model; on any failure
     (timeout, non-2xx, bad JSON, schema mismatch, cap) the item keeps the
     keyword-table title and category and `description` stays `NULL`. A
     category slug we do not have (the model is shown only the slugs for the
     item's modality, plus `trends`) falls back to the heuristic slug alone —
     the rest of the answer is kept and the log shows `(llm wanted "…")`.
   - `requires_image = heuristic OR llm`. When only the model saw the
     dependency, a `publish` verdict is demoted to `queue` with the reason
     `requires-image-llm` (same Ф5 parking as the regex path).
   - `unsafe = true` is treated exactly like a stop-list hit: **nothing is
     stored**, counted under `skipped-safety (llm-unsafe: N)`. (For rows that
     are already in the table the verdict is persisted instead — see
     `license = 'blocked'` under `--relabel`.)
   - Skips (stop-list, duplicate) and items without a media URL never cost a
     call.
4. **Media.** `images.meigen.ai` → `ffmpeg` → RustFS via the S3 API →
   `https://ask.gptweb.ru/s3/lobe/presets/trend-<id>.{mp4,webp}`. Temp files are
   always cleaned up. An item whose media fails is counted as `failed-media`
   and **not** stored — `preview_url` is `NOT NULL` and a row without a preview
   is useless.
5. **Upsert.** `ON CONFLICT (external_id) DO NOTHING`, so a re-run is a no-op.

### LLM cost and abuse guards

An unguarded LLM timer once burned money overnight in this repo, so the
labelling step is boxed in:

- **No work, no call.** The classifier is constructed (so a missing key fails
  fast) but makes no request until an item actually needs a label. A run that
  finds nothing new, or a `--relabel` over an empty set, costs $0.
- **Hard cap: 60 classifications per process.** Beyond it every item keeps
  its heuristic labels and the log says so once (`per-run cap … reached`).
  `--relabel` stops at the cap instead of scanning on.
- **One retry, never more** (transport error, 429/5xx, empty or malformed
  answer). 20 s timeout per attempt. No background timers, no queue.
- **Usage is printed** in the run summary: calls, retries, failures, tokens
  in/out and USD (from OpenRouter's `usage.cost`, else list price
  $0.25/M in · $2/M out). Measured: ~600 prompt + ~80 completion tokens per
  item ≈ **$0.0003/item**, so a full 40-item run is about **$0.012** and the
  worst case (cap) about $0.02.
- `reasoning.effort` is pinned to `minimal`. gpt-5-mini is a reasoning
  model; at the default effort it spends ~200 reasoning tokens before the
  first content token and a small `max_tokens` returns an **empty message**
  (`finish_reason=length`). Minimal effort brings reasoning to 0 tokens.

### `--relabel[=N]`

For rows ingested before the LLM step (or after a prompt change). Reads the
`N` oldest rows with `external_id IS NOT NULL`, re-runs the classifier on the
stored `prompt_template` and prints a before→after table (title, category,
i2v flag, active flag, blocked flag, flags such as `i2v→off`, `unsafe→off`,
`blocked+`, `cat?<slug>`). Rules: `requires_image` = stored OR regex OR llm
(never flips back); a row that *becomes* i2v while `active` is parked
(`active=false`) for Ф5 to re-activate with its own script; a row the model
flags unsafe is parked too **and stamped `license = 'blocked'`**; a failed
classification leaves the row untouched. **Nothing is written without
`--apply`.** Curated rows (`external_id IS NULL`) are never touched.

**`license = 'blocked'` is the durable unsafe verdict.** `active=false` on its
own is not: `activateI2v.ts` re-runs only the heuristic filters and once
re-activated a "use the provided facial reference" prompt the model had parked.
There is no dedicated column (and no migration), so the verdict rides on
`license`, which nothing else writes (`source-attribution` for every ingested
row). Every activation path skips these rows — `planActivation` keeps them
with reason `blocked-by-llm` and the `UPDATE` repeats the check — and the
verdict is sticky: a later run where the model answers `unsafe=false` keeps
the row blocked and parked (`blocked` flag). Unblocking is a human decision:
`UPDATE presets SET license = 'source-attribution' WHERE slug = '…'`. The
summary prints `blocked: N (new: M)`.

**Do not relabel the first 40 ingested rows blindly.** The 2026-09-06 13:33
batch (`trend-2091396663718117706` … `trend-2091040255818236292`) carries
hand-written titles («Bullet time: падение на Уолл-стрит», «POV: заморозка
времени») that the model does not improve on; only the 15:31+ batches were
labelled by the keyword tables. Target those with `--since`:

```bash
# ingested_at is UTC; the heuristic batches start at 15:31Z (18:31 MSK)
npx tsx scripts/ingestPresets/index.ts --relabel=60 --since=2026-09-06T15:00:00Z
```

Rows written by the LLM step carry a non-NULL `description`; heuristic rows
have `description IS NULL`, which is the quickest way to spot what is left.

### Auto-publish rules (all must pass for `active=true`)

- Safety stop-list clean (nsfw / violence / weapons / drugs / political figures /
  brands and trademarked characters) — checked on prompt **and** title.
- ≥90% ASCII in the first 200 characters of the prompt.
- Prompt length ≥80.
- Aspect ratio resolves to one of `16:9 9:16 1:1 4:3 3:4`.
- `likes ≥ 50`.
- Attribution derivable (a usable X handle).
- Not already ingested.
- ≤2 presets per author per run.
- Media downloaded and converted successfully.

Two deliberate refinements over a literal reading of the spec:

- **Aspect ratio is snapped, not matched.** The source does not normalise
  `aspectRatio`: real values include `427:240`, `159:91`, `26:15` and `7:4`,
  all of which are 16:9 footage within a couple of percent. A literal whitelist
  match would queue roughly a quarter of a page of perfect 16:9 clips. We snap
  to the nearest supported ratio within 3% and reject beyond that (a 2:3 image
  is 11% from 3:4 and correctly fails). The images endpoint ships **no**
  `aspectRatio` field at all, so images resolve from `imageWidth`/`imageHeight`.

- **i2v presets publish like any other (since Ф5).** Prompts referencing a
  reference image (`@image1`, `@[image1]`, `uploaded image`, `reference face`,
  …) are stored with `requires_image=true`; the UI shows «Нужно фото» and will
  not run until a reference image is attached. Their `recommended_model_id` is
  the paired **`/text-to-video`** card (`bytedance/seedance-2.0-fast/text-to-video`),
  not the `…/image-to-video` id: the i2v cards are disabled in model-bank and
  the runtime swaps the endpoint itself when `imageUrl` is set
  (`pairedEndpoint.ts`). Rows queued under the pre-Ф5 hold are activated with
  `activateI2v.ts` (below). **Image** prompts that reference an image (i2i)
  still queue as `requires-image-i2i-pending` — the image flow has no
  «Добавьте фото» gate yet.

- **Not every id is an X post.** The images endpoint also serves the source's
  own community uploads under ids like `community_34e69cb0-4906-…`. A
  `/status/<id>` link for those would 404, so attribution is not derivable and
  the item is queued rather than published (`no-attribution`).

### Derived fields

`slug` = `trend-<id>`; `source_url` = `https://x.com/<username>/status/<id>`;
`author_url` = `https://x.com/<username>` (derived from the handle, **not** from
the payload's `profileUrl`, so an upstream change cannot redirect our
«Источник ↗»); `license` = `source-attribution`; `popularity` = source likes;
`category`, `title` and `description` from the LLM step (see above). The
fallback when the LLM step is off or failed: `category` from a keyword table
falling back to `trends` (categories are DB-driven since Ф2, so a new slug is
reachable); `title` a short Russian label from a keyword table falling back to
the trimmed source title; `description` `NULL`.

## Activating pre-Ф5 i2v rows (one-off)

Queue reasons are not stored, so `activateI2v.ts` re-runs the _current_
`filters.ts` over every queued `requires_image` row (stored prompt, aspect,
likes, attribution, per-author cap) and activates only the rows that would
publish today. Rows with `license = 'blocked'` (LLM unsafe verdict, see
`--relabel`) are kept back with reason `blocked-by-llm` whatever the filters
say. Dry run by default; `--apply` writes in one transaction.

```bash
npx tsx scripts/ingestPresets/activateI2v.ts         # report only
npx tsx scripts/ingestPresets/activateI2v.ts --apply # activate
```

## Failure modes

| Symptom                                  | Cause                                                                                                                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reader proxy returned a non-JSON body`  | `r.jina.ai` served an error/challenge page. The listing API is behind a Cloudflare managed challenge and the proxy is the **only** working channel — there is no fallback. |
| `catalogue page has neither …`           | Upstream renamed its payload keys. Both `videos` and `images` are already accepted; add the new key in `fetchCatalog.parseCatalogPage`.                                    |
| Every page reports `fresh=0` on offset 0 | Normal — nothing new since the last run.                                                                                                                                   |
| `GET https://images.meigen.ai/… → 404`   | Media CDN layout changed, or that particular clip was pulled. Counted as `failed-media`; a systemic change shows up as every item failing.                                 |
| `HeadBucket` / `AccessDenied` on upload  | RustFS is down, or its metadata was corrupted by someone `mkdir`-ing inside the data dir. **Never write to the RustFS data directory directly** — always the S3 API.       |
| Alert logged but no Telegram message     | `TELEGRAM_ALERT_BOT_TOKEN` / `TELEGRAM_ALERT_CHAT_ID` missing from the cron environment.                                                                                   |
| `OPENROUTER_API_KEY is not set`          | Key missing from `.env.local` / cron env. Add it, or run with `--no-llm` for keyword-table labels.                                                                          |
| Many `(llm failed: http 402 …)` lines    | OpenRouter balance exhausted. Items keep heuristic labels; the run still succeeds. Top up, then `--relabel`.                                                                |
| `(llm failed: empty content …)`          | The model answered with reasoning only. Should not happen with `effort: minimal`; if OpenRouter drops the field, raise `MAX_TOKENS` in `classify.ts`.                      |

Everything already ingested lives in our own DB and CDN, so the catalogue never
degrades when the source or the proxy goes away.

## Tests

```bash
npx vitest run scripts/ingestPresets
```

Covers the pure logic only — filters, i2v detection, aspect resolution,
attribution, category, title/slug derivation and page parsing — plus the LLM
step with a mocked `fetch` (schema validation, trimming, retry/cap/fallback
behaviour), the label merge (`requires_image` precedence, unsafe → skip) and
`--relabel` against a mocked `pg` client (dry-run issues no writes). Network,
ffmpeg and DB paths are exercised by `--dry-run` and by the first supervised
real run.
