# Blog AI-pivot Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (this session) or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) tracking.

**Goal:** Rebuild gptweb.ru blog organic traffic on RKN-safe AI topics by fixing the broken keyword supply that feeds the existing 8-articles/day machine.

**Architecture:** The generator / SEO-gate / publish / cluster-expansion pipeline is untouched. We fix only what feeds it: purge the junk keyword queue, harden the shared keyword guard (bash) AND the ingestion route (TS) against VPN/обход/adult/nav/layout-gibberish/zero-volume, bootstrap a clean AI keyword stream via Wordstat-validated curated seeds (import mode), and stop the public blog from 301-redirecting / VPN-promoting archived content.

**Tech Stack:** bash + Supabase (`docker exec supabase-db psql`, schema `ai_aggregator`) in `ai-aggregator-lobechat`; Next.js route `webgpt-admin/app/api/cron/blog-keywords/route.ts` (ingestion); Next.js `webgpt-landing/app/blog/[category]/[slug]/page.tsx` (public render); Wordstat via `xmlriver` (`scripts/blog/wordstat.sh`).

**Three repos / deploys:**

- `ai-aggregator-lobechat` (bash scripts run from disk on the VPS — no deploy; commit to `canary`).
- `webgpt-admin` (GHA → GHCR → SSH deploy; branch `master`).
- `webgpt-landing` (deploy = build on VPS; branch per repo).

---

## Task 1: Purge the junk keyword queue

**Files:**

- Create: `supabase-migrations/2026-06-13_purge_junk_keywords.sql` (record only; applied via psql)

**Step 1: Capture the before-count**

Run:

```bash
docker exec supabase-db psql -U postgres -d postgres -tAc "
SELECT 'pending=' || count(*) FROM ai_aggregator.blog_keywords WHERE status='pending';"
```

Expected: `pending=1424` (±).

**Step 2: Write the purge SQL** (`supabase-migrations/2026-06-13_purge_junk_keywords.sql`)

```sql
-- Quarantine the junk pending keyword queue (AI-pivot 2026-06-13).
-- Junk = VPN/brands that slipped, circumvention/adult, branded-nav,
-- keyboard-layout gibberish, and zero-volume. Survivors must be real
-- RU-volume AI terms. status=skipped (reversible).
UPDATE ai_aggregator.blog_keywords SET status='skipped'
WHERE status='pending' AND (
     keyword ~* '(vpn|впн|vless|amnezi|амнези|hiddify|outline|shadowsocks|wireguard|browsec|hotspot|zenmate|betternet|psiphon|lantern|windscribe|radmin|proxy|прокси|обход|разблок|dpi|byebyedpi|туннел|tunnel)'
  OR keyword ~* '(без +цензур|без +ограничен|раздев|18\+|adult|nsfw|jailbreak|взлом|цензур)'
  OR keyword ~* '(wegpt|gpt ?web|личный +кабинет)'
  -- keyboard-layout gibberish: 3+ consecutive latin consonants w/ no vowel,
  -- or a token that is mostly latin letters on an otherwise-russian blog
  OR keyword ~* '[a-z]{4,}'  AND keyword !~* '(gpt|chatgpt|claude|gemini|grok|midjourney|deepseek|llama|qwen|ai|api|seo|web|google|openai)'
  OR coalesce(impressions,0) < 30
);
```

> Note: the `[a-z]{4,}` clause is deliberately broad; the allow-list of AI brand tokens protects legit terms. Over-purge is safe — the machine refills from clean seeds (Task 3).

**Step 3: Dry-run the WHERE (count what it would touch) BEFORE applying**

Run:

```bash
docker exec supabase-db psql -U postgres -d postgres -tAc "
SELECT count(*) FROM ai_aggregator.blog_keywords WHERE status='pending' AND (
  keyword ~* '(vpn|впн|vless|amnezi|амнези|hiddify|outline|shadowsocks|wireguard|browsec|hotspot|zenmate|betternet|psiphon|lantern|windscribe|radmin|proxy|прокси|обход|разблок|dpi|byebyedpi|туннел|tunnel)'
  OR keyword ~* '(без +цензур|без +ограничен|раздев|18\+|adult|nsfw|jailbreak|взлом|цензур)'
  OR keyword ~* '(wegpt|gpt ?web|личный +кабинет)'
  OR (keyword ~* '[a-z]{4,}' AND keyword !~* '(gpt|chatgpt|claude|gemini|grok|midjourney|deepseek|llama|qwen|ai|api|seo|web|google|openai)')
  OR coalesce(impressions,0) < 30);"
```

Expected: a large number (likely 1300–1420 of 1424).

**Step 4: Eyeball the SURVIVORS — make sure we are not killing good AI terms**

Run:

```bash
docker exec supabase-db psql -U postgres -d postgres -c "
SELECT keyword, impressions FROM ai_aggregator.blog_keywords WHERE status='pending' AND NOT (
  keyword ~* '(vpn|впн|vless|amnezi|амнези|hiddify|outline|shadowsocks|wireguard|browsec|hotspot|zenmate|betternet|psiphon|lantern|windscribe|radmin|proxy|прокси|обход|разблок|dpi|byebyedpi|туннел|tunnel)'
  OR keyword ~* '(без +цензур|без +ограничен|раздев|18\+|adult|nsfw|jailbreak|взлом|цензур)'
  OR keyword ~* '(wegpt|gpt ?web|личный +кабинет)'
  OR (keyword ~* '[a-z]{4,}' AND keyword !~* '(gpt|chatgpt|claude|gemini|grok|midjourney|deepseek|llama|qwen|ai|api|seo|web|google|openai)')
  OR coalesce(impressions,0) < 30) ORDER BY impressions DESC;"
```

Expected: a short list of legit AI terms (or empty). If a legit term is wrongly excluded-from-survivors (i.e. would be purged), widen the brand allow-list and re-check. Do NOT apply until the survivor set looks clean.

**Step 5: Apply the purge**

Run:

```bash
docker exec -i supabase-db psql -U postgres -d postgres < supabase-migrations/2026-06-13_purge_junk_keywords.sql 2>&1 | grep -E 'UPDATE [0-9]+'
docker exec supabase-db psql -U postgres -d postgres -tAc "SELECT 'pending_now=' || count(*) FROM ai_aggregator.blog_keywords WHERE status='pending';"
```

Expected: `UPDATE <n>`; `pending_now=` small.

**Step 6: Commit the SQL record**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
git add supabase-migrations/2026-06-13_purge_junk_keywords.sql
git commit -m "chore(blog): purge junk keyword queue (VPN/обход/nav/gibberish/zero-volume) — AI-pivot"
```

---

## Task 2: Harden the shared keyword guard (bash)

**Files:**

- Modify: `scripts/blog/lib/vpn-guard.sh`
- Modify: `scripts/blog/tests/` (add `test-keyword-guard.sh`)
- Test: `scripts/blog/tests/test-keyword-guard.sh`

**Step 1: Write the failing test** (`scripts/blog/tests/test-keyword-guard.sh`)

```bash
#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$DIR/lib/vpn-guard.sh"
fail=0
must_block() { is_vpn_keyword "$1" && echo "OK block: $1" || {
  echo "MISS (should block): $1"
  fail=1
}; }
must_pass() { is_vpn_keyword "$1" && {
  echo "FALSE-BLOCK: $1"
  fail=1
} || echo "OK pass: $1"; }
# VPN brands that slipped + layout gibberish + circumvention/adult/nav
must_block "browsec скачать"
must_block "hotspot shield basic"
must_block "dgy yf gr"
must_block "как обойти блокировку интернета"
must_block "промт для раздевания в gemini"
must_block "ии чат без цензуры"
must_block "wegpt ru личный кабинет"
# legit AI keywords must pass
must_pass "нейросеть для генерации картинок"
must_pass "chatgpt промпты для учебы"
must_pass "как пользоваться claude на русском"
must_pass "лучшие нейросети для текста"
must_pass "midjourney что это"
[ "$fail" = 0 ] && echo "PASS keyword-guard" || {
  echo "FAIL keyword-guard"
  exit 1
}
```

**Step 2: Run it — expect failures**

Run: `bash scripts/blog/tests/test-keyword-guard.sh`
Expected: MISS lines for `browsec`, `hotspot`, `dgy yf gr`, `раздевания`, `без цензуры`, `wegpt` (current regex misses these) → `FAIL keyword-guard`.

**Step 3: Extend `VPN_RE` + add `is_vpn_keyword` junk clauses** in `scripts/blog/lib/vpn-guard.sh`

Add the new brands to `VPN_RE` (inside the alternation), and extend `is_vpn_keyword()` to also reject circumvention/adult/nav and layout-gibberish:

```bash
# add to VPN_RE alternation (brands that slipped 2026-06-13):
#   |browsec|hotspot ?shield|zenmate|betternet|psiphon|lantern|туннел|tunnel
# new is_vpn_keyword body:
is_vpn_keyword() {
  local kw_lc="${1,,}"
  # 1) VPN / circumvention brands + tokens
  [[ "$kw_lc" =~ $VPN_RE ]] && return 0
  # 2) circumvention / adult / uncensored
  [[ "$kw_lc" =~ (без[[:space:]]*цензур|без[[:space:]]*ограничен|раздев|18\+|adult|nsfw|jailbreak|взлом|цензур) ]] && return 0
  # 3) our own branded-navigational (thin, converts nothing)
  [[ "$kw_lc" =~ (wegpt|gpt[[:space:]]?web|личный[[:space:]]+кабинет) ]] && return 0
  # 4) keyboard-layout gibberish: a token of 4+ latin chars that is NOT a known
  #    AI brand → almost always Cyrillic typed in the wrong layout (dgy yf gr).
  if [[ "$kw_lc" =~ [a-z]{4,} ]] && ! [[ "$kw_lc" =~ (gpt|chatgpt|claude|gemini|grok|midjourney|deepseek|llama|qwen|ai|api|seo|web|google|openai|telegram|windows|android|iphone) ]]; then
    return 0
  fi
  return 1
}
```

> Keep `VPN_RE` as the canonical brand list; the extra clauses live in `is_vpn_keyword` so both the generator and the producer inherit them (single source of truth — see 2026-06-10 incident).

**Step 4: Run the test — expect pass**

Run: `bash scripts/blog/tests/test-keyword-guard.sh`
Expected: all `OK …` lines, `PASS keyword-guard`.

**Step 5: Regression — the existing slot-parity/vpn tests still pass**

Run: `bash scripts/blog/tests/test-slot-parity.sh; bash -n scripts/blog/generate-article.sh && echo generate-ok; bash -n scripts/blog/track-positions.sh && echo track-ok`
Expected: `PASS …`, `generate-ok`, `track-ok`.

**Step 6: Commit**

```bash
git add scripts/blog/lib/vpn-guard.sh scripts/blog/tests/test-keyword-guard.sh
git commit -m "feat(blog): harden keyword guard — VPN brands + layout-gibberish + adult/обход/nav"
```

---

## Task 3: Stop ingestion from re-importing junk + add volume floor (TS)

**Files:**

- Modify: `webgpt-admin/app/api/cron/blog-keywords/route.ts` (`normalizeKeyword`)

**Step 1: Add a junk/VPN reject + volume awareness to `normalizeKeyword`**

The route's `normalizeKeyword` currently only drops API-error payloads — VPN/обход queries from Webmaster flow straight in. Add a reject mirroring the bash guard (TS can't source the bash lib; keep the regex in sync — reference the same brand list):

```ts
// Reject VPN/circumvention/adult/nav/layout-gibberish at ingestion so the
// Yandex-Webmaster auto-collect (which harvests the queries we ALREADY rank
// for — historically VPN) stops re-seeding the junk. Mirror of
// scripts/blog/lib/vpn-guard.sh::is_vpn_keyword — keep in sync.
const JUNK_RE =
  /(vpn|впн|vless|amnezi|амнези|hiddify|outline|shadowsocks|wireguard|browsec|hotspot|zenmate|betternet|psiphon|lantern|windscribe|radmin|proxy|прокси|обход|разблок|dpi|byebyedpi|туннел|tunnel|без ?цензур|без ?ограничен|раздев|18\+|adult|nsfw|jailbreak|взлом|цензур|wegpt|gpt ?web|личный кабинет)/i;
function isLayoutGibberish(kw: string): boolean {
  const m = kw.toLowerCase().match(/[a-z]{4,}/);
  return (
    !!m &&
    !/(gpt|chatgpt|claude|gemini|grok|midjourney|deepseek|llama|qwen|\bai\b|api|seo|web|google|openai|telegram|windows|android|iphone)/i.test(
      kw,
    )
  );
}
```

Then in `normalizeKeyword`, after the existing checks, add:

```ts
if (JUNK_RE.test(keyword) || isLayoutGibberish(keyword)) return null;
```

**Step 2: Add a volume floor to the auto-collect insert**

In `handleAutoCollect`, skip inserting brand-new keywords below a floor (existing-row metric updates are fine). After computing `impressions`, before the `insert`:

```ts
const VOLUME_FLOOR = 30; // RU Webmaster TOTAL_SHOWS over 28d
if (!existing && impressions < VOLUME_FLOOR) {
  skipped++;
  continue;
}
```

**Step 3: Build + typecheck**

Run:

```bash
cd /home/deploy/projects/webgpt-admin && npx tsc --noEmit 2>&1 | grep -iE 'blog-keywords|error TS' | head
```

Expected: no errors referencing `blog-keywords/route.ts`.

**Step 4: Commit + deploy webgpt-admin**

```bash
git add app/api/cron/blog-keywords/route.ts
git commit -m "fix(blog): reject VPN/обход/adult/nav/gibberish at keyword ingestion + volume floor"
git push origin master # GHA → GHCR → SSH deploy
```

Verify: GHA run succeeds (`gh run list --limit 1`); endpoint still returns 401 without bearer.

---

## Task 4: Bootstrap clean AI keywords via Wordstat-validated seeds

**Files:**

- Create: `scripts/blog/seed-ai-keywords.sh` (one-shot + re-runnable seeder)
- Create: `scripts/blog/ai-seed-topics.txt` (curated seed phrases)

**Step 1: Curate seed phrases** (`scripts/blog/ai-seed-topics.txt`, one per line)

Seed families from the spec — broad heads that Wordstat will expand. Example starter set (the implementer refines from Wordstat numbers in Step 3):

```
нейросеть для генерации картинок
нейросеть для текста
бесплатные нейросети
как пользоваться chatgpt
chatgpt на русском
промпты для chatgpt
claude нейросеть
gemini нейросеть
нейросеть для учебы
нейросеть для работы
нейросеть для кода
ии для написания текста
как сделать картинку нейросетью
лучшие нейросети 2026
```

**Step 2: Write the seeder** (`scripts/blog/seed-ai-keywords.sh`)

Reads the topic file, runs each through `wordstat.sh` to get RU volume + expansions, filters with `is_vpn_keyword` (Task 2 guard) and a volume floor, then POSTs the survivors to the collection route in **import mode** (`{ keywords: [...] }`) with `source:'manual'`, `priority:'high'`. (The route file: `webgpt-admin/app/api/cron/blog-keywords` import branch.)

```bash
#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/vpn-guard.sh"
set -a
source /home/deploy/.config/blog-autogen/env
set +a
FLOOR=${SEED_VOLUME_FLOOR:-50}
batch='[]'
while IFS= read -r topic; do
  [ -z "$topic" ] && continue
  # wordstat.sh prints "<phrase>\t<shows>" lines for the head + expansions
  while IFS=$'\t' read -r phrase shows; do
    [ -z "$phrase" ] && continue
    is_vpn_keyword "$phrase" && continue
    [ "${shows:-0}" -lt "$FLOOR" ] && continue
    batch=$(jq -c --arg k "$phrase" --argjson s "${shows:-0}" \
      '. += [{keyword:$k, source:"manual", priority:"high", impressions:$s}]' <<< "$batch")
  done < <("$DIR/wordstat.sh" "$topic" 2> /dev/null)
done < "$DIR/ai-seed-topics.txt"
n=$(jq 'length' <<< "$batch")
echo "seeding $n AI keywords (floor=$FLOOR)…"
curl -sf -X POST "${API_URL:-https://ask.gptweb.ru}/api/cron/blog-keywords" \
  -H "Authorization: Bearer ${CRON_SECRET}" -H 'Content-Type: application/json' \
  -d "{\"keywords\": $batch}" | jq .
```

> Verify `wordstat.sh`'s actual output format first (`bash scripts/blog/wordstat.sh "нейросеть"` ) and adapt the `read` parsing if columns differ. If `wordstat.sh` returns JSON, pipe through `jq` instead of `read`.

**Step 3: Dry-run Wordstat for ONE topic (validate volume + format)**

Run: `bash scripts/blog/wordstat.sh "нейросеть для текста" | head`
Expected: phrase/volume rows. Confirm the parser in Step 2 matches; tune the seed list toward heads with real volume (drop heads returning near-zero).

**Step 4: Run the seeder**

Run: `bash scripts/blog/seed-ai-keywords.sh`
Expected: `seeding N AI keywords…` with N≫0 and an import response `{inserted, updated, rejected}`.

**Step 5: Verify the queue is now clean AI keywords**

Run:

```bash
docker exec supabase-db psql -U postgres -d postgres -c "
SELECT left(keyword,50), priority, impressions FROM ai_aggregator.blog_keywords
WHERE status='pending' ORDER BY impressions DESC LIMIT 20;"
```

Expected: AI keywords with real volume, no VPN/обход/gibberish.

**Step 6: Commit**

```bash
git add scripts/blog/seed-ai-keywords.sh scripts/blog/ai-seed-topics.txt
git commit -m "feat(blog): Wordstat-validated AI keyword seeder (bootstrap RKN-safe topics)"
```

---

## Task 5: Public blog — stop redirecting/promoting archived VPN (webgpt-landing)

**Files:**

- Modify: `webgpt-landing/app/blog/[category]/[slug]/page.tsx`

**Step 1: Archived posts → clean 404, never 301-redirect**

At lines \~187-191 the page does `getArchivedRedirect(slug)` → `permanentRedirect`. For the RKN takedown we do NOT want to redirect archived VPN to a live page. Change archived handling to `notFound()` (clean 404) unless the redirect target is a non-VPN canonical from the cannibalization map. Minimal safe change: skip the redirect for VPN slugs.

```ts
const post = await getPostBySlug(slug);
if (!post) {
  const redirectTo = await getArchivedRedirect(slug);
  // Do NOT redirect VPN/circumvention slugs to live pages (RKN + de-index):
  if (redirectTo && !/\b(vpn|vless|wireguard)\b|впн|прокси|обход/i.test(slug)) {
    permanentRedirect(redirectTo);
  }
  notFound();
}
```

**Step 2: Remove the live-page VPN promo block**

Lines \~38-70 + \~261 define `isVpnArticle`, `VPN_CLUSTER_LINKS`, `showVpnPromo`. These promote VPN on live pages (RKN leak + off-strategy). Remove the `VPN_CLUSTER_LINKS` array, the `isVpnArticle` helper, the `showVpnPromo` const, and the JSX block that renders it. Grep to find the JSX usage:

```bash
grep -n "showVpnPromo\|VPN_CLUSTER_LINKS\|isVpnArticle" "app/blog/[category]/[slug]/page.tsx"
```

Delete all references.

**Step 3: Build + typecheck**

Run: `cd /home/deploy/projects/webgpt-landing && npx tsc --noEmit 2>&1 | grep -iE 'slug/page|error TS' | head`
Expected: no errors in the page.

**Step 4: Verify locally that an archived VPN slug 404s (no redirect)**

After deploy (Step 5), run:

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://gptweb.ru/blog/prompts/dyadya-vanya-skachat-promty-2026
```

Expected: `404` with empty redirect (not 301).

**Step 5: Commit + deploy webgpt-landing**

```bash
git add "app/blog/[category]/[slug]/page.tsx"
git commit -m "fix(blog): archived VPN slugs 404 (no redirect) + remove live VPN promo blocks (RKN)"
git push # then deploy per webgpt-landing's pipeline (VPS build)
```

---

## Task 6: Docs

**Files:**

- Modify: `docs/seo_blog_instruction.md` (in `ai-aggregator-lobechat`)

**Step 1: Update the relevant sections**

- §3 (Сбор семантики): document that auto-collect harvests Webmaster _own-ranking_ queries (a VPN feedback loop historically) and is now filtered at ingestion (`normalizeKeyword` JUNK_RE + volume floor); the clean AI stream comes from `seed-ai-keywords.sh` (Wordstat-validated curated seeds, import mode).
- §10 (RKN): note the guard now also covers VPN brands that slipped (browsec/hotspot…), layout-gibberish, adult/обход/nav; archived VPN slugs 404 (no redirect) and the live VPN promo block is removed.
- Add a short "Content strategy: AI, not VPN" note: the blog rebuilds traffic on нейросети/модели/промпты/ИИ-задачи; seed families live in `scripts/blog/ai-seed-topics.txt`.

**Step 2: Commit** (commit prose BEFORE any refresh-instruction-state run — auto-commit gotcha)

```bash
git add docs/seo_blog_instruction.md
git commit -m "docs(blog): AI-pivot — keyword sourcing, hardened guard, archived 410/404 policy"
```

---

## After all tasks

- Push `ai-aggregator-lobechat` `canary` (bash live from disk already; commit for record): `git push origin canary`.
- Confirm `webgpt-admin` + `webgpt-landing` deploys are live (GHA / VPS build).
- The next `blog-generate` slots (08–22 MSK) will draw from the clean AI queue; cluster-expansion amplifies any AI cluster that gains traction.
- Track recovery weekly: `/blog` organic in Metrika (counter 106801684) — building from a tiny non-VPN base, so expect a slow ramp.

## Self-review checklist (run before executing)

- Spec coverage: §1 purge → T1; §2 seed source → T3+T4; §3 filter → T2+T3; §4 410/hygiene → T5; docs → T6. ✓
- No placeholders except deliberately-deferred (final seed list / volume floor — produced from live Wordstat in T4). ✓
- Guard regex stays single-source in bash (`vpn-guard.sh`); the TS `JUNK_RE` is an explicit mirror flagged "keep in sync". ✓
