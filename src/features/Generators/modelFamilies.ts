/**
 * Model families whose members differ only in quality / price and take the
 * same prompt and parameters. The settings strip shows them as one
 * «Качество» switch next to the model chip instead of three rows in the
 * picker, and a style tuned for one member is considered a match for any of
 * them (the prompt does not change; only the render tier does).
 */
export interface FamilyVariant {
  label: string;
  modelId: string;
}

export interface ModelFamily {
  id: string;
  variants: readonly FamilyVariant[];
}

export const MODEL_FAMILIES: readonly ModelFamily[] = [
  {
    id: 'seedance-2.0',
    variants: [
      { label: 'Mini', modelId: 'bytedance/seedance-2.0-mini/text-to-video' },
      { label: 'Fast', modelId: 'bytedance/seedance-2.0-fast/text-to-video' },
      { label: 'Pro', modelId: 'bytedance/seedance-2.0/text-to-video' },
    ],
  },
];

export const familyOf = (modelId: string | null | undefined): ModelFamily | null => {
  if (!modelId) return null;
  return MODEL_FAMILIES.find((f) => f.variants.some((v) => v.modelId === modelId)) ?? null;
};

/** True when both ids belong to the same family (or are the same id). */
export const sameFamily = (a: string | null | undefined, b: string | null | undefined): boolean => {
  if (!a || !b) return false;
  if (a === b) return true;
  const fa = familyOf(a);
  return !!fa && fa === familyOf(b);
};
