# @gptwebrubot Rewrite — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite @gptwebrubot as a standalone Bun/grammY bot that uses LobeChat's webapi for AI streaming and direct PostgreSQL access for data management.

**Architecture:** Standalone Bun project on VPS #1 (same host as LobeChat). Direct PG access to LobeChat DB (localhost:5433) for user/message/topic/billing CRUD. XOR-encoded HTTP calls to `/webapi/chat/[provider]` for AI streaming. Local SQLite for telegram_id→lobechat_user_id mapping.

**Tech Stack:** Bun, TypeScript, grammY, postgres (postgres.js), bun:sqlite, OpenAI SDK (Whisper), @aws-sdk/client-s3 (RustFS upload)

**Key reference files:**

- Old bot handlers: `/home/deploy/projects/ai-aggregator/bot/src/handlers/`
- LobeChat DB schemas: `/home/deploy/projects/ai-aggregator-lobechat/packages/database/src/schemas/`
- XOR encoding: `/home/deploy/projects/ai-aggregator-lobechat/packages/utils/src/client/xor-obfuscation.ts`
- SSE format: event types `text`, `reasoning`, `usage`, `stop`, `error` — data is JSON
- LobeChat webapi: `/home/deploy/projects/ai-aggregator-lobechat/src/app/(backend)/webapi/chat/[provider]/route.ts`
- Billing tables: `/home/deploy/projects/ai-aggregator-lobechat/packages/database/src/schemas/billing.ts`

---

### Task 1: Project Scaffolding

**Files:**

- Create: `gptwebrubot/package.json`
- Create: `gptwebrubot/tsconfig.json`
- Create: `gptwebrubot/.gitignore`
- Create: `gptwebrubot/.env.example`

**Step 1: Create project directory and init**

```bash
mkdir -p /home/deploy/projects/gptwebrubot
cd /home/deploy/projects/gptwebrubot
/home/deploy/.bun/bin/bun init -y
```

**Step 2: Install dependencies**

```bash
/home/deploy/.bun/bin/bun add grammy postgres openai @aws-sdk/client-s3
/home/deploy/.bun/bin/bun add -d @types/node typescript
```

- `grammy` — Telegram bot framework
- `postgres` — postgres.js PG client (zero-dep, promise-based)
- `openai` — OpenAI SDK (for Whisper STT only)
- `@aws-sdk/client-s3` — S3 client for RustFS photo upload

**Step 3: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["bun-types"]
  },
  "include": ["src"]
}
```

**Step 4: Write .gitignore**

```
node_modules/
dist/
.env
*.db
```

**Step 5: Write .env.example**

```env
TELEGRAM_BOT_TOKEN=
LOBECHAT_BASE_URL=http://localhost:3210
LOBECHAT_DB_URL=postgres://postgres:PASSWORD@127.0.0.1:5433/lobechat
OPENAI_API_KEY=
RUSTFS_ENDPOINT=http://localhost:9000
RUSTFS_ACCESS_KEY=admin
RUSTFS_SECRET_KEY=
RUSTFS_BUCKET=lobe
```

**Step 6: Update package.json scripts**

```json
{
  "scripts": {
    "start": "bun run src/index.ts",
    "dev": "bun --watch src/index.ts"
  }
}
```

**Step 7: Create src directory structure**

```bash
mkdir -p src/{lobechat,handlers,middleware}
```

**Step 8: Commit**

```bash
git init
git add -A
git commit -m "feat: init gptwebrubot project with dependencies"
```

---

### Task 2: Config & Database Layer

**Files:**

- Create: `gptwebrubot/src/config.ts`
- Create: `gptwebrubot/src/db.ts`

**Step 1: Write config.ts with env validation**

```typescript
// src/config.ts

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const config = {
  telegramToken: requireEnv('TELEGRAM_BOT_TOKEN'),
  lobechatBaseUrl: optionalEnv('LOBECHAT_BASE_URL', 'http://localhost:3210'),
  lobechatDbUrl: requireEnv('LOBECHAT_DB_URL'),
  openaiApiKey: requireEnv('OPENAI_API_KEY'),
  rustfsEndpoint: optionalEnv('RUSTFS_ENDPOINT', 'http://localhost:9000'),
  rustfsAccessKey: optionalEnv('RUSTFS_ACCESS_KEY', 'admin'),
  rustfsSecretKey: requireEnv('RUSTFS_SECRET_KEY'),
  rustfsBucket: optionalEnv('RUSTFS_BUCKET', 'lobe'),
  webUrl: optionalEnv('WEB_URL', 'https://ask.gptweb.ru'),
} as const;
```

**Step 2: Write db.ts — SQLite for telegram mapping + PG for LobeChat**

```typescript
// src/db.ts
import { Database } from 'bun:sqlite';
import postgres from 'postgres';
import { config } from './config';

// --- SQLite: telegram_id <-> lobechat user mapping ---
const sqlite = new Database('bot.db');
sqlite.run(`
  CREATE TABLE IF NOT EXISTS telegram_users (
    telegram_id TEXT PRIMARY KEY,
    lobechat_user_id TEXT NOT NULL,
    preferred_model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    current_topic_id TEXT
  )
`);

export interface TelegramUser {
  telegram_id: string;
  lobechat_user_id: string;
  preferred_model: string;
  current_topic_id: string | null;
}

export function getTelegramUser(telegramId: string): TelegramUser | null {
  return sqlite
    .query<TelegramUser, [string]>('SELECT * FROM telegram_users WHERE telegram_id = ?')
    .get(telegramId);
}

export function upsertTelegramUser(telegramId: string, lobechatUserId: string): void {
  sqlite.run(
    `INSERT INTO telegram_users (telegram_id, lobechat_user_id)
     VALUES (?, ?)
     ON CONFLICT(telegram_id) DO UPDATE SET lobechat_user_id = excluded.lobechat_user_id`,
    [telegramId, lobechatUserId],
  );
}

export function setPreferredModel(telegramId: string, model: string): void {
  sqlite.run('UPDATE telegram_users SET preferred_model = ? WHERE telegram_id = ?', [
    model,
    telegramId,
  ]);
}

export function setCurrentTopic(telegramId: string, topicId: string | null): void {
  sqlite.run('UPDATE telegram_users SET current_topic_id = ? WHERE telegram_id = ?', [
    topicId,
    telegramId,
  ]);
}

// --- PostgreSQL: LobeChat DB ---
export const pg = postgres(config.lobechatDbUrl, {
  max: 5,
  idle_timeout: 60,
});

export async function closeDatabases(): Promise<void> {
  sqlite.close();
  await pg.end();
}
```

**Step 3: Verify DB connections**

Create a quick test script:

```bash
echo 'import "./config"; import { pg, getTelegramUser } from "./db"; const r = await pg`SELECT count(*) FROM users`; console.log("PG users:", r[0].count); console.log("SQLite test:", getTelegramUser("0")); await pg.end(); process.exit(0);' > src/test-db.ts
```

Run: `/home/deploy/.bun/bin/bun run src/test-db.ts`
Expected: `PG users: <number>` and `SQLite test: null`

Delete test file after verification.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add config validation and database layer (SQLite + PG)"
```

---

### Task 3: LobeChat Auth & User Management

**Files:**

- Create: `gptwebrubot/src/lobechat/auth.ts`
- Create: `gptwebrubot/src/lobechat/queries.ts`

**Step 1: Write auth.ts — XOR encoding + user creation**

```typescript
// src/lobechat/auth.ts
import { pg } from '../db';

const SECRET_XOR_KEY = 'LobeHub \u00b7 LobeHub';

/**
 * XOR-encode payload for X-lobe-chat-auth header.
 * Same algorithm as LobeChat's obfuscatePayloadWithXOR.
 */
export function encodeAuthPayload(payload: { userId: string }): string {
  const jsonString = JSON.stringify(payload);
  const dataBytes = new TextEncoder().encode(jsonString);
  const keyBytes = new TextEncoder().encode(SECRET_XOR_KEY);

  const result = new Uint8Array(dataBytes.length);
  for (let i = 0; i < dataBytes.length; i++) {
    result[i] = dataBytes[i] ^ keyBytes[i % keyBytes.length];
  }

  return btoa(String.fromCharCode(...result));
}

/**
 * Create a LobeChat user + credential account.
 * Returns the new user ID.
 */
export async function createLobechatUser(opts: {
  telegramId: string;
  name: string;
  username?: string;
}): Promise<string> {
  const userId = crypto.randomUUID();
  const email = `tg_${opts.telegramId}@bot.gptweb.ru`;
  const now = new Date();

  // Bcrypt hash of a random password (user won't login via password)
  const randomPassword = crypto.randomUUID();
  const bcryptHash = await Bun.password.hash(randomPassword, { algorithm: 'bcrypt', cost: 10 });

  await pg.begin(async (tx) => {
    // Insert user
    await tx`
      INSERT INTO users (id, email, normalized_email, full_name, username, email_verified, is_onboarded, created_at, updated_at, last_active_at)
      VALUES (${userId}, ${email}, ${email.toLowerCase()}, ${opts.name}, ${opts.username || null}, true, true, ${now}, ${now}, ${now})
    `;

    // Insert credential account (required by Better Auth)
    await tx`
      INSERT INTO accounts (id, user_id, account_id, provider_id, password, created_at, updated_at)
      VALUES (${crypto.randomUUID()}, ${userId}, ${email}, 'credential', ${bcryptHash}, ${now}, ${now})
    `;

    // Create inbox session
    await tx`
      INSERT INTO sessions (id, slug, type, user_id, created_at, updated_at, accessed_at)
      VALUES (${crypto.randomUUID()}, 'inbox', 'agent', ${userId}, ${now}, ${now}, ${now})
    `;

    // Create user_billing record (Phase 3: free plan, plan_id=1)
    await tx`
      INSERT INTO user_billing (user_id, plan_id, tokens_used_month, token_balance, billing_reset_date, created_at, updated_at)
      VALUES (${userId}, 1, 0, 0, ${new Date(now.getFullYear(), now.getMonth() + 1, 1)}, ${now}, ${now})
      ON CONFLICT (user_id) DO NOTHING
    `;
  });

  return userId;
}
```

**Step 2: Write queries.ts — LobeChat DB queries**

```typescript
// src/lobechat/queries.ts
import { pg } from '../db';

// --- Sessions ---

export async function getInboxSessionId(userId: string): Promise<string | null> {
  const rows = await pg`
    SELECT id FROM sessions WHERE user_id = ${userId} AND slug = 'inbox' LIMIT 1
  `;
  return rows[0]?.id || null;
}

// --- Topics ---

export async function createTopic(
  userId: string,
  sessionId: string,
  title: string,
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date();
  await pg`
    INSERT INTO topics (id, title, session_id, user_id, created_at, updated_at, accessed_at)
    VALUES (${id}, ${title}, ${sessionId}, ${userId}, ${now}, ${now}, ${now})
  `;
  return id;
}

export async function getRecentTopics(
  userId: string,
  limit = 10,
): Promise<Array<{ id: string; title: string; updated_at: Date }>> {
  return pg`
    SELECT id, title, updated_at FROM topics
    WHERE user_id = ${userId}
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `;
}

// --- Messages ---

export interface ChatMessage {
  id: string;
  role: string;
  content: string | null;
  model: string | null;
  provider: string | null;
  created_at: Date;
}

export async function getTopicMessages(topicId: string, userId: string): Promise<ChatMessage[]> {
  return pg`
    SELECT id, role, content, model, provider, created_at FROM messages
    WHERE topic_id = ${topicId} AND user_id = ${userId}
    ORDER BY created_at ASC
  `;
}

export async function insertMessage(opts: {
  userId: string;
  topicId: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model?: string;
  provider?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date();
  await pg`
    INSERT INTO messages (id, role, content, model, provider, user_id, topic_id, session_id, created_at, updated_at, accessed_at)
    VALUES (${id}, ${opts.role}, ${opts.content}, ${opts.model || null}, ${opts.provider || null},
            ${opts.userId}, ${opts.topicId}, ${opts.sessionId}, ${now}, ${now}, ${now})
  `;
  return id;
}

export async function updateMessageContent(messageId: string, content: string): Promise<void> {
  await pg`UPDATE messages SET content = ${content}, updated_at = now() WHERE id = ${messageId}`;
}

// --- Billing ---

export interface BillingInfo {
  plan_name: string;
  plan_slug: string;
  token_limit: number;
  tokens_used_month: number;
  token_balance: number;
  billing_reset_date: Date;
}

export async function getBillingInfo(userId: string): Promise<BillingInfo | null> {
  const rows = await pg`
    SELECT bp.name as plan_name, bp.slug as plan_slug, bp.token_limit,
           ub.tokens_used_month, ub.token_balance, ub.billing_reset_date
    FROM user_billing ub
    JOIN billing_plans bp ON bp.id = ub.plan_id
    WHERE ub.user_id = ${userId}
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function recordTokenUsage(userId: string, tokens: number): Promise<void> {
  await pg`
    UPDATE user_billing
    SET tokens_used_month = tokens_used_month + ${tokens}, updated_at = now()
    WHERE user_id = ${userId}
  `;
}

export interface PlanInfo {
  id: number;
  slug: string;
  name: string;
  price_rub: number;
  token_limit: number;
}

export async function getPlans(): Promise<PlanInfo[]> {
  return pg`SELECT id, slug, name, price_rub, token_limit FROM billing_plans ORDER BY price_rub`;
}
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add LobeChat auth (XOR encoding, user creation) and DB queries"
```

---

### Task 4: SSE Chat Client

**Files:**

- Create: `gptwebrubot/src/lobechat/chat.ts`

**Step 1: Write SSE streaming client for /webapi/chat/\[provider]**

```typescript
// src/lobechat/chat.ts
import { config } from '../config';
import { encodeAuthPayload } from './auth';

export interface ChatRequestMessage {
  role: 'user' | 'assistant' | 'system';
  content:
    | string
    | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
}

export interface ChatStreamChunk {
  type: 'text' | 'reasoning' | 'usage' | 'stop' | 'error';
  content?: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  stopReason?: string;
  error?: string;
}

/**
 * Stream chat response from LobeChat webapi.
 * Yields ChatStreamChunk for each SSE event.
 */
export async function* streamChat(opts: {
  userId: string;
  provider: string;
  model: string;
  messages: ChatRequestMessage[];
  temperature?: number;
}): AsyncGenerator<ChatStreamChunk> {
  const authToken = encodeAuthPayload({ userId: opts.userId });

  const response = await fetch(`${config.lobechatBaseUrl}/webapi/chat/${opts.provider}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-lobe-chat-auth': authToken,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.7,
      stream: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    yield { type: 'error', error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    yield { type: 'error', error: 'No response body' };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE events (separated by double newline)
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        const chunk = parseSSEEvent(part);
        if (chunk) yield chunk;
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      const chunk = parseSSEEvent(buffer);
      if (chunk) yield chunk;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSSEEvent(raw: string): ChatStreamChunk | null {
  let eventType = '';
  let data = '';

  for (const line of raw.split('\n')) {
    if (line.startsWith('event: ')) {
      eventType = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      data += (data ? '\n' : '') + line.slice(6);
    } else if (line === 'data:') {
      data += '\n';
    }
  }

  if (!eventType && !data) return null;

  try {
    switch (eventType) {
      case 'text':
        return { type: 'text', content: JSON.parse(data) };

      case 'reasoning':
        return { type: 'reasoning', content: JSON.parse(data) };

      case 'usage':
        return { type: 'usage', usage: JSON.parse(data) };

      case 'stop':
        return { type: 'stop', stopReason: JSON.parse(data) };

      case 'error':
        const errObj = JSON.parse(data);
        return { type: 'error', error: errObj.message || JSON.stringify(errObj) };

      default:
        // Ignore unknown events (tool_calls, grounding, speed, etc.)
        return null;
    }
  } catch {
    // If data is not JSON, treat as text
    if (eventType === 'text' || !eventType) {
      return { type: 'text', content: data };
    }
    return null;
  }
}
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: add SSE streaming chat client for LobeChat webapi"
```

---

### Task 5: Whisper STT & S3 Upload Clients

**Files:**

- Create: `gptwebrubot/src/lobechat/whisper.ts`
- Create: `gptwebrubot/src/lobechat/s3.ts`

**Step 1: Write whisper.ts — voice transcription**

```typescript
// src/lobechat/whisper.ts
import OpenAI from 'openai';
import { config } from '../config';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

export async function transcribeAudio(buffer: Buffer, filename: string): Promise<string> {
  const file = new File([buffer], filename, { type: 'audio/ogg' });

  const response = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    language: 'ru',
  });

  return response.text;
}
```

**Step 2: Write s3.ts — RustFS photo upload**

```typescript
// src/lobechat/s3.ts
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config';

const s3 = new S3Client({
  endpoint: config.rustfsEndpoint,
  region: 'us-east-1',
  credentials: {
    accessKeyId: config.rustfsAccessKey,
    secretAccessKey: config.rustfsSecretKey,
  },
  forcePathStyle: true,
});

/**
 * Upload a file to RustFS and return the public URL.
 */
export async function uploadToS3(opts: {
  buffer: Buffer;
  filename: string;
  contentType: string;
  userId: string;
}): Promise<string> {
  const key = `bot/${opts.userId}/${Date.now()}_${opts.filename}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: config.rustfsBucket,
      Key: key,
      Body: opts.buffer,
      ContentType: opts.contentType,
    }),
  );

  // RustFS public URL (accessible via network-service container port mapping)
  return `${config.rustfsEndpoint}/${config.rustfsBucket}/${key}`;
}
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add Whisper STT and RustFS S3 upload clients"
```

---

### Task 6: Bot Setup & Auth Middleware

**Files:**

- Create: `gptwebrubot/src/types.ts`
- Create: `gptwebrubot/src/middleware/auth.ts`
- Create: `gptwebrubot/src/bot.ts`
- Create: `gptwebrubot/src/models.ts`

**Step 1: Write types.ts**

```typescript
// src/types.ts
import { Context } from 'grammy';
import type { TelegramUser } from './db';

export interface BotContext extends Context {
  tgUser: TelegramUser;
  lobechatUserId: string;
}
```

**Step 2: Write models.ts — available models list**

```typescript
// src/models.ts

export interface ModelDef {
  name: string; // Model ID sent to API
  displayName: string; // Display name for Telegram
  provider: string; // LobeChat provider name (url path)
  category: 'fast' | 'smart' | 'cheap' | 'reasoning';
  description: string;
  supportsVision?: boolean;
}

export const MODELS: ModelDef[] = [
  // OpenAI (direct)
  {
    name: 'gpt-4o',
    displayName: 'GPT-4o',
    provider: 'openai',
    category: 'smart',
    description: 'Флагман OpenAI — баланс скорости и качества',
    supportsVision: true,
  },
  {
    name: 'gpt-4o-mini',
    displayName: 'GPT-4o Mini',
    provider: 'openai',
    category: 'fast',
    description: 'Быстрая и дешёвая модель для простых задач',
    supportsVision: true,
  },
  // Anthropic (direct)
  {
    name: 'claude-sonnet-4-5-20250514',
    displayName: 'Claude Sonnet 4.5',
    provider: 'anthropic',
    category: 'smart',
    description: 'Мощная модель Anthropic — код и анализ',
    supportsVision: true,
  },
  {
    name: 'claude-haiku-4-5-20251001',
    displayName: 'Claude Haiku 4.5',
    provider: 'anthropic',
    category: 'fast',
    description: 'Быстрая модель Anthropic',
    supportsVision: true,
  },
  // OpenRouter
  {
    name: 'deepseek/deepseek-chat',
    displayName: 'DeepSeek Chat',
    provider: 'openrouter',
    category: 'cheap',
    description: 'Дешёвая модель — хорошее качество за минимальную цену',
  },
  {
    name: 'deepseek/deepseek-reasoner',
    displayName: 'DeepSeek Reasoner (R1)',
    provider: 'openrouter',
    category: 'reasoning',
    description: 'Модель с цепочкой рассуждений',
  },
  {
    name: 'google/gemini-2.0-flash-001',
    displayName: 'Gemini 2.0 Flash',
    provider: 'openrouter',
    category: 'fast',
    description: 'Быстрая модель Google',
    supportsVision: true,
  },
];

export function getModelByName(name: string): ModelDef | undefined {
  return MODELS.find((m) => m.name === name);
}

export const DEFAULT_MODEL = 'gpt-4o-mini';

const CATEGORY_LABELS: Record<string, string> = {
  fast: 'Быстрые',
  smart: 'Умные',
  cheap: 'Экономичные',
  reasoning: 'Рассуждающие',
};

const CATEGORY_ORDER = ['fast', 'smart', 'cheap', 'reasoning'];

export { CATEGORY_LABELS, CATEGORY_ORDER };
```

**Step 3: Write middleware/auth.ts**

```typescript
// src/middleware/auth.ts
import { NextFunction } from 'grammy';
import { getTelegramUser, upsertTelegramUser } from '../db';
import { createLobechatUser } from '../lobechat/auth';
import type { BotContext } from '../types';

export async function authMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
  if (!ctx.from) return;

  const telegramId = String(ctx.from.id);
  let tgUser = getTelegramUser(telegramId);

  if (!tgUser) {
    // Auto-create LobeChat user
    const name = buildDisplayName(ctx.from);
    const lobechatUserId = await createLobechatUser({
      telegramId,
      name,
      username: ctx.from.username,
    });
    upsertTelegramUser(telegramId, lobechatUserId);
    tgUser = getTelegramUser(telegramId)!;
  }

  ctx.tgUser = tgUser;
  ctx.lobechatUserId = tgUser.lobechat_user_id;
  return next();
}

function buildDisplayName(from: BotContext['from']): string {
  if (!from) return 'Telegram User';
  const parts: string[] = [];
  if (from.first_name) parts.push(from.first_name);
  if (from.last_name) parts.push(from.last_name);
  return parts.length > 0 ? parts.join(' ') : from.username || 'Telegram User';
}
```

**Step 4: Write bot.ts — grammY setup (handlers registered later)**

```typescript
// src/bot.ts
import { Bot } from 'grammy';
import { config } from './config';
import { authMiddleware } from './middleware/auth';
import type { BotContext } from './types';

let bot: Bot<BotContext> | null = null;

export function createBot(): Bot<BotContext> {
  const instance = new Bot<BotContext>(config.telegramToken);

  // Auth middleware — runs for all updates
  instance.use(authMiddleware);

  // Error handler
  instance.catch((err) => {
    console.error(`Error handling update ${err.ctx.update.update_id}:`, err.error);
    err.ctx.reply('Произошла ошибка. Попробуйте позже.').catch(() => {});
  });

  return instance;
}

export async function startBot(): Promise<void> {
  bot = createBot();

  // Register handlers (imported in index.ts)
  const { registerHandlers } = await import('./registerHandlers');
  registerHandlers(bot);

  await bot.api.setMyCommands([
    { command: 'start', description: 'Начать работу' },
    { command: 'new', description: 'Новый диалог' },
    { command: 'model', description: 'Выбрать модель' },
    { command: 'balance', description: 'Баланс и лимиты' },
    { command: 'history', description: 'История диалогов' },
    { command: 'plan', description: 'Тарифные планы' },
    { command: 'help', description: 'Помощь' },
  ]);

  bot.start({
    onStart: (info) => console.info(`Bot started as @${info.username}`),
  });
}

export async function stopBot(): Promise<void> {
  if (bot) {
    await bot.stop();
    bot = null;
    console.info('Bot stopped');
  }
}
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add bot setup, auth middleware, and models config"
```

---

### Task 7: Chat Handler (Streaming)

**Files:**

- Create: `gptwebrubot/src/handlers/chat.ts`

This is the core handler. Replicates the old bot's streaming pattern.

**Step 1: Write handlers/chat.ts**

```typescript
// src/handlers/chat.ts
import type { BotContext } from '../types';
import { setCurrentTopic } from '../db';
import {
  getInboxSessionId,
  createTopic,
  getTopicMessages,
  insertMessage,
  updateMessageContent,
  recordTokenUsage,
} from '../lobechat/queries';
import { streamChat, type ChatRequestMessage } from '../lobechat/chat';
import { getModelByName, DEFAULT_MODEL } from '../models';

const TG_TEXT_LIMIT = 4096;
const EDIT_INTERVAL_MS = 1000;

export async function chatHandler(ctx: BotContext): Promise<void> {
  const messageText = (ctx.message as any)?.text;
  if (!messageText) return;

  await ctx.replyWithChatAction('typing');

  const userId = ctx.lobechatUserId;
  const telegramId = String(ctx.from!.id);

  // Get or create session + topic
  let sessionId = await getInboxSessionId(userId);
  if (!sessionId) {
    // Should have been created during user creation, but handle gracefully
    console.error(`No inbox session for user ${userId}`);
    await ctx.reply('Ошибка: сессия не найдена. Попробуйте /start');
    return;
  }

  let topicId = ctx.tgUser.current_topic_id;
  if (!topicId) {
    // Create new topic
    const title = messageText.slice(0, 60) + (messageText.length > 60 ? '...' : '');
    topicId = await createTopic(userId, sessionId, title);
    setCurrentTopic(telegramId, topicId);
  }

  // Insert user message
  const modelName = ctx.tgUser.preferred_model || DEFAULT_MODEL;
  const modelDef = getModelByName(modelName);
  const provider = modelDef?.provider || 'openai';

  await insertMessage({
    userId,
    topicId,
    sessionId,
    role: 'user',
    content: messageText,
  });

  // Load conversation history
  const dbMessages = await getTopicMessages(topicId, userId);
  const chatMessages: ChatRequestMessage[] = dbMessages.map((m) => ({
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content || '',
  }));

  // Create placeholder assistant message
  const assistantMsgId = await insertMessage({
    userId,
    topicId,
    sessionId,
    role: 'assistant',
    content: '',
    model: modelName,
    provider,
  });

  // Stream AI response
  let fullText = '';
  let sentMessage: { chat: { id: number }; message_id: number } | null = null;
  let lastEditTime = 0;
  let editTimer: ReturnType<typeof setTimeout> | null = null;
  let isComplete = false;
  let totalTokens = 0;

  try {
    const generator = streamChat({ userId, provider, model: modelName, messages: chatMessages });

    for await (const chunk of generator) {
      switch (chunk.type) {
        case 'text': {
          if (chunk.content) fullText += chunk.content;

          if (!sentMessage && fullText.length > 0) {
            sentMessage = await ctx.reply(truncateForTelegram(fullText));
            lastEditTime = Date.now();
          } else if (sentMessage) {
            const now = Date.now();
            if (now - lastEditTime >= EDIT_INTERVAL_MS) {
              if (editTimer) {
                clearTimeout(editTimer);
                editTimer = null;
              }
              await safeEdit(ctx, sentMessage.message_id, fullText);
              lastEditTime = Date.now();
            } else if (!editTimer) {
              const delay = EDIT_INTERVAL_MS - (now - lastEditTime);
              editTimer = setTimeout(async () => {
                editTimer = null;
                if (!isComplete && sentMessage) {
                  await safeEdit(ctx, sentMessage.message_id, fullText);
                  lastEditTime = Date.now();
                }
              }, delay);
            }
          }
          ctx.replyWithChatAction('typing').catch(() => {});
          break;
        }

        case 'reasoning': {
          // Skip reasoning text for now (could show in future)
          break;
        }

        case 'usage': {
          totalTokens = chunk.usage?.totalTokens || 0;
          break;
        }

        case 'stop': {
          isComplete = true;
          if (editTimer) {
            clearTimeout(editTimer);
            editTimer = null;
          }

          if (sentMessage) {
            let finalText = truncateForTelegram(fullText);
            if (totalTokens > 0) {
              const footer = `\n\n<i>${formatTokens(totalTokens)} tokens</i>`;
              if (finalText.length + footer.length <= TG_TEXT_LIMIT) {
                finalText += footer;
              }
            }
            await safeEdit(ctx, sentMessage.message_id, finalText, !!totalTokens);
          } else if (!fullText) {
            await ctx.reply('(Пустой ответ от модели)');
          }
          break;
        }

        case 'error': {
          isComplete = true;
          if (editTimer) {
            clearTimeout(editTimer);
            editTimer = null;
          }
          const errorMsg = chunk.error || 'Unknown error';
          const errorText = `<b>Ошибка:</b> ${escapeHtml(errorMsg)}`;

          if (sentMessage) {
            await safeEdit(ctx, sentMessage.message_id, fullText + '\n\n' + errorText, true);
          } else {
            await ctx.reply(errorText, { parse_mode: 'HTML' });
          }
          break;
        }
      }
    }
  } catch (err: any) {
    isComplete = true;
    if (editTimer) {
      clearTimeout(editTimer);
      editTimer = null;
    }
    console.error('Chat handler error:', err);
    const errorText = `<b>Ошибка:</b> ${escapeHtml(err.message || 'Internal error')}`;
    if (sentMessage) {
      await safeEdit(ctx, sentMessage.message_id, fullText + '\n\n' + errorText, true);
    } else {
      await ctx.reply(errorText, { parse_mode: 'HTML' });
    }
  }

  // Save assistant response to DB
  if (fullText) {
    await updateMessageContent(assistantMsgId, fullText);
  }

  // Record token usage for billing
  if (totalTokens > 0) {
    await recordTokenUsage(userId, totalTokens).catch((err) =>
      console.error('Failed to record token usage:', err),
    );
  }
}

async function safeEdit(
  ctx: BotContext,
  messageId: number,
  text: string,
  isHtml = false,
): Promise<void> {
  try {
    const content = text || '(пусто)';
    await ctx.api.editMessageText(
      ctx.chat!.id,
      messageId,
      content,
      isHtml ? { parse_mode: 'HTML' } : undefined,
    );
  } catch (err: any) {
    if (err.description?.includes('message is not modified')) return;
    if (err.description?.includes('message to edit not found')) return;
    console.error('Edit error:', err.message);
  }
}

function truncateForTelegram(text: string): string {
  if (text.length <= TG_TEXT_LIMIT - 100) return text;
  return text.slice(0, TG_TEXT_LIMIT - 120) + '\n\n<i>... (обрезано)</i>';
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: add chat handler with SSE streaming and throttled edits"
```

---

### Task 8: Command Handlers

**Files:**

- Create: `gptwebrubot/src/handlers/start.ts`
- Create: `gptwebrubot/src/handlers/new.ts`
- Create: `gptwebrubot/src/handlers/model.ts`
- Create: `gptwebrubot/src/handlers/balance.ts`
- Create: `gptwebrubot/src/handlers/plan.ts`
- Create: `gptwebrubot/src/handlers/history.ts`

**Step 1: Write handlers/start.ts**

```typescript
// src/handlers/start.ts
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../types';
import { getBillingInfo } from '../lobechat/queries';
import { escapeHtml, formatTokens } from './chat';
import { config } from '../config';

export async function startHandler(ctx: BotContext): Promise<void> {
  const billing = await getBillingInfo(ctx.lobechatUserId);

  const keyboard = new InlineKeyboard()
    .text('Новый чат', 'action:new_chat')
    .text('Модели', 'action:models')
    .row()
    .text('Баланс', 'action:balance')
    .text('Помощь', 'action:help')
    .row()
    .url('Открыть WebGPT', config.webUrl);

  const planName = billing?.plan_name || 'Free';
  const tokensUsed = billing?.tokens_used_month || 0;
  const tokenLimit = billing?.token_limit || 50000;
  const percent = tokenLimit > 0 ? Math.round((tokensUsed / tokenLimit) * 100) : 0;

  await ctx.reply(
    `<b>Добро пожаловать в WebGPT!</b>\n\n` +
      `План: <b>${escapeHtml(planName)}</b>\n` +
      `Токены: ${formatTokens(tokensUsed)} / ${formatTokens(tokenLimit)} (${percent}%)\n` +
      `Модель: <code>${escapeHtml(ctx.tgUser.preferred_model)}</code>\n\n` +
      `Просто напишите сообщение, чтобы начать диалог.`,
    { parse_mode: 'HTML', reply_markup: keyboard },
  );
}

export async function actionCallbackHandler(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith('action:')) return;
  await ctx.answerCallbackQuery();

  const action = data.replace('action:', '');
  switch (action) {
    case 'new_chat':
      await ctx.reply('Новый диалог начат. Просто напишите сообщение.');
      break;
    case 'models':
      await ctx.reply('Используйте /model для выбора модели.');
      break;
    case 'balance':
      await ctx.reply('Используйте /balance для проверки баланса.');
      break;
    case 'help':
      await ctx.reply(
        `<b>Команды:</b>\n` +
          `/model — выбрать AI-модель\n` +
          `/new — начать новый диалог\n` +
          `/balance — токены и лимиты\n` +
          `/history — история диалогов\n` +
          `/plan — тарифные планы\n\n` +
          `<b>Веб-версия:</b> ${config.webUrl}`,
        { parse_mode: 'HTML' },
      );
      break;
  }
}
```

**Step 2: Write handlers/new\.ts**

```typescript
// src/handlers/new.ts
import type { BotContext } from '../types';
import { setCurrentTopic } from '../db';

export async function newHandler(ctx: BotContext): Promise<void> {
  const telegramId = String(ctx.from!.id);
  setCurrentTopic(telegramId, null);
  await ctx.reply('Новый диалог начат. Просто напишите сообщение.');
}
```

**Step 3: Write handlers/model.ts**

```typescript
// src/handlers/model.ts
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../types';
import { setPreferredModel } from '../db';
import { MODELS, getModelByName, CATEGORY_LABELS, CATEGORY_ORDER } from '../models';
import { escapeHtml } from './chat';

export async function modelHandler(ctx: BotContext): Promise<void> {
  const text = ctx.message?.text || '';
  const args = text.replace(/^\/model\s*/, '').trim();

  if (args) {
    await setModel(ctx, args);
    return;
  }

  const keyboard = new InlineKeyboard();

  for (const category of CATEGORY_ORDER) {
    const group = MODELS.filter((m) => m.category === category);
    if (group.length === 0) continue;

    for (let i = 0; i < group.length; i++) {
      const m = group[i];
      const isCurrent = m.name === ctx.tgUser.preferred_model;
      const label = `${isCurrent ? '* ' : ''}${m.displayName}`;
      keyboard.text(label, `model:${m.name}`);
      if (i % 2 === 1 || i === group.length - 1) keyboard.row();
    }
  }

  const currentModel = getModelByName(ctx.tgUser.preferred_model);
  const currentLabel = currentModel?.displayName || ctx.tgUser.preferred_model;

  const lines: string[] = [
    `<b>Выберите модель</b>\n\nТекущая: <b>${escapeHtml(currentLabel)}</b>\n`,
  ];
  for (const category of CATEGORY_ORDER) {
    const group = MODELS.filter((m) => m.category === category);
    if (group.length === 0) continue;
    lines.push(`<b>${CATEGORY_LABELS[category]}:</b>`);
    for (const m of group) {
      lines.push(`  <code>${m.name}</code> — ${escapeHtml(m.description)}`);
    }
    lines.push('');
  }

  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: keyboard });
}

export async function modelCallbackHandler(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith('model:')) return;
  await ctx.answerCallbackQuery();
  await setModel(ctx, data.replace('model:', ''));
}

async function setModel(ctx: BotContext, modelName: string): Promise<void> {
  const model = getModelByName(modelName);
  if (!model) {
    await ctx.reply(
      `Модель <code>${escapeHtml(modelName)}</code> не найдена.\n\nДоступные: ${MODELS.map((m) => `<code>${m.name}</code>`).join(', ')}`,
      { parse_mode: 'HTML' },
    );
    return;
  }

  setPreferredModel(String(ctx.from!.id), model.name);
  ctx.tgUser.preferred_model = model.name;

  await ctx.reply(
    `Модель установлена: <b>${escapeHtml(model.displayName)}</b>\n<i>${escapeHtml(model.description)}</i>`,
    { parse_mode: 'HTML' },
  );
}
```

**Step 4: Write handlers/balance.ts**

```typescript
// src/handlers/balance.ts
import type { BotContext } from '../types';
import { getBillingInfo } from '../lobechat/queries';
import { escapeHtml, formatTokens } from './chat';

export async function balanceHandler(ctx: BotContext): Promise<void> {
  const billing = await getBillingInfo(ctx.lobechatUserId);
  if (!billing) {
    await ctx.reply('Информация о биллинге не найдена.');
    return;
  }

  const percent =
    billing.token_limit > 0
      ? Math.min(Math.round((billing.tokens_used_month / billing.token_limit) * 100), 100)
      : 0;
  const progressBar = buildProgressBar(percent);
  const daysUntilReset = getDaysUntilReset();

  let text =
    `<b>Баланс и лимиты</b>\n\n` +
    `План: <b>${escapeHtml(billing.plan_name)}</b>\n` +
    `Модель: <code>${escapeHtml(ctx.tgUser.preferred_model)}</code>\n\n` +
    `<b>Токены:</b>\n` +
    `${progressBar} ${percent}%\n` +
    `${formatTokens(billing.tokens_used_month)} / ${formatTokens(billing.token_limit)}\n`;

  if (billing.token_balance > 0) {
    text += `Бонус: +${formatTokens(billing.token_balance)}\n`;
  }

  text += `\nОбновление через: <b>${daysUntilReset}</b> дн.`;

  if (percent >= 80) {
    text += `\n\n<b>Внимание:</b> лимит почти исчерпан! Обновите план: /plan`;
  }

  await ctx.reply(text, { parse_mode: 'HTML' });
}

function buildProgressBar(percent: number): string {
  const filled = Math.min(Math.round(percent / 10), 10);
  return '\u2593'.repeat(filled) + '\u2591'.repeat(10 - filled);
}

function getDaysUntilReset(): number {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return Math.ceil((nextMonth.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}
```

**Step 5: Write handlers/plan.ts**

```typescript
// src/handlers/plan.ts
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../types';
import { getPlans } from '../lobechat/queries';
import { escapeHtml, formatTokens } from './chat';
import { config } from '../config';

export async function planHandler(ctx: BotContext): Promise<void> {
  const plans = await getPlans();
  const lines: string[] = ['<b>Тарифные планы</b>\n'];

  for (const plan of plans) {
    const isCurrent = plan.slug === (ctx.tgUser as any).plan_slug; // approximate
    const marker = isCurrent ? ' (текущий)' : '';
    const price = plan.price_rub === 0 ? 'бесплатно' : `${plan.price_rub} руб/мес`;
    lines.push(`<b>${escapeHtml(plan.name)}${marker}</b> — ${price}`);
    lines.push(`  ${formatTokens(plan.token_limit)} токенов/мес`);
    lines.push('');
  }

  const keyboard = new InlineKeyboard().url('Оплатить / Управление', `${config.webUrl}/me/billing`);

  await ctx.reply(lines.join('\n'), {
    parse_mode: 'HTML',
    reply_markup: keyboard,
    link_preview_options: { is_disabled: true },
  });
}
```

**Step 6: Write handlers/history.ts**

```typescript
// src/handlers/history.ts
import type { BotContext } from '../types';
import { getRecentTopics } from '../lobechat/queries';
import { escapeHtml } from './chat';

export async function historyHandler(ctx: BotContext): Promise<void> {
  const topics = await getRecentTopics(ctx.lobechatUserId, 10);

  if (topics.length === 0) {
    await ctx.reply('У вас пока нет диалогов. Просто напишите сообщение!');
    return;
  }

  const lines: string[] = ['<b>Последние диалоги</b>\n'];
  for (const topic of topics) {
    const title = topic.title || 'Без названия';
    const date = formatDate(topic.updated_at);
    lines.push(`${date} — ${escapeHtml(title)}`);
  }

  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
}

function formatDate(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${day}.${month} ${hours}:${mins}`;
}
```

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: add all command handlers (start, new, model, balance, plan, history)"
```

---

### Task 9: Voice & Photo Handlers

**Files:**

- Create: `gptwebrubot/src/handlers/voice.ts`
- Create: `gptwebrubot/src/handlers/photo.ts`

**Step 1: Write handlers/voice.ts**

```typescript
// src/handlers/voice.ts
import type { BotContext } from '../types';
import { transcribeAudio } from '../lobechat/whisper';
import { chatHandler } from './chat';
import { config } from '../config';

export async function voiceHandler(ctx: BotContext): Promise<void> {
  const voice = ctx.message?.voice || ctx.message?.video_note;
  if (!voice) return;

  await ctx.replyWithChatAction('typing');

  try {
    const file = await ctx.getFile();
    const url = `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`;
    const res = await fetch(url);
    const buffer = Buffer.from(await res.arrayBuffer());

    const text = await transcribeAudio(buffer, file.file_path || 'audio.ogg');

    if (!text.trim()) {
      await ctx.reply('Не удалось распознать речь. Попробуйте ещё раз.');
      return;
    }

    // Inject transcribed text and delegate to chat handler
    (ctx.message as any).text = text;
    await chatHandler(ctx);
  } catch (err: any) {
    console.error('Voice handler error:', err);
    await ctx.reply(`Ошибка распознавания: ${err.message || 'Unknown error'}`);
  }
}
```

**Step 2: Write handlers/photo.ts**

```typescript
// src/handlers/photo.ts
import type { BotContext } from '../types';
import { setCurrentTopic } from '../db';
import {
  getInboxSessionId,
  createTopic,
  getTopicMessages,
  insertMessage,
  updateMessageContent,
  recordTokenUsage,
} from '../lobechat/queries';
import { streamChat, type ChatRequestMessage } from '../lobechat/chat';
import { uploadToS3 } from '../lobechat/s3';
import { getModelByName, DEFAULT_MODEL } from '../models';
import { escapeHtml } from './chat';
import { config } from '../config';

const TG_TEXT_LIMIT = 4096;
const EDIT_INTERVAL_MS = 1000;

export async function photoHandler(ctx: BotContext): Promise<void> {
  await ctx.replyWithChatAction('typing');

  try {
    let fileId: string;
    let filename: string;
    let contentType: string;

    if (ctx.message?.photo) {
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      fileId = photo.file_id;
      filename = 'photo.jpg';
      contentType = 'image/jpeg';
    } else if (ctx.message?.document) {
      fileId = ctx.message.document.file_id;
      filename = ctx.message.document.file_name || 'document';
      contentType = ctx.message.document.mime_type || 'application/octet-stream';
    } else {
      return;
    }

    // Download from Telegram
    const file = await ctx.api.getFile(fileId);
    const url = `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`;
    const res = await fetch(url);
    const buffer = Buffer.from(await res.arrayBuffer());

    // Upload to RustFS
    const imageUrl = await uploadToS3({
      buffer,
      filename,
      contentType,
      userId: ctx.lobechatUserId,
    });

    // Pick vision model
    const userModel = ctx.tgUser.preferred_model || DEFAULT_MODEL;
    const userModelDef = getModelByName(userModel);
    const chatModel = userModelDef?.supportsVision ? userModel : 'gpt-4o';
    const chatModelDef = getModelByName(chatModel)!;
    const provider = chatModelDef.provider;

    const caption = ctx.message?.caption || 'Что на этом изображении?';
    const telegramId = String(ctx.from!.id);

    // Get/create topic
    const sessionId = await getInboxSessionId(ctx.lobechatUserId);
    if (!sessionId) {
      await ctx.reply('Ошибка: сессия не найдена.');
      return;
    }

    let topicId = ctx.tgUser.current_topic_id;
    if (!topicId) {
      topicId = await createTopic(ctx.lobechatUserId, sessionId, caption.slice(0, 60));
      setCurrentTopic(telegramId, topicId);
    }

    // Insert user message
    await insertMessage({
      userId: ctx.lobechatUserId,
      topicId,
      sessionId,
      role: 'user',
      content: caption,
    });

    // Build message with image
    const dbMessages = await getTopicMessages(topicId, ctx.lobechatUserId);
    const chatMessages: ChatRequestMessage[] = dbMessages.slice(0, -1).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content || '',
    }));

    // Last message includes image
    chatMessages.push({
      role: 'user',
      content: [
        { type: 'text', text: caption },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    });

    // Create assistant message placeholder
    const assistantMsgId = await insertMessage({
      userId: ctx.lobechatUserId,
      topicId,
      sessionId,
      role: 'assistant',
      content: '',
      model: chatModel,
      provider,
    });

    // Model switch notice
    let fullText = '';
    if (chatModel !== userModel) {
      fullText = '(Модель переключена на GPT-4o для анализа изображения)\n\n';
    }

    // Stream response
    let sentMessage: { chat: { id: number }; message_id: number } | null = null;
    let lastEditTime = 0;
    let totalTokens = 0;

    const generator = streamChat({
      userId: ctx.lobechatUserId,
      provider,
      model: chatModel,
      messages: chatMessages,
    });

    for await (const chunk of generator) {
      if (chunk.type === 'text' && chunk.content) {
        fullText += chunk.content;
        if (!sentMessage) {
          sentMessage = await ctx.reply(fullText.slice(0, TG_TEXT_LIMIT));
          lastEditTime = Date.now();
        } else if (Date.now() - lastEditTime >= EDIT_INTERVAL_MS) {
          await safeEdit(ctx, sentMessage.message_id, fullText);
          lastEditTime = Date.now();
        }
        ctx.replyWithChatAction('typing').catch(() => {});
      } else if (chunk.type === 'usage') {
        totalTokens = chunk.usage?.totalTokens || 0;
      } else if (chunk.type === 'stop' && sentMessage) {
        await safeEdit(ctx, sentMessage.message_id, fullText);
      } else if (chunk.type === 'error') {
        await ctx.reply(`Ошибка: ${chunk.error}`);
      }
    }

    if (!sentMessage && !fullText) {
      await ctx.reply('(Пустой ответ)');
    }

    if (fullText) await updateMessageContent(assistantMsgId, fullText);
    if (totalTokens > 0) await recordTokenUsage(ctx.lobechatUserId, totalTokens).catch(() => {});
  } catch (err: any) {
    console.error('Photo handler error:', err);
    await ctx.reply(`Ошибка: ${err.message || 'Unknown error'}`);
  }
}

async function safeEdit(ctx: BotContext, messageId: number, text: string): Promise<void> {
  try {
    const truncated =
      text.length > TG_TEXT_LIMIT - 50
        ? text.slice(0, TG_TEXT_LIMIT - 70) + '\n\n<i>... (обрезано)</i>'
        : text;
    await ctx.api.editMessageText(ctx.chat!.id, messageId, truncated || '(пусто)');
  } catch (err: any) {
    if (err.description?.includes('message is not modified')) return;
    if (err.description?.includes('message to edit not found')) return;
  }
}
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add voice (Whisper) and photo (vision) handlers"
```

---

### Task 10: Inline Handler & Handler Registration

**Files:**

- Create: `gptwebrubot/src/handlers/inline.ts`
- Create: `gptwebrubot/src/registerHandlers.ts`

**Step 1: Write handlers/inline.ts**

```typescript
// src/handlers/inline.ts
import type { BotContext } from '../types';
import { streamChat } from '../lobechat/chat';

const INLINE_MODEL = 'gpt-4o-mini';
const INLINE_PROVIDER = 'openai';
const MAX_INLINE_LENGTH = 4096;

export async function inlineHandler(ctx: BotContext): Promise<void> {
  const query = ctx.inlineQuery?.query?.trim();
  if (!query || query.length < 3) return;

  try {
    let fullText = '';

    const generator = streamChat({
      userId: ctx.lobechatUserId,
      provider: INLINE_PROVIDER,
      model: INLINE_MODEL,
      messages: [{ role: 'user', content: query }],
    });

    for await (const chunk of generator) {
      if (chunk.type === 'text' && chunk.content) fullText += chunk.content;
      if (chunk.type === 'error') {
        fullText = `Ошибка: ${chunk.error}`;
        break;
      }
    }

    if (!fullText) fullText = '(Пустой ответ)';

    const truncated =
      fullText.length > MAX_INLINE_LENGTH
        ? fullText.slice(0, MAX_INLINE_LENGTH - 20) + '\n\n... (обрезано)'
        : fullText;

    await ctx.answerInlineQuery(
      [
        {
          type: 'article',
          id: `inline-${Date.now()}`,
          title: truncated.slice(0, 100),
          description: query,
          input_message_content: { message_text: truncated },
        },
      ],
      { cache_time: 10 },
    );
  } catch (err: any) {
    console.error('Inline handler error:', err);
  }
}
```

**Step 2: Write registerHandlers.ts — wire everything together**

```typescript
// src/registerHandlers.ts
import { Bot } from 'grammy';
import type { BotContext } from './types';
import { config } from './config';

import { startHandler, actionCallbackHandler } from './handlers/start';
import { newHandler } from './handlers/new';
import { modelHandler, modelCallbackHandler } from './handlers/model';
import { balanceHandler } from './handlers/balance';
import { planHandler } from './handlers/plan';
import { historyHandler } from './handlers/history';
import { chatHandler } from './handlers/chat';
import { voiceHandler } from './handlers/voice';
import { photoHandler } from './handlers/photo';
import { inlineHandler } from './handlers/inline';

export function registerHandlers(bot: Bot<BotContext>): void {
  // Commands
  bot.command('start', startHandler);
  bot.command('new', newHandler);
  bot.command('model', modelHandler);
  bot.command('balance', balanceHandler);
  bot.command('plan', planHandler);
  bot.command('history', historyHandler);
  bot.command('help', async (ctx) => {
    await ctx.reply(
      `<b>WebGPT Bot</b>\n\n` +
        `Просто напишите сообщение — бот ответит через выбранную AI-модель.\n\n` +
        `<b>Команды:</b>\n` +
        `/start — начало работы\n` +
        `/model — выбрать AI-модель\n` +
        `/new — начать новый диалог\n` +
        `/balance — токены и лимиты\n` +
        `/history — история диалогов\n` +
        `/plan — тарифные планы\n` +
        `/help — эта справка\n\n` +
        `<b>Веб-версия:</b> ${config.webUrl}`,
      { parse_mode: 'HTML' },
    );
  });

  // Callback queries
  bot.callbackQuery(/^model:/, modelCallbackHandler);
  bot.callbackQuery(/^action:/, actionCallbackHandler);

  // Inline queries
  bot.on('inline_query', inlineHandler);

  // Voice / video note
  bot.on('message:voice', voiceHandler);
  bot.on('message:video_note', voiceHandler);

  // Photo / document
  bot.on('message:photo', photoHandler);
  bot.on('message:document', photoHandler);

  // Text (MUST be last)
  bot.on('message:text', chatHandler);
}
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add inline handler and wire all handlers in registerHandlers"
```

---

### Task 11: Entry Point & systemd Service

**Files:**

- Create: `gptwebrubot/src/index.ts`
- Create: `gptwebrubot/gptwebrubot.service`
- Create: `gptwebrubot/KNOWLEDGE.md`

**Step 1: Write src/index.ts — entry point with graceful shutdown**

```typescript
// src/index.ts
import { startBot, stopBot } from './bot';
import { closeDatabases } from './db';

async function main(): Promise<void> {
  console.info('Starting gptwebrubot...');
  await startBot();

  const shutdown = async (signal: string) => {
    console.info(`Received ${signal}, shutting down...`);
    await stopBot();
    await closeDatabases();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

**Step 2: Write systemd service file**

```ini
# gptwebrubot.service
[Unit]
Description=WebGPT Telegram Bot (@gptwebrubot)
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
User=deploy
WorkingDirectory=/home/deploy/projects/gptwebrubot
ExecStart=/home/deploy/.bun/bin/bun run src/index.ts
Restart=always
RestartSec=5
Environment=NODE_ENV=production
EnvironmentFile=/home/deploy/projects/gptwebrubot/.env

[Install]
WantedBy=multi-user.target
```

**Step 3: Write KNOWLEDGE.md**

````markdown
# KNOWLEDGE.md — gptwebrubot

## Overview

Telegram bot @gptwebrubot — thin client for LobeChat at ask.gptweb.ru.

**GitHub:** bugle-c/gptwebrubot (private)
**Deploy:** systemd on VPS #1 (194.113.209.247), same host as LobeChat

## Architecture

- **Runtime:** Bun + grammY (long polling)
- **AI backend:** LobeChat webapi (localhost:3210) via SSE streaming
- **Data:** Direct PG to LobeChat DB (localhost:5433) + local SQLite for telegram mapping
- **Voice:** OpenAI Whisper API (direct)
- **Photos:** RustFS S3 upload (localhost:9000)

## Key Files

- `src/index.ts` — entry point, graceful shutdown
- `src/bot.ts` — grammY setup
- `src/registerHandlers.ts` — handler registration (order matters: text handler LAST)
- `src/lobechat/chat.ts` — SSE streaming client
- `src/lobechat/auth.ts` — XOR encoding for X-lobe-chat-auth header
- `src/lobechat/queries.ts` — LobeChat PG queries
- `src/db.ts` — SQLite + PG connections
- `src/handlers/chat.ts` — main chat with throttled streaming edits

## Deploy

```bash
# Install
sudo cp gptwebrubot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable gptwebrubot
sudo systemctl start gptwebrubot

# Logs
journalctl -u gptwebrubot -f

# Restart
sudo systemctl restart gptwebrubot
```
````

````

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add entry point, systemd service, and KNOWLEDGE.md"
````

---

### Task 12: Deploy & End-to-End Verification

**Step 1: Create .env from .env.example**

```bash
cd /home/deploy/projects/gptwebrubot
cp .env.example .env
# Fill in values:
# TELEGRAM_BOT_TOKEN — from @BotFather (existing bot token)
# LOBECHAT_DB_URL=postgres://postgres:0ae6c58c62f6347f2120e958941ef922@127.0.0.1:5433/lobechat
# OPENAI_API_KEY — from /opt/lobechat/.env
# RUSTFS_SECRET_KEY — from /opt/lobechat/.env (RUSTFS_SECRET_KEY value)
```

**Step 2: Test run manually**

```bash
/home/deploy/.bun/bin/bun run src/index.ts
```

Expected: `Bot started as @gptwebrubot`

**Step 3: Test basic commands via Telegram**

Send to @gptwebrubot:

1. `/start` — should show welcome message with plan info
2. `/model` — should show model keyboard
3. `/balance` — should show token usage
4. `/new` — should confirm new dialog
5. Send any text message — should get AI response with streaming edits
6. `/history` — should show the conversation

**Step 4: Test voice and photo (if working)**

1. Send a voice message — should transcribe and respond
2. Send a photo — should analyze with vision model

**Step 5: Install systemd service**

```bash
sudo cp gptwebrubot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable gptwebrubot
sudo systemctl start gptwebrubot
sudo systemctl status gptwebrubot
```

Expected: `Active: active (running)`

**Step 6: Verify DB integration**

```bash
PGPASSWORD=0ae6c58c62f6347f2120e958941ef922 psql -h 127.0.0.1 -p 5433 -U postgres -d lobechat \
  -c "SELECT u.id, u.full_name, u.email FROM users u WHERE u.email LIKE 'tg_%';"
```

Expected: See the bot-created user(s).

**Step 7: Create GitHub repo and push**

```bash
cd /home/deploy/projects/gptwebrubot
git remote add origin git@github.com:bugle-c/gptwebrubot.git
git push -u origin master
```

**Step 8: Final commit and update memory**

Update KNOWLEDGE.md in ai-aggregator-lobechat to mark Phase 4 as done.

```bash
git add -A
git commit -m "feat: gptwebrubot v1.0 — deployed and verified"
```

---

## Dependency Graph

```
Task 1 (scaffold)
  └→ Task 2 (config + db)
       └→ Task 3 (auth + queries)
            ├→ Task 4 (SSE client)
            ├→ Task 5 (whisper + s3)
            └→ Task 6 (bot setup)
                 └→ Task 7 (chat handler)
                      └→ Task 8 (command handlers)
                           └→ Task 9 (voice + photo)
                                └→ Task 10 (inline + registration)
                                     └→ Task 11 (entry point + systemd)
                                          └→ Task 12 (deploy + verify)
```

## Notes for Implementer

1. **XOR key** is `'LobeHub · LobeHub'` — the middle dot is Unicode `\u00b7`, not ASCII period
2. **LobeChat inbox session** slug is `'inbox'` — created during user creation in auth.ts
3. **Text handler must be registered LAST** in grammY — otherwise it catches commands
4. **Telegram edit rate limit** — throttle edits to 1000ms minimum
5. **Safe edit** — always catch "message is not modified" and "message to edit not found" errors
6. **Token recording** — call `recordTokenUsage()` after each chat completion for billing
7. **PG password** for LobeChat: `0ae6c58c62f6347f2120e958941ef922` (from `/opt/lobechat/.env`)
8. **Bun path**: `/home/deploy/.bun/bin/bun`
9. **Bot token**: Get from existing bot or ask user — stored in `.env`
10. **Model IDs** in models.ts must match what LobeChat recognizes for each provider
