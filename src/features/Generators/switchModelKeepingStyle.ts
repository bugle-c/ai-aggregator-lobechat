import type { Preset } from '@/types/preset';

/** The slice of the image / video store a style-aware model switch needs. */
export interface StyleAwareStore {
  currentPreset: Preset | null;
  parameters?: { imageUrl?: unknown; prompt?: unknown } | null;
  parametersSchema?: object | null;
  selectPreset: (preset: Preset) => void;
  setModelAndProviderOnSelect: (modelId: string, providerId: string) => void;
  setParamOnInput: (key: any, value: any) => void;
}

/**
 * Switch the model without losing the style. `setModelAndProviderOnSelect`
 * resets `parameters` to the new model's defaults, which used to drop the
 * style's `params_lock`, the user's own words and the photo they attached.
 * Re-applies all three afterwards (photo only when the new model takes one).
 */
export const switchModelKeepingStyle = (
  getState: () => StyleAwareStore,
  modelId: string,
  providerId: string,
): void => {
  const before = getState();
  const prevPrompt = before.parameters?.prompt;
  const prevImage = before.parameters?.imageUrl;

  before.setModelAndProviderOnSelect(modelId, providerId);

  const after = getState();
  if (after.currentPreset) after.selectPreset(after.currentPreset);
  if (typeof prevPrompt === 'string' && prevPrompt) after.setParamOnInput('prompt', prevPrompt);
  if (
    typeof prevImage === 'string' &&
    prevImage &&
    after.parametersSchema &&
    'imageUrl' in after.parametersSchema
  )
    after.setParamOnInput('imageUrl', prevImage);
};
