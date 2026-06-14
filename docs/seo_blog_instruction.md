<!--
  ╔══════════════════════════════════════════════════════════════════╗
  ║  SEO BLOG — OPERATIONAL INSTRUCTION (gptweb.ru)                   ║
  ║  Single source of truth for the automated SEO blog pipeline.     ║
  ║                                                                  ║
  ║  FOR AI AGENTS: read this top-to-bottom before touching ANY      ║
  ║  blog automation. It explains every step, decision, threshold,   ║
  ║  table, timer, failure mode and recovery procedure end-to-end.   ║
  ║                                                                  ║
  ║  ⚠️  MAINTENANCE RULE (mandatory):                                ║
  ║  Whenever you change blog automation (any script in              ║
  ║  scripts/blog/, any blog table, any timer, any threshold,        ║
  ║  the RKN policy, the news profile, etc.) you MUST update the     ║
  ║  relevant prose section of this file IN THE SAME CHANGE. The     ║
  ║  "LIVE STATE" block below is refreshed automatically by a cron   ║
  ║  (refresh-instruction-state.sh); the prose is NOT — humans/agents║
  ║  own it.                                                          ║
  ╚══════════════════════════════════════════════════════════════════╝
-->

# SEO Blog — операционная инструкция (gptweb.ru)

> **Назначение файла.** Это исчерпывающее описание того, как устроен
> автоматический SEO-блог на `gptweb.ru` — от сбора семантики до
> публикации, индексации, отслеживания трафика и реоптимизации. Любой
> ИИ-агент должен прочитать этот файл целиком прежде чем менять блог.
>
> **Язык.** Проза — русский, технические термины/код — английский (как
> во всём репозитории).

<!-- LIVE-STATE:BEGIN — этот блок перезаписывается cron-скриптом
     refresh-instruction-state.sh раз в сутки. Руками НЕ редактировать,
     изменения затрутся. -->

### 📊 LIVE STATE (auto, обновлено 2026-06-14 04:00 МСК)

**Контент:** published **237** · archived 125 · draft 0
· keywords pending **188** (из них VPN: 0 — должно быть \~0)
· clusters used 197 · reoptimize pending 0

**Новости:** профиль истекает **2026-07-19** (осталось 35 дн.) · pipeline 🟢 ok (профиль активен)

**Кадэнс публикаций (7 дней):**

- 2026-06-13 — 5 постов
- 2026-06-12 — 8 постов
- 2026-06-11 — 8 постов
- 2026-06-10 — 6 постов

**Таймеры (последний запуск):**

| Сервис            | Статус    | Когда                   |
| ----------------- | --------- | ----------------------- |
| `blog-generate`   | 🔴 exit=1 | 2026-06-13 22:21:08 MSK |
| `blog-hype`       | 🔴 exit=1 | 2026-06-13 19:38:33 MSK |
| `blog-keywords`   | 🟢 exit=0 | 2026-06-14 03:00:04 MSK |
| `blog-positions`  | 🟢 exit=0 | 2026-06-13 04:03:26 MSK |
| `blog-sync`       | 🟢 exit=0 | 2026-06-13 06:00:08 MSK |
| `blog-reoptimize` | 🟢 exit=0 | 2026-06-14 04:00:01 MSK |

<!-- LIVE-STATE:END -->

---

## 0. TL;DR для агента, у которого 30 секунд

- Блог пишется **сам**: 8 статей/день по ротации категорий (`blog-generate`,
  08–22 МСК) + 1 новость/день (`blog-hype`, 09:30 и 19:30 МСК).
- Источник тем — **семантика из Yandex Wordstat** (`blog-keywords`,
  ежедневно), сгруппированная в **кластеры** (`cluster-builder.sh`).
- Каждая статья проходит **SEO-аудит ДО публикации** (gate, порог 80/100,
  ноль FAIL). Не прошла → остаётся `draft`.
- Опубликованное **пингуется в IndexNow + Yandex**, трафик трекается
  ежедневно (`blog-positions`), просевшие посты **реоптимизируются**
  (`blog-reoptimize`).
- 🚫 **VPN-тематика запрещена** (РКН). В генераторе hard-guard +
  карантин ключей. Не снимать без явного указания владельца.
- Всё на **bash + Supabase REST + Claude CLI + systemd timers**, секреты в
  `/home/deploy/.config/blog-autogen/env`.
- Уведомления (успех/провал) идут в **Telegram** (`@gptwebrubot`,
  chat `249389410`), НЕ в email.

---

## 1. Где что лежит

| Что                     | Путь                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| Скрипты пайплайна       | `/home/deploy/projects/ai-aggregator-lobechat/scripts/blog/`                                  |
| Этот документ           | `/home/deploy/projects/ai-aggregator-lobechat/docs/seo_blog_instruction.md`                   |
| Секреты/env             | `/home/deploy/.config/blog-autogen/env` (chmod 600)                                           |
| Логи                    | `/home/deploy/.claude/logs/blog-*.log` + `journalctl -u blog-*.service`                       |
| systemd timers/services | `/etc/systemd/system/blog-*.{timer,service}`                                                  |
| База данных             | Supabase self-hosted, схема `ai_aggregator`, PG-контейнер `supabase-db` (НЕ `lobe-postgres`!) |
| Фронтенд блога (рендер) | `webgpt-landing` (Next.js), маршрут `/blog/[category]/[slug]`                                 |
| Новостной агент         | сервис `agent-news-007` (`https://agent-news-007.pashavin.ru`)                                |

**Важно про две БД:** контент блога живёт в **Supabase** (`supabase-db`
контейнер, схема `ai_aggregator`). Биллинг/usage_logs приложения — в
**отдельной** PG (`lobe-postgres`, БД `lobechat`). Не путать. Прямой
доступ к Supabase: `docker exec supabase-db psql -U postgres -d postgres`.
PostgREST не всегда видит таблицы `ai_aggregator` в кеше схемы — для
надёжности ходи в PG напрямую через `docker exec`.

---

## 2. Полный жизненный цикл одной статьи (end-to-end)

```
[1] Wordstat ──► collect-keywords.sh ──► blog_keywords (status=pending)
                                              │
                                              ▼  (раз в сутки 03:00 UTC)
[2] blog-generate.timer (8×/день) ──► generate-article.sh
        │
        ├─ выбирает КАТЕГОРИЮ дня (ротация по активным blog_categories)
        ├─ берёт КЛЮЧ из blog_keywords:
        │     1) category-hinted (status=pending, category_slug=<кат>, priority.asc, impressions.desc)
        │     2) fallback: глобальная очередь /api/cron/blog-keywords/next
        ├─ VPN-GUARD (is_valid_keyword): vpn|впн|vless|xray|amnezia|… → skip (rkn-blocked)
        ├─ SATURATION-GUARD: тема в 3+ заголовках за 7д → skip
        ├─ DEDUP-GUARD: похоже на существующий заголовок категории → skip
        ├─ cluster-builder.sh: строит/реюзит КЛАСТЕР (10-15 related из Wordstat + LLM-фильтр)
        ├─ Claude CLI генерит статью (с 10 SEO/GEO правилами в промпте)
        ▼
[3] API сохраняет как DRAFT (auto_publish=false) ──► blog_posts (status=draft)
        │
        ▼
[4] seo-audit-pre.sh (GATE): аудит preview-URL, порог 80, max FAIL=0
        │
        ├─ PASS ──► PATCH status=published ──► пинг IndexNow + Yandex recrawl
        │              │
        │              ▼
        │         [5] seo-audit-post.sh (информативный, алертит если score < порога)
        │
        └─ FAIL ──► остаётся draft, notify_failure в Telegram
```

Новости идут отдельным путём (`generate-hype-article.sh`, см. §6).

---

## 3. Сбор семантики (`collect-keywords.sh` + `wordstat.sh`)

**Таймер:** `blog-keywords.timer` — ежедневно `03:00 UTC` (06:00 МСК).

**Что делает:**

1. Тянет до 500 фраз-кандидатов из Yandex Wordstat через **xmlriver**
   (`wordstat.sh` — клиент xmlriver API, креды `XMLRIVER_USER` /
   `XMLRIVER_API_KEY`).
2. Дедуп против существующих `blog_keywords` (по точному совпадению).
3. Новые вставляет в `blog_keywords` со `status='pending'`, `source='yandex_api'`,
   `priority` (high/medium/low по частотности), `impressions` (Wordstat-объём),
   `category_slug` (если удаётся определить).
4. Лог: `Done: added=N, skipped=M, from_api=500`.

**Норма:** `added=1-3/день` — это **здоровое** состояние. Очередь насыщена
(\~1455 pending), большинство кандидатов — дубли (`skipped=497-499`). Низкий
`added` ≠ поломка.

**Когда бить тревогу:** `from_api=0` (xmlriver упал / кончились лимиты),
или скрипт падает с ошибкой → проверь `XMLRIVER_*` креды и баланс xmlriver.

### 3.1 ⚠️ AI-pivot контент-стратегия (2026-06-13)

**Важно про источник ключей.** Авто-сбор (`POST /api/cron/blog-keywords` в
**webgpt-admin**, домен `ask.gptweb.ru/admin`) тянет не абстрактный Wordstat,
а **популярные запросы из Yandex Webmaster — те, по которым сайт УЖЕ
ранжируется**. Это самоусиливающаяся петля: блог исторически был VPN-сайтом →
Webmaster отдавал VPN-запросы → писались новые VPN-статьи. Когда РКН + Яндекс
выпилили VPN (трафик упал с \~6000 до \~250 визитов/день за 18 дней), эта петля
осталась без топлива.

**Что сделано:**

1. **Фильтр на ingestion** (`webgpt-admin/lib/keyword-junk.ts::isJunkKeyword`,
   зеркало `lib/vpn-guard.sh`) режет VPN/обход/adult/nav/раскладочный-мусор +
   порог частотности (TOTAL_SHOWS ≥ 30) — Webmaster-петля больше не сеет junk.
2. **Очередь зачищена** (`supabase-migrations/2026-06-13_purge_junk_keywords.sql`):
   1424 → 25 ключей.
3. **Бутстрап чистых ИИ-тем** — `scripts/blog/seed-ai-keywords.sh` расширяет
   `ai-seed-topics.txt` через Wordstat и заливает ВЧ-ИИ-ключи (нейросети,
   ChatGPT/Claude/Gemini без «обхода», промпты, ИИ-для-задач) как
   `priority=high` import'ом. Перезапускаемо. **Темы добавлять сюда.**

**Стратегия:** трафик отстраивается заново на разрешённых ИИ-темах (→ лиды на
gptweb.ru). VPN не вернётся. Дизайн:
`docs/superpowers/specs/2026-06-13-blog-ai-pivot-design.md`.

---

## 4. Кластеризация (`cluster-builder.sh`)

Вызывается **из** `generate-article.sh` (не по таймеру). Получает seed-ключ

- категорию, возвращает `cluster_id` (целое число в stdout).

**Алгоритм:**

1. Идемпотентность: если для seed уже есть `blog_clusters.status='pending'` —
   реюзит его.
2. Тянет related-фразы из Wordstat вокруг seed.
3. **LLM-фильтр** (Claude): отбирает 10-15 фраз, образующих _один связный
   topic-кластер_ — то, что можно покрыть одной статьёй. Исключает:
   нерелевантное, брендовые конкуренты, дубли по смыслу.
4. Считает `total_impressions` = сумма частот выбранных фраз (Wordstat-объём,
   НЕ реальный трафик!), `avg_competition` (SERP-конкуренция, sample).
5. Вставляет строку в `ai_aggregator.blog_clusters`.

⚠️ **Ключевой нюанс:** `blog_clusters.total_impressions` — это **потенциал
по Wordstat**, а НЕ трафик, который реально пришёл к нам. Топ-кластеры по
этому полю — все VPN (39M «впн», 35M «vpn»), но это потенциал, не факт.
Реальный трафик считается через `blog_positions` (см. §9). Не путать эти
две метрики при любых traffic-based решениях.

---

## 5. Генерация статьи (`generate-article.sh`) — сердце системы

**Таймер:** `blog-generate.timer` — `05,07,09,11,13,15,17,19:00 UTC`
(08,10,…,22 МСК) = **8 слотов/день**, с jitter до 45 мин.

**Пошагово (что важно знать):**

### 5.1 Выбор категории дня

Тянет активные категории (`blog_categories?is_active=eq.true`, по
`sort_order`). Ротация — одна категория на слот. Категории сейчас:
`prompts, reviews, cases, guides, business, education, news`.

### 5.2 Выбор ключа (`MAX_KEYWORD_ATTEMPTS=5` попыток)

- **Сначала** category-hinted: `blog_keywords?status=eq.pending&category_slug=eq.<кат>&order=priority.asc,impressions.desc&limit=1`.
- **Fallback** глобальная очередь: `GET /api/cron/blog-keywords/next`.
- Если ключей нет совсем → триггерит сбор (`POST /api/cron/blog-keywords`) и выходит.

### 5.3 Три guard'а (каждый — `continue` на следующий ключ)

1. **`is_valid_keyword()` → VPN-GUARD (RKN).** Lower-case match по regex
   `vpn|впн|vless|v2ray|xray|amnezia|amneziawg|shadowsocks|wireguard|hiddify|outline|прокси|proxy|обход блок|разблок|dpi|byebyedpi`.
   Совпало → exit code **2** → `mark_keyword_skipped reason="rkn-blocked: vpn topic"`.
   Также отсекает мусор (JSON-payload, error-строки, >160 символов).
2. **SATURATION-GUARD** (`SATURATION_THRESHOLD=3`). Если topic-root ключа
   встречается в 3+ заголовках за последние 7 дней (по всем категориям) —
   тема перегрета, skip.
3. **DEDUP-GUARD.** Похоже на существующий заголовок в этой категории
   (LLM/строковая близость) — skip.

### 5.4 Построение кластера

Прошедший guard'ы ключ → `cluster-builder.sh` строит/реюзит кластер →
related-фразы идут в промпт как контекст для покрытия смежных запросов.

### 5.5 Генерация Claude CLI

Промпт содержит **обязательные SEO/GEO-правила** (аудируются после
публикации). Ключевые из них:

- Заголовок H1 с ключом, мета-title ≤60 симв, meta_description 150-160.
- **FAQ-секция в конце:** последний H2 = «Часто задаваемые вопросы», 3-5
  H3-вопросов с ответами 2-4 предложения → авто-оборачивается в FAQPage
  JSON-LD издательским пайплайном.
- 3-5 внешних ссылок на авторитетные источники с описательным анкором
  (НЕ «тут»/«здесь»/«подробнее»).
- Региональная привязка (RU/СНГ), внутренняя перелинковка.
- `CLAUDE_USE_API` НЕ ставится — используется CLI (бесплатно), не платный API.

### 5.6 Сохранение → аудит → публикация

1. Сохраняет **draft** через API (`auto_publish=false`) → получает `post_id`,
   `slug`.
2. Запускает **`seo-audit-pre.sh`** на preview-URL
   (`/blog/preview/<id>?token=<BLOG_PREVIEW_TOKEN>`).
3. Gate: `score >= SEO_PREPUBLISH_THRESHOLD (80)` И `FAIL_COUNT <= 0`.
   - **PASS** → PATCH `status=published`, пинг индексации.
   - **FAIL** → остаётся `draft`, Telegram-алерт.

**Окно работы:** через `SEO_AUTOMATION=1` включается гейт «23:00–05:00 МСК
off-hours» для некоторых скриптов (новости), но `blog-generate` идёт по
своим 8 слотам днём.

---

## 6. Новости (`generate-hype-article.sh` + `agent-news-007`)

**Таймер:** `blog-hype.timer` — `06:30 UTC` и `16:30 UTC` (09:30 / 19:30 МСК),
**1 статья/день** (идемпотентно — не более 1-2 hype-постов в UTC-сутки).

**Как работает:**

1. Запрашивает горячую AI-новость у `agent-news-007`:
   `POST /api/v1/get-news-for-project` с телом
   `{"project_id":"gptweb","limit":15,"min_score":<70 строгий → 60 relaxed>,"min_hype":0,"exclude_delivered":true}`.
2. Сервис скорит события против **профиля проекта** (embedding + категории),
   возвращает релевантные с `relevance_score`.
3. Берёт топ-событие → Claude CLI пишет новостную статью (RU, со ссылками на
   источники) → сохраняет draft → тот же SEO-gate → публикация.

### 6.1 КРИТИЧНО: профиль проекта в agent-news-007

- Профиль живёт в схеме **`agent_news_007.project_profiles`**, `project_id='gptweb'`.
- **TTL = 40 дней.** Поле `profile_filled_at`. Истёк → сервис отвечает
  `status='profile_expired'` и новости **перестают писаться** (молча, с
  ошибкой в логе `# profile-required`).
- **Как продлить (быстро, без LLM):**
  ```sql
  UPDATE agent_news_007.project_profiles
  SET profile_filled_at = now()
  WHERE project_id='gptweb';
  -- опц. сбросить кеш релевантности для пере-скоринга:
  DELETE FROM agent_news_007.project_event_relevance WHERE project_id='gptweb';
  ```
  `schema_version` должен совпадать с константой `SCHEMA_VERSION` в
  `agent-news-007/apps/service/lib/profile-questions.ts` (сейчас `1`). Если
  не совпадает — нужна полная перерегистрация через
  `POST /api/v1/register-project-profile`.
- **RKN в новостях:** в `topics_excluded` профиля добавлены «VPN, прокси,
  обход блокировок, DPI, Amnezia, VLESS, Xray, WireGuard, Shadowsocks». Это
  чтобы новости про обход цензуры не подтягивались. НЕ удалять.

### 6.2 Нюанс hype_score

Скрипт шлёт `min_hype=0`, поэтому абсолютная величина `hype_score` событий
(сейчас потолок \~15) не блокирует пайплайн. Фильтрация идёт по
`relevance_score` (min_score 70→60). Если меняешь скрипт — не ставь
`min_hype>0`, иначе текущая шкала отсечёт всё.

---

## 7. Трекинг трафика (`track-positions.sh`) → очередь реоптимизации

**Таймер:** `blog-positions.timer` — `01:00 UTC` (04:00 МСК), ежедневно.

**Что делает:**

1. Тянет per-URL метрики из **Yandex Webmaster** (показы/клики/позиции) и
   **Yandex Metrika** (визиты).
2. Пишет дневной снапшот в `ai_aggregator.blog_positions`
   (`post_id, snapshot_date, impressions, clicks, ctr, avg_position, top_query`).
3. Сравнивает трафик каждого поста с **23-дневным baseline**. Падение **≥50%**
   → вставляет строку в `ai_aggregator.reoptimize_queue` (`status='pending'`,
   `flagged_at`), если там ещё нет pending-строки для этого поста.
4. Алерт о всех drop'ах → **Telegram** (`notify_failure "track-positions" …`).

---

## 8. Реоптимизация (`reoptimize-article.sh`) — спасение просевших

**Таймер:** `blog-reoptimize.timer` — **каждые 15 минут** (`*:0/15`).

**Что делает:**

- Берёт oldest `reoptimize_queue?status=eq.pending&order=flagged_at.asc&limit=1`.
- Если очередь пуста → `{"status":"idle"}` и выход (это норма большую часть
  времени).
- Иначе: Claude CLI **переписывает title + meta_description + первый абзац**
  поста, используя **текущие топ-запросы сайта** (по показам) как контекст.
- Помечает строку очереди `done`.

⚠️ **Известный режим поломки:** если процесс умирает посреди обработки —
строка зависает в `status='in_progress'` навсегда (очередь берёт только
`pending`, in_progress блокирует ничего, но и не дорабатывается). Лечение:

```sql
UPDATE ai_aggregator.reoptimize_queue SET status='pending'
WHERE status='in_progress' AND flagged_at < now() - interval '1 day';
```

**Важно:** реоптимизация — механика **«спасение падающих»**. Парная ей
механика **«усиление выигрышных»** — это cluster-expansion loop (ниже §8.1).

### 8.1 Cluster-expansion loop — усиление выигрышных кластеров

Кластеры, которые дают **реальный трафик**, автоматически получают новые
статьи под свои непокрытые `related_keywords`. Это exploitation-петля в пару
к реоптимизации (rescue-петля).

**Producer** — в `track-positions.sh` (таймер `blog-positions.timer`, 04:00
МСК, после снятия позиций):

1. Считает per-cluster **blended score** = `SUM(clicks)×5 + SUM(impressions)`
   за 7 дней (join `blog_posts.cluster_id` → `blog_positions`, только
   `published`). ⚠️ Это **реальный** трафик из `blog_positions`, НЕ Wordstat
   `total_impressions` (по которому топ — сплошь VPN).
2. Исключает VPN-кластеры расширенным regex `VPN_RE` — он шире, чем guard
   генератора: ловит и бренды без токена «впн» (`дядя ваня`, `амнезия`,
   `хапп`, `щука`, `radmin`, `windscribe`…). Переусиление здесь безопасно —
   просто меньше seed'ов, не блокирует легитимный контент. См. §10.
3. Берёт `top-N` (default 5) кластеров с `blended ≥ MIN_SCORE` (default 5).
4. Для каждого сеет до `KW_PER_CLUSTER` (default 2) **непокрытых**
   `related_keywords` как `blog_keywords` строки: `source='cluster_expansion'`,
   `priority='high'`, `status='pending'`, `category_slug` и `cluster_id` от
   кластера, `impressions=blended` (чтобы сортировка выносила горячие наверх).
   Idempotent: уже засеянные/покрытые ключи пропускаются; остывшие кластеры
   выпадают из top-N и перестают сеять (естественный спад).
5. Telegram-сводка `✅ cluster-expansion: Засеяно N ключей из M кластеров`
   (молчит при N=0, чтобы не шуметь). Hard psql ERROR → `notify_failure`.

**Consumer** — slot-parity ветка в `generate-article.sh` (8 слотов/день
08–22 МСК):

- **Чётность часа** (`scripts/blog/lib/slot-parity.sh::is_expansion_slot`)
  делит слоты строго **4/4**: expansion на **08/12/16/20**, normal на
  **10/14/18/22**. Это и есть потолок \~50%.
- **Expansion-слот:** берёт pending `source='cluster_expansion'`
  (`priority.asc, impressions.desc`) → его `category_slug` **перебивает**
  категорию дня, `cluster_id` переиспользуется (cluster-builder не
  перестраивает кластер). Все guard'ы (vpn/насыщение/дедуп) работают как
  обычно. Если pending-expansion нет → **проваливается в normal** (слот не
  теряется).
- **Normal-слот:** прежнее поведение + во все запросы ключей добавлен
  `source=neq.cluster_expansion` — чтобы normal не съедал high-priority
  expansion-ключи и не ломал 50%-потолок.

**Kill-switch:** `CLUSTER_EXPANSION_ENABLED=0` → всегда normal (см. флаги
§12). Дизайн: `docs/superpowers/specs/2026-06-10-cluster-expansion-loop-design.md`.

> Пока реальный трафик мал (топ-кластер \~17 кликов/7д), петля почти всегда
> «спит» — это by design: floor `MIN_SCORE=5` пропускает 0–1 кластер. По мере
> роста трафика она оживает сама.

---

## 9. Схема данных (схема `ai_aggregator`)

| Таблица                           | Назначение              | Ключевые поля                                                                                                                              |
| --------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `blog_posts`                      | Статьи                  | `slug, title, content, category_id, status(draft/published/archived), cluster_id, published_at, index_status(jsonb), canonical_url`        |
| `blog_categories`                 | Категории               | `slug, name, is_active, sort_order`                                                                                                        |
| `blog_keywords`                   | Семантика-очередь       | `keyword, status(pending/used/skipped), priority, impressions(Wordstat), category_slug, cluster_id, used_in_post_id`                       |
| `blog_clusters`                   | Тематические кластеры   | `primary_keyword, related_keywords[], category_slug, status(pending/used), total_impressions(Wordstat!), avg_competition, used_in_post_id` |
| `blog_positions`                  | Дневной трафик per-post | `post_id, snapshot_date, impressions, clicks, ctr, avg_position, top_query`                                                                |
| `reoptimize_queue`                | Очередь спасения        | `post_id, status(pending/in_progress/done), flagged_at`                                                                                    |
| `agent_news_007.project_profiles` | Профиль новостей        | `project_id, topics_interested[], topics_excluded[], profile_filled_at, ttl_days(40), schema_version`                                      |

**Реальный трафик кластера** (этим запросом cluster-expansion §8.1 выбирает
выигрышные кластеры):

```sql
SELECT bc.id, bc.primary_keyword,
       SUM(pos.clicks)*5 + SUM(pos.impressions) AS blended_score
FROM ai_aggregator.blog_clusters bc
JOIN ai_aggregator.blog_posts bp ON bp.cluster_id = bc.id AND bp.status='published'
LEFT JOIN ai_aggregator.blog_positions pos
       ON pos.post_id = bp.id AND pos.snapshot_date > now() - interval '7 days'
GROUP BY bc.id, bc.primary_keyword
ORDER BY blended_score DESC NULLS LAST;
```

---

## 10. 🚫 RKN / VPN policy (НЕ НАРУШАТЬ)

Роскомнадзор потребовал убрать VPN-контент. Нарушение = риск блокировки
всего домена `gptweb.ru`. Действующие меры:

1. **Единый hard-guard** — `scripts/blog/lib/vpn-guard.sh` (ОДИН источник
   правды): экспортирует `VPN_RE` + `is_vpn_keyword()`. Его **сорсят оба**:
   генератор (`generate-article.sh::is_valid_keyword` → exit 2 → skip с reason
   `rkn-blocked`) и producer cluster-expansion (`track-positions.sh`,
   интерполирует `VPN_RE` в SQL `~*`). Regex ловит и VPN-бренды без токена
   «впн» (`дядя ваня`, `щука`/`shuka`, `хапп`/`happ`, `amnezia`, `radmin`,
   `windscribe`, `hiddify`, `zoog`, `bebra`, `browsec`, `hotspot shield`…).
   **С 2026-06-13 guard режет ещё и** circumvention/adult/nav (`обход`,
   `без цензур`, `снятие ограничений`, `секс/взрослого`, `wegpt`/`gpt web`) и
   **раскладочный мусор** (all-latin без гласных и без ИИ-токена — `dgy yf gr`
   \= «впн на пк»). Зеркало в TS: `webgpt-admin/lib/keyword-junk.ts` (держать в
   синхроне). Тест: `scripts/blog/tests/test-keyword-guard.sh` + фикстуры.
   ⚠️ **Новый VPN-бренд блокировать ТОЛЬКО в `lib/vpn-guard.sh`** — не дублируй
   regex по скриптам. Дублирование и было причиной инцидента 2026-06-10:
   producer-копию усилили брендами, а генератор-копию забыли → бренд-ключи
   («дядя ваня личный кабинет», без токена «впн») проходили guard генератора
   и 100+ VPN-статей автопубликовались. Over-block безопасен (ключ просто
   скипается); false-negative = RKN-риск, поэтому при сомнении — добавляй.
2. **Карантин ключей:** все VPN-ключи в `blog_keywords` переведены
   `pending→skipped`. Сбор может занести новые → guard их отсекает на
   генерации.
3. **Исключения в новостном профиле** (`topics_excluded`).
4. **Архивация + 404:** опубликованные VPN-статьи переведены
   `status='archived'` (фронт отдаёт 404, `getPostBySlug` фильтрует по
   `published`), URL отправлены на Yandex recrawl/removal. **С 2026-06-13**
   архивные VPN-слаги отдают **чистый 404 без 301-редиректа** (в
   `webgpt-landing/app/blog/[category]/[slug]/page.tsx` редирект пропускается
   для vpn/впн/прокси/обход-слагов — чтобы Яндекс деиндексировал, а не
   передавал релевантность на живую страницу).
5. **Нет VPN-промо на живом фронте** (с 2026-06-13): из blog-страниц убраны
   блок «Бесплатный VPN → t.me/freeipru_bot», словарь `VPN_RECOVERY_NOTES`
   (Огонь/Super/Щука/Express ВПН) и `VPN_CLUSTER_LINKS`. Блог нигде не
   рекламирует VPN.

**Как заархивировать VPN-статью + убрать из поиска:**

```sql
UPDATE ai_aggregator.blog_posts
SET status='archived',
    index_status = jsonb_build_object('reason','roskomnadzor_takedown','archived_at',now()::text),
    updated_at=now()
WHERE slug = '<slug>';
```

Затем Yandex recrawl:

```bash
curl -X POST "https://api.webmaster.yandex.net/v4/user/${YANDEX_WEBMASTER_USER_ID}/hosts/${YANDEX_WEBMASTER_HOST_ID}/recrawl/queue" \
  -H "Authorization: OAuth ${YANDEX_WEBMASTER_TOKEN}" -H "Content-Type: application/json" \
  -d '{"url":"https://gptweb.ru/blog/<category>/<slug>"}'
```

---

## 11. Уведомления (`notify.sh`)

Все скрипты используют общий `notify.sh`. **Канал — Telegram** (мигрировано
с Brevo email 2026-05-31, потому что email жрал квоту Brevo 300/день).

- `notify_failure "<script>" "<msg>"` → `❌ [Blog FAIL]` в TG.
- `notify_success "<script>" "<details>"` → `✅ [Blog OK]` в TG.
- Env: `NOTIFY_TG_BOT_TOKEN` (бот `@gptwebrubot`), `NOTIFY_TG_CHAT_ID`
  (`249389410` — DM владельца).
- **Никаких `notify_email`** — функция удалена. Если видишь вызов
  `notify_email` в каком-то скрипте — это баг (был такой в track-positions и
  check-api-delta, исправлен 2026-06-01), переведи на `notify_failure`.

⚠️ **Второй email-канал был в приложении, не в bash.** Проект `webgpt-admin`
(Next.js backend блога: роуты `app/api/cron/blog-{generate,publish,sync}`)
слал `[Blog] Auto-published…` письма через Brevo (`lib/email.ts::sendNotification`)
— миграция 2026-05-31 покрыла только bash-сторону и пропустила это.
Отключено 2026-06-10: `sendNotification` сделан no-op. Блог-письма мертвы
полностью. Если письма по блогу снова появятся — проверь сначала
`webgpt-admin/lib/email.ts`, а не только bash `notify.sh`.

---

## 12. Env / секреты (`/home/deploy/.config/blog-autogen/env`)

| Ключ                                               | Назначение                                     |
| -------------------------------------------------- | ---------------------------------------------- |
| `CRON_SECRET`                                      | Bearer для `/api/cron/*` эндпоинтов приложения |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`       | Доступ к БД блога (REST)                       |
| `XMLRIVER_USER` / `XMLRIVER_API_KEY`               | Wordstat через xmlriver                        |
| `YANDEX_WEBMASTER_TOKEN` / `_USER_ID` / `_HOST_ID` | Webmaster API (трафик, recrawl)                |
| `BLOG_PREVIEW_TOKEN`                               | Доступ к preview-URL для pre-publish аудита    |
| `AGENT_NEWS_URL` / `AGENT_NEWS_API_KEY`            | Новостной агент                                |
| `NOTIFY_TG_BOT_TOKEN` / `NOTIFY_TG_CHAT_ID`        | Telegram-алерты                                |

**Cluster-expansion (§8.1) — необязательные оверрайды** (скрипты включены по
умолчанию, эти переменные нужны только чтобы изменить поведение):

| Ключ                               | Default | Назначение                                          |
| ---------------------------------- | ------- | --------------------------------------------------- |
| `CLUSTER_EXPANSION_ENABLED`        | `1`     | Kill-switch (producer + consumer); `0` → всё normal |
| `CLUSTER_EXPANSION_TOP_N`          | `5`     | Сколько кластеров расширять за прогон producer'а    |
| `CLUSTER_EXPANSION_MIN_SCORE`      | `5`     | Floor blended-score (мёртвые кластеры отсекаются)   |
| `CLUSTER_EXPANSION_KW_PER_CLUSTER` | `2`     | Ключей сеять на кластер за прогон                   |

Скрипты грузят env через `set -a; source /home/deploy/.config/blog-autogen/env; set +a`.

---

## 13. Runbook — типичные поломки и лечение

| Симптом                                                          | Причина                                                   | Лечение                                                                                 |
| ---------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Новости не пишутся, лог `# profile-required` / `profile_expired` | TTL профиля 40д истёк                                     | §6.1 — `UPDATE … profile_filled_at = now()`                                             |
| VPN-статья опубликовалась                                        | Guard обошли / ключ просочился                            | §10 — заархивировать + recrawl; проверить guard в `is_valid_keyword`                    |
| `blog-generate` падает «No pending keywords»                     | Очередь пуста                                             | Триггерни сбор: `POST /api/cron/blog-keywords`                                          |
| Статьи застревают в `draft`                                      | SEO-gate не пройден (score<80 или есть FAIL)              | Прочитай лог аудита; обычно слабая структура/FAQ/мета. Промпт в §5.5                    |
| `reoptimize_queue` строка в `in_progress` навсегда               | Процесс умер посреди                                      | §8 — `UPDATE … status='pending'`                                                        |
| `added=0, from_api=0` в keywords                                 | xmlriver лимит/падение                                    | Проверь `XMLRIVER_*` + баланс xmlriver                                                  |
| Нет алертов в TG                                                 | `NOTIFY_TG_*` не заданы / бот упал                        | Проверь env + `getMe` бота                                                              |
| Кадэнс публикаций провалился на N дней                           | Claude CLI auth истёк / сервер был офлайн                 | Проверь `claude` CLI auth; таймеры догонят сами                                         |
| Cluster-expansion (§8.1) не сеет ключи                           | Трафик ниже floor (`MIN_SCORE=5`) ИЛИ все related покрыты | Норма пока трафик мал; проверь `CLUSTER_EXPANSION_*` флаги + дай трафику вырасти        |
| Expansion засеял VPN-бренд-кластер                               | Бренд без токена «впн» проскочил `VPN_RE`                 | §10 — добавь бренд в `VPN_RE` в `track-positions.sh`; ключи `UPDATE … status='skipped'` |

**Где смотреть логи:**

```bash
journalctl -u blog-generate.service --since '1 day ago'
journalctl -u blog-hype.service --since '2 days ago'
tail -50 /home/deploy/.claude/logs/blog-*.log
systemctl list-timers --all | grep blog
```

---

## 14. Правила для ИИ-агентов (как расширять)

1. **Всегда читай этот файл первым** перед изменением блог-автоматики.
2. **Обновляй прозу этого файла** в том же изменении, что и код. LIVE STATE
   обновляется cron'ом, проза — нет.
3. **VPN-guard не снимать** без явного письменного указания владельца.
4. **Новый pipeline-скрипт** → добавь его в §1, §13, заведи timer, опиши шаг.
5. **Изменил порог/константу** (threshold, saturation, TTL, slots) → обнови
   соответствующий раздел.
6. **Не путай** `total_impressions` (Wordstat-потенциал) и `blog_positions`
   (реальный трафик). Traffic-based решения — только по `blog_positions`.
7. **Ходи в Supabase напрямую** через `docker exec supabase-db psql` —
   PostgREST не всегда видит `ai_aggregator` в кеше схемы.
8. **Деплой не нужен** для shell-скриптов — они запускаются с диска
   таймерами. Контейнерный деплой нужен только для фронта (`webgpt-landing`)
   и приложения (`lobehub`).

---

## 15. Запланированное (backlog)

- **Cluster-expansion loop** — ✅ **реализовано 2026-06-10, см. §8.1.**
  Producer в `track-positions.sh`, consumer slot-parity в
  `generate-article.sh`, флаги в §12, runbook в §13. Дизайн:
  `docs/superpowers/specs/2026-06-10-cluster-expansion-loop-design.md`.

_(backlog пуст — следующие идеи добавлять сюда)_

---

_История изменений этого документа — в git-логе файла. Каждое изменение
блог-системы обязано трогать и этот файл (§14.2)._
