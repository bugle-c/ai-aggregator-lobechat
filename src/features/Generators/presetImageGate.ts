/**
 * Reference-image gate for image-to-video presets (spec Ф5).
 *
 * An i2v preset (`requiresImage`) is a prompt written around a photo the
 * user supplies; running it without one wastes credits on a clip about
 * nothing. The gate is pure so the desktop CTA, the mobile CTA, the Enter
 * key in the prompt and the store action all agree on one answer.
 *
 * The photo itself is the video store's `parameters.imageUrl` — the same
 * parameter the ConfigPanel's start-frame uploader writes — and the runtime
 * routes the paired `/text-to-video` model to its `/image-to-video`
 * endpoint when that parameter is set.
 */

/** The preset fields the gate looks at; both `Preset` and `PresetListItem` fit. */
export interface GatedPreset {
  promptTemplate?: string;
  requiresImage: boolean;
}

export const hasReferenceImage = (value: unknown): boolean =>
  typeof value === 'string' && value.trim().length > 0;

export type PresetImageGate =
  /** The preset does not need a photo (or there is no preset). */
  | { kind: 'none' }
  /** Needs a photo and one is attached. */
  | { kind: 'ready' }
  /** Needs a photo and nothing is attached — block the run. */
  | { kind: 'missing' };

export const decidePresetImageGate = (input: {
  imageUrl: unknown;
  preset: GatedPreset | null | undefined;
}): PresetImageGate => {
  if (!input.preset?.requiresImage) return { kind: 'none' };
  return hasReferenceImage(input.imageUrl) ? { kind: 'ready' } : { kind: 'missing' };
};

export type GenerateBlocker = 'generating' | 'empty' | 'missing-image';

export interface GenerateReadiness {
  /** Why the CTA is disabled, most user-actionable first; `null` when it is not. */
  blocker: GenerateBlocker | null;
  canGenerate: boolean;
}

/**
 * Whether «Сгенерировать» may fire. A selected style is a ready prompt, so
 * an empty input with a style is fine; an i2v style additionally needs its
 * photo. Removing the style lifts that requirement with it.
 */
export const decideGenerateReadiness = (input: {
  imageUrl: unknown;
  isGenerating: boolean;
  preset: GatedPreset | null | undefined;
  prompt: string;
}): GenerateReadiness => {
  if (input.isGenerating) return { blocker: 'generating', canGenerate: false };

  const hasWords = input.prompt.trim().length > 0 || !!input.preset?.promptTemplate;
  if (!hasWords) return { blocker: 'empty', canGenerate: false };

  if (decidePresetImageGate(input).kind === 'missing') {
    return { blocker: 'missing-image', canGenerate: false };
  }

  return { blocker: null, canGenerate: true };
};
