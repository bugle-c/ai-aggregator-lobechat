import { type GenerationBatch } from '@/types/generation';

import { type ImageStoreState } from '../../initialState';
import { generationTopicSelectors } from '../generationTopic/selectors';

// ====== topic batch selectors ====== //

const getGenerationBatchesByTopicId = (topicId: string) => (s: ImageStoreState) => {
  return s.generationBatchesMap[topicId] || [];
};

const currentGenerationBatches = (s: ImageStoreState): GenerationBatch[] => {
  const activeTopicId = generationTopicSelectors.activeGenerationTopicId(s);
  if (!activeTopicId) return [];
  return getGenerationBatchesByTopicId(activeTopicId)(s);
};

const getGenerationBatchByBatchId = (batchId: string) => (s: ImageStoreState) => {
  const batches = currentGenerationBatches(s);
  return batches.find((batch) => batch.id === batchId);
};

const isCurrentGenerationTopicLoaded = (s: ImageStoreState): boolean => {
  const activeTopicId = generationTopicSelectors.activeGenerationTopicId(s);
  if (!activeTopicId) return false;
  return Array.isArray(s.generationBatchesMap[activeTopicId]);
};

// True iff the user has at least one batch on ANY topic. Used by the
// new flow page to decide the default tab (`presets` if empty,
// `feed` if filled).
const hasAnyBatches = (s: ImageStoreState): boolean =>
  Object.values(s.generationBatchesMap).some((arr) => Array.isArray(arr) && arr.length > 0);

// ====== aggregate selectors ====== //

export const generationBatchSelectors = {
  getGenerationBatchesByTopicId,
  currentGenerationBatches,
  getGenerationBatchByBatchId,
  hasAnyBatches,
  isCurrentGenerationTopicLoaded,
};
