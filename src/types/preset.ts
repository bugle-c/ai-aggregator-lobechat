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
  modelId: string;
  paramsLock: PresetParamsLock;
  previewUrl: string;
  promptTemplate: string;
  slug: string;
  sortOrder: number;
  title: string;
}

export interface PresetListFilters {
  category?: string;
  modality: PresetModality;
  modelId?: string;
  q?: string;
}
