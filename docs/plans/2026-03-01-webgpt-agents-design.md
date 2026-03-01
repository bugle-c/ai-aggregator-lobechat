# WebGPT Custom Agents — Featured at Top of Catalog

**Date:** 2026-03-01
**Status:** Approved

## Problem

Agent catalog shows only community agents from LobeHub market. Need 10 WebGPT-branded agents focused on Russian market, always displayed first.

## Solution

### Approach: JSON config + DiscoverService injection

1. Create `src/const/webgpt-agents.ts` with 10 agent definitions (full system role prompts in Russian)
2. Modify `getAssistantList()` in `src/server/services/discover/index.ts` to prepend WebGPT agents before market results
3. All agents authored by "WebGPT", Russian-language system prompts

### Agents

1. Копирайтер — тексты на русском
2. SEO-специалист — Яндекс + Google
3. SMM-менеджер — VK, Telegram, Дзен
4. Юрист-консультант — законодательство РФ
5. Бухгалтер — налоги, отчётность
6. HR-специалист — подбор персонала, hh.ru
7. Менеджер по продажам — скрипты, КП
8. Программист — Python, JS, SQL
9. Аналитик данных — SQL, дашборды, метрики
10. Email-маркетолог — рассылки, цепочки
