/**
 * Customer-facing wording for provider / pipeline failures.
 *
 * Raw upstream payloads (OpenRouter JSON, WaveSpeed `400 {...}`, tRPC
 * `detail` strings) must never reach the UI — see 2026-09-21: a user got a
 * 40-line JSON dump for an unsupported HEIC attachment. Every surface that
 * renders an error message (chat bubble, image feed, video feed) passes the
 * raw text through here and shows only the returned sentence.
 *
 * Rules are ordered; first match wins. Everything unrecognised collapses to
 * a generic line. Keep the list short — it documents the failure classes we
 * have actually seen, not every possible provider string.
 */
const RULES: Array<{ re: RegExp; text: string }> = [
  {
    // Our own free-video copy (media-router/newcomer.ts) — keep it verbatim.
    re: /Видео сейчас в очереди/,
    text: 'Видео сейчас в очереди — попробуйте через 10–15 минут. Ваше бесплатное видео сохранено.',
  },
  {
    re: /does not represent a valid image|invalid.*media_type|media_type|unsupported image|image.*(format|type)/i,
    text: 'Прикреплённый файл не распознан как изображение. Поддерживаются JPEG, PNG, WebP и GIF.',
  },
  {
    re: /field\s*\\?"?image\\?"?\s+is\s+required|image is required|requires.*image/i,
    text: 'Для этой модели нужно прикрепить исходное изображение.',
  },
  {
    re: /requires duration|duration=.*got duration|invalid duration/i,
    text: 'Такое сочетание длительности и разрешения недоступно у этой модели. Измените длительность или разрешение.',
  },
  {
    re: /content (review|moderation|policy)|safety|nsfw|flagged|rejected by moderation|inappropriate/i,
    text: 'Запрос отклонён модерацией модели. Смягчите формулировку или попробуйте другую модель.',
  },
  {
    re: /context.?length|too many tokens|maximum context|prompt is too long/i,
    text: 'Слишком длинный запрос для этой модели. Сократите текст или начните новую тему.',
  },
  {
    re: /rate.?limit|429|too many requests|overloaded|capacity/i,
    text: 'Модель перегружена. Подождите минуту и повторите запрос.',
  },
  {
    re: /credit|insufficient|balance|quota exceeded/i,
    text: 'Недостаточно кредитов для этой операции.',
  },
  {
    re: /timed? ?out|ETIMEDOUT/i,
    text: 'Модель не ответила вовремя. Попробуйте ещё раз.',
  },
];

const GENERIC_CHAT = 'Не удалось получить ответ. Попробуйте ещё раз или выберите другую модель.';
const GENERIC_GEN =
  'Не удалось выполнить генерацию. Кредиты за неё не списаны. Попробуйте ещё раз или другую модель.';

function extractText(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    // OpenRouter shape: { error: { message, metadata: { raw } } } / { body: { detail } }
    const parts = [
      (o.error as any)?.metadata?.raw,
      (o.error as any)?.message,
      (o.body as any)?.detail,
      (o.body as any)?.error?.message,
      o.detail,
      o.message,
    ].filter((x) => typeof x === 'string') as string[];
    if (parts.length > 0) return parts.join(' | ');
    try {
      return JSON.stringify(raw);
    } catch {
      return '';
    }
  }
  return String(raw);
}

/** Chat bubble: raw error body → one sentence. */
export function friendlyChatError(raw: unknown): string {
  const text = extractText(raw);
  return RULES.find((r) => r.re.test(text))?.text ?? GENERIC_CHAT;
}

/** Image / video generation feed: raw task error → one sentence. */
export function friendlyGenerationError(raw: unknown): string {
  const text = extractText(raw);
  return RULES.find((r) => r.re.test(text))?.text ?? GENERIC_GEN;
}
