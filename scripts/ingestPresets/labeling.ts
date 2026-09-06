/**
 * Merge the heuristic evaluation with the LLM classification.
 *
 * Pure and synchronous so the precedence rules are unit-testable:
 *   - `requires_image` is heuristic OR llm — the regex and the model can each
 *     catch what the other misses, and a false positive only parks the item
 *     in the moderation queue, never deletes it;
 *   - an item the model flags as unsafe is a safety skip (nothing stored),
 *     exactly like a stop-list hit;
 *   - title / category / description come from the model when the call
 *     succeeded, from the heuristics otherwise. A category slug we do not
 *     have falls back to the heuristic slug on its own, without discarding
 *     the rest of the answer.
 */
import type { ClassifyResult } from './classify';
import type { Evaluation } from './types';

/** Reason appended when only the LLM detected the reference-image dependency. */
export const REQUIRES_IMAGE_LLM_REASON = 'requires-image-llm';

export interface Labels {
  category: string;
  description: string | null;
  title: string;
}

export interface LabelDecision {
  /** Evaluation with the merged `requiresImage` and, if needed, the verdict demoted to `queue`. */
  evaluation: Evaluation;
  labels: Labels;
  source: 'heuristic' | 'llm';
  /** True when the model flagged the item — the caller must not store it. */
  unsafe: boolean;
}

export const mergeLabels = ({
  evaluation,
  heuristic,
  llm,
}: {
  evaluation: Evaluation;
  heuristic: Labels;
  llm: ClassifyResult | null;
}): LabelDecision => {
  if (!llm || !llm.ok) {
    return { evaluation, labels: heuristic, source: 'heuristic', unsafe: false };
  }

  const requiresImage = evaluation.requiresImage || llm.requiresImage;
  const addedByLlm = requiresImage && !evaluation.requiresImage;

  const merged: Evaluation = addedByLlm
    ? {
        ...evaluation,
        reasons: [...evaluation.reasons, REQUIRES_IMAGE_LLM_REASON],
        requiresImage,
        // i2v presets wait for the Ф5 model-switch UX, whoever detected them.
        verdict: evaluation.verdict === 'publish' ? 'queue' : evaluation.verdict,
      }
    : evaluation;

  return {
    evaluation: merged,
    labels: {
      category: llm.category ?? heuristic.category,
      description: llm.summary,
      title: llm.title,
    },
    source: 'llm',
    unsafe: llm.unsafe,
  };
};
