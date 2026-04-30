/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
import { type ModelParamsSchema, type RuntimeImageGenParams } from 'model-bank';
import { extractDefaultValues } from 'model-bank';
import { nanoBananaProParameters } from 'model-bank/google';

import { DEFAULT_IMAGE_CONFIG } from '@/const/settings';

// Cheapest active image rate ($0.015/img → cheap-tier) so free-plan users
// don't hit a silent 403 from chargeBeforeGenerate on first /image visit.
// Nano Banana Pro ($0.35/img → premium) was the previous default — silent
// failure for everyone except pro_max.
export const DEFAULT_AI_IMAGE_PROVIDER = 'lobehub';
export const DEFAULT_AI_IMAGE_MODEL = 'wavespeed-ai/flux-schnell';

export interface GenerationConfigState {
  parameters: RuntimeImageGenParams;
  parametersSchema: ModelParamsSchema;

  provider: string;
  model: string;
  imageNum: number;

  isAspectRatioLocked: boolean;
  activeAspectRatio: string | null; // string - virtual ratio; null - native ratio

  /**
   * Marks whether the configuration has been initialized (including restoration from memory)
   */
  isInit: boolean;
}

export const DEFAULT_IMAGE_GENERATION_PARAMETERS: RuntimeImageGenParams =
  extractDefaultValues(nanoBananaProParameters);

export const initialGenerationConfigState: GenerationConfigState = {
  model: DEFAULT_AI_IMAGE_MODEL,
  provider: DEFAULT_AI_IMAGE_PROVIDER,
  imageNum: DEFAULT_IMAGE_CONFIG.defaultImageNum,
  parameters: DEFAULT_IMAGE_GENERATION_PARAMETERS,
  parametersSchema: nanoBananaProParameters,
  isAspectRatioLocked: false,
  activeAspectRatio: null,
  isInit: false,
};
