# Blog AI-pivot Implementation Plan (v2)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (this session) or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) tracking.

**Goal:** Rebuild gptweb.ru blog organic traffic on RKN-safe AI topics by fixing the broken keyword supply that feeds the existing 8-articles/day machine.

**Architecture:** The generator / SEO-gate / publish / cluster-expansion pipeline is untouched. We fix only what feeds it: harden the shared keyword guard (bash) AND the ingestion route (TS), purge the junk queue, bootstrap a clean AI keyword stream via Wordstat-validated curated seeds (import mode), and stop the public blog from 301-redirecting / VPN-promoting archived content.

**Tech Stack:** bash + Supabase (`docker exec supabase-db psql`, schema `ai_aggregator`) in `ai-aggregator-lobechat`; Next.js `webgpt-admin/app/api/cron/blog-keywords/route.ts` (ingestion); Next.js `webgpt-landing/app/blog/[category]/[slug]/page.tsx` (public render); Wordstat via `xmlriver` (`scripts/blog/wordstat.sh`).

**Order matters (v2 fix):** filters ship FIRST (Tasks 1–2), THEN we purge (Task 3), THEN seed (Task 4). Otherwise the daily Webmaster auto-collect (03:00 UTC) re-pollutes the queue between purge and filter-deploy.

**Three repos / deploys:**

- `ai-aggregator-lobechat` — bash runs from disk on the VPS (no deploy; commit `canary`).
- `webgpt-admin` — GHA → GHCR → SSH deploy; branch `master`.
- `webgpt-landing` — deploy mechanism CONFIRMED IN TASK 5 STEP 0 before use.

---

## The canonical "junk keyword" definition (shared by all tasks)

A keyword is JUNK if ANY holds (case-insensitive):

1. **VPN/circumvention** — matches `vpn-guard.sh::VPN_RE` (incl. brands browsec, hotspot shield, zenmate, betternet, psiphon, lantern, windscribe, radmin, …).
2. **Circumvention/adult/uncensored** — `без ?цензур|без ?ограничен|раздев|18\+|adult|nsfw|jailbreak|взлом|цензур`.
3. **Branded-navigational** — `wegpt|gpt ?web|личный кабинет`.
4. **Keyboard-layout gibberish** — the keyword is **all-Latin** (no Cyrillic), contains **zero `aeiou` vowels**, and contains **no AI token** (`gpt|claude|gemini|grok|llama|qwen|ai|api|seo`). This precisely catches Russian typed in the Latin layout (`dgy yf gr` = "впн на пк"), because Russian→Latin layout maps almost all Russian vowels to Latin consonants → vowel-starved all-Latin strings. Legit English AI tools (`stable diffusion`, `perplexity`, `copilot`, `midjourney`) have normal vowels → never match; Russian AI keywords have Cyrillic → never match; `gpt`/`chatgpt` are protected by the AI-token clause.

> Rationale for the vowel rule (v2 fix): the earlier `[a-z]{4,}` + allow-list would have blocked every English-named AI tool not on the list (`stable diffusion`, `perplexity`, `leonardo`, `suno`, `flux`, …) — i.e. the exact content we are building. The vowel rule has near-zero false positives on legit AI terms.

---

## Task 1: Harden the shared keyword guard (bash) — ships first

**Files:**

- Modify: `scripts/blog/lib/vpn-guard.sh`
- Create: `scripts/blog/tests/test-keyword-guard.sh`
- Create: `scripts/blog/tests/keyword-fixtures.txt` (shared block/pass fixtures — also used by the TS test in Task 2)

**Step 1: Write the shared fixtures** (`scripts/blog/tests/keyword-fixtures.txt`)

```
BLOCK	browsec скачать
BLOCK	hotspot shield basic
BLOCK	dgy yf gr
BLOCK	,tcgkfnysq dgy yf gr
BLOCK	как обойти блокировку интернета
BLOCK	промт для раздевания в gemini
BLOCK	ии чат без цензуры
BLOCK	wegpt ru личный кабинет
PASS	нейросеть для генерации картинок
PASS	chatgpt промпты для учебы
PASS	как пользоваться claude на русском
PASS	лучшие нейросети для текста
PASS	midjourney что это
PASS	stable diffusion промпты
PASS	perplexity что это
PASS	github copilot для кода
PASS	deepseek нейросеть
```

**Step 2: Write the failing test** (`scripts/blog/tests/test-keyword-guard.sh`)

```bash
#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$DIR/lib/vpn-guard.sh"
fail=0
while IFS=$'\t' read -r verdict kw; do
  [ -z "$verdict" ] && continue
  if is_vpn_keyword "$kw"; then got=BLOCK; else got=PASS; fi
  if [ "$got" = "$verdict" ]; then
    echo "OK   $verdict  $kw"
  else
    echo "WRONG want=$verdict got=$got  $kw"
    fail=1
  fi
done < "$DIR/tests/keyword-fixtures.txt"
[ "$fail" = 0 ] && echo "PASS keyword-guard" || {
  echo "FAIL keyword-guard"
  exit 1
}
```

**Step 3: Run it — expect failures**

Run: `bash scripts/blog/tests/test-keyword-guard.sh`
Expected: WRONG lines for `browsec`, `hotspot`, `dgy yf gr`, `раздевания`, `без цензуры`, `wegpt` → `FAIL keyword-guard`.

**Step 4: Implement in `scripts/blog/lib/vpn-guard.sh`**

(a) Add brands to the `VPN_RE` alternation (find the existing `VPN_RE='(...)'` line, add inside the group): `browsec`, `hotspot ?shield`, `zenmate`, `betternet`, `psiphon`, `lantern`, `туннел`, `tunnel`.

(b) Replace `is_vpn_keyword()` with:

```bash
# AI tokens that must never be treated as gibberish/junk.
VPN_GUARD_AI_RE='(gpt|chatgpt|claude|gemini|grok|llama|qwen|deepseek|midjourney|openai|google|telegram|\bai\b|api|seo)'

# Keyboard-layout gibberish: all-Latin, zero aeiou vowels, no AI token.
is_layout_gibberish() {
  local lc="${1,,}"
  [[ "$lc" =~ [а-яё] ]] && return 1           # has Cyrillic → not gibberish
  [[ "$lc" =~ $VPN_GUARD_AI_RE ]] && return 1 # protected AI term
  local letters="${lc//[^a-z]/}"              # strip non-latin-letters
  ((${#letters} < 5)) && return 1             # too short to judge
  local vow="${letters//[^aeiou]/}"
  ((${#vow} == 0)) && return 0 # all-latin, no vowels → gibberish
  return 1
}

is_vpn_keyword() {
  local kw_lc="${1,,}"
  [[ "$kw_lc" =~ $VPN_RE ]] && return 0                                                                                        # 1) VPN/brands
  [[ "$kw_lc" =~ (без[[:space:]]*цензур|без[[:space:]]*ограничен|раздев|18\+|adult|nsfw|jailbreak|взлом|цензур) ]] && return 0 # 2) circumvention/adult
  [[ "$kw_lc" =~ (wegpt|gpt[[:space:]]?web|личный[[:space:]]+кабинет) ]] && return 0                                           # 3) branded-nav
  is_layout_gibberish "$kw_lc" && return 0                                                                                     # 4) layout gibberish
  return 1
}
```

**Step 5: Run the test — expect pass**

Run: `bash scripts/blog/tests/test-keyword-guard.sh`
Expected: all `OK …`, `PASS keyword-guard`.

**Step 6: Regression — slot-parity + syntax of consumers**

Run: `bash scripts/blog/tests/test-slot-parity.sh; bash -n scripts/blog/generate-article.sh && echo gen-ok; bash -n scripts/blog/track-positions.sh && echo trk-ok`
Expected: `PASS …`, `gen-ok`, `trk-ok`.

**Step 7: Commit**

```bash
git add scripts/blog/lib/vpn-guard.sh scripts/blog/tests/test-keyword-guard.sh scripts/blog/tests/keyword-fixtures.txt
git commit -m "feat(blog): harden keyword guard — VPN brands + vowel-based layout-gibberish + adult/обход/nav"
```

---

## Task 2: Ingestion filter + volume floor (webgpt-admin) — ships before purge

**Files:**

- Modify: `webgpt-admin/app/api/cron/blog-keywords/route.ts` (`normalizeKeyword`, `handleAutoCollect`)
- Create: `webgpt-admin/lib/__tests__/keyword-junk.test.ts` (mirror of the bash fixtures)

**Step 1: Add the junk filter to `normalizeKeyword`**

The route's `normalizeKeyword` only drops API-error payloads — Webmaster VPN/обход queries flow straight in (the self-reinforcing loop). Add, mirroring `vpn-guard.sh` (TS can't source bash — KEEP IN SYNC; same vowel rule keeps it simple):

```ts
// Mirror of scripts/blog/lib/vpn-guard.sh::is_vpn_keyword — keep in sync.
const JUNK_RE =
  /(vpn|впн|vless|amnezi|амнези|hiddify|outline|shadowsocks|wireguard|browsec|hotspot|zenmate|betternet|psiphon|lantern|windscribe|radmin|proxy|прокси|обход|разблок|dpi|byebyedpi|туннел|tunnel|без ?цензур|без ?ограничен|раздев|18\+|adult|nsfw|jailbreak|взлом|цензур|wegpt|gpt ?web|личный кабинет)/i;
const AI_TOKEN_RE =
  /(gpt|chatgpt|claude|gemini|grok|llama|qwen|deepseek|midjourney|openai|google|telegram|\bai\b|api|seo)/i;
function isLayoutGibberish(kw: string): boolean {
  const lc = kw.toLowerCase();
  if (/[а-яё]/.test(lc)) return false; // has Cyrillic
  if (AI_TOKEN_RE.test(lc)) return false; // protected AI term
  const letters = lc.replace(/[^a-z]/g, '');
  if (letters.length < 5) return false;
  return !/[aeiou]/.test(letters); // all-latin, no vowels
}
export function isJunkKeyword(kw: string): boolean {
  return JUNK_RE.test(kw) || isLayoutGibberish(kw);
}
```

Then in `normalizeKeyword`, after the existing checks and before `return keyword;`:

```ts
if (isJunkKeyword(keyword)) return null;
```

**Step 2: Add a volume floor to the auto-collect insert**

In `handleAutoCollect`, only for NEW keywords (existing-row metric updates stay), after `const impressions = …` and before the `insert`:

```ts
const VOLUME_FLOOR = 30; // RU Webmaster TOTAL_SHOWS over the 28-day window
if (!existing && impressions < VOLUME_FLOOR) {
  skipped++;
  continue;
}
```

**Step 3: Write the TS test** (`webgpt-admin/lib/__tests__/keyword-junk.test.ts`)

Use the same block/pass cases as the bash fixtures (drift guard):

```ts
import { describe, it, expect } from 'vitest';
import { isJunkKeyword } from '@/app/api/cron/blog-keywords/route';
const BLOCK = [
  'browsec скачать',
  'hotspot shield basic',
  'dgy yf gr',
  'как обойти блокировку интернета',
  'промт для раздевания в gemini',
  'ии чат без цензуры',
  'wegpt ru личный кабинет',
];
const PASS = [
  'нейросеть для генерации картинок',
  'chatgpt промпты для учебы',
  'stable diffusion промпты',
  'perplexity что это',
  'github copilot для кода',
  'deepseek нейросеть',
  'midjourney что это',
];
describe('isJunkKeyword', () => {
  it.each(BLOCK)('blocks %s', (k) => expect(isJunkKeyword(k)).toBe(true));
  it.each(PASS)('passes %s', (k) => expect(isJunkKeyword(k)).toBe(false));
});
```

> If `isJunkKeyword` can't be exported from a route file under this Next config, move the three helpers into `webgpt-admin/lib/keyword-junk.ts` and import from both the route and the test.

**Step 4: Run the test + typecheck**

Run: `cd /home/deploy/projects/webgpt-admin && npx vitest run lib/__tests__/keyword-junk.test.ts 2>&1 | tail -15; npx tsc --noEmit 2>&1 | grep -iE 'blog-keywords|keyword-junk|error TS' | head`
Expected: tests pass; no TS errors in the touched files. (If vitest isn't configured, run a quick `node`-based assertion instead and note it.)

**Step 5: Commit + deploy webgpt-admin**

```bash
git add app/api/cron/blog-keywords/route.ts lib/__tests__/keyword-junk.test.ts lib/keyword-junk.ts 2> /dev/null
git commit -m "fix(blog): reject VPN/обход/adult/nav/gibberish at keyword ingestion + volume floor"
git push origin master # GHA → GHCR → SSH
```

Verify: `gh run list --limit 1` succeeds; `curl -s -o /dev/null -w '%{http_code}' -X POST https://ask.gptweb.ru/api/cron/blog-keywords` → 401 (route alive). **Both filters (Task 1 bash + Task 2 TS) must be live before Task 3.**

---

## Task 3: Purge the junk keyword queue (SQL) — only after Tasks 1–2 are live

**Files:**

- Create: `supabase-migrations/2026-06-13_purge_junk_keywords.sql`

**Step 1: Capture before-count**

Run: `docker exec supabase-db psql -U postgres -d postgres -tAc "SELECT 'pending=' || count(*) FROM ai_aggregator.blog_keywords WHERE status='pending';"`
Expected: `pending=1424` (±).

**Step 2: Write the purge SQL** (`supabase-migrations/2026-06-13_purge_junk_keywords.sql`)

The gibberish clause matches the vowel rule: all-Latin (`^[a-z ,._-]+$`, no Cyrillic), zero `aeiou`, no AI token.

```sql
-- Quarantine the junk pending keyword queue (AI-pivot 2026-06-13).
-- status=skipped (reversible). Mirrors vpn-guard.sh::is_vpn_keyword.
UPDATE ai_aggregator.blog_keywords SET status='skipped'
WHERE status='pending' AND (
     keyword ~* '(vpn|впн|vless|amnezi|амнези|hiddify|outline|shadowsocks|wireguard|browsec|hotspot|zenmate|betternet|psiphon|lantern|windscribe|radmin|proxy|прокси|обход|разблок|dpi|byebyedpi|туннел|tunnel)'
  OR keyword ~* '(без ?цензур|без ?ограничен|раздев|18\+|adult|nsfw|jailbreak|взлом|цензур)'
  OR keyword ~* '(wegpt|gpt ?web|личный кабинет)'
  OR (keyword !~ '[а-яёА-ЯЁ]' AND keyword !~* '[aeiou]'
        AND keyword !~* '(gpt|claude|gemini|grok|llama|qwen|ai|api|seo)')
  OR coalesce(impressions,0) < 30
);
```

**Step 3: Dry-run the count BEFORE applying**

Run the same WHERE wrapped in `SELECT count(*) … WHERE status='pending' AND ( … );`
Expected: a large number (likely 1300–1420).

**Step 4: Eyeball the SURVIVORS — do not kill good AI terms**

Run the same predicate negated (`AND NOT ( … )`), `ORDER BY impressions DESC`.
Expected: a short clean AI list or empty. If a legit AI term would be purged, widen the AI-token allow-list in the gibberish clause (NOT the broad parts) and re-check. **Do NOT apply until survivors look clean.**

**Step 5: Apply + verify**

```bash
docker exec -i supabase-db psql -U postgres -d postgres < supabase-migrations/2026-06-13_purge_junk_keywords.sql 2>&1 | grep -E 'UPDATE [0-9]+'
docker exec supabase-db psql -U postgres -d postgres -tAc "SELECT 'pending_now=' || count(*) FROM ai_aggregator.blog_keywords WHERE status='pending';"
```

**Step 6: Commit**

```bash
git add supabase-migrations/2026-06-13_purge_junk_keywords.sql
git commit -m "chore(blog): purge junk keyword queue (VPN/обход/nav/gibberish/zero-volume) — AI-pivot"
```

---

## Task 4: Bootstrap clean AI keywords via Wordstat-validated seeds

**Files:**

- Create: `scripts/blog/ai-seed-topics.txt`
- Create: `scripts/blog/seed-ai-keywords.sh`

**Step 0: Confirm `wordstat.sh` output format**

Run: `bash scripts/blog/wordstat.sh "нейросеть для текста" | head`
Note whether it prints `phrase<TAB>shows` lines or JSON; adapt the parser in Step 2 accordingly. Also confirm `jq` exists: `command -v jq`.

**Step 1: Curate seed phrases** (`scripts/blog/ai-seed-topics.txt`)

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
  while IFS=$'\t' read -r phrase shows; do # adapt to wordstat.sh format (Step 0)
    [ -z "$phrase" ] && continue
    is_vpn_keyword "$phrase" && continue
    [ "${shows:-0}" -lt "$FLOOR" ] && continue
    batch=$(jq -c --arg k "$phrase" --argjson s "${shows:-0}" \
      '. += [{keyword:$k, source:"manual", priority:"high", impressions:$s}]' <<< "$batch")
  done < <("$DIR/wordstat.sh" "$topic" 2> /dev/null)
done < "$DIR/ai-seed-topics.txt"
n=$(jq 'length' <<< "$batch")
echo "seeding $n AI keywords (floor=$FLOOR)…"
[ "$n" -eq 0 ] && {
  echo "nothing to seed — check wordstat output"
  exit 1
}
curl -sf -X POST "${API_URL:-https://ask.gptweb.ru}/api/cron/blog-keywords" \
  -H "Authorization: Bearer ${CRON_SECRET}" -H 'Content-Type: application/json' \
  -d "{\"keywords\": $batch}" | jq .
```

**Step 3: Run + verify the queue is clean AI**

Run: `bash scripts/blog/seed-ai-keywords.sh`
Then: `docker exec supabase-db psql -U postgres -d postgres -c "SELECT left(keyword,50), priority, impressions FROM ai_aggregator.blog_keywords WHERE status='pending' ORDER BY impressions DESC LIMIT 20;"`
Expected: AI keywords with real volume; no VPN/обход/gibberish. (The ingestion filter from Task 2 also guards this POST — confirm none of the legit seeds were wrongly rejected; if so, fix the gibberish rule.)

**Step 4: Commit**

```bash
git add scripts/blog/seed-ai-keywords.sh scripts/blog/ai-seed-topics.txt
git commit -m "feat(blog): Wordstat-validated AI keyword seeder (bootstrap RKN-safe topics)"
```

---

## Task 5: Public blog — archived VPN 404s (no redirect) + remove VPN promo (webgpt-landing)

**Files:**

- Modify: `webgpt-landing/app/blog/[category]/[slug]/page.tsx`

**Step 0: Confirm webgpt-landing's deploy mechanism (v2 fix)**

Run: `ls /home/deploy/projects/webgpt-landing/.github/workflows/ 2>/dev/null; docker ps --format '{{.Names}}' | grep -i landing`
Determine: GHA workflow vs VPS `docker compose` build. Record the exact deploy command for Step 5. Do NOT guess.

**Step 1: Archived posts → clean 404, never 301 to a VPN page**

At the `if (!post) { … getArchivedRedirect … permanentRedirect … notFound() }` block (\~lines 187–191), skip the redirect for VPN/circumvention slugs:

```ts
const post = await getPostBySlug(slug);
if (!post) {
  const redirectTo = await getArchivedRedirect(slug);
  if (redirectTo && !/\b(vpn|vless|wireguard)\b|впн|прокси|обход/i.test(slug)) {
    permanentRedirect(redirectTo);
  }
  notFound(); // clean 404 → Yandex de-indexes the archived VPN page
}
```

> Decision (v2, was "410" in spec): Next App Router cannot return a 410 from a server component without middleware gymnastics; a clean 404 + the existing `noindex` achieves de-indexing equally for Yandex. 410-via-middleware is a possible later refinement, not needed now.

**Step 2: Remove the live-page VPN promo**

Delete `isVpnArticle` (\~38–54), `VPN_CLUSTER_LINKS` (\~56–70+), the `showVpnPromo` const (\~261), and the JSX block that renders the promo. Find every reference first:

```bash
grep -n "showVpnPromo\|VPN_CLUSTER_LINKS\|isVpnArticle" "app/blog/[category]/[slug]/page.tsx"
```

Delete all; ensure no dangling reference remains.

**Step 3: Build + typecheck**

Run: `cd /home/deploy/projects/webgpt-landing && npx tsc --noEmit 2>&1 | grep -iE 'slug/page|error TS' | head`
Expected: no errors in the page.

**Step 4: Commit + deploy (use the command confirmed in Step 0)**

```bash
git add "app/blog/[category]/[slug]/page.tsx"
git commit -m "fix(blog): archived VPN slugs 404 (no redirect) + remove live VPN promo (RKN)"
git push # then run the deploy command from Step 0
```

**Step 5: Verify live**

Run: `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://gptweb.ru/blog/prompts/dyadya-vanya-skachat-promty-2026`
Expected: `404` with empty redirect (not 301).

---

## Task 6: Docs

**Files:**

- Modify: `docs/seo_blog_instruction.md`

**Step 1:** Update §3 (collection harvests Webmaster own-ranking queries — a VPN feedback loop historically, now filtered at ingestion + volume floor; the clean AI stream comes from `seed-ai-keywords.sh`); §10 (guard now covers slipped VPN brands, vowel-based layout-gibberish, adult/обход/nav; archived VPN slugs 404 no-redirect; live VPN promo removed); add a "Content strategy: AI, not VPN" note pointing to `scripts/blog/ai-seed-topics.txt`.

**Step 2: Commit** (commit prose BEFORE any refresh-instruction-state run — auto-commit gotcha):

```bash
git add docs/seo_blog_instruction.md
git commit -m "docs(blog): AI-pivot — keyword sourcing, hardened guard, archived 404 policy"
```

---

## After all tasks

- `git push origin canary` (bash already live from disk; commit for record).
- Confirm `webgpt-admin` + `webgpt-landing` deploys live.
- Next `blog-generate` slots draw from the clean AI queue; cluster-expansion amplifies winners.
- Track weekly: `/blog` organic in Metrika (106801684) — building from a tiny non-VPN base, slow ramp expected.

## Self-review (v2)

- Spec coverage: filter §3/§2/§1 → T1+T2; purge §1 → T3; seed §2 → T4; 404/hygiene §4 → T5; docs → T6. ✓
- Review findings applied: vowel-gibberish (no legit-AI false-block) ✓; order filters→purge→seed ✓; English-AI must_pass cases + shared fixtures ✓; landing deploy confirmed in T5.S0 ✓; SQL parens consistent ✓; 410→404 made conscious ✓; bash↔TS drift mitigated via shared fixtures + simple vowel rule ✓.
- No remaining placeholders except deliberately-deferred (final seed list / floor — produced from live Wordstat in T4). ✓
