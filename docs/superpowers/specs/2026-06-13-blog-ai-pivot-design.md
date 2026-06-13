# Blog AI-pivot — rebuild organic traffic on RKN-safe topics — design

**Status:** approved 2026-06-13
**Scope:** Refill and retarget the existing blog content machine (8
auto-articles/day + cluster-expansion) so it rebuilds organic search
traffic on legitimate, high-volume, RKN-safe AI topics — replacing the
VPN/circumvention traffic base that is permanently gone.
**Out of scope:** changing the generation/SEO-gate/publish pipeline
itself (it works); a manual/editorial pillar-content track (the owner
chose the volume-machine path); reviving any VPN content.

## Why now — the diagnosis (data-backed)

`/blog` organic search traffic (Yandex Metrika, counter 106801684) fell
\~95% over 18 days: **\~6000 visits/day (May 25–26) → \~250 (June 12)**. The
fall is **100% organic search** (direct/referral/social are <2%), and the
top pages were **entirely VPN**: `ogon-vpn`, `shchuka-vpn`, `windscribe`,
`batya-vpn`, `dyadya-vanya`, `amneziya-vpn`, `vipien`, … The blog was, in
effect, a VPN site.

Two compounding causes, neither reversible:

1. **Yandex is demoting/de-indexing VPN content** (RU regulatory pressure;
   the decline started May 27, before our mass archive).
2. **RKN compliance** removed the VPN content ourselves (125 articles
   archived → 404). We cannot and will not bring it back.

Deeper root cause for "why AI content never ranked": the **keyword supply
is broken**. The pending queue (1424 keywords) is almost all junk:

- VPN that slipped the regex: `browsec скачать`, `hotspot shield basic`.
- **Keyboard-layout gibberish**: `dgy yf gr` = "впн на пк" typed in Latin
  layout (d→в, g→п, y→н); `,tcgkfnysq dgy yf gr` = "бесплатный впн на пк".
- Circumvention/adult: `обход цензуры gemini`, `боты без цензуры`,
  `промт для раздевания в gemini`, `ии чат без ограничений`.
- Branded-navigational: `wegpt ru личный кабинет`, `gpt web`.
- **Only 2 of 1424 keywords have search volume >100.**

Even the existing "AI" articles skew grey-area (`нейронка-без-цензуры`,
`ии-без-ограничений`, `ai-without-filters`, `gemini для России`) — the
same circumvention bait, just applied to AI. The topic engine
systematically dredges grey-zone, zero-volume terms. Retargeting "to AI"
in the abstract is not enough — the keyword pipeline must be fixed.

## Architecture — 4 parts

The generation pipeline, SEO gate (score ≥80, zero FAIL), IndexNow ping,
position tracking, and cluster-expansion loop all stay as-is. We only fix
what feeds them.

### 1. Purge the junk queue

Quarantine (`status='skipped'`) all pending `blog_keywords` matching: the
hardened VPN regex (incl. brands + layout-gibberish), circumvention/adult
(`обход|цензур|без ограничен|раздев|18\+|adult|jailbreak`),
branded-navigational (`wegpt|gpt ?web|личный кабинет`), and anything below
the volume floor. Near-zero survive — expected; the machine refills from
clean seeds.

### 2. Fix the keyword source (the primary lever)

Keyword collection runs via `POST /api/cron/blog-keywords` (seed logic in
the app, not bash). Replace its seed set with curated, high-volume,
RKN-safe AI topic seeds, validated against real RU Wordstat volume before
seeding. Seed families (each expanded by Wordstat into clusters):

- **нейросети** — что такое / как пользоваться / бесплатно / онлайн / на русском / для телефона
- **модели** (без «обхода»): ChatGPT, Claude, Gemini, Midjourney, Grok — как пользоваться, возможности, бесплатно, на русском
- **промпты для** — учёбы, работы, текстов, кода, картинок, резюме, презентаций
- **ИИ для задач** — написать текст/диплом/письмо, сделать картинку, перевести, код, таблицы
- **сравнения / выбор** — какая нейросеть лучше для X, топ нейросетей для Y
- **how-to / гайды** — как сделать X с помощью ИИ

These have large RU volume and tie directly to the gptweb.ru product
(every article can CTA into "try it on gptweb.ru"). The seed list is
produced during implementation from actual Wordstat numbers, not guessed.

### 3. Harden the keyword filter

Extend the shared guard (`scripts/blog/lib/vpn-guard.sh` +
`generate-article.sh::is_valid_keyword`, and ideally the collection route)
to reject, in addition to the current VPN set:

- **VPN brands that slipped**: `browsec`, `hotspot ?shield`, `zenmate`,
  `betternet`, `touch ?vpn`, `turbo`, `proton` (vpn-context), `urban`,
  `1.1.1.1`, `warp`, `psiphon`, `lantern`, etc.
- **Keyboard-layout gibberish**: keywords that are mostly Latin letters
  forming no English words, or mixed-script noise (heuristic: a Cyrillic
  blog whose keyword has a high ratio of `[a-z]` runs with no vowels / no
  dictionary hit → reject). At minimum, reject the known layout-VPN seeds.
- **Circumvention/adult/uncensored**: `обход`, `без цензур`, `без
ограничен`, `раздев`, `18+`, `adult`, `nsfw`, `jailbreak`, `взлом`.
- **Branded-navigational**: `wegpt`, `gpt ?web`, `личный кабинет`, our own
  domain terms (these convert nothing and signal thin content).
- **Volume floor**: reject keywords with Wordstat impressions below a
  threshold (TBD in plan, e.g. 50–100) so zero-volume junk never enters.

The guard already proved its single-source-of-truth value (2026-06-10
incident); all additions go in the shared lib.

### 4. SEO hygiene for the 125 archived

They currently 404. For RKN we _want_ them out of the index, so a stronger
**410 Gone** is preferable to a soft-404 (faster, cleaner de-index; no
redirect that could pass VPN relevance to a live page). Verify the blog
front returns 410 (or a clean 404 with `noindex`) for archived slugs; no
redirects to live AI pages.

## Success metrics

- Leading: pending queue is clean (junk ≈ 0, all survivors above volume
  floor); ≥X clean AI keywords seeded/day.
- Lagging (Metrika `/blog` organic, weekly): arrest the decline, then net
  growth in non-VPN organic visits over 4–8 weeks. Baseline to beat: the
  pre-collapse _non-VPN_ floor (tiny today) — we are building, not
  recovering, so early numbers are small by definition.
- cluster-expansion amplifies any AI cluster that gains traction.

## Risks

| Risk                                                             | Mitigation                                                                          |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| AI SERPs in RU are competitive; auto-content ranks slowly        | Volume + freshness + cluster-expansion on winners; accept months-long ramp          |
| Filter over-blocks legit AI terms (e.g. "обход ограничений API") | Tune iteratively; over-block is the safe direction (skips, never publishes)         |
| Seed list guessed, not volume-backed                             | Validate every seed family against Wordstat before committing the list              |
| Domain authority dented by 125 archived pages                    | Unavoidable + correct; new clean content rebuilds topical authority                 |
| Layout-gibberish heuristic false-positives                       | Start with an explicit denylist of known layout-VPN seeds; add heuristic cautiously |

## Migration plan (commit order)

1. **Purge** — SQL quarantine of the junk queue (record the WHERE clause).
2. **Filter hardening** — extend `lib/vpn-guard.sh` + collection route +
   add the volume floor; unit-test against the known junk samples.
3. **Seed source** — curate + volume-validate the AI seed families, wire
   them into `/api/cron/blog-keywords`.
4. **410 hygiene** — archived slugs return 410/noindex, no redirects.
5. **Docs** — update `seo_blog_instruction.md` (§3 collection, §10 guard,
   new "content strategy: AI not VPN" note).

Each step independently revertable. The generator/gate/cluster-expansion
are untouched.
