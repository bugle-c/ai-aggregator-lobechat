/* eslint-disable perfectionist/sort-interfaces */
import {
  extractVideoDefaultValues,
  ModelProvider,
  type RuntimeVideoGenParams,
  type VideoModelParamsSchema,
} from 'model-bank';
import { seedance15ProParams } from 'model-bank/lobehub';

// Use a model that has an active rate in admin model_rates so
// chargeBeforeGenerate can route it correctly. The previous default
// `seedance-1-5-pro-251215` is not in model_rates → fetchRate falls back
// to __default__ → tier='premium' → silent 403 for everyone but pro_max.
// `bytedance/seedance-2.0-fast/text-to-video` ($0.077/sec → mid-tier) is
// the cheapest active text-to-video and is reachable from Basic upwards;
// free users now see the locked-model indicator instead of a silent skip.
export const DEFAULT_AI_VIDEO_PROVIDER = ModelProvider.LobeHub;
export const DEFAULT_AI_VIDEO_MODEL = 'bytedance/seedance-2.0-fast/text-to-video';

export interface VideoGenerationConfigState {
  parameters: RuntimeVideoGenParams;
  parametersSchema: VideoModelParamsSchema;

  provider: string;
  model: string;

  /**
   * Marks whether the configuration has been initialized (including restoration from memory)
   */
  isInit: boolean;
}

export const DEFAULT_VIDEO_GENERATION_PARAMETERS: RuntimeVideoGenParams =
  extractVideoDefaultValues(seedance15ProParams);

export const initialGenerationConfigState: VideoGenerationConfigState = {
  model: DEFAULT_AI_VIDEO_MODEL,
  provider: DEFAULT_AI_VIDEO_PROVIDER,
  parameters: DEFAULT_VIDEO_GENERATION_PARAMETERS,
  parametersSchema: seedance15ProParams,
  isInit: false,
};
