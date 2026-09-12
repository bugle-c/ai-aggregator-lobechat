# Seedance: цена по разрешению, все форматы, Mini + чип «Качество»

Владелец сравнил панель донора (meigen) с нашей на пресете
`trend-2091396663718117706` и одобрил пакет 1–3 (2026-09-12). Пункт 4
(референсы картинок/видео для Mini и полной 2.0) — отдельным заходом.

## Факты (WaveSpeed docs, 2026-09-12)

| модель | 480p | 720p | 1080p | 4k | $/с |
|---|---|---|---|---|---|
| Seedance 2.0 Mini | 0.06 | 0.12 | 0.30 | 0.60 |
| Seedance 2.0 Fast | 0.10 | 0.20 | 0.50 | 1.00 |
| Seedance 2.0 | 0.12 | 0.24 | 0.60 | 1.20 |

Множитель к 720p одинаков для всей семьи: 480p ×0.5 · 720p ×1 · 1080p ×2.5 · 4k ×5.
Форматы: 16:9, 9:16, 4:3, 3:4, 1:1, 21:9. Наша ставка Fast была 0.50 (цена 1080p) без
множителя → 720p по умолчанию считалось в 2.5× дороже себестоимости.

## 1. Цена по разрешению
- `compute-cost.ts`: `VideoUsage.resolution?`, `RESOLUTION_PRICE_FACTORS` по префиксу
  `bytedance/seedance-2.0`, `videoResolutionFactor(modelId, resolution)` (default 1),
  применяется в `computeBaseCostUsdFromRate`. Юнит-тесты.
- `quote.videoCost` принимает `resolution`; `chargeBeforeGenerate` берёт
  `params.params.resolution`; `chargeAfterGenerate` получает `resolution` из
  `batch.config` (вебхук-роут); клиент передаёт `parameters.resolution` в превью.
- Ставки (`ai_aggregator.model_rates`, операторский SQL после деплоя): Fast 0.20 (high),
  2.0 полная 0.24 (high), Mini 0.12 (**mid** — дешёвый вход с Basic).

## 2. Форматы
`seedance20Params.aspectRatio.enum` = все 6; `resolution.enum` + `4k`.

## 3. Mini + чип «Качество»
- Карточки `bytedance/seedance-2.0-mini/text-to-video` (enabled) и `…/image-to-video`
  (disabled, paired) в `wavespeed.ts`; пара в `pairedEndpoint.ts`; строки ставок.
- `modelFamilies.ts`: семья Seedance 2.0 = Mini / Fast / Pro (полная). `ModelSettingsChip`
  рендерит `Segmented` качества рядом с чипом модели, когда текущая модель в семье;
  переключение идёт через тот же `pick` (лок → апселл, стиль/промпт/фото сохраняются).
  Несовпадение с рекомендацией стиля **внутри семьи** не считается несовпадением.
