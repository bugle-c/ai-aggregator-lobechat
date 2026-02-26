# @gptwebrubot Rewrite — Design Doc

## Goal

Rewrite the @gptwebrubot Telegram bot as a standalone project that uses LobeChat HTTP API as its backend, replacing the old ai-aggregator monorepo architecture.

## Architecture

Standalone Bun/TypeScript project. The bot is a thin client of LobeChat — it calls the same HTTP APIs as the web UI. All conversations are stored in LobeChat's DB and visible in the web interface.

```
Telegram User
     |
grammY Bot (Bun, systemd, VPS #1)
     |
LobeChat HTTP API (localhost:3210)
+-- /trpc/lambda/*          -- message/topic CRUD, billing
+-- /webapi/chat/[provider] -- AI streaming (SSE)
+-- /api/auth/*             -- Better Auth (user creation)
     |
LobeChat PG + RustFS + AI Providers
```

### Auth

- XOR-encoded `X-lobe-chat-auth` header with `{ userId }` payload
- XOR key: `LobeHub · LobeHub`
- Bot stores `telegram_id -> lobechat_user_id` mapping in local SQLite (`bun:sqlite`)

### User Creation

- New Telegram user → bot creates LobeChat account via Better Auth API (`/api/auth/sign-up/email`)
- Email: `tg_<telegram_id>@bot.gptweb.ru`, random password
- Bot stores resulting userId in SQLite mapping

## Features (Full Parity with Old Bot)

| Feature                  | Implementation                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------- |
| Text chat with streaming | `sendMessageInServer` tRPC + `/webapi/chat/[provider]` SSE → throttled editMessageText |
| `/model`                 | Model list from config, store preference in SQLite                                     |
| `/new`                   | Create new topic in same session                                                       |
| `/balance`               | tRPC `spend.getUsageSummary`                                                           |
| `/plan`                  | tRPC `subscription.getPlans` + payment link                                            |
| `/history`               | tRPC `topic.query`                                                                     |
| `/help`                  | Static text                                                                            |
| Voice/video notes        | OpenAI Whisper API directly → text → chat handler                                      |
| Photos/documents         | Upload to RustFS (S3) → vision model auto-switch                                       |
| Inline queries           | Direct `/webapi/chat/[provider]` call, non-streaming, no DB save                       |

## Message Flow

1. Telegram user sends text
2. Bot calls tRPC `aiChat.sendMessageInServer` → creates user/assistant message records, returns history
3. Bot POSTs `/webapi/chat/[provider]` with history → SSE stream
4. Bot parses SSE chunks → throttled `editMessageText` every 1000ms
5. On completion: tRPC `message.update` → save final response to DB
6. Usage tracking happens automatically (Phase 3 middleware in webapi route)

## Tech Stack

- **Runtime**: Bun
- **Framework**: grammY
- **Local DB**: bun:sqlite (telegram_id ↔ lobechat_user_id + preferred_model)
- **HTTP**: native fetch
- **Deploy**: systemd on VPS #1 (same host as LobeChat, localhost access)

## Project Structure

```
gptwebrubot/
├── src/
│   ├── index.ts           # Entry point, graceful shutdown
│   ├── bot.ts             # grammY setup, middleware, command registration
│   ├── config.ts          # Env validation
│   ├── db.ts              # SQLite: telegram_id ↔ lobechat mapping
│   ├── lobechat/
│   │   ├── auth.ts        # XOR encoding, user creation via Better Auth
│   │   ├── trpc.ts        # tRPC HTTP client wrapper
│   │   ├── chat.ts        # /webapi/chat SSE streaming client
│   │   └── s3.ts          # RustFS upload for photos
│   ├── handlers/
│   │   ├── start.ts       # /start
│   │   ├── chat.ts        # Text messages (streaming)
│   │   ├── model.ts       # /model
│   │   ├── balance.ts     # /balance
│   │   ├── plan.ts        # /plan
│   │   ├── new.ts         # /new
│   │   ├── history.ts     # /history
│   │   ├── voice.ts       # Voice/video_note → Whisper
│   │   ├── photo.ts       # Photos → RustFS → vision
│   │   └── inline.ts      # Inline queries
│   └── middleware/
│       └── auth.ts        # telegram_id → lobechat user resolution
├── package.json
├── tsconfig.json
└── KNOWLEDGE.md
```

## Environment Variables

```
TELEGRAM_BOT_TOKEN=...
LOBECHAT_BASE_URL=http://localhost:3210
OPENAI_API_KEY=...          # For Whisper STT
RUSTFS_ACCESS_KEY=admin
RUSTFS_SECRET_KEY=...
RUSTFS_ENDPOINT=http://localhost:9000
RUSTFS_BUCKET=lobe
```

## Key Decisions

- **SQLite for mapping** — lightweight, no external DB dependency, bun:sqlite is built-in
- **XOR auth** — same mechanism LobeChat web UI uses, no need for session cookies
- **Whisper via OpenAI directly** — LobeChat has no STT endpoint, same approach as old bot
- **RustFS for photos** — same S3 storage LobeChat uses, photos accessible in web UI
- **Long polling** — same as old bot, simpler than webhook setup
- **Fail-open on errors** — billing check failures don't block users (inherited from Phase 3)
