# Router-first медиа: видео-пул llm-router (9router + flow-veo) перед WaveSpeed

**Дата:** 2026-09-22 (вечером переписано: первая версия ошибочно описывала контейнер OmniRoute — это тестовый стенд, не наш роутер) · **Статус:** дизайн, реализация не начата (по слову владельца) · **Автор:** Claude по задаче владельца от 2026-09-21

## 0. Задача владельца (дословно, сжато)

1. Видео: запрос сначала идёт в **наши видео-пулы в LLM-роутере** (Veo; Seedance «пока не надо»); если там нет — в WaveSpeed. Экономим деньги.
2. **Клиент ничего об этом не знает.**
3. Админка учитывает такие генерации как **нулевые затраты**.
4. Те же пулы дают **Nano Banana бесплатно** → пользователям, у которых **меньше 3 сгенерированных картинок** (0, 1 или 2), дефолтная модель картинок = Nano Banana из бесплатного пула. С третьей картинки дефолт возвращается на самую дешёвую модель, как сейчас.

## 1. Что есть на самом деле (проверено 2026-09-22; без живых генераций — правило репо роутера «credits are money»)

### 1.1 Роутер и видео-пул

- **Роутер** = `llm-router` (форк 9Router, `/home/deploy/projects/llm-router/.worktrees/9router-fork`), systemd `llm-router-v2.service`, порт **3300** (слушает `*:3300`, из контейнера `lobehub` доступен как `http://172.21.0.1:3300`), публично `https://llm-router.pashavin.ru` (Caddy → 3300, cutover 2026-06-13). Ключи API — `requireApiKey` в настройках + дашборд `/api/keys`. Им уже пользуются content-farm(-clipper/-avatar), agent-news, seo-builder, pashavin.ru. Агрегатор — пока нет.
- **Видео-пул** = сервис `services/flow-veo` (`flow-veo.service`, `127.0.0.1:8012`): гоняет **Google Flow (Veo 3.1 Fast)** по HTTP-протоколу Flow (`FLOW_HTTP=1`, reCAPTCHA через CapSolver) на **пуле аккаунтов Google One AI Pro** — генерация оплачена подпиской, per-call цены нет. Роутер проксирует: `POST /v1/videos/generations` → `flow-veo /generate`.
- **Контракт роутера** (`src/app/api/v1/videos/generations/route.js`, `[jobId]/route.js`; `docs/API.md`):
  - запрос: `{ model:"veo", prompt, image?, endImage?, aspect:"9:16"|"16:9", seconds:4|6|8|10, async:true }`. `image` — data:/URL/base64 (image→video), `endImage` — интерполяция первый+последний кадр. Модель `dola*`/`*seedance*` → Dola (Seedance) — **вне задачи**; `heygen*` — аватары, вне задачи.
  - **асинхронный режим есть:** `async:true` → `202 { job_id }`, затем `GET /v1/videos/generations/<job_id>` → `{ status: pending|running|done|error, data?:[{b64_json}], meta?, error? }`, опрос \~15 с, задача хранится \~30 мин после завершения. Синхронный режим держит соединение весь рендер — через прокси рвётся на \~300 с, **не использовать**.
  - ответ: `{ created, data:[{ b64_json:<mp4> }], meta }` (в `meta` — аккаунт, секунды, остаток кредитов).
  - ошибки (`flow-veo/src/server.js` `ERR_CODE`): **429** `quota_exhausted` (ни у одного аккаунта кредитов выше floor) / `monthly_backstop_exhausted`; **502** `geo_blocked`, `video_mode_unavailable`, bot-wall; **504** `timeout_no_result`; **503** — сервис в режиме «не тратить» (`FLOW_NO_SPEND`); 401 — ключ.
- **Что умеет пул** (`flowApi.js`): Veo 3.1 **Fast** text→video (`veo_3_1_t2v_fast[_portrait]`), image→video (`veo_3_1_i2v_s_fast_fl`), интерполяция по двум кадрам; только **landscape/portrait** (16:9 / 9:16; `1:1` в коде маппится, но у Flow-видео такого ключа нет — считать неподдерживаемым); длительности 4/6/8/10 с. Разрешение — дефолт Flow (ожидаемо 720p; **измерить в Ф0**; 1080p-апскейл Flow не делаем). Время: «Veo Fast \~1–3 мин» (комментарий в `flow.js`), таймаут одной генерации 420 с, минимум 60 с между сабмитами на аккаунт, один рендер на аккаунт, **параллельно по аккаунтам**.
- **Ёмкость** (health 2026-09-22 23:00): 10 аккаунтов, **7 живых** после починки владельцем 22.09 (`acc3,4,6,7,8,10,11`); `acc1` — личный владельца (`yourcashtg@gmail.com`, reserve, сейчас разлогинен); `acc9`, `acc2` — нужен ручной вход. Кредиты Flow: по \~1050 у живых (у `acc3` — 50). Цена (`flow-veo/KNOWLEDGE.md`): **20 кредитов за 5-сек image→video, 100 за text→video**. Итого ≈ **70 text→video или ≈ 350 image→video в месяц** на весь пул; месячный backstop `FLOW_VEO_MONTHLY_CAP=500`, `CREDIT_FLOOR=40`. Август: 24 ролика / 1 830 кредитов. Пул **общий с content-farm** — его расход надо вычесть.
- **Хрупкость, по журналу:** с 11.09 по 22.09 пул был мёртв целиком (Flow переехал на flow\.google.com, сессии протухли, 1 165 «DEAD» за 10 дней). Аккаунты — **купленные** (`purchased:true`, «владение» 0/6 шагов), прогрев каждые 2 ч, смерть аккаунта видна в панели. Это не API, это подписочная автоматизация Google — она будет ломаться и дальше, дизайн обязан это переживать (§3.6).
- Роутер **не логирует** видео-вызовы в свою `usageHistory` (0 строк с `video`) — единственный учёт будет наш `usage_logs`.

### 1.2 Картинки в роутере — Nano Banana там **нет**

- Единственная картиночная линия: комбо **`cf-image` = `cx/gpt-5.5-image`** (подписка ChatGPT Plus, Codex; **1 аккаунт, 100 запросов в неделю на всё вместе с чатом content-farm**) → fallback **`openrouter/openai/gpt-image-1` — платные кредиты OpenRouter роутера**. `ag/*-image` («antigravity does not support image generation»), `flow/imagen`, `gc/imagen-4`, `nanobanana` — без кредов/мертвы (`KNOWLEDGE.md` §Картинки, 06.09).
- **В `flow-veo` есть клиент картинок Flow** (`flowApi.js IMAGE_MODELS`: `GEM_PIX_2` = Gemini-картинки, тот самый класс Nano Banana; `IMAGEN_3_5`; `NARWHAL`; эндпоинт `flowMedia:batchGenerateImages`; `generate.js#generateImage`) — **но ни одного HTTP-маршрута к нему нет**: ни в `flow-veo/server.js` (`/generate` только видео), ни в роутере. Т.е. «нанобанана из видеопула» технически возможна на тех же аккаунтах, но это **новая фича в репо llm-router**, со своими правилами и измерением цены в кредитах Flow.
- Вывод: пункт 4 задачи (дефолт Nano Banana новичкам «бесплатно») сегодня выполнить **нечем**. Варианты — §3.4.

### 1.3 Агрегатор — как сейчас идёт генерация

**Картинки** (`src/server/routers/lambda/image/index.ts` → `src/server/routers/async/image.ts`):

1. `createImage` (lambda): `chargeBeforeGenerate` — `fetchRate(model)` по каталожному id, холд кредитов; `generation_batches` + `generations` + `async_tasks`; `asyncCaller.image.createImage` (внутренний tRPC `/trpc/async`, долгоживущий).
2. `async createImage`: если есть `WAVESPEED_API_KEY` → `submitWaveSpeedImage` (async, cron `poll-active-image-jobs`); иначе **синхронный путь** `modelRuntime.createImage` → `response.imageUrl` (URL **или `data:` URI**) → `transformImageForGeneration` → `uploadImageForGeneration` → asset/file → `chargeAfterGenerate`.
3. `chargeAfterGenerate` → `writeUsageLog(kind:'image', …)`; `computeUsageLogRow` считает `provider_cost_rub` **из `model_rates.per_unit`**, не из факта; переопределение `providerCostUsd` есть только для чата.
4. Дефолт модели — клиентский: `DEFAULT_AI_IMAGE_MODEL = 'wavespeed-ai/flux-schnell'` (`store/image/slices/generationConfig/initialState.ts`), перекрывается `lastSelectedImageModel/Provider` (`action.ts:335–371`).

**Видео** (`src/server/routers/lambda/video/index.ts`):

1. `createVideo`: `normalizeVideoParams` → `chargeBeforeGenerate` (план-гейт; **Free видео недоступно** с 2026-09-10) → batch/generation/asyncTask с `webhookToken` → `modelRuntime.createVideo({callbackUrl})` (WaveSpeed) → Processing.
2. Результат — вебхук `api/webhooks/video/[provider]`: atomic claim → `processVideoForGeneration(videoUrl)` → asset → `chargeAfterGenerate` по фактическим секундам. Страховка: кроны `poll-stuck-video-jobs`, `timeout-stuck-video-jobs`.
3. `getVideoFreeQuota.ts` — заглушка (`return null`).

**Каталог**: клиент видит провайдера `lobehub`; карточки из `wavespeed.ts` (`lobehub/image.ts`, `lobehub/video.ts`); скрытые `edit`/`image-to-video` подключаются через `pairedEndpoint.ts`. Наши Veo-карточки: `google/veo3.1-fast/text-to-video` (+ скрытая `image-to-video`), `google/veo3.1/…` (quality), `google/veo3.1-lite/…`; параметры пикера: 4/6/8 с, 16:9/9:16, 720p/1080p (1080p только при 8 с — `normalizeVideoParams`).

### 1.4 Админка — как считает себестоимость

- Всё через `usage_logs.provider_cost_rub` (`economics/_lib/queries.ts`, `finance/api-costs/route.ts`, `_lib/alerts.ts`). Валовая маржа = revenue − Σ`provider_cost_rub` → **строка с `provider_cost_rub = 0` автоматически даёт «по нулям»**.
- `lib/provider-mapping.ts#mapUsageProvider(provider, model)`: корзины `anthropic | openai | wavespeed | huggingface | openrouter`(default). Неизвестный провайдер **упадёт в `openrouter`** и испортит сверку с инвойсом → нужна корзина `router`.

### 1.5 Цифры (prod, 2026-09-22)

|                                                            |                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------- |
| Пользователей с 0 успешных картинок / 1 / 2 / ≥3           | 3 006 / 23 / 11 / 4                                           |
| Картинок за 30 дней / себестоимость                        | 30 шт. / 208,80 ₽                                             |
| Видео за 30 дней / себестоимость                           | 2 шт. / 54,00 ₽                                               |
| `model_rates`: veo3.1-fast t2v / i2v (WaveSpeed, $ за сек) | **1.2** / 0.12 — t2v выглядит опечаткой ×10, проверить        |
| `model_rates`: veo3.1 (quality) t2v / lite t2v             | 0.4 / 0.3                                                     |
| Ёмкость пула Veo в месяц (7 акк.)                          | ≈ 70 text→video **или** ≈ 350 image→video, минус content-farm |

**Честный вывод по деньгам:** прямая экономия при текущем объёме — десятки рублей в месяц. Смысл — в другом: пул позволяет **давать видео дешевле/шире** (Free/Базовый), не платя WaveSpeed, и держать маржу 100 % на Veo Fast. Но ёмкость ≈ 70 text→video в месяц — это **не «безлимит»**, а ограниченный ресурс, разделённый с content-farm; правило распределения — §3.3.

## 2. Принципы

1. **Каталог, цены и UI не меняются.** Пользователь выбирает те же карточки, платит те же кредиты. Роутер — деталь исполнения на сервере.
2. **Роутер — «попытка», WaveSpeed — «гарантия».** Любой не-успех роутера (429/502/503/504/дедлайн/битый артефакт/неподдерживаемые параметры) → прозрачный переход на текущий путь. Пользователь видит либо результат, либо обычную ошибку WaveSpeed.
3. **Никогда не отдавать хуже, чем просили.** Пул даёт только Veo 3.1 **Fast**, 16:9/9:16, 4–10 с, дефолтное разрешение Flow. Запросы на «Veo 3.1» (quality), 1080p, референсы Seedance и т.п. — сразу WaveSpeed. «Lite» → Fast допустимо (лучше, чем просили).
4. **Холд = потолок.** Списание за роутерный результат никогда не превышает предоплату (`prechargeResult`), даже если пул вернул ролик длиннее.
5. **Себестоимость = факт.** `usage_logs`: `provider='llm-router'`, `provider_cost_rub=0`, `model` = каталожный id.
6. **Один рубильник + предохранитель.** `ROUTER_FIRST_MEDIA=video` (env) + circuit breaker на Redis; отключение источника не требует деплоя.
7. **Ёмкость пула — бюджет, а не бесконечность.** Дневной бюджет роутерных видео (`ROUTER_FIRST_VIDEO_DAILY_BUDGET`) и приоритет платных тарифов; при исчерпании бюджета — WaveSpeed как сегодня.

## 3. Дизайн

### 3.1 Конфигурация (env `/opt/lobechat/.env`)

```
LLM_ROUTER_URL=http://172.21.0.1:3300        # host-gateway из контейнера lobehub; 3300 слушает на *:3300
LLM_ROUTER_API_KEY=sk-…                      # отдельный ключ «webgpt» из дашборда роутера (/api/keys); НЕ ключ content-farm
ROUTER_FIRST_MEDIA=video                     # csv: video | image | пусто = выкл
ROUTER_FIRST_VIDEO_DEADLINE_MS=540000        # 9 мин: 420 с рендер + очередь + скачивание
ROUTER_FIRST_VIDEO_DAILY_BUDGET=3            # роликов в сутки через пул (≈ 70/мес t2v на весь пул, content-farm тоже там)
ROUTER_FIRST_VIDEO_PLANS=pro,pro_max,basic   # кому даём пул (Free видео недоступно и так)
ROUTER_FIRST_BREAKER_FAILS=3
ROUTER_FIRST_BREAKER_COOLDOWN_MS=900000      # 15 мин
```

Новый модуль `src/business/server/media-router/` (server-only):

- `config.ts` — env, `isRouterFirstEnabled(kind)`.
- `client.ts` — `submitRouterVideo({prompt, image?, aspect, seconds}) → {jobId}` (`async:true`), `pollRouterVideo(jobId) → {status, mp4Buffer?, meta?, error?}`; классификация исхода `ok | quota(429) | upstream(502/503) | timeout(504/дедлайн) | invalid(400)`.
- `breaker.ts` — Redis (`lobe-redis`): `router-first:video:fails`, `:paused_until`; `quota`/`upstream`/`timeout` → +1, `ok` → 0; `fails ≥ N` → пауза; 429 с `Retry-After` → пауза не короче него. Пока пауза — роутер не трогаем (нулевая задержка для юзера).
- `budget.ts` — Redis-счётчик `router-first:video:day:<YYYY-MM-DD>` (MSK), `ROUTER_FIRST_VIDEO_DAILY_BUDGET`; резервируется при сабмите, возвращается при fallback.
- `eligibility.ts` — чистая `videoRouteFor(model, params, planSlug)` → `{routerModel:'veo', aspect, seconds, image?} | null` по §3.3; юнит-тесты.
- `accounting.ts` — `routerUsage()` → `{provider:'llm-router', providerCostUsd:0}`.

### 3.2 Не трогаем

`chargeBeforeGenerate` (холд по каталожной модели), карточки и `pairedEndpoint`, бот (медиа не генерирует), тарифы и копии в UI.

### 3.3 Видео

**Eligibility** (`videoRouteFor`), все условия одновременно:

| условие               | значение                                                                                                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| каталожная модель     | `google/veo3.1-fast/text-to-video` или (через pairing) `google/veo3.1-fast/image-to-video`; `google/veo3.1-lite/*` — тоже (Fast ≥ Lite). `google/veo3.1/*` (quality), `bytedance/*`, всё остальное — нет |
| `resolution`          | `720p` (или не задано). `1080p` → нет                                                                                                                                                                    |
| `duration`            | 4, 6, 8 (10 в нашем пикере нет)                                                                                                                                                                          |
| `aspectRatio`         | `16:9` или `9:16`                                                                                                                                                                                        |
| референсы             | `imageUrl` (стартовый кадр) — да, идёт как `image`; `imageUrls`/`videoUrls`/`endImage` — нет (наш пикер их для Veo не даёт)                                                                              |
| план                  | ∈ `ROUTER_FIRST_VIDEO_PLANS`                                                                                                                                                                             |
| бюджет/предохранитель | `budget.tryReserve()` и `!breaker.paused()`                                                                                                                                                              |

**Поток** — врезка в `createVideo` lambda **после** транзакции (batch/generation/asyncTask созданы, холд взят), **вместо** немедленного `modelRuntime.createVideo`:

```
const route = videoRouteFor(model, generationParams, planSlug)
if (route && isRouterFirstEnabled('video') && !breaker.paused() && budget.tryReserve()) {
  asyncTask.metadata += { servedBy:'llm-router-attempt', routerStartedAt, routerDeadlineAt }
  asyncCaller.video.createViaRouter({ asyncTaskId, generationId, batchId, model, route, params, prechargeResult, webhookToken })
  return { data:{batch, generations:[generation]}, success:true }     // клиент поллит asyncTask как обычно
}
// ↓ без изменений: WaveSpeed + webhook
```

Новый async-роутер `src/server/routers/async/video.ts` (по образцу `async/image.ts`), процедура `createViaRouter`:

1. `submitRouterVideo(async:true)` → `jobId` → `asyncTask.metadata.routerJobId`, `inferenceId = 'llm-router:'+jobId`, статус Processing. Опрос каждые 15 с до `routerDeadlineAt` (9 мин) в том же процессе; страховка от рестарта контейнера — cron `poll-stuck-video-jobs` учится по `metadata.routerJobId` дёргать `pollRouterVideo` (задача роутера живёт 30 мин), а `timeout-stuck-video-jobs` уважает `routerDeadlineAt + 2 мин`.
2. **`done`** → `videoService.processVideoForGeneration` расширяется, чтобы принимать `Buffer` (сейчас только URL; внутри всё равно скачивание → обработка → S3), далее тот же код, что в вебхуке: asset, `generations.fileId`, `Success`, `chargeAfterGenerate({ served:{provider:'llm-router', providerCostUsd:0}, seconds:min(actual, requested) })`. Фактические секунды/разрешение из `meta` и ffprobe — в `metadata` для контроля профиля.
3. **`error` / 429 / 502 / 503 / 504 / дедлайн / битый mp4** → `breaker.record`, `budget.release`, `metadata.servedBy='wavespeed'`, `metadata.routerFallbackReason`, и **тот же** существующий код: `initModelRuntimeFromDB` → `modelRuntime.createVideo({callbackUrl})` → Processing → вебхук WaveSpeed. Холд не трогаем. Для юзера это «генерация идёт дольше обычного»; предельно — 9 мин + 2–4 мин WaveSpeed.
4. Приоритет тарифов и бюджет — §2.7: сначала Pro/Pro Max; Базовый — если бюджет дня не выбран к 18:00 MSK (простое правило, можно убрать).

**Что осознанно не делаем:** Seedance/Dola (владелец: «пока не надо»), HeyGen, 1080p, quality-Veo, интерполяция по двум кадрам, референсы — всё WaveSpeed.

### 3.4 Картинки — три варианта, решение за владельцем

Премисса «пул даёт Nano Banana бесплатно» сегодня не выполняется (§1.2). Варианты:

|       | что                                                                                                                                                                                                                                                                                                                                                 | стоимость нам                                                                                   | объём                                                   | работа                                                                                                         | риск                                                                      |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **A** | Довести **картинки Flow** до эндпоинта: `flow-veo /generate-image` (`generate.js#generateImage`, модель `gemini-image-*` = `GEM_PIX_2`) + роутер `POST /v1/images/generations` с `model:"flow/gemini-image"`; агрегатор: eligibility «nano-banana-2 t2i, 1 картинка, без референсов, 1:1/16:9/9:16» → роутер → `data:` URI в существующий sync-путь | 0 ₽ (кредиты Flow; **цену за картинку измерить** — она уменьшит видео-ёмкость тех же аккаунтов) | ограничен теми же \~7 000 кредитов/мес                  | 1–2 дня **в репо llm-router** (чужие правила: без живых генераций для отладки, фикстуры) + полдня в агрегаторе | те же купленные аккаунты, та же хрупкость; конкуренция с видео за кредиты |
| **B** | Использовать `cx/gpt-5.5-image` (ChatGPT Plus) **напрямую, не через комбо `cf-image`** — иначе fallback молча уйдёт на платный OpenRouter роутера, которого наш учёт не увидит                                                                                                                                                                      | 0 ₽                                                                                             | **100 запросов/нед на всё**, делим с чатом content-farm | полдня                                                                                                         | новички съедят квоту content-farm; качество GPT-image ≠ Nano Banana       |
| **C** | Ничего не менять в источнике: дефолт новичкам — `google/nano-banana-2/text-to-image` на WaveSpeed                                                                                                                                                                                                                                                   | 6,3 ₽/картинка; при сегодняшних 30 картинках/мес — ≈ 190 ₽/мес максимум                         | безлимит                                                | полдня (только дефолт)                                                                                         | нет                                                                       |

**Рекомендация:** дефолт новичка сделать сейчас как **C** (это то, что видит юзер, и стоит копейки), а **A** — отдельной задачей в llm-router после видео, когда будет измерена цена картинки в кредитах Flow. **B не рекомендую**: 100/нед на всех — это бомба под content-farm.

**Дефолт для новичков** (одинаково для A и C):

- Сервер: `spend.getCreditState` дополняется `imagesGenerated` = `count(generations WHERE user_id AND asset IS NOT NULL)` по картиночным батчам (`generations_user_id_idx`).
- Клиент `initializeImageConfig`: 1) `lastSelectedImageModel`, если юзер сам выбирал; 2) иначе `imagesGenerated < 3` → `google/nano-banana-2/text-to-image`; 3) иначе `DEFAULT_AI_IMAGE_MODEL` (flux-schnell). Дефолт новичка **не записывается** в `lastSelected…` — поэтому после 3-й картинки сам возвращается flux-schnell. `NEWBIE_IMAGE_THRESHOLD = 3` в `packages/const/src/settings/image.ts`.
- Цена новичку — та же, что всем (126 кредитов за Nano Banana 2); Free-план тянет \~19 таких из месячного пула 2 500. «Первые 3 по цене flux» — одна строка в `chargeBeforeGenerate`, но цена в UI разойдётся с реальной; не рекомендую.

### 3.5 Учёт

**Агрегатор**

- `writeUsageLog.ts`: `providerCostUsd` начинает действовать для `kind: 'image' | 'video'` (сейчас только чат): если передан → `provider_cost_rub = providerCostUsd × USD_TO_RUB`, иначе как раньше из `model_rates`. `cost_usd/cost_rub` (что заплатил юзер) — без изменений. `provider = 'llm-router'`.
- Оба `chargeAfterGenerate` получают опциональный `served?: {provider, providerCostUsd}` → `writeUsageLog`.
- `async_tasks.metadata.servedBy | routerJobId | routerFallbackReason | actualSeconds` — правда для поддержки.

**Админка (`webgpt-admin`)**

- `lib/provider-mapping.ts`: корзина `router` (`p === 'llm-router'`), подпись «Роутер (подписки)», **до** дефолта `openrouter`. На «API-расходах» booked = 0, инвойса нет — так и должно быть.
- Экономика: карточка «Сэкономлено через роутер, 30 дн.» = Σ по `provider='llm-router'` × цена WaveSpeed из `model_rates` (`per_unit × video_seconds` / `× images`).
- Алерт `_lib/alerts.ts`: «роутерное видео: доля успеха < 50 % за 24 ч или предохранитель в паузе > 6 ч» — пул умер, молча платим WaveSpeed. Плюс «бюджет дня выбран до 12:00» — пора расширять пул или снижать бюджет.
- Страница юзера → «Экономика»: строки `llm-router` подписывать «через роутер, 0 ₽».

### 3.6 Отказоустойчивость и деградация

| Сценарий                                                              | Поведение                                                                                                                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Роутер/flow-veo лежит (ECONNREFUSED, 503 no-spend)                    | outcome `upstream` → WaveSpeed; после N подряд — пауза 15 мин                                                                                           |
| Пул без кредитов (429 `quota_exhausted`/`monthly_backstop_exhausted`) | WaveSpeed сразу; пауза ≥ `Retry-After`; алерт                                                                                                           |
| Google выкинул сессии (как 11–22.09)                                  | серия 502/504 → пауза + алерт; продукт работает на WaveSpeed, маржа обычная                                                                             |
| Bot-wall / device-verify на аккаунте                                  | у роутера это 502 (не 429) → fallback; аккаунт лечит warmer/оператор пула, не мы                                                                        |
| Ролик не по профилю (другая длина/ratio)                              | принимаем, списываем по принципу 4, `metadata.profileMismatch` → алерт «профиль изменился»                                                              |
| Рестарт `lobehub` во время роутерной задачи                           | `poll-stuck-video-jobs` добирает по `routerJobId` (30 мин у роутера); после `routerDeadlineAt+2` мин — `timeout-stuck-video-jobs`: Error + refund холда |
| Бюджет дня исчерпан                                                   | `budget.tryReserve()=false` → WaveSpeed, без задержки                                                                                                   |
| `ROUTER_FIRST_MEDIA` пустой                                           | единственный `if` не исполняется, поведение = сегодняшнее                                                                                               |

### 3.7 Что видит клиент

Ничего нового: те же карточки, цены, счётчик, лента. Отличие только во времени: через пул Veo Fast 1–3 мин (+ очередь), при fallback — до \~12 мин суммарно. Копия «Генерация может занять несколько минут» уже есть.

## 4. Риски и вопросы владельцу

1. **Ёмкость.** ≈ 70 text→video в месяц на весь пул, и он общий с content-farm. Дневной бюджет 3 — стартовое число; расширение = новые аккаунты Google One AI Pro (задача пула, не агрегатора). Сколько роликов в месяц ты готов отдать WebGPT из пула?
2. **Купленные аккаунты.** Пул — покупные Google-аккаунты с несекьюренным владением (0/6). Бан/перехват = минус ёмкость; продукт не страдает (fallback), маржа возвращается к WaveSpeed. Личный `acc1` (`yourcashtg`) в резерве — предлагаю **исключить из ротации для WebGPT** (`personal:true` уже есть), чтобы клиентские генерации не шли с твоего аккаунта.
3. **Ставка `veo3.1-fast/text-to-video` = $1.2/с** в `model_rates` при i2v $0.12/с — похоже на опечатку ×10 (quality-Veo стоит $0.4). Если так, мы сейчас **переоцениваем** Veo Fast юзеру в 10 раз — проверить независимо от этой задачи.
4. **Nano Banana:** премисса не выполняется (§1.2). A/B/C — твоё решение; рекомендация C сейчас + A потом.
5. **Отдельный ключ и лимит на роутере.** Роутер умеет ограничивать модели по ключу («запрет по ключу вызывающего» в его KNOWLEDGE) — выпустить ключ `webgpt` с доступом только к `veo`, чтобы баг агрегатора не смог потратить Codex/OpenRouter-кредиты роутера.
6. **`FLOW_NO_SPEND` / правило «credits are money».** Все замеры Ф0 — на явно выделенных владельцем кредитах (например, 5 роликов = 500 кредитов t2v или 100 i2v). Без отмашки живых генераций не делаем.

## 5. План реализации (после отмашки)

**Ф0 — замеры (полдня, только по разрешению на 5 роликов).** `scripts/media-router/probe.ts`: 5 роликов (3 t2v 16:9 8 с, 2 i2v 9:16 4 с) через `async:true` → таблица: время до `done`, размер, длительность/разрешение (ffprobe), `meta.credits` до/после (реальная цена в кредитах), доля успеха. Результат — в §1.1 и в eligibility.

**Ф1 — видео (1–2 дня).** `media-router/{config,client,breaker,budget,eligibility,accounting}` + тесты; `async/video.ts#createViaRouter`; `processVideoForGeneration(Buffer)`; `writeUsageLog` `providerCostUsd` для image/video; `chargeAfterGenerate.served`; кроны учат `routerJobId`/`routerDeadlineAt`. Ключ `webgpt` на роутере (только `veo`). Env, `ROUTER_FIRST_MEDIA=video`, бюджет 3/день. Смоук под владельцем (bot-bridge deeplink): строка `usage_logs` с `provider='llm-router', provider_cost_rub=0`, ролик в ленте.

**Ф2 — админка (полдня).** Корзина `router`, карточка «Сэкономлено», два алерта, подпись в экономике юзера.

**Ф3 — дефолт новичка (полдня, вариант C).** `getCreditState.imagesGenerated`, `initializeImageConfig`, `NEWBIE_IMAGE_THRESHOLD`.

**Ф4 — картинки Flow (вариант A, отдельная задача в llm-router, 1–2 дня + полдня у нас).** Эндпоинт `flow-veo /generate-image` → роутер `/v1/images/generations` `model:"flow/gemini-image"` → eligibility картинок в агрегаторе (`ROUTER_FIRST_MEDIA=video,image`). Только после Ф0-замера цены картинки в кредитах.

**Ф5 — наблюдение (неделя).** Доля успеха, `profileMismatch`, расход бюджета; решение о расширении пула и о видео для Free/Базового.

## 6. Что НЕ входит

- Seedance/Dola и HeyGen через роутер (владелец: «пока не надо»; аватары — другой продукт).
- Чат через роутер (остаёмся на OpenRouter — другая задача).
- Изменения каталога, цен, тарифов, копий в UI; бот.
- Лечение самого пула (аккаунты, прогрев, онбординг) — это репо llm-router.
- OmniRoute (`127.0.0.1:20228`) — тестовый стенд, к задаче отношения не имеет; первая редакция этой спеки про него удалена.
