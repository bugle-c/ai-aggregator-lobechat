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
```

### Flags

| Flag                            | Default | Meaning                                                                 |
| ------------------------------- | ------- | ----------------------------------------------------------------------- |
| `--dry-run`                     | off     | Fetch + filter + report. No downloads, no S3, no DB writes.             |
| `--limit=N`                     | `40`    | Cap on newly ingested items for the whole run, spent across modalities. |
| `--max-pages=N`                 | `15`    | Cap on catalogue pages per modality (page = 20 items).                  |
| `--modality=video\|image\|both` | `both`  | Which catalogue(s) to walk.                                             |

### Requirements

- `ffmpeg` with `libx264` and `libwebp` on the host (`ffmpeg -version`).
- `DATABASE_URL`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
  `S3_BUCKET` — already in `.env.local`, host-reachable (`127.0.0.1:5433`,
  `localhost:9000`).
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
3. **Media.** `images.meigen.ai` → `ffmpeg` → RustFS via the S3 API →
   `https://ask.gptweb.ru/s3/lobe/presets/trend-<id>.{mp4,webp}`. Temp files are
   always cleaned up. An item whose media fails is counted as `failed-media`
   and **not** stored — `preview_url` is `NOT NULL` and a row without a preview
   is useless.
4. **Upsert.** `ON CONFLICT (external_id) DO NOTHING`, so a re-run is a no-op.

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
`category` from a keyword table falling back to `trends` (categories are
DB-driven since Ф2, so a new slug is reachable); `title` a short Russian label
from a keyword table falling back to the trimmed source title.

## Activating pre-Ф5 i2v rows (one-off)

Queue reasons are not stored, so `activateI2v.ts` re-runs the _current_
`filters.ts` over every queued `requires_image` row (stored prompt, aspect,
likes, attribution, per-author cap) and activates only the rows that would
publish today. Dry run by default; `--apply` writes in one transaction.

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

Everything already ingested lives in our own DB and CDN, so the catalogue never
degrades when the source or the proxy goes away.

## Tests

```bash
npx vitest run scripts/ingestPresets
```

Covers the pure logic only — filters, i2v detection, aspect resolution,
attribution, category, title/slug derivation and page parsing. Network, ffmpeg
and DB paths are exercised by `--dry-run` and by the first supervised real run.
