# Вау-онбординг медиа: подарок новичку из подписочного пула llm-router (9router + flow-veo)

**Дата:** 2026-09-22 · **Версия 2** (вечер 22.09, после уточнения владельца; v1 «router-first для всех» — в истории git) · **Статус:** дизайн, реализация не начата · **Автор:** Claude по задаче владельца

## 0. Задача владельца (уточнение 22.09, сжато)

1. Nano Banana в роутере **появится скоро — владелец добавит сам**. Задача агрегатора — уметь её использовать.
2. По видео большого спроса не будет. Нужно **грамотно построить, что только новые люди могут попробовать одно видео бесплатно**, и **кредиты при этом не списываются**.
3. Картинки новичкам — **Nano Banana вместо flux**, тоже бесплатно, из пула.
4. Главная цель — **вау-эффект при входе: крутая модель, бесплатно, с главной**, при условии «чтобы мы не страдали»: используем безлимит подписок, а не платим WaveSpeed.

Отсюда меняется рамка: это не «дешёвый исполнитель для всего трафика» (v1), а **ограниченный подарок новичку**, исполняемый пулом. Платный трафик остаётся на WaveSpeed как сегодня (при желании — фаза 5).

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

1. **Подарок — это сущность, а не скидка.** У новичка есть счётчики «бесплатных проб» (картинки, видео). Проба тратит счётчик, а не кредиты: холд 0, `credits_charged = 0`. Обычные генерации новичка сверх подарка — по обычным правилам (кредиты, WaveSpeed).
2. **Проба исполняется пулом.** Проба идёт в llm-router (Nano Banana → `flow/gemini-image`, когда владелец её поднимет; видео → `veo` i2v/t2v `async:true`). Себестоимость 0.
3. **«Чтобы мы не страдали» = потолки.** Персональный лимит (на аккаунт), глобальные дневные и месячные лимиты, и отдельный, очень маленький бюджет на fallback в WaveSpeed. Всё в env, всё выключается одним флагом.
4. **Клиент знает про подарок, не про пул.** Копия честная: «Подарок новичку: 3 картинки Nano Banana и 1 видео — бесплатно». Ни слова о роутере.
5. **Никогда хуже, чем обещали.** Проба даёт фиксированный, заранее известный формат (картинка Nano Banana 1:1/16:9/9:16; видео Veo Fast 4 с из картинки). Если пул не может — либо ограниченный fallback, либо честное «попробуйте через несколько минут» с сохранением подарка. Никаких сырых ошибок (friendlyError уже есть).
6. **Каталог, цены, тарифы не меняются.** Только дефолт модели для новичка и бейджи «бесплатно».

## 3. Дизайн

### 3.1 Кто «новичок» и что получает

| параметр          | предложение                                                                                              | почему                                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| новичок           | `plan=free`, не платил никогда, не `is_admin_granted`, регистрация ≤ **7 дней** назад                    | окно короткое — подарок про первое впечатление, а не про халяву                                                                          |
| активация подарка | после **первого сообщения в чате** (уже есть счётчик EXP-003)                                            | \~40 % регистраций вообще не пишут; так подарок не тратится на ботов и случайных                                                         |
| картинки          | **3** генерации Nano Banana (`google/nano-banana-2/text-to-image`), 1 картинка за запрос, без референсов | 3 = «понял, что это круто»; референсы/edit — вне пула                                                                                    |
| видео             | **1** ролик Veo Fast, **image→video 4 с** («Оживить картинку»), 16:9 или 9:16 по картинке                | i2v = **20 кредитов Flow против 100 за text→video** — в 5 раз дешевле для пула и сильнее вау: оживает своя же картинка                   |
| глобально в день  | `TRIAL_IMAGES_PER_DAY=20`, `TRIAL_VIDEOS_PER_DAY=3`                                                      | 7 регистраций/день, \~3 активных → 3 видео × 20 кредитов = 60/день ≈ 1 800/мес ≈ 25 % пула; картинки — после замера цены в кредитах Flow |
| глобально в месяц | `TRIAL_VIDEOS_PER_MONTH=60`                                                                              | страховка от всплеска регистраций (реклама, рассылка)                                                                                    |
| срок              | счётчики сгорают через 7 дней после регистрации                                                          |                                                                                                                                          |

Хранение: `user_billing.trial_images_left int default 0`, `trial_video_left int default 0`, `trial_unlocked_at`, `trial_expires_at` (миграция как у `magic_bonus_claimed_at`). Выдача — в момент первого сообщения (`checkUsageLimit` уже считает его), идемпотентно. Глобальные счётчики — Redis `trial:{images|videos}:day:<MSK-дата>` и `:month:<YYYY-MM>`.

### 3.2 Картинки-пробы

- **Дефолт модели** для новичка с `trial_images_left > 0` — `google/nano-banana-2/text-to-image` (клиент: `initializeImageConfig`, порядок: явный `lastSelected` → проба → `DEFAULT_AI_IMAGE_MODEL`; дефолт пробы не пишется в `lastSelected`, поэтому после подарка сам вернётся flux-schnell — «картинки нано-банаские вместо флакса» ровно на время подарка). Сервер отдаёт счётчики в `spend.getCreditState` (`trial: {imagesLeft, videoLeft, expiresAt}`), там же где `dailyQuota`.
- **Списание**: в `image/chargeBeforeGenerate` перед холдом — `if (trialApplies(billing, model, params))` → атомарно `trial_images_left -= 1` (UPDATE … WHERE > 0 RETURNING), холд 0, `generation_batches.metadata.trial = true`. Условия `trialApplies`: модель = nano-banana-2 t2i, `imageNum = 1`, нет `imageUrl/imageUrls`, подарок активен и не истёк, глобальный дневной лимит не выбран (`INCR` с проверкой, откат при отказе).
- **Исполнение**: в `async/image.ts` **перед** веткой WaveSpeed: если `batch.metadata.trial` → `routerGenerateImage({model:'flow/gemini-image', prompt, aspect})` (id модели — как владелец назовёт в роутере; в env `LLM_ROUTER_IMAGE_MODEL`) → `data:` URI → существующий sync-путь (transform → upload → asset) → `chargeAfterGenerate({served:{provider:'llm-router', providerCostUsd:0}, trial:true})` → `usage_logs`: `credits_charged=0, provider='llm-router', provider_cost_rub=0, is_trial=true`.
- **Fallback** (роутер 429/5xx/таймаут 60 с): WaveSpeed `google/nano-banana-2/text-to-image` **за наш счёт** (6,3 ₽) — но только в пределах `TRIAL_FALLBACK_IMAGES_PER_DAY=10` (≤ 63 ₽/день в худшем случае); сверх — счётчик пробы возвращается, юзер видит «Сейчас очередь, попробуйте через пару минут». Рекомендую fallback разрешить: 6 ₽ за сохранённый вау-момент — дёшево.
- **Сверх подарка**: обычная генерация — 126 кредитов из месячного пула Free (2 500), WaveSpeed. Ничего не меняем.

### 3.3 Видео-проба «Оживить картинку»

- **Точка входа**: кнопка «Оживить бесплатно» на карточке картинки в ленте/лайтбоксе (только пока `trial_video_left > 0`), ведёт на видео-страницу с предзаполненной картинкой, моделью `google/veo3.1-fast/image-to-video` (через pairing — карточка Fast t2v с `imageUrl`), 4 с, ratio по картинке, 720p; поля заблокированы бейджем «Подарок: 1 бесплатное видео». Text→video для пробы **не предлагаем** (5× дороже пулу; если владелец хочет — второй флаг `TRIAL_VIDEO_T2V=1`).
- **Гейт тарифа**: Free видео закрыто (`isModelAllowedForPlanAsync`). В `video/chargeBeforeGenerate` проверка пробы идёт **до** план-гейта: `trialApplies` → пропускаем гейт и холд, `trial_video_left -= 1` атомарно, `metadata.trial=true`. Всё остальное на Free по-прежнему закрыто.
- **Исполнение**: `createVideo` lambda → `asyncCaller.video.createTrialViaRouter` (новый `async/video.ts`): `POST /v1/videos/generations {model:'veo', prompt, image, aspect, seconds:4, async:true}` → `job_id` → опрос каждые 15 с до `TRIAL_VIDEO_DEADLINE_MS=540000` → `done` → `processVideoForGeneration(Buffer)` → asset → `Success` → `chargeAfterGenerate({served:{provider:'llm-router', providerCostUsd:0}, trial:true, seconds:4})`. Кроны `poll-stuck-video-jobs`/`timeout-stuck-video-jobs` учат `metadata.routerJobId`/`routerDeadlineAt` (задача на роутере живёт 30 мин).
- **Fallback**: пул 429/502/503/504/дедлайн → по умолчанию **без WaveSpeed**: проба возвращается (`trial_video_left += 1`), задача → Error с дружелюбным текстом «Видео сейчас в очереди — подарок сохранён, попробуйте через 10–15 минут» + пуш в TG, если привязан. Опционально `TRIAL_FALLBACK_VIDEOS_PER_DAY=1` (Veo Lite 4 с на WaveSpeed ≈ 30–60 ₽) — решение владельца.
- **Предохранитель**: Redis breaker как в v1 (`trial:video:paused_until`): пока пул в паузе, кнопка «Оживить бесплатно» **скрыта** (сервер отдаёт `trial.videoAvailable=false`), подарок не сгорает. Так юзер не упирается в ошибку.

### 3.4 Что видит клиент

- **Вход** (welcome modal / PcSidebarCard / MobileStickyBar — там, где сейчас TG-бонус): «Подарок новичку: 3 картинки Nano Banana и 1 видео — бесплатно». После первого сообщения — тост «Подарок активирован».
- **Картинки**: пикер открыт на Nano Banana с бейджем «Бесплатно · осталось 3»; счётчик уменьшается; после 3 — бейдж исчезает, дефолт flux-schnell, обычные цены.
- **Видео**: кнопка «Оживить бесплатно» на картинке; страница видео с замороженными параметрами и бейджем; после — обычный Free (видео закрыто, апселл как сейчас).
- Ошибки — только через `friendlyError`; про роутер/пул — ни слова.

### 3.5 Учёт

**Агрегатор**

- `usage_logs`: новая колонка `is_trial boolean default false`; `credits_charged=0`, `provider='llm-router'` (или `'wavespeed'` при fallback — тогда `provider_cost_rub` реальный), `cost_rub=0`. `writeUsageLog`: `providerCostUsd` начинает действовать для image/video (сейчас только чат).
- `generation_batches.metadata.trial`, `async_tasks.metadata.{servedBy, routerJobId, routerFallbackReason}`.

**Админка**

- `lib/provider-mapping.ts`: корзина `router` (`provider='llm-router'`) до дефолта `openrouter`.
- Новая карточка «Подарок новичкам» в Экономике: выдано / активировано / использовано картинок и видео / fallback-расход ₽ / **конверсия в оплату за 14 дней среди получивших подарок vs без** — это и есть KPI фичи (сейчас платят 2 из \~40 регистраций в неделю).
- Алерты: «пул видео в паузе > 6 ч», «fallback-бюджет дня выбран», «дневной лимит проб выбран до 12:00» (значит, пора расширять пул или сужать окно).

### 3.6 Защита от злоупотреблений

- Подарок один на аккаунт; выдаётся только после первого сообщения; окно 7 дней; глобальные дневные/месячные потолки; нет подарка админ-выданным и когда-либо платившим.
- Регистрация через TG и почту у нас одинаковая → мультиаккаунт возможен. Минимальная мера: не выдавать видео-пробу аккаунтам, созданным с того же `ym_client_id`/IP за сутки (данные атрибуции уже пишутся, см. Ф18) — если владелец сочтёт нужным. Картинки при 6 ₽ fallback и 0 ₽ пуле — риск копеечный.

### 3.7 Конфигурация (env `/opt/lobechat/.env`)

```
LLM_ROUTER_URL=http://172.21.0.1:3300
LLM_ROUTER_API_KEY=sk-…                # отдельный ключ «webgpt», ограниченный моделями veo + картинка
LLM_ROUTER_IMAGE_MODEL=flow/gemini-image   # как назовёт владелец
TRIAL_ENABLED=1
TRIAL_IMAGES_PER_USER=3  TRIAL_VIDEOS_PER_USER=1  TRIAL_WINDOW_DAYS=7
TRIAL_IMAGES_PER_DAY=20  TRIAL_VIDEOS_PER_DAY=3  TRIAL_VIDEOS_PER_MONTH=60
TRIAL_FALLBACK_IMAGES_PER_DAY=10  TRIAL_FALLBACK_VIDEOS_PER_DAY=0
TRIAL_VIDEO_DEADLINE_MS=540000
TRIAL_BREAKER_FAILS=3  TRIAL_BREAKER_COOLDOWN_MS=900000
```

## 4. Риски и вопросы владельцу

1. **Определение новичка**: ≤ 7 дней с регистрации + хотя бы одно сообщение в чате — ок? (Иначе \~60 % подарков уйдут тем, кто и так не вернулся.)
2. **Видео-проба = «оживить картинку» (i2v, 4 с)**, а не текст→видео: в 5 раз дешевле пулу и, по-моему, сильнее по вау. Ок, или хочешь text→video?
3. **Fallback**: картинки — WaveSpeed до 10/день (≈ 63 ₽/день максимум); видео — без fallback (подарок сохраняется, «попробуйте через 10 минут») или 1/день на WaveSpeed? Рекомендую: картинки да, видео нет.
4. **Лимиты**: 3 картинки + 1 видео на человека; 20 картинок и 3 видео в день; 60 видео в месяц. Это ≈ 25 % ёмкости пула Veo. Ок?
5. **Nano Banana в роутере** — жду от тебя id модели и подтверждение, что `POST /v1/images/generations` отдаёт `b64_json`; цену в кредитах Flow померим (она уменьшает видео-ёмкость тех же аккаунтов).
6. **Твой личный аккаунт `acc1`** — исключить из ротации для клиентских проб (`personal:true` уже есть).
7. **`model_rates` Veo Fast t2v $1.2/с vs i2v $0.12** — похоже на опечатку ×10; поправить независимо.

## 5. План (после отмашки; Ф1–Ф3 не зависят от готовности Nano Banana в роутере)

- **Ф0 — замеры** (когда Nano Banana в роутере поднята): 5 картинок + 3 i2v-ролика на выделенных владельцем кредитах → цена в кредитах Flow, время, разрешение. Правило репо роутера «credits are money» соблюдаем.
- **Ф1 — подарок в бэкенде (1,5 дня)**: миграция колонок `trial_*` + `usage_logs.is_trial`; выдача при первом сообщении; `trialApplies` + атомарные счётчики (Postgres + Redis); обход план-гейта и холда для пробы; `media-router/{client,breaker}`; `async/video.ts#createTrialViaRouter`; `processVideoForGeneration(Buffer)`; `writeUsageLog.providerCostUsd` для image/video; кроны. Тесты на чистые функции.
- **Ф2 — UI (1 день)**: копия подарка в welcome/сайдбаре/мобильной полосе; дефолт и бейдж в пикере картинок; кнопка «Оживить бесплатно» + замороженная форма видео; счётчики из `getCreditState`.
- **Ф3 — админка (0,5 дня)**: корзина `router`, карточка «Подарок новичкам» с конверсией, 3 алерта.
- **Ф4 — включение**: `TRIAL_ENABLED=1` на 20 % новых (по хэшу id) на неделю → сравнить конверсию в оплату с контролем; затем 100 %.
- **Ф5 (опционально, позже)** — router-first для платного Veo-трафика (v1 этой спеки), если пул расширится.

## 6. Что НЕ входит

- Seedance/Dola, HeyGen; чат через роутер; изменения тарифов и цен; бот; лечение пула (репо llm-router); OmniRoute (тестовый стенд, не наш роутер).
