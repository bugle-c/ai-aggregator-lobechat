# Market Proxy + LobeHub Branding Removal

**Date:** 2026-03-01
**Status:** Approved

## Problem

WebGPT (ask.gptweb.ru) has an empty agent catalog because `market.gptweb.ru` doesn't serve anything. Additionally, several UI elements leak LobeHub/LobeChat branding.

## Solution

### 1. Caddy reverse proxy

Add `market.gptweb.ru` block to Caddyfile on VPS #1 (194.113.209.247), proxying to `market.lobehub.com`. This gives 685+ community agents instantly while keeping all requests under our domain.

### 2. Branding fixes

Replace LobeHub GitHub links in:
- `packages/const/src/url.ts` — AGENTS_INDEX_GITHUB, AGENTS_INDEX_GITHUB_ISSUE
- Community detail Nav components — "View Source Code" and "Report Issue" links

Create Agent button left as-is (user decision).

### 3. Rebuild & deploy

Rebuild `lobechat-custom:latest` Docker image and restart container.
