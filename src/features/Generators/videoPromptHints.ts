/**
 * Pre-flight prompt heuristics for video generation.
 *
 * Veo / Kling / Seedance can't do four things their users typically ask
 * for in a single 8-second clip:
 *   1. **Render a specific brand logo** they've never seen. Without an
 *      input image (image-to-video), the model invents a logo from
 *      scratch and the user is rightfully disappointed.
 *   2. **Render Cyrillic text on screen reliably.** Glyph soup is the
 *      typical result. Latin works much better.
 *   3. **Follow a long multi-action narrative in 8 seconds.** Veo 3.1
 *      Fast caps at 8 sec; long shots ignore most of the verbs after
 *      the first scene.
 *   4. **Handle a very long prompt** — anything beyond ~300 chars
 *      gets sliced and parts of the instruction are dropped silently.
 *
 * This file detects those cases purely client-side from the prompt
 * string. The video PromptInput renders the hints under the textarea
 * as warnings (⚠️) — never as blockers. The user always retains the
 * choice to ignore and submit.
 *
 * Why heuristics, not LLM moderation: it's free, instant, and the four
 * cases above cover ~95% of the disappointment reports we saw. We can
 * graduate to an LLM judge later if false-positive rate gets too high.
 */

export interface VideoPromptHint {
  /** One-sentence body explaining what to do. */
  body: string;
  /** Short headline shown on the row. */
  title: string;
}

// JS regex `\b` is ASCII-only and won't fire at Cyrillic word boundaries,
// so we use plain substring matching. The chosen substrings ("логотип",
// "лого", "бренд", "корпоративн") are long enough that false positives
// on common Russian words are practically impossible (verified: doesn't
// match "технология", "психология", "филология" — those contain "лог"
// followed by "и", not "о").
const BRAND_WORDS_RE =
  /логотип|лого|бренд|brand|logo|trademark|товарный знак|фирменный знак|корпоративн/iu;

// Latin token followed by/preceded by Cyrillic, OR explicit asks for
// on-screen text in Russian. We don't fire on plain Cyrillic prompts —
// only on the "user wants text RENDERED IN the video" cases.
// `надпис[ьия]` covers "надпись"/"надписи"/"надписями"/"надписям"
// (the instrumental/dative plural forms have "я" at position 6,
// the singular nominative/genitive have "ь" or "и"). "надписью"
// is covered by the "надпись" prefix match.
const TEXT_ON_SCREEN_RE =
  /надпис[ьия]|субтитр|текст(?:[ауеs]|$|ом)|заголов|подпис[ьи]|caption|subtitle/iu;
const HAS_CYRILLIC = /\p{Script=Cyrillic}/u;

// Veo 3.1 Fast is 8 sec. A prompt with many verbs of motion across
// distinct phases will lose half the story. This regex counts action
// verbs commonly used in story-style prompts. >4 distinct = warning.
const ACTION_VERB_TOKENS = [
  // Russian
  'бежит',
  'прыгает',
  'преодолевает',
  'уворачивается',
  'перепрыгивает',
  'побеждает',
  'подбирает',
  'добирается',
  'получает',
  'радуется',
  'летит',
  'плывёт',
  'падает',
  'взрывается',
  'стреляет',
  // English
  'runs',
  'jumps',
  'dodges',
  'fights',
  'wins',
  'collects',
  'reaches',
  'flies',
  'shoots',
  'crashes',
];

const PROMPT_LENGTH_WARN = 300;

export function detectVideoPromptHints(prompt: string): VideoPromptHint[] {
  // Skip while the user is still typing the first phrase — hints under an
  // empty textarea read as a wall of complaints instead of help.
  if (prompt.trim().length < 20) return [];

  const hints: VideoPromptHint[] = [];
  const lower = prompt.toLowerCase();

  if (BRAND_WORDS_RE.test(prompt)) {
    hints.push({
      title: '⚠️ Логотип / бренд',
      body: 'Модель не знает ваш бренд. Загрузите референс через image-to-video — оттуда логотип попадёт в видео точно.',
    });
  }

  if (TEXT_ON_SCREEN_RE.test(prompt) && HAS_CYRILLIC.test(prompt)) {
    hints.push({
      title: '⚠️ Кириллица на экране',
      body: 'Кириллицу нейросеть пишет ненадёжно — часто получается псевдо-русский набор букв. Замените на латиницу или уберите надпись.',
    });
  }

  if (prompt.length > PROMPT_LENGTH_WARN) {
    hints.push({
      title: '⚠️ Слишком длинный промт',
      body: `Около ${prompt.length} символов. Большая часть инструкций будет проигнорирована — оставьте одно главное действие.`,
    });
  }

  // Count distinct action verbs in the prompt.
  let actionCount = 0;
  for (const v of ACTION_VERB_TOKENS) {
    if (lower.includes(v)) actionCount += 1;
  }
  if (actionCount >= 4) {
    hints.push({
      title: '⚠️ Много действий в одном кадре',
      body: 'Veo 3.1 Fast — 8 секунд. Связную историю с 4+ действиями не успеет показать. Опишите одну сцену или используйте Veo 3.1 (полный) / склейку.',
    });
  }

  return hints;
}
