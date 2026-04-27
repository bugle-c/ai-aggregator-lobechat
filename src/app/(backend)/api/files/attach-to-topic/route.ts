/**
 * POST /api/files/attach-to-topic
 *
 * Receives a multipart upload (fields: `file`, `topicId`), saves the file to
 * S3 via FileService, creates a user message in the target topic with the file
 * as an attachment, and fires a bot push via the internal notify endpoint so
 * the user gets a "file is ready" message in Telegram.
 *
 * Auth: Better Auth session cookie (set by the bot-bridge consume flow).
 * Ownership: validates that the topic belongs to the current user.
 */

import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { sha256 } from 'js-sha256';

import { auth } from '@/auth';
import { topics, messages, messagesFiles, userBilling } from '@/database/schemas';
import { idGenerator } from '@/database/utils/idGenerator';
import { getServerDB } from '@/database/core/db-adaptor';
import { FileService } from '@/server/services/file';

export const runtime = 'nodejs';
export const maxDuration = 120; // Allow up to 2 min for large file processing

const json = (body: unknown, status: number) => NextResponse.json(body, { status });

const BOT_INTERNAL_URL = process.env.BOT_INTERNAL_URL ?? 'http://127.0.0.1:8081';
const BOT_NOTIFY_SECRET = process.env.BOT_NOTIFY_SECRET ?? '';

/** Fire-and-forget bot push for `file_attached`. Errors are swallowed intentionally. */
async function notifyBot(tgUserId: number, fileName: string, topicId: string): Promise<void> {
  try {
    await fetch(`${BOT_INTERNAL_URL}/internal/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${BOT_NOTIFY_SECRET}`,
      },
      body: JSON.stringify({
        tgUserId,
        type: 'file_attached',
        payload: { fileName, topicId },
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.warn('[attach-to-topic] bot notify failed (non-fatal):', err);
  }
}

export async function POST(req: NextRequest) {
  // --- Auth ---
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user?.id) {
    return json({ error: 'unauthorized' }, 401);
  }
  const userId = session.user.id;

  // --- Parse multipart ---
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return json({ error: 'invalid_multipart' }, 400);
  }

  const topicId = formData.get('topicId');
  const fileField = formData.get('file');

  if (!topicId || typeof topicId !== 'string') {
    return json({ error: 'missing_topicId' }, 400);
  }
  if (!fileField || !(fileField instanceof Blob)) {
    return json({ error: 'missing_file' }, 400);
  }

  const db = await getServerDB();

  // --- Ownership check ---
  const [topic] = await db
    .select({ id: topics.id, sessionId: topics.sessionId })
    .from(topics)
    .where(and(eq(topics.id, topicId), eq(topics.userId, userId)))
    .limit(1);

  if (!topic) {
    return json({ error: 'topic_not_found_or_forbidden' }, 403);
  }

  // --- Get sessionId for message creation (need inbox session) ---
  const sessionId = topic.sessionId;

  // --- Determine file metadata ---
  const fileName =
    fileField instanceof File ? fileField.name || 'upload' : 'upload';
  const contentType = fileField.type || 'application/octet-stream';
  const arrayBuffer = await fileField.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const fileSize = buffer.length;
  const fileHash = sha256(buffer);

  // --- Upload to storage ---
  const fileService = new FileService(db, userId);
  const storageKey = `files/${userId}/${Date.now()}-${fileName}`;

  await fileService.uploadBuffer(storageKey, buffer, contentType);

  const { fileId } = await fileService.createFileRecord({
    fileHash,
    fileType: contentType,
    name: fileName,
    size: fileSize,
    url: storageKey,
  });

  // --- Create user message with attachment ---
  const messageId = idGenerator('messages');
  await db.transaction(async (trx) => {
    await trx.insert(messages).values({
      id: messageId,
      userId,
      topicId,
      sessionId: sessionId ?? undefined,
      role: 'user',
      content: `[Файл: ${fileName}]`,
    });

    await trx.insert(messagesFiles).values({
      fileId,
      messageId,
      userId,
    });
  });

  // --- Notify bot (fire and forget) ---
  const [billing] = await db
    .select({ tgBotChatId: userBilling.tgBotChatId })
    .from(userBilling)
    .where(eq(userBilling.userId, userId))
    .limit(1);

  if (billing?.tgBotChatId) {
    void notifyBot(billing.tgBotChatId, fileName, topicId);
  }

  return json({ fileId, fileName, messageId, topicId }, 200);
}
