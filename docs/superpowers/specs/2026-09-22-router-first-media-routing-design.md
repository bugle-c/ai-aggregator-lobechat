# Вау-онбординг медиа: новичку — Nano Banana и одно видео, исполняет подписочный пул llm-router (9router + flow-veo)

**Дата:** 2026-09-22 · **Версия 3** (ночь 22→23.09, после двух уточнений владельца; v1 «router-first для всех» и v2 «бесплатно без кредитов» — в истории git) · **Статус:** дизайн, реализация не начата · **Автор:** Claude по задаче владельца

## 0. Задача владельца (уточнения 22.09, сжато)

1. Nano Banana в роутере **появится скоро — владелец добавит сам**. Агрегатор должен уметь её использовать.
2. По видео большого спроса не будет. Нужно построить так, что **только новые люди могут попробовать одно видео** — сейчас на Free видео закрыто вовсе.
3. Картинки новичкам — **Nano Banana вместо flux** (дефолт), пока не сгенерировал 3 картинки.
4. **Кредиты у клиента списываются как обычно**, будто он платит нам по API. «Ничего не тратим» — это про **нас**: исполняет подписочный пул, себестоимость 0 (небольшой расход на fallback допустим).
5. Цель — **вау-эффект при входе**: крутая модель с первого экрана, при условии «чтобы мы не страдали».

Рамка: это не «дешёвый исполнитель для всего трафика» (v1) и не «бесплатные пробы» (v2), а **новичковый режим**: (а) дефолт картинок Nano Banana, (б) одно разрешённое видео на Free, (в) обе вещи исполняются пулом, (г) с обычным списанием кредитов из стартового пула Free (2 500/мес по EXP-003). Платный трафик остаётся на WaveSpeed как сегодня (расширение — фаза 5).

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

1. **Клиент платит как всегда.** Те же карточки, те же цены, обычный холд/списание кредитов (`chargeBeforeGenerate` без изменений). Новичок платит из стартового пула Free (2 500 кредитов/мес). Меняются только дефолт модели и **разрешение** на одно видео.
2. **Исполняет пул, WaveSpeed — страховка с потолком.** Новичковые генерации идут в llm-router (Nano Banana → `LLM_ROUTER_IMAGE_MODEL`; видео → `veo`, `async:true`). Себестоимость 0. Fallback в WaveSpeed — только в пределах маленького дневного бюджета (наш расход «на лёгком»).
3. **Ёмкость пула — потолок.** Персональные лимиты (3 картинки-дефолта, 1 видео), глобальные дневные/месячные потолки, предохранитель. Всё в env, один флаг выключает.
4. **Клиент знает про «доступ новичку», не про пул.** Копия: «Новичкам: лучшая модель картинок и одно видео уже доступны». Ни слова о роутере, никаких сырых ошибок (`friendlyError`).
5. **Никогда хуже, чем обещали.** Фиксированный формат: картинка Nano Banana 1:1/16:9/9:16; видео Veo Fast 4 с из картинки, 720p. Пул не может → fallback в бюджете, иначе честное «попробуйте через несколько минут» с сохранением права на видео.
6. **Холд = потолок.** Списание за результат пула никогда не превышает предоплату.

## 3. Дизайн

### 3.1 Кто «новичок» и что получает

| параметр          | предложение                                                                                                                                       | почему                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| новичок           | `plan=free`, не платил, не `is_admin_granted`, регистрация ≤ **7 дней**                                                                           | режим про первое впечатление, а не про постоянную халяву для Free                                               |
| картинки          | дефолт пикера = `google/nano-banana-2/text-to-image`, пока у юзера **< 3** успешных картинок (правило владельца); цена обычная — **126 кредитов** | дефолт, а не запрет: flux остаётся доступен                                                                     |
| видео             | **1** ролик на Free: Veo Fast **image→video 4 с** («Оживить картинку»), 16:9/9:16 по картинке, 720p; цена обычная по `model_rates`                | i2v = **20 кредитов Flow против 100 за text→video** — в 5 раз дешевле пулу, вау сильнее (оживает своя картинка) |
| глобально в день  | `NEWCOMER_IMAGES_PER_DAY=20`, `NEWCOMER_VIDEOS_PER_DAY=3`                                                                                         | 7 регистраций/день, \~3 активных; 3 видео × 20 кредитов ≈ 1 800/мес ≈ 25 % пула                                 |
| глобально в месяц | `NEWCOMER_VIDEOS_PER_MONTH=60`                                                                                                                    | страховка от всплеска (реклама, рассылка)                                                                       |
| сверх лимитов     | картинки — как сейчас (WaveSpeed, обычная цена); видео на Free — закрыто, апселл как сейчас                                                       |                                                                                                                 |

Хранение: `user_billing.newcomer_video_left int default 1` (сгорает вместе с окном 7 дней, `newcomer_until timestamptz`, выставляется при регистрации), `imagesGenerated` считаем по `generations` (asset не null). Глобальные счётчики — Redis `newcomer:{images|videos}:day:<MSK>` / `:month:<YYYY-MM>`.

**Цена видео новичку — блокер:** по текущим `model_rates` Veo Fast i2v = $0.12/с → 4 с × 2.5 (premium) ≈ 720 кредитов (108 ₽) — из 2 500 Free это одно видео, ок. Но t2v стоит **$1.2/с** → 4 с ≈ 7 200 кредитов — Free не потянет вообще; это ещё один довод и за i2v, и за проверку ставки (похоже на опечатку ×10).

### 3.2 Картинки новичка

- **Дефолт модели** — клиент `initializeImageConfig`: явный `lastSelectedImageModel` → иначе (`newcomer && imagesGenerated < 3`) → `google/nano-banana-2/text-to-image` → иначе `DEFAULT_AI_IMAGE_MODEL` (flux-schnell). Дефолт новичка **не пишется** в `lastSelected`, после 3-й картинки сам возвращается flux. `NEWBIE_IMAGE_THRESHOLD = 3` в `packages/const/src/settings/image.ts`. Сервер отдаёт `newcomer: {active, imagesGenerated, videoLeft, videoAvailable}` в `spend.getCreditState`.
- **Списание** — без изменений: `chargeBeforeGenerate` держит 126 кредитов по каталожной модели.
- **Исполнение** — в `async/image.ts` **перед** веткой WaveSpeed: `if (newcomerRouteFor(model, params, billing))` → `routerGenerateImage({model: LLM_ROUTER_IMAGE_MODEL, prompt, aspect})` (таймаут 60 с) → `data:` URI → существующий sync-путь (transform → upload → asset) → `chargeAfterGenerate({served:{provider:'llm-router', providerCostUsd:0}})`. Условия: модель nano-banana-2 t2i, `imageNum=1`, нет референсов, ratio ∈ поддерживаемых пулом (замер Ф0), новичок, дневной лимит не выбран, breaker не в паузе.
- **Fallback** (429/5xx/таймаут): существующий путь WaveSpeed nano-banana-2 (наш расход 6,3 ₽), в пределах `NEWCOMER_FALLBACK_IMAGES_PER_DAY=10` (≤ 63 ₽/день); сверх — тоже WaveSpeed? Нет: сверх бюджета картинка всё равно нужна юзеру, а он за неё заплатил кредитами → **WaveSpeed без ограничения** (клиент платит, наш расход 6 ₽ — «на лёгком»). Бюджет нужен только как алерт «пул не тянет».
- **Учёт**: `usage_logs`: `credits_charged=126` (как всегда), `provider='llm-router'`, `provider_cost_rub=0`, `is_newcomer=true`; при fallback `provider='wavespeed'`, cost реальный.

### 3.3 Видео новичка «Оживить картинку»

- **Точка входа**: кнопка «Оживить картинку» на карточке в ленте/лайтбоксе (пока `newcomer.videoLeft > 0 && videoAvailable`) → видео-страница с предзаполненной картинкой, модель `google/veo3.1-fast/text-to-video` + `imageUrl` (pairing → i2v), 4 с, ratio по картинке, 720p; поля заморожены с бейджем «Доступно новичку: 1 видео · 720 кредитов». Text→video новичку не предлагаем (`NEWCOMER_VIDEO_T2V=0`).
- **Гейт тарифа**: в `video/chargeBeforeGenerate` перед `isModelAllowedForPlanAsync`: `if (newcomerVideoApplies(billing, model, params))` → гейт пропускаем, **холд обычный** (по `model_rates`, из пула Free), `newcomer_video_left -= 1` атомарно (UPDATE … WHERE > 0 RETURNING), `metadata.newcomer=true`. Если кредитов Free не хватает — обычный `credits_exhausted` (апселл/топап), право на видео не тратится.
- **Исполнение**: `createVideo` lambda → `asyncCaller.video.createViaRouter` (новый `async/video.ts`): `POST /v1/videos/generations {model:'veo', prompt, image, aspect, seconds:4, async:true}` → `job_id` → опрос каждые 15 с до `NEWCOMER_VIDEO_DEADLINE_MS=540000` → `done` → `processVideoForGeneration(Buffer)` (расширить с URL на Buffer) → asset → `Success` → `chargeAfterGenerate({served:{provider:'llm-router', providerCostUsd:0}, seconds:min(actual,4)})`. Кроны `poll-stuck-video-jobs`/`timeout-stuck-video-jobs` учат `metadata.routerJobId`/`routerDeadlineAt`.
- **Fallback** (пул 429/502/503/504/дедлайн): в пределах `NEWCOMER_FALLBACK_VIDEOS_PER_DAY=1` → существующий путь WaveSpeed (`modelRuntime.createVideo` + вебхук; наш расход ≈ 30–60 ₽, клиент уже заплатил кредитами). Сверх бюджета → холд возвращается, `newcomer_video_left += 1`, задача Error с текстом «Видео сейчас в очереди — попробуйте через 10–15 минут», TG-пуш если привязан.
- **Предохранитель**: пока пул в паузе — `videoAvailable=false`, кнопка скрыта, право сохраняется; юзер не упирается в ошибку.

### 3.4 Что видит клиент

- Вход (welcome modal / PcSidebarCard / MobileStickyBar — где сейчас TG-бонус): «Новичкам 7 дней: картинки на лучшей модели и одно видео из вашей картинки».
- Картинки: пикер открыт на Nano Banana, бейдж «Рекомендуем новичкам»; после 3 картинок дефолт flux-schnell, всё остальное как было.
- Видео: кнопка «Оживить картинку» с ценой в кредитах; страница с замороженными параметрами; после использования — обычный Free (видео закрыто, апселл).
- Ошибки — только `friendlyError`; про пул — ни слова.

### 3.5 Учёт

**Агрегатор**: `usage_logs.is_newcomer boolean default false`; `provider='llm-router'` + `provider_cost_rub=0` для результата пула, `wavespeed` + реальная цена при fallback; `credits_charged`/`cost_rub` — как всегда. `writeUsageLog`: `providerCostUsd` начинает действовать для image/video; оба `chargeAfterGenerate` принимают `served`. `generation_batches.metadata.newcomer`, `async_tasks.metadata.{servedBy, routerJobId, routerFallbackReason}`.

**Админка**: корзина `router` в `lib/provider-mapping.ts` (до дефолта `openrouter`); карточка «Новичковый режим»: сколько новичков, картинок/видео через пул, fallback-расход ₽, **конверсия в оплату за 14 дней с режимом vs без** (KPI фичи; сейчас платят \~2 из 40 регистраций в неделю); алерты «пул в паузе > 6 ч», «fallback-бюджет дня выбран», «дневной лимит новичков выбран до 12:00».

### 3.6 Защита от злоупотреблений

Одно видео на аккаунт, окно 7 дней, только Free без платежей и без админ-грантов, глобальные потолки. Мультиаккаунт: видео стоит юзеру 720 кредитов из стартовых 2 500 — злоупотребление невыгодно; пулу — 20 кредитов Flow за попытку, ограничено дневным потолком. Дополнительно (по желанию): не давать видео аккаунтам с тем же `ym_client_id`/IP за сутки.

### 3.7 Конфигурация (env `/opt/lobechat/.env`)

```
LLM_ROUTER_URL=http://172.21.0.1:3300
LLM_ROUTER_API_KEY=sk-…                  # отдельный ключ «webgpt», ограниченный veo + картинка
LLM_ROUTER_IMAGE_MODEL=flow/gemini-image # как назовёт владелец
NEWCOMER_MODE=1
NEWCOMER_WINDOW_DAYS=7  NEWCOMER_IMAGE_THRESHOLD=3  NEWCOMER_VIDEOS_PER_USER=1
NEWCOMER_IMAGES_PER_DAY=20  NEWCOMER_VIDEOS_PER_DAY=3  NEWCOMER_VIDEOS_PER_MONTH=60
NEWCOMER_FALLBACK_VIDEOS_PER_DAY=1  NEWCOMER_FALLBACK_IMAGES_PER_DAY=10   # картинки — только алерт
NEWCOMER_VIDEO_DEADLINE_MS=540000
NEWCOMER_BREAKER_FAILS=3  NEWCOMER_BREAKER_COOLDOWN_MS=900000
```

## 4. Риски и вопросы владельцу

1. **Новичок** = Free, без платежей, ≤ 7 дней с регистрации — ок? (Активация «после первого сообщения» теперь не нужна: юзер платит кредитами, лимитирует пул.)
2. **Видео новичка = «оживить картинку» (i2v, 4 с, 720p)**, а не текст→видео: в 5 раз дешевле пулу, и по текущим ставкам t2v Free не потянул бы вовсе. Ок?
3. **Fallback**: картинки — WaveSpeed всегда (клиент заплатил, наш расход 6 ₽); видео — 1 в день на WaveSpeed, сверх — «попробуйте позже» с сохранением права. Ок?
4. **Лимиты**: 3 видео/день, 60/мес, 20 картинок/день через пул ≈ 25 % ёмкости Veo. Ок?
5. **Ставка Veo Fast t2v $1.2/с** vs i2v $0.12 в `model_rates` — опечатка ×10? Влияет на все цены Veo Fast, не только на новичков.
6. **Nano Banana в роутере** — жду id модели и подтверждение, что `POST /v1/images/generations` отдаёт `b64_json`; цену в кредитах Flow померим в Ф0.
7. **`acc1` (личный)** — исключить из ротации для клиентских генераций.

## 5. План (после отмашки; Ф1–Ф3 не ждут Nano Banana в роутере — картиночная ветка включится флагом, когда модель появится)

- **Ф0 — замеры**: 5 картинок + 3 i2v-ролика на выделенных владельцем кредитах → цена в кредитах Flow, время, разрешение, ratio. Правило репо роутера «credits are money» соблюдаем.
- **Ф1 — бэкенд (1,5 дня)**: миграция `user_billing.newcomer_video_left/newcomer_until` + `usage_logs.is_newcomer`; `newcomerRouteFor`/`newcomerVideoApplies` (чистые, с тестами); обход план-гейта на одно видео; `media-router/{config,client,breaker,caps}`; врезка в `async/image.ts`; `async/video.ts#createViaRouter`; `processVideoForGeneration(Buffer)`; `writeUsageLog.providerCostUsd` для image/video; `chargeAfterGenerate.served`; кроны.
- **Ф2 — UI (1 день)**: копия в welcome/сайдбаре/мобильной полосе; дефолт + бейдж в пикере картинок; кнопка «Оживить картинку» + замороженная форма; `getCreditState.newcomer`.
- **Ф3 — админка (0,5 дня)**: корзина `router`, карточка «Новичковый режим» с конверсией, 3 алерта.
- **Ф4 — включение**: 20 % новых регистраций (по хэшу id) на неделю против контроля → конверсия в оплату; затем 100 %.
- **Ф5 (позже)** — router-first для платного Veo-трафика (v1), если пул расширится.

## 6. Что НЕ входит

Seedance/Dola, HeyGen; чат через роутер; изменения тарифов и цен; бот; лечение пула (репо llm-router); OmniRoute (тестовый стенд).
