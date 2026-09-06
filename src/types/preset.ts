export type PresetModality = 'image' | 'video';

// `trend_of_month` is a more prominent variant of `trending` — the badge
// renders as a text pill "Тренд месяца" instead of the small 🔥 emoji,
// reserved for the one-or-two presets ops actively wants to push that
// month. Keeping `trending` around for the regular hot-list use.
export type PresetBadge = 'top_choice' | 'mixed' | 'new' | 'trending' | 'trend_of_month';

export interface PresetParamsLock {
  // intentionally permissive — model-specific params live here as raw JSON
  [k: string]: unknown;
  aspect_ratio?: string;
  cfg?: number;
  duration_sec?: number;
  steps?: number;
}

export interface Preset {
  authorAvatar: string | null;
  authorName: string | null;
  authorUrl: string | null;
  badges: PresetBadge[];
  category: string;
  description: string | null;
  /** Id in the source catalogue; dedup key for the ingest job. */
  externalId: string | null;
  id: number;
  ingestedAt: string | null;
  license: string | null;
  modality: PresetModality;
  paramsLock: PresetParamsLock;
  /** Source-side popularity signal (likes) used for ranking. */
  popularity: number | null;
  /** Still frame shown before the mp4 preview loads. */
  posterUrl: string | null;
  previewUrl: string;
  promptTemplate: string;
  /** Suggested model. UI surfaces a hint when it differs from the current model. */
  recommendedModelId: string | null;
  /** True for image-to-video presets that need a reference image. */
  requiresImage: boolean;
  slug: string;
  sortOrder: number;
  /** Where the preset was ingested from, e.g. 'meigen'. */
  sourcePlatform: string | null;
  /** Canonical link to the original post, rendered as «Источник ↗». */
  sourceUrl: string | null;
  title: string;
}

export interface PresetListFilters {
  category?: string;
  modality: PresetModality;
  q?: string;
  /** Filters by `recommended_model_id`. */
  recommendedModelId?: string;
}
