export type PresetModality = 'image' | 'video';

export type PresetBadge = 'top_choice' | 'mixed' | 'new' | 'trending';

export interface PresetParamsLock {
  // intentionally permissive — model-specific params live here as raw JSON
  [k: string]: unknown;
  aspect_ratio?: string;
  cfg?: number;
  duration_sec?: number;
  steps?: number;
}

export interface Preset {
  badges: PresetBadge[];
  category: string;
  description: string | null;
  id: number;
  modality: PresetModality;
  paramsLock: PresetParamsLock;
  previewUrl: string;
  promptTemplate: string;
  /** Suggested model. UI surfaces a hint when it differs from the current model. */
  recommendedModelId: string | null;
  slug: string;
  sortOrder: number;
  title: string;
}

export interface PresetListFilters {
  category?: string;
  modality: PresetModality;
  q?: string;
  /** Filters by `recommended_model_id`. */
  recommendedModelId?: string;
}
