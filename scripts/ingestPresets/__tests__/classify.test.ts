import { describe, expect, it, vi } from 'vitest';

import {
  allowedCategories,
  buildSystemPrompt,
  buildUserPrompt,
  ClassificationSchema,
  Classifier,
  cleanTitle,
  MAX_CLASSIFICATIONS_PER_RUN,
  OPENROUTER_URL,
  SHORT_TITLE_TARGET,
  tidyTitle,
  truncatePrompt,
} from '../classify';

const GOOD = {
  category: 'ad',
  requires_image: false,
  summary_ru: 'Реклама бургера: макро, слоу-мо, студийный свет',
  title_ru: 'Реклама бургера в стиле кино',
  unsafe: false,
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });

const completion = (
  content: unknown,
  usage: { completion_tokens: number; cost?: number; prompt_tokens: number } = {
    completion_tokens: 80,
    prompt_tokens: 600,
  },
) =>
  jsonResponse({
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }],
    usage,
  });

const mockFetch = (...responses: (Response | Error)[]) => {
  const fn = vi.fn<typeof fetch>();
  for (const r of responses) {
    if (r instanceof Error) fn.mockRejectedValueOnce(r);
    else fn.mockResolvedValueOnce(r);
  }
  return fn;
};

const classifier = (fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof Classifier>[0]> = {}) =>
  new Classifier({ apiKey: 'test-key', fetchImpl, retryDelayMs: 0, ...extra });

const input = { aspectRatio: '16:9', modality: 'video' as const, prompt: 'A burger commercial' };

describe('ClassificationSchema', () => {
  it('accepts a well-formed answer and strips quotes / final period from the title', () => {
    const parsed = ClassificationSchema.parse({ ...GOOD, title_ru: '«Кошка на белом фоне».' });
    expect(parsed.title_ru).toBe('Кошка на белом фоне');
  });

  it('trims an over-long title on a word boundary to 40 chars instead of failing', () => {
    const parsed = ClassificationSchema.parse({
      ...GOOD,
      title_ru: 'Очень длинное название которое явно не помещается в карточку',
    });
    expect(parsed.title_ru.length).toBeLessThanOrEqual(40);
    // word-boundary cut gives «… явно не»; the dangling «не» is dropped as well
    expect(parsed.title_ru).toBe('Очень длинное название которое явно');
  });

  it('drops a dangling preposition or open bracket left by the trim', () => {
    expect(tidyTitle('Молодой бегун в стартовой позе для рекламы кроссовок')).toBe(
      'Молодой бегун в стартовой позе',
    );
    expect(tidyTitle('Бизнесмен на замороженной улице (bullet time)')).toBe(
      'Бизнесмен на замороженной улице',
    );
    expect(tidyTitle('Кошка на белом фоне')).toBe('Кошка на белом фоне');
    // a quoted name inside keeps its closing quote; a wrapping pair is removed
    expect(tidyTitle('Титры фильма «Пепел дня»')).toBe('Титры фильма «Пепел дня»');
    expect(tidyTitle('«Титры фильма «Пепел дня»»')).toBe('Титры фильма «Пепел дня»');
    // 39 chars: fits, so nothing is touched
    expect(tidyTitle('Миниатюрная невеста в бумажной открытке')).toBe(
      'Миниатюрная невеста в бумажной открытке',
    );
    // 41 chars: the trim leaves «… в», which is then dropped too
    expect(tidyTitle('Миниатюрная невеста в бумажной открытке в')).toBe(
      'Миниатюрная невеста в бумажной открытке',
    );
  });

  it('rejects a runaway title, a missing field and a non-boolean flag', () => {
    expect(ClassificationSchema.safeParse({ ...GOOD, title_ru: 'x'.repeat(81) }).success).toBe(false);
    const { summary_ru: _omit, ...missing } = GOOD;
    expect(ClassificationSchema.safeParse(missing).success).toBe(false);
    expect(ClassificationSchema.safeParse({ ...GOOD, unsafe: 'no' }).success).toBe(false);
  });
});

describe('prompt building', () => {
  it('lists only the modality-appropriate slugs plus trends', () => {
    const video = buildSystemPrompt('video');
    const image = buildSystemPrompt('image');
    expect(video).toContain('"cinematic"');
    expect(video).not.toContain('"portrait"');
    expect(image).toContain('"portrait"');
    expect(image).not.toContain('"cinematic"');
    // anime is the one shared slug: the image keyword table emits it too
    expect(allowedCategories('image')).toContain('anime');
    expect(allowedCategories('video')).toContain('anime');
    expect(allowedCategories('image')).toContain('trends');
    expect(allowedCategories('video')).toContain('trends');
  });

  it('truncates the prompt to ~1500 chars', () => {
    const long = 'word '.repeat(1000);
    expect(truncatePrompt(long).length).toBeLessThanOrEqual(1500 + 6);
    expect(buildUserPrompt({ ...input, prompt: long })).toContain('[…]');
    expect(buildUserPrompt(input)).toContain('Aspect ratio: 16:9');
  });
});

describe('Classifier', () => {
  it('returns a validated result and records usage', async () => {
    const fetchImpl = mockFetch(completion(GOOD, { completion_tokens: 80, cost: 0.0002, prompt_tokens: 600 }));
    const c = classifier(fetchImpl);

    const result = await c.classify(input);
    expect(result).toEqual({
      category: 'ad',
      ok: true,
      rawCategory: 'ad',
      requiresImage: false,
      summary: GOOD.summary_ru,
      title: GOOD.title_ru,
      unsafe: false,
    });
    expect(c.stats).toMatchObject({ calls: 1, completionTokens: 80, failed: 0, promptTokens: 600, usd: 0.0002 });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(OPENROUTER_URL);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('openai/gpt-5-mini');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.reasoning).toEqual({ effort: 'minimal' });
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer test-key' });
  });

  it('estimates USD from list prices when the response carries no cost', async () => {
    const c = classifier(mockFetch(completion(GOOD, { completion_tokens: 1000, prompt_tokens: 1_000_000 })));
    await c.classify(input);
    expect(c.stats.usd).toBeCloseTo(0.25 + 0.002, 6);
  });

  it('keeps the answer but nulls the category when the slug is not ours', async () => {
    const c = classifier(mockFetch(completion({ ...GOOD, category: 'food' })));
    const result = await c.classify(input);
    expect(result.ok && result.category).toBeNull();
    expect(result.ok && result.rawCategory).toBe('food');
    expect(result.ok && result.title).toBe(GOOD.title_ru);
  });

  it('treats a video slug on an image item as unknown', async () => {
    const c = classifier(mockFetch(completion({ ...GOOD, category: 'cinematic' })));
    const result = await c.classify({ ...input, modality: 'image' });
    expect(result.ok && result.category).toBeNull();
  });

  it('retries exactly once on a transport error, then fails', async () => {
    const c = classifier(mockFetch(new Error('ECONNRESET'), new Error('ECONNRESET'), completion(GOOD)));
    const result = await c.classify(input);
    expect(result.ok).toBe(false);
    expect(c.stats).toMatchObject({ calls: 2, failed: 1, retries: 1 });
  });

  it('recovers when the retry succeeds after a schema failure', async () => {
    const c = classifier(mockFetch(completion({ nope: true }), completion(GOOD)));
    const result = await c.classify(input);
    expect(result.ok).toBe(true);
    expect(c.stats).toMatchObject({ calls: 2, failed: 0, retries: 1 });
  });

  it('does not retry a 4xx other than 429', async () => {
    const c = classifier(mockFetch(jsonResponse({ error: { message: 'bad key' } }, 401)));
    const result = await c.classify(input);
    expect(result).toEqual({ ok: false, reason: 'http 401: bad key' });
    expect(c.stats.calls).toBe(1);
  });

  it('fails cleanly on an empty message (reasoning ate the budget)', async () => {
    const empty = () =>
      jsonResponse({
        choices: [{ finish_reason: 'length', message: { content: null } }],
        usage: { completion_tokens: 200, prompt_tokens: 50 },
      });
    const c = classifier(mockFetch(empty(), empty()));
    const result = await c.classify(input);
    expect(result).toEqual({ ok: false, reason: 'empty content (finish=length)' });
    expect(c.stats.completionTokens).toBe(400);
  });

  it('stops at the per-run cap without calling fetch', async () => {
    const fetchImpl = mockFetch(completion(GOOD), completion(GOOD), completion(GOOD));
    const c = classifier(fetchImpl, { maxCalls: 2 });
    expect((await c.classify(input)).ok).toBe(true);
    expect((await c.classify(input)).ok).toBe(true);
    expect(await c.classify(input)).toEqual({ ok: false, reason: 'cap' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(c.stats.capped).toBe(1);
    expect(c.callsLeft).toBe(0);
    expect(MAX_CLASSIFICATIONS_PER_RUN).toBe(60);
  });

  it('refuses to construct without an API key', () => {
    expect(() => new Classifier({ apiKey: '' })).toThrow(/OPENROUTER_API_KEY/);
  });
});

describe('over-long title follow-up', () => {
  // 47 chars: the classifier overshot; a plain trim gave «… на пустынной».
  const LONG = 'Финал гонки на закате на пустынной трассе в пустыне';
  const SHORT = 'Финал гонки на закате';

  it('asks the same model once to shorten and uses the answer', async () => {
    const fetchImpl = mockFetch(completion({ ...GOOD, title_ru: `«${LONG}».` }), completion({ title_ru: SHORT }));
    const c = classifier(fetchImpl);

    const result = await c.classify(input);
    expect(result.ok && result.title).toBe(SHORT);
    expect(result.ok && result.summary).toBe(GOOD.summary_ru);
    expect(c.stats).toMatchObject({ calls: 2, failed: 0, retries: 0, shortened: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const body = JSON.parse((fetchImpl.mock.calls[1]![1] as RequestInit).body as string);
    expect(body.model).toBe('openai/gpt-5-mini');
    expect(body.max_tokens).toBeLessThanOrEqual(100);
    expect(body.messages[0].content).toContain(`at most ${SHORT_TITLE_TARGET} characters`);
    // the cleaned phrase (quotes / period stripped), not the trimmed one
    expect(body.messages[1].content).toContain(`Title: ${LONG}`);
    expect(body.messages[1].content).toContain(GOOD.summary_ru);
  });

  it('does not follow up on a title that already fits', async () => {
    const fetchImpl = mockFetch(completion(GOOD), completion({ title_ru: 'x' }));
    const c = classifier(fetchImpl);
    const result = await c.classify(input);
    expect(result.ok && result.title).toBe(GOOD.title_ru);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(c.stats.shortened).toBe(0);
  });

  it('falls back to the trimmed title when the follow-up fails, without counting a failure', async () => {
    const trimmed = tidyTitle(LONG);
    expect(trimmed.length).toBeLessThanOrEqual(40);

    const nonJson = jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: 'nope' } }] });
    const c = classifier(mockFetch(completion({ ...GOOD, title_ru: LONG }), nonJson));
    const result = await c.classify(input);
    expect(result.ok && result.title).toBe(trimmed);
    expect(c.stats).toMatchObject({ calls: 2, failed: 0, shortened: 1 });

    // An empty answer fails the follow-up schema and falls back the same way.
    const empty = classifier(mockFetch(completion({ ...GOOD, title_ru: LONG }), completion({ title_ru: '' })));
    const result2 = await empty.classify(input);
    expect(result2.ok && result2.title).toBe(trimmed);
    expect(empty.stats).toMatchObject({ calls: 2, failed: 0, shortened: 1 });
  });

  it('trims a follow-up that is itself still too long, from the shorter phrase', async () => {
    const c = classifier(
      mockFetch(completion({ ...GOOD, title_ru: LONG }), completion({ title_ru: 'Финал гонки на закате на пустынной трассе' })),
    );
    const result = await c.classify(input);
    expect(result.ok && result.title).toBe('Финал гонки на закате на пустынной');
  });

  it('skips the follow-up (keeps the trim) when the per-run cap is spent', async () => {
    const fetchImpl = mockFetch(completion({ ...GOOD, title_ru: LONG }), completion({ title_ru: SHORT }));
    const c = classifier(fetchImpl, { maxCalls: 1 });
    const result = await c.classify(input);
    expect(result.ok && result.title).toBe(tidyTitle(LONG));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(c.stats).toMatchObject({ calls: 1, capped: 0, shortened: 0 });
    expect(c.callsLeft).toBe(0);
  });

  it('cleanTitle strips only the wrapper, never the length', () => {
    expect(cleanTitle(`«${LONG}».`)).toBe(LONG);
    expect(cleanTitle('Титры фильма «Пепел дня»')).toBe('Титры фильма «Пепел дня»');
  });
});
