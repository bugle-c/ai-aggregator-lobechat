# UX & Growth Plan — 2026-04-24

**Контекст:** baseline $19.80/мес revenue (2 платежа апрель), 49 юзеров, 43% gross margin. Только что починили billing (transaction wrap + empty-stream guard), внесли API-expenses, построили `/admin/finance/api-costs`.

**Отказались:** переезд на OpenWebUI (licensing 50-user clause, Python stack mismatch, 6-10 нед dev = plohой ROI при $19/мес). Решили: остаёмся на LobeChat fork, упрощаем UI.

**Цель:** двинуть activation rate и conversion в ближайшие 4 недели. Не ломать работающий billing, не переписывать платформу.

---

## Phase 1 — Сейчас (1-2 недели, high priority)

### Task 1.1: Merge upstream LobeChat (1-2 дня)

**Зачем:** наш форк отстаёт на 891 коммит / 2 месяца от `lobehub/lobe-chat:canary`. При 6+ месяцах станет legacy. Сейчас merge ещё реалистичен (≈544 файла потенциальных конфликтов, большая часть — локали).

**Что делать:**

1. Создать worktree `merge-upstream-20260424`.
2. `git fetch upstream && git merge upstream/canary`.
3. Разрешить конфликты. Приоритет наших изменений над upstream в критичных местах:
   - `src/server/modules/billing/*`
   - `src/server/services/billing/*`
   - `src/database/schemas/user-billing.ts` / `usage-logs.ts` / `billing-payments.ts`
   - `src/app/(backend)/webapi/chat/[provider]/route.ts`
   - Все наши файлы с custom billing/auth/plans логикой.
   - Локали (`locales/*.json`) — брать свежую версию с upstream.
4. Запустить `npm run test:server` — все 46 billing-тестов должны пройти.
5. Smoke-test на staging (Dokploy VPS#2): чат, оплата, проверка лимитов.
6. Merge в canary, rebuild `lobechat-custom:latest`, deploy.

**Критерий готовности:** upstream merged, tests green, 1 реальный чат прошёл, tokens_used_month корректно инкрементируется.

**Риск:** конфликты в chat route (наш billing inject vs их refactoring) могут быть болезненными. Если merge больше 1 дня — приостановить, разобраться, доделать.

---

### Task 1.2: Simplify LobeChat UI (2-3 дня)

**Зачем:** юзер жалуется "LobeChat сложный". Реальный bottleneck пока не измерен, но гипотеза правдоподобна — LobeChat показывает много power-user фич сразу (agent market, plugins, workspace tabs, advanced settings).

**Что скрыть для обычных юзеров:**

1. **Agent Market** — отдельная иконка в sidebar. Скрыть через `NEXT_PUBLIC_ENABLE_MARKETPLACE=0` или CSS override в нашей теме.
2. **Plugin store / Plugin settings** — убрать ссылки из settings menu.
3. **Workspace tabs multi-session** — оставить только один активный чат + sidebar с историей, как у ChatGPT.
4. **Advanced model settings** (temperature/top_p) — спрятать за "Advanced" accordion.
5. **Настройки ролей (persona)** — в отдельную страницу, не на первом экране.
6. **Artifact preview, branching conversations** — оставить, но дефолтно свёрнутые.

**Что НЕ трогать:**

- Балансовый индикатор (критично)
- Выбор модели (критично)
- История чатов
- Upload файлов
- Кнопка "Купить больше кредитов"

**Реализация:**

- Feature flags через env (`NEXT_PUBLIC_SIMPLE_UI=true`)
- CSS overrides в `src/styles/custom.css`
- Conditional rendering в `src/app/[variants]/(main)/_layout/*` компонентах
- **НЕ рефакторить** upstream-файлы. Только wrap/override.

**Критерий готовности:** новый юзер после регистрации видит чистый chat UI уровня ChatGPT. Всё лишнее либо скрыто, либо доступно через "More options" (3 клика минимум).

---

### Task 1.3: Onboarding flow (1 день)

**Зачем:** сейчас новый юзер попадает в пустой интерфейс. Нет чёткого "что делать дальше". Activation rate страдает.

**Что добавить:**

1. **Welcome modal при первом входе:**
   - Заголовок: "Добро пожаловать в WebGPT!"
   - Текст: "У вас 20 бесплатных кредитов. Хватит на \~40 простых вопросов к ChatGPT."
   - Кнопка "Начать" закрывает modal, не навязчиво.

2. **3 suggested prompts на пустом экране чата:**
   - "Напиши письмо на работу"
   - "Объясни термин ..."
   - "Помоги с идеей для ..."
     (подсказки на первый клик — убираются после первого сообщения)

3. **Balance banner в top-bar:**
   - "У вас 20 кредитов" (с иконкой)
   - При <5 кредитах → красный цвет + кнопка "Пополнить"

4. **Post-first-message hook:**
   - После первого ответа LLM — toast "Списано 1 кредит" (1 раз, dismissable)

**Реализация:**

- Таблица `user_onboarding_state` в LobeChat PG: `user_id, first_login_seen, first_message_sent, banner_dismissed`
- Компонент `OnboardingModal` в `src/features/Onboarding/`
- Баланс — берём из `user_billing` через существующий endpoint
- Hook на первое сообщение — в существующем chat route добавить increment onboarding flag

**Критерий готовности:** новый юзер от регистрации до первого сообщения проходит без WTF-моментов. Баланс виден всегда.

---

### Task 1.4: Monitoring & alerts (1 день)

**Зачем:** при фикше writeUsageLog мы теперь видим реальные затраты. Но если в прод попадёт новый bug с проглатыванием логов — узнаем только через месяц, когда сверим с инвойсом. Нужен ранний сигнал.

**Что ставить:**

1. **Sentry** (free tier 5k errors/mo) для aggregator:
   - `SENTRY_DSN` в `.env`
   - Захват `[billing] charge transaction failed` errors → instant alert в телеграм
   - Захват всех uncaught errors в chat route и billing module

2. **UptimeRobot** (free tier) на:
   - `https://ask.gptweb.ru/` (HTTP 200)
   - `https://gptweb.ru/` (HTTP 200)
   - `https://ask.gptweb.ru/api/health` (если эндпоинта нет — добавить, простой `return 'ok'`)

3. **Daily cron: API-costs Δ% alert.**
   - Каждое утро: GET `/admin/api/finance/api-costs?from=<current month>&to=<current month>`
   - Если для текущего месяца `|Δ%| > 30%` для какого-то провайдера → email через Brevo на `NOTIFY_EMAIL`
   - Cron на VPS#1, скрипт в `scripts/monitoring/check-api-delta.sh`

**Критерий готовности:** если завтра writeUsageLog снова сломается — узнаю в тот же день, не через месяц.

---

### Task 1.5: Activation rate measurement (0.5 дня — замеры до и после)

**Зачем:** нужен baseline до UI-simplification и onboarding, чтобы измерить эффект.

**Метрика:** `activation_rate = users_with_first_message_within_7d / registered_users_cohort` за последние 30 дней (rolling).

**Реализация:**

- Страница в админке `/admin/economics/activation`:
  - Cohort table: месяц регистрации × activation rate × sample size
  - Линейный график за 90 дней
- SQL: `users` join `usage_logs` на `user_id` + `created_at` within 7d of user.created_at
- Baseline замер: **ДО** задач 1.2 и 1.3 → записать число в memory/notes
- После задач 1.2-1.3 ждать 14 дней → повторный замер
- Цель: activation +20% минимум

**Критерий готовности:** два измеренных числа через 2 недели.

---

## Phase 1 — Summary

| #         | Task                            | Days         | Deps                               |
| --------- | ------------------------------- | ------------ | ---------------------------------- |
| 1.1       | Merge upstream LobeChat         | 1-2          | —                                  |
| 1.2       | Simplify LobeChat UI            | 2-3          | 1.1 (merge первый, потом упрощать) |
| 1.3       | Onboarding flow                 | 1            | 1.1                                |
| 1.4       | Monitoring & alerts             | 1            | — (можно параллельно)              |
| 1.5       | Activation baseline + dashboard | 0.5          | — (замер baseline ДО 1.2)          |
| **Итого** |                                 | **6-8 дней** |                                    |

**Рекомендуемый порядок (с параллелизмом):**

- День 1: Task 1.1 старт (upstream merge), параллельно Task 1.5 baseline замер
- День 2: Task 1.1 finish + deploy, старт Task 1.4 (monitoring)
- День 3-4: Task 1.2 (simplify UI)
- День 5: Task 1.3 (onboarding) + Task 1.4 finish
- День 6: deploy всего, smoke-test, документация
- Неделя 2: наблюдаем метрики, точечные правки

---

## Phase 2 — При росте revenue до \~$100-300/мес (4-6 недель после Phase 1)

Запускать при условии: Phase 1 завершён, activation rate +15% минимум, появились живые платящие юзеры.

### Task 2.1: Referral program (3-5 дней)

"Пригласи друга — получи +50 кредитов когда он сделает первый платёж."

- DB: `referrals(referrer_user_id, referred_user_id, status, credits_awarded_at)`
- Landing: `?ref=<user_id>` sets cookie, при регистрации ставит `users.referred_by`
- Hook на первый `billing_payments.status=succeeded` → начислить 50 credits рефереру + уведомление
- Page `/app/referrals` в LobeChat UI — link + статистика

### Task 2.2: Pricing A/B test (continuous, 2-4 недели)

- Split traffic на landing между 2 вариантами цен (например 1490₽ vs 1990₽ за Pro)
- Next.js middleware на cookie split
- Conversion metrics → Яндекс.Метрика events
- Решение по winner через 2 недели при >100 impressions на вариант

### Task 2.3: Subscription lifecycle hooks (2-3 дня)

- Email-напоминание за 3 дня до окончания подписки (Brevo)
- Auto-renew reminder (если юзер не включил recurring)
- Post-churn survey: "Почему отменил?" — 3 варианта + free-text

---

## Phase 3 — При $1500+/мес revenue

Тогда запускать:

1. **Merge upstream cadence**: раз в 3-4 недели `git fetch upstream && merge` в worktree.
2. **Financial dashboard expansion** в `/admin/economics`: MRR, churn, cohort LTV, CAC by channel.
3. **Human editor для топ-SEO статей** — $200-400/мес, полирует 2-3 статьи/неделю от blog auto-generator.
4. **Яндекс.Директ test** — $300-500 на 2-3 недели, замер CPA и LTV:CAC.
5. **Thin custom chat UI** (если UX-simplification из Phase 1 недостаточно): 3-4 недели — `chat.gptweb.ru` как минимальный chat layer поверх LobeChat backend. **Альтернатива** миграции на OpenWebUI, сохраняет инвестиции в billing.
6. **B2B features** (если запрашивают): teams, shared workspaces, SSO, API-ключи для своего приложения.
7. **Пересмотреть migration на OpenWebUI** только если: (a) UX доказан как #1 bottleneck, (b) есть B2B-запрос на SSO/RBAC, (c) licensing-клауза ок (готовы к footer или enterprise).

---

## Что НЕ делаем

- **НЕ мигрируем** на OpenWebUI (licensing + stack + opportunity cost)
- **НЕ переписываем** billing (только что починили, работает)
- **НЕ добавляем** новых провайдеров без реального спроса
- **НЕ делаем** Python-бэкенд
- **НЕ трогаем** admin panel архитектуру пока Phase 1 не завершён

---

## Метрики успеха Phase 1

| Метрика                       | Baseline (24.04) | Цель через 4 нед                   |
| ----------------------------- | ---------------- | ---------------------------------- |
| Activation rate (1 msg in 7d) | TBD (замерить)   | +20%                               |
| Conversion (register → paid)  | \~4% (2/49)      | +50% (до 6%)                       |
| API cost / revenue            | 61%              | <50% (better margin)               |
| Активных monitoring alerts    | 0                | 3+ (uptime, sentry, api-delta)     |
| Upstream lag (commits behind) | 891              | <100 (after merge, 1x/month after) |

---

## Коммит-план для документа

Этот план сохраняется в `docs/plans/2026-04-24-ux-growth-plan.md` на canary. Правится по мере выполнения — галочки/заметки по задачам.
