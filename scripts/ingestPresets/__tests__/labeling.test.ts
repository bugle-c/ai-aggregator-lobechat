import { describe, expect, it } from 'vitest';

import type { ClassifyOk } from '../classify';
import { mergeLabels, REQUIRES_IMAGE_LLM_REASON } from '../labeling';
import type { Evaluation } from '../types';

const heuristic = { category: 'trends', description: null, title: 'Портрет: макро' };

const llmOk = (overrides: Partial<ClassifyOk> = {}): ClassifyOk => ({
  category: 'ad',
  ok: true,
  rawCategory: 'ad',
  requiresImage: false,
  summary: 'Рекламный ролик бургера',
  title: 'Реклама бургера в стиле кино',
  unsafe: false,
  ...overrides,
});

const publish: Evaluation = { aspectRatio: '16:9', reasons: [], requiresImage: false, verdict: 'publish' };

describe('mergeLabels', () => {
  it('uses heuristic labels when the LLM was off or failed', () => {
    expect(mergeLabels({ evaluation: publish, heuristic, llm: null })).toEqual({
      evaluation: publish,
      labels: heuristic,
      source: 'heuristic',
      unsafe: false,
    });
    const failed = mergeLabels({ evaluation: publish, heuristic, llm: { ok: false, reason: 'cap' } });
    expect(failed.source).toBe('heuristic');
    expect(failed.labels).toBe(heuristic);
  });

  it('takes title, category and description from a successful call', () => {
    const decision = mergeLabels({ evaluation: publish, heuristic, llm: llmOk() });
    expect(decision.source).toBe('llm');
    expect(decision.labels).toEqual({
      category: 'ad',
      description: 'Рекламный ролик бургера',
      title: 'Реклама бургера в стиле кино',
    });
    expect(decision.evaluation).toBe(publish);
  });

  it('falls back to the heuristic category alone when the LLM slug is unknown', () => {
    const decision = mergeLabels({
      evaluation: publish,
      heuristic,
      llm: llmOk({ category: null, rawCategory: 'food' }),
    });
    expect(decision.labels.category).toBe('trends');
    expect(decision.labels.title).toBe('Реклама бургера в стиле кино');
  });

  describe('requires_image precedence (heuristic OR llm)', () => {
    it('LLM-only detection demotes publish to queue with its own reason', () => {
      const decision = mergeLabels({ evaluation: publish, heuristic, llm: llmOk({ requiresImage: true }) });
      expect(decision.evaluation).toEqual({
        ...publish,
        reasons: [REQUIRES_IMAGE_LLM_REASON],
        requiresImage: true,
        verdict: 'queue',
      });
    });

    it('heuristic detection is never cleared by the LLM', () => {
      const queued: Evaluation = {
        reasons: ['requires-image-pending-f5'],
        requiresImage: true,
        verdict: 'queue',
      };
      const decision = mergeLabels({ evaluation: queued, heuristic, llm: llmOk({ requiresImage: false }) });
      expect(decision.evaluation).toBe(queued);
      expect(decision.evaluation.requiresImage).toBe(true);
    });

    it('LLM detection on an already-queued item adds the reason but keeps queue', () => {
      const queued: Evaluation = { reasons: ['low-likes'], requiresImage: false, verdict: 'queue' };
      const decision = mergeLabels({ evaluation: queued, heuristic, llm: llmOk({ requiresImage: true }) });
      expect(decision.evaluation.verdict).toBe('queue');
      expect(decision.evaluation.reasons).toEqual(['low-likes', REQUIRES_IMAGE_LLM_REASON]);
    });
  });

  it('propagates the unsafe flag so the caller skips the item', () => {
    const decision = mergeLabels({ evaluation: publish, heuristic, llm: llmOk({ unsafe: true }) });
    expect(decision.unsafe).toBe(true);
    expect(mergeLabels({ evaluation: publish, heuristic, llm: llmOk() }).unsafe).toBe(false);
  });
});
