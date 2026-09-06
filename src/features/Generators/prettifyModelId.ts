/**
 * Format a canonical model_id like
 * `bytedance/seedance-2.0-fast/text-to-video` into a user-readable
 * label `Seedance 2.0 Fast`. Falls back to a title-cased bare slug
 * (`flux-pro` → `Flux Pro`).
 *
 * We don't fetch the real `displayName` from `model-bank` here to keep
 * callers a pure derivation of the data they already hold. If the
 * prettified label diverges from the registry's canonical name for a
 * given model, upgrade to a full lookup later.
 */
export const prettifyModelId = (modelId: string): string => {
  const parts = modelId.split('/');
  const core = parts.length >= 2 ? parts[1] : parts[0];
  return core
    .split('-')
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
};
