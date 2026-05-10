import { type CreateVideoState, initialCreateVideoState } from './slices/createVideo/initialState';
import {
  type GenerationBatchState,
  initialGenerationBatchState,
} from './slices/generationBatch/initialState';
import {
  initialGenerationConfigState,
  type VideoGenerationConfigState,
} from './slices/generationConfig/initialState';
import {
  type GenerationTopicState,
  initialGenerationTopicState,
} from './slices/generationTopic/initialState';
import { initialPresetState, type PresetState } from './slices/preset/action';

export type VideoStoreState = VideoGenerationConfigState &
  GenerationTopicState &
  GenerationBatchState &
  CreateVideoState &
  PresetState;

export const initialState: VideoStoreState = {
  ...initialGenerationConfigState,
  ...initialGenerationTopicState,
  ...initialGenerationBatchState,
  ...initialCreateVideoState,
  ...initialPresetState,
};
