# Router-first медиа: бесплатные пулы OmniRoute перед WaveSpeed

**Дата:** 2026-09-22 · **Статус:** дизайн, реализация не начата (по слову владельца) · **Автор:** Claude по задаче владельца от 2026-09-21

## 0. Задача владельца (дословно, сжато)

1. Видео: запрос сначала идёт в **наши видео-пулы в LLM-роутере** (Veo, Seedance, …); если там нет — в WaveSpeed. Экономим деньги.
2. **Клиент ничего об этом не знает.**
3. Админка учитывает такие генерации как **нулевые затраты**.
4. Те же пулы дают **Nano Banana бесплатно** → пользователям, у которых **меньше 3 сгенерированных картинок** (0, 1 или 2), дефолтная модель картинок = Nano Banana из бесплатного пула. С третьей картинки дефолт возвращается на самую дешёвую модель, как сейчас.

## 1. Что есть на самом деле (проверено 2026-09-22)

### 1.1 Роутер

- «LLM-роутер» = **OmniRoute**, контейнер `omniroute` на Hetzner, `127.0.0.1:20228` (API + дашборд), `REQUIRE_API_KEY=false`, redis `omniroute-redis`. Помечен в `ACCESS.txt` как «тест рядом с боевым». Repo: `/home/deploy/projects/omniroute`.
- **Сегодня им никто из нашего стека не пользуется**: агрегатор ходит в OpenRouter (`OPENROUTER_API_KEY`), WaveSpeed и напрямую в Anthropic/OpenAI. Бот — только в агрегатор. Т.е. это будет **первый боевой потребитель** роутера.
- Контейнер `lobehub` не в одной docker-сети с `omniroute`; порт 20228 опубликован на `0.0.0.0`, так что агрегатор ходит через host-gateway, как уже ходит к боту (`http://172.21.0.1:8082`).
- Живые **бесплатные** медиа-модели в `/v1/models`:

| id в роутере                           | провайдер                                              | тип   | что это                                |
| -------------------------------------- | ------------------------------------------------------ | ----- | -------------------------------------- |
| `antigravity/gemini-3.1-flash-image`   | `antigravity` (Google OAuth, free tier)                | image | Nano Banana 2 (Gemini 3.1 Flash Image) |
| `veo-free/veo` (= `veoaifree-web/veo`) | `veoaifree-web` (без ключа, парсит сайт veoaifree.com) | video | Veo 3.1                                |
| `veo-free/seedance`                    | `veoaifree-web`                                        | video | Seedance                               |

- **Картинки** `POST /v1/images/generations` — синхронно. Смоук-тест 2026-09-22: `antigravity/gemini-3.1-flash-image`, prompt + `size:1024x1024` → **200 за 10.3 с**, тело `{created, data:[{b64_json:<JPEG ~600 КБ>, revised_prompt}]}`, заголовки `x-omniroute-response-cost: 0.0000000000`, `x-omniroute-provider: antigravity`, `x-omniroute-request-id`. В реестре у antigravity `supportedSizes: ["1024x1024"]`, edit-режим не заявлен.
- **Видео** `POST /v1/videos/generations` — **синхронно и долго**: хендлер `veoaifree-web` из тела берёт только `prompt` и `size`/`aspect_ratio` (превращает в system-строку `aspect_ratio: …`), **`duration`, `resolution`, `image` игнорирует**; исполнитель поллит сайт каждые 20 с, максимум 30 раз (**10 минут**), затем качает mp4 (лимит 100 МБ) и отдаёт `{created, data:[{b64_json:<mp4>, format:"mp4"}]}`. Смоук-тест `veo-free/seedance` — см. §1.4.
- Аккаунт за `antigravity` — **личный Google-аккаунт владельца** (`antigravity/yourcashtg`, OAuth-токен роутер обновляет сам, см. `app.log` `[HealthCheck] Refreshing antigravity/yourcashtg`). Бан по ToS = бан этого аккаунта, не абстрактного «пула».
- При исчерпании пула/ошибке апстрима роутер отвечает **`429` + `Retry-After`** (квота) или `502/504` (сбой/таймаут) — это и есть сигнал для fallback на WaveSpeed.
- **Правовой статус источников** (из `docs/reference/FREE_TIERS.md` самого OmniRoute): `veoaifree-web` — _caution_: ToS сайта запрещает ботов «на нечеловеческой скорости»; `antigravity` — ToS Google **прямо запрещает** ходить в бесплатный тир через прокси. Это риск не кода, а **внезапной смерти источника** (бан аккаунта / смена вёрстки сайта). Дизайн обязан переживать это без деградации продукта (§3.6).

### 1.2 Агрегатор — как сейчас идёт генерация

**Картинки** (`src/server/routers/lambda/image/index.ts` → `src/server/routers/async/image.ts`):

1. `createImage` (lambda): `chargeBeforeGenerate` — `fetchRate(model)` по каталожному id (`google/nano-banana-2/text-to-image`, `wavespeed-ai/flux-schnell`, …), холд кредитов; создаёт `generation_batches` + `generations` + `async_tasks`; дергает `asyncCaller.image.createImage` (внутренний tRPC `/trpc/async`, долгоживущий).
2. `async createImage`: если есть `WAVESPEED_API_KEY` → `submitWaveSpeedImage` (async, cron `poll-active-image-jobs` дозабирает); иначе **синхронный путь** `modelRuntime.createImage` → `response.imageUrl` (URL **или `data:` URI** — уже поддерживается) → `transformImageForGeneration` → `uploadImageForGeneration` → asset/file → `chargeAfterGenerate`.
3. `chargeAfterGenerate` → `writeUsageLog(kind:'image', model, provider, images)`; `computeUsageLogRow` считает `provider_cost_rub` **из `model_rates.per_unit`**, а не из факта. Переопределение `providerCostUsd` есть **только для чата**.
4. Дефолт модели — клиентский: `DEFAULT_AI_IMAGE_MODEL = 'wavespeed-ai/flux-schnell'` (`src/store/image/slices/generationConfig/initialState.ts`), перекрывается `lastSelectedImageModel/Provider` из user settings (`action.ts:335–371`).

**Видео** (`src/server/routers/lambda/video/index.ts`):

1. `createVideo`: `normalizeVideoParams` → `chargeBeforeGenerate` (план-гейт `isModelAllowedForPlanAsync`; **Free видео не доступно** с 2026-09-10) → batch/generation/asyncTask с `webhookToken` → `modelRuntime.createVideo({callbackUrl})` (WaveSpeed) → статус Processing.
2. Результат приходит вебхуком `api/webhooks/video/[provider]` (atomic claim → `processVideoForGeneration(videoUrl)` → asset → `chargeAfterGenerate` по фактическим секундам). Страховка: кроны `poll-stuck-video-jobs`, `timeout-stuck-video-jobs`.
3. `getVideoFreeQuota.ts` — пустая заглушка (`return null`).

**Каталог**: клиент видит провайдера `lobehub`; карточки берутся из `wavespeed.ts` (`lobehub/image.ts`, `lobehub/video.ts` фильтруют `enabled`). Скрытые `edit`/`image-to-video` карточки подключаются автоматически через `pairedEndpoint.ts`.

### 1.3 Админка — как считает себестоимость

- Всё через `usage_logs.provider_cost_rub` (`economics/_lib/queries.ts`, `finance/api-costs/route.ts`, `_lib/alerts.ts`). Валовая маржа = revenue − Σ`provider_cost_rub`. Значит **строка с `provider_cost_rub = 0` автоматически даёт «по нулям»** — отдельной логики не нужно, нужно лишь правильно записать строку.
- `lib/provider-mapping.ts#mapUsageProvider(provider, model)` раскладывает строки по «корзинам» инвойсов: `anthropic | openai | wavespeed | huggingface | openrouter`(default). Неизвестный провайдер **упадёт в `openrouter`** и испортит сверку с инвойсом → нужна новая корзина.

### 1.4 Цифры (prod, 2026-09-22)

|                                         |                                                         |
| --------------------------------------- | ------------------------------------------------------- |
| Пользователей с 0 успешных картинок     | 3 006                                                   |
| с 1 / 2 / ≥3                            | 23 / 11 / 4                                             |
| Картинок за 30 дней / себестоимость     | 30 шт. / 208,80 ₽                                       |
| Видео за 30 дней / себестоимость        | 2 шт. / 54,00 ₽                                         |
| Себестоимость Nano Banana 2 (WaveSpeed) | $0.07 = 6,3 ₽ / картинка; юзер платит ×3 = 126 кредитов |
| Себестоимость flux-schnell              | $0.003 = 0,27 ₽; юзер платит ×5 = 9 кредитов            |
| Veo 3.1 Fast / Seedance 2.0 (WaveSpeed) | $1.2 / $0.24 за секунду                                 |

**Смоук-тест видео (2 пробы, 2026-09-22):** `veo-free/seedance` (prompt + `aspect_ratio:16:9`, старт 20:14 MSK) — **12 минут без единого байта ответа**, curl timeout; `veo-free/veo` (старт 20:30) — **15 минут, то же**. В журнале вызовов роутера (`data/call_logs`) за день только картинка; в `app.log` ни одной строки про видео; спустя 30 минут после старта у контейнера всё ещё **два открытых соединения** к Cloudflare-IP veoaifree.com — исполнитель молча поллит и не отдаёт даже 504 (его «10-минутный потолок» считает только циклы, каждый poll ещё до 30 с сети → реально до 25 мин). Сам сайт — «Free & Unlimited» wrapper над Veo (на его главной рядом «Free Claude Pro», «Free Grok 4») без заявленного времени генерации.

**Вывод по видео:** в текущем виде бесплатный видео-пул **не годится как первая попытка для живого пользователя**: WaveSpeed отдаёт Veo Fast за 2–4 мин, пул — неизвестно когда и, по двум пробам, не отдаёт вовсе. Профили §3.3 заполнить нечем → видео **не включаем** (fail-closed), пока не выполнится хотя бы одно из условий §5 Ф3.

**Честный вывод по деньгам:** при текущих объёмах прямая экономия — порядка **250–300 ₽/мес**. Ценность идеи не в экономии сегодня, а в двух вещах: (а) первое впечатление новичка — Nano Banana вместо flux-schnell при нулевой себестоимости, (б) возможность позже открыть видео шире (Free/дешёвые тарифы) не платя WaveSpeed. Поэтому порядок реализации — **картинки → админка**; видео после замеров 2026-09-22 отложено (§3.3, §5 Ф3).

## 2. Принципы

1. **Каталог, цены и UI не меняются.** Пользователь выбирает те же карточки (`google/nano-banana-2/text-to-image`, `google/veo3.1-fast/text-to-video`, …), платит те же кредиты. Роутер — деталь исполнения на сервере.
2. **Роутер — это «попытка», WaveSpeed — «гарантия».** Любой не-успех роутера (429, 5xx, таймаут, битый артефакт, неподдерживаемые параметры) → прозрачный переход на текущий путь. Пользователь видит либо результат, либо обычную ошибку WaveSpeed, никогда — ошибку роутера.
3. **Никогда не отдавать хуже, чем просили.** Бесплатный пул игнорирует `duration/resolution/image`. Значит роутер получает запрос **только если его известный выход совпадает с запросом** (профили §3.3). Иначе — сразу WaveSpeed.
4. **Холд = потолок.** Списание за роутерный результат никогда не превышает предоплату (`prechargeResult`), даже если пул вернул ролик длиннее.
5. **Себестоимость = факт.** Строка `usage_logs` для роутерного результата: `provider='omniroute'`, `provider_cost_rub=0`, `model` = каталожный id (чтобы аналитика по моделям не сломалась).
6. **Один рубильник.** `ROUTER_FIRST_MEDIA=image,video` (env) + автоматический предохранитель (circuit breaker) — отключение источника не требует деплоя.

## 3. Дизайн

### 3.1 Конфигурация (env `/opt/lobechat/.env`)

```
OMNIROUTE_URL=http://172.21.0.1:20228       # host-gateway, как BOT_URL
OMNIROUTE_API_KEY=                          # пусто, пока REQUIRE_API_KEY=false
ROUTER_FIRST_MEDIA=image                    # csv: image | video | пусто = выкл
ROUTER_FIRST_VIDEO_DEADLINE_MS=420000       # 7 мин, меньше 10-минутного потолка исполнителя
ROUTER_FIRST_BREAKER_FAILS=3                # подряд неуспехов → пауза источника
ROUTER_FIRST_BREAKER_COOLDOWN_MS=900000     # 15 мин
```

Новый модуль `src/business/server/media-router/` (server-only):

- `config.ts` — чтение env, `isRouterFirstEnabled(kind)`.
- `client.ts` — `routerGenerateImage({prompt, size}) → {jpegBuffer, requestId}` и `routerGenerateVideo({prompt, aspectRatio, deadlineMs, signal}) → {mp4Buffer, requestId}`; парсит `x-omniroute-*`; классифицирует исход: `ok | quota(429) | upstream(5xx) | timeout | invalid`.
- `breaker.ts` — предохранитель на Redis (`lobe-redis` уже есть): ключи `router-first:{image|video}:fails` и `:paused_until`. `quota`/`upstream`/`timeout` → +1; `ok` → сброс; при `fails ≥ N` → пауза на cooldown. Пока пауза — роутер не пробуем вообще (нулевая задержка для юзера).
- `eligibility.ts` — чистые функции `imageRouteFor(model, params)` / `videoRouteFor(model, params)` → `{routerModel, expectedOutput} | null` по таблицам §3.2/§3.3. Юнит-тесты.
- `accounting.ts` — хелпер `routerUsage(kind)` → `{provider:'omniroute', providerCostUsd:0}` для `writeUsageLog`.

### 3.2 Картинки

**Eligibility** (`imageRouteFor`): каталожная модель ∈ `{google/nano-banana-2/text-to-image}` (расширяемо), `imageNum === 1`, **нет** `imageUrl/imageUrls` (edit → WaveSpeed как сейчас), `size`/`aspectRatio` ∈ поддерживаемых роутером (по результату Ф0; сегодня заявлен только `1024x1024`, но Gemini 3.1 Flash Image умеет 1:1/16:9/9:16/4:3/3:4 — проверить, что `mapImageSize` роутера их пробрасывает).

**Поток** — врезка в `src/server/routers/async/image.ts` **перед** веткой `WAVESPEED_API_KEY`:

```
if (isRouterFirstEnabled('image') && !breaker.paused('image')) {
  const route = imageRouteFor(model, params);
  if (route) {
    const r = await routerGenerateImage(...)           // ≤ 60 с
    if (r.ok) {
      imageUrl = `data:image/jpeg;base64,${r.b64}`     // дальше — существующий sync-путь:
      → transformImageForGeneration → uploadImageForGeneration → asset/file
      → chargeAfterGenerate({..., served: {provider:'omniroute', providerCostUsd:0}})
      return
    }
    breaker.record('image', r.outcome); log('[router-first] image fallback reason=…')
  }
}
// ↓ без изменений: WaveSpeed async submit / sync runtime
```

Никаких новых состояний `async_tasks`: роутерная картинка укладывается в уже существующий синхронный путь (10 с). Единственное новое поле — `async_tasks.metadata.servedBy = 'omniroute' | 'wavespeed'` (для отладки и админки).

**Дефолтная модель для новичков** (правило «< 3 картинок»):

- Сервер: `spend.getCreditState` (уже отдаёт `dailyQuota…`) дополняется `imagesGenerated: number` = `count(generations WHERE user_id AND asset IS NOT NULL AND batch.model — картиночная)`. Один индексированный запрос (`generations_user_id_idx`).
- Клиент: `initializeImageConfig` (`store/image/slices/generationConfig/action.ts`): порядок выбора модели становится
  1. `lastSelectedImageModel` — если пользователь **сам** когда-либо выбирал модель (как сейчас);
  2. иначе `imagesGenerated < 3` → `google/nano-banana-2/text-to-image`;
  3. иначе `DEFAULT_AI_IMAGE_MODEL` (flux-schnell).
     Дефолт новичка **не записывается** в `lastSelected…` (запись остаётся только на явном выборе в пикере, `action.ts:292`) — поэтому после 3-й картинки дефолт сам возвращается на flux-schnell, как просил владелец. Константа `NEWBIE_IMAGE_THRESHOLD = 3` в `packages/const/src/settings/image.ts` рядом с существующими константами картинок.
- Цена для новичка: **та же, что у всех** (126 кредитов за Nano Banana 2). Это осознанный выбор по принципу 1; если владелец захочет «первые 3 — по цене flux», это делается одной строкой в `chargeBeforeGenerate` (`imagesGenerated < 3 && route → rate = flux`), но тогда цена в UI будет расходиться с реальной — не рекомендую.
- Free-план: картинки идут из месячного пула 2 500 кредитов (EXP-003), дневной лимит 5 сообщений их не касается → 126 кредитов новичок может себе позволить \~19 раз. Ничего менять не нужно.

**Где не трогаем**: `chargeBeforeGenerate` (холд по каталожной модели остаётся), `pairedEndpoint`, карточки моделей, бот (бот картинки не генерирует).

### 3.3 Видео

> **Статус после замеров §1.4: не реализовывать сейчас.** Ниже — как это должно быть устроено, когда появится источник, который отвечает предсказуемо (или роутер получит асинхронный API «submit → poll»). До этого `videoRouteFor()` возвращает `null` для всех моделей, и весь видео-трафик идёт в WaveSpeed как сегодня.

**Профили** (`ROUTER_VIDEO_PROFILES`, заполняются по измерениям Ф0):

| каталожная модель (что выбрал юзер)                                                                   | модель роутера      | ожидаемый выход пула (Ф0) | eligible, если запрос =                                                                 |
| ----------------------------------------------------------------------------------------------------- | ------------------- | ------------------------- | --------------------------------------------------------------------------------------- |
| `google/veo3.1-fast/text-to-video`, `google/veo3.1/text-to-video`, `google/veo3.1-lite/text-to-video` | `veo-free/veo`      | ? с, ? p, ratios ?        | duration = выход, resolution ≤ выход, ratio ∈ выход, нет `imageUrl/imageUrls/videoUrls` |
| `bytedance/seedance-2.0*/text-to-video`                                                               | `veo-free/seedance` | ?                         | то же                                                                                   |

Пока в профиле стоит `?` — модель **не eligible** (fail-closed). Именно поэтому видео нельзя включать до Ф0.

**Поток** — врезка в `createVideo` lambda **после** транзакции (batch/generation/asyncTask созданы, холд взят) и **вместо** немедленного `modelRuntime.createVideo`:

```
const route = videoRouteFor(model, generationParams)
if (isRouterFirstEnabled('video') && !breaker.paused('video') && route) {
  asyncTask.metadata += { servedBy:'omniroute-attempt', routerStartedAt }
  asyncCaller.video.createViaRouter({ asyncTaskId, generationId, batchId, model, route, params, prechargeResult, webhookToken })
  return { data: {batch, generations:[generation]}, success:true }   // клиент как обычно поллит asyncTask
}
// ↓ без изменений: WaveSpeed + webhook
```

Новый async-роутер `src/server/routers/async/video.ts` (по образцу `async/image.ts`; `asyncCaller` уже умеет внутренние вызовы), процедура `createViaRouter`:

1. `routerGenerateVideo(prompt, aspect, deadline=7 мин)`; параллельно кроны `timeout-stuck-video-jobs` учитывают `metadata.routerStartedAt` и не убивают задачу раньше `deadline + 2 мин`.
2. **Успех** → `videoService.processVideoForGeneration` расширяется, чтобы принимать `Buffer` (сейчас — только URL; внутри всё равно скачивание → обработка → S3), далее тот же код, что в вебхуке: asset, `generations.fileId`, `async_tasks.status=Success`, `chargeAfterGenerate` с `served:{provider:'omniroute', providerCostUsd:0}` и **`seconds = min(actual, requested)`** (принцип 4). Фактическую длину/разрешение пишем в `metadata` для контроля профилей.
3. **Неуспех до получения артефакта** (`quota`/`upstream`/`timeout`/`invalid`) → `breaker.record`, `metadata.servedBy='wavespeed'`, `metadata.routerFallbackReason`, и **тот же** существующий код: `initModelRuntimeFromDB` → `modelRuntime.createVideo({callbackUrl})` → Processing → вебхук WaveSpeed. Холд не трогаем — он и так по каталожной модели. Пользователю это выглядит как «генерация идёт дольше обычного».
4. Ограничение параллелизма: пул `veoaifree` — один сайт, «нечеловеческая скорость» = бан. Семафор в Redis `router-first:video:inflight` ≤ 2; при переполнении — сразу WaveSpeed (не ждать).

**Что осознанно не делаем:** image-to-video, reference images/videos, 1080p, любые длительности, кроме той, что реально выдаёт пул — всё это WaveSpeed. Так «клиент ничего не замечает» выполняется буквально.

### 3.4 Учёт (агрегатор)

- `writeUsageLog.ts`: `providerCostUsd` начинает действовать для `kind: 'image' | 'video'` (сейчас — только чат): если передан, `providerCostRub = providerCostUsd × USD_TO_RUB`, иначе как раньше из `model_rates`. `cost_usd/cost_rub` (то, что заплатил юзер) — без изменений. Поле `provider` = `'omniroute'`.
- Оба `chargeAfterGenerate` получают опциональный `served?: {provider, providerCostUsd}` и прокидывают его в `writeUsageLog`. По умолчанию (WaveSpeed) поведение прежнее.
- `async_tasks.metadata.servedBy` — источник правды «кто исполнил» для поддержки.

### 3.5 Учёт (админка `webgpt-admin`)

- `lib/provider-mapping.ts`: новая корзина `router` (`p === 'omniroute'`), подпись «Роутер (бесплатные пулы)». На странице «API-расходы» она показывает booked = 0 и не имеет инвойса — так и должно быть; в `mapUsageProvider` добавить **до** дефолта `openrouter`, иначе сверка OpenRouter поедет.
- Экономика: ничего не менять — `sum(provider_cost_rub)` уже даст ноль. Добавить одну карточку «Сэкономлено через роутер, 30 дн.» = Σ по строкам `provider='omniroute'` × цена WaveSpeed из `model_rates` (`per_unit × images` / `per_unit × video_seconds`) — это тот самый «учёт того, что у нас по нулям», в рублях, без второй колонки в БД.
- Алерт в `_lib/alerts.ts`: «роутерные медиа: доля успеха < 50 % за 24 ч или предохранитель в паузе > 6 ч» — сигнал, что источник умер (§1.1) и мы молча платим WaveSpeed.
- Страница юзера → «Экономика»: строки с `provider='omniroute'` подписывать «через роутер, 0 ₽».

### 3.6 Отказоустойчивость и деградация

| Сценарий                                                        | Поведение                                                                                                                                                                                     |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OmniRoute недоступен (контейнер лежит)                          | `client` получает ECONNREFUSED → outcome `upstream` → fallback WaveSpeed; после N подряд — пауза 15 мин, роутер не дёргается                                                                  |
| Пул исчерпан (429 + Retry-After)                                | fallback сразу; `paused_until = max(cooldown, Retry-After)`                                                                                                                                   |
| Google забанил antigravity-аккаунт                              | серия 5xx/403 → пауза; алерт админки; картинки идут в WaveSpeed по обычной цене — маржа падает, продукт не ломается                                                                           |
| veoaifree сменил вёрстку                                        | executor роутера отдаёт 502 «Failed to extract CSRF nonce» → пауза + алерт                                                                                                                    |
| Роутер отдал артефакт не по профилю (другая длина/ratio)        | принимаем (юзер уже ждал), списываем по принципу 4, пишем `metadata.profileMismatch` → алерт «профиль пула изменился, обновить таблицу»                                                       |
| Контейнер `lobehub` перезапустился во время роутерной генерации | видео: `timeout-stuck-video-jobs` по `routerStartedAt + deadline` → Error + refund холда (как сейчас для WaveSpeed); картинки: 10-секундное окно, риск мал, тот же `timeout-stuck-image-jobs` |
| `ROUTER_FIRST_MEDIA` пустой                                     | код не исполняется вовсе (единственный `if`), поведение = сегодняшнее                                                                                                                         |

### 3.7 Что видит клиент

Ничего нового: те же карточки, те же цены, тот же счётчик, та же лента «Мои генерации». Единственное косвенное отличие — время: картинка Nano Banana через роутер ≈ 10 с (WaveSpeed ≈ 15–30 с), видео через пул — до 7 мин + возможный fallback. Копия «Генерация может занять несколько минут» уже есть в видео-ленте; менять не нужно.

## 4. Риски и открытые вопросы владельцу

1. **ToS.** Antigravity: Google прямо запрещает прокси к бесплатному тиру; veoaifree: «нечеловеческая скорость». Мы **не** нарушаем ничего кодом агрегатора (он ходит в свой роутер), но источник может исчезнуть в любой день. Дизайн это переживает (§3.6), деньги при этом возвращаются к сегодняшним. Нужно ли владельцу что-то ещё, кроме алерта — например, сразу выключать нано-банану как дефолт новичка при паузе > 24 ч? (Предлагаю: да, `getCreditState.imagesGenerated` при паузе источника отдаёт `threshold`, и дефолт молча возвращается на flux.)
   1a. **Видео-пул не отвечает.** Две пробы из двух не вернули результат за 12 и 15 минут (§1.4). Это не «медленно», это «неизвестно, работает ли». Рекомендация: видео через роутер снять с плана до появления асинхронного API или другого источника; картинки — делать.
2. **Тестовый контейнер.** OmniRoute помечен как тест, без API-ключа, без healthcheck и не в стеке `/opt/lobechat`. Перед Ф1 нужно: `REQUIRE_API_KEY=true` + ключ в env агрегатора; gatus-проверка `GET /v1/models`; решение, считать ли его боевым (бэкап `data/`).
3. **Цена для новичка** — оставляем 126 кредитов за Nano Banana (принцип 1) или делаем «первые 3 по 9»? Рекомендация — оставить: маржа 100 %, UI честный.
4. **Единственная картинка за запрос.** Роутер отдаёт одну; при `imageNum > 1` — WaveSpeed целиком (не смешивать источники внутри батча).
5. **Видео только после Ф0.** Если пул выдаёт, например, только 8 с 16:9 720p — eligible будут только запросы ровно на это; пикер Veo 3.1 Fast по умолчанию предлагает именно 8 с/16:9, так что большая часть трафика подойдёт. Если Ф0 покажет нестабильную длительность — видео через роутер не включаем.

## 5. План реализации (после отмашки)

**Ф0 — измерения (полдня, без кода в агрегаторе).** Скрипт в `scripts/media-router/probe.ts`: 5 картинок с разными `size`, 3 видео на каждую из двух моделей → таблица: время, размер, ratio, длительность (ffprobe), разрешение, доля успеха, поведение при 3 параллельных. Результат — в §1.4 и в `ROUTER_VIDEO_PROFILES`.

**Ф1 — картинки (1 день).** `media-router/{config,client,breaker,eligibility,accounting}` + тесты; врезка в `async/image.ts`; `writeUsageLog` `providerCostUsd` для image/video; `chargeAfterGenerate.served`; `getCreditState.imagesGenerated`; дефолт новичка в `initializeImageConfig`; `NEWBIE_IMAGE_THRESHOLD`. Env на проде, `ROUTER_FIRST_MEDIA=image`. Проверка: смоук под владельцем (bot-bridge deeplink), строка в `usage_logs` с `provider='omniroute', provider_cost_rub=0`.

**Ф2 — админка (полдня).** Корзина `router`, карточка «Сэкономлено», алерт, подпись в экономике юзера.

**Ф3 — видео (1–2 дня) — заблокировано замерами 2026-09-22.** Условия разблокировки, любое из: (а) в роутере появляется асинхронный видео-API (submit → task id → poll), чтобы агрегатор не держал соединение 10–25 мин и мог честно отвалиться по дедлайну; (б) другой бесплатный/дешёвый источник в роутере со стабильным временем ответа ≤ 5 мин по 10 из 10 проб Ф0; (в) владелец принимает продуктовое решение «фоновая очередь»: пользователь получает видео «когда будет готово» с уведомлением в TG — тогда пул можно использовать как ночной/фоновый исполнитель, а WaveSpeed оставить для «срочно». После разблокировки: `async/video.ts#createViaRouter`, `processVideoForGeneration(Buffer)`, семафор, учёт `routerStartedAt` в кронах, канареечно `seedance` → `veo`.

**Ф4 — наблюдение (неделя).** Смотрим долю успеха и `profileMismatch`; решаем, открывать ли видео Free/дешёвым тарифам за счёт пула — это уже отдельное продуктовое решение с новой ценой.

## 6. Что НЕ входит

- Чат через OmniRoute (остаёмся на OpenRouter — другая задача, другие риски).
- Любые изменения каталога, цен, тарифов, копий в UI.
- Бот: не генерирует медиа, не затрагивается.
- Перенос OmniRoute в «боевой» статус (инфраструктурная задача из §4.2, делается параллельно).
