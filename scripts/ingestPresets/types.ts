/**
 * Shared types for the preset ingest job (spec Ф4).
 *
 * The source payload is third-party and only loosely stable, so every field
 * that is not `id` is optional here — the filters treat a missing field as a
 * failed check rather than crashing the run.
 */

import type { ClassifierStats } from './classify';

export type Modality = 'image' | 'video';

export interface SourceAuthor {
  avatar?: string;
  name?: string;
  profileUrl?: string;
  username?: string;
  verified?: boolean;
}

export interface SourceStats {
  likes?: number;
  retweets?: number;
  views?: number;
}

/** One item as returned by `/api/videos` or `/api/images`. */
export interface SourceItem {
  aspectRatio?: string;
  author?: SourceAuthor;
  id: string;
  /** Poster (video) or first frame (image). */
  image?: string;
  imageHeight?: number;
  images?: string[];
  imageWidth?: number;
  mediaType?: string;
  model?: string;
  postedAt?: string;
  prompt?: string;
  stats?: SourceStats;
  /** Truncated prompt — used only as a title fallback. */
  title?: string;
  videoUrl?: string;
}

export interface CatalogPage {
  hasMore: boolean;
  items: SourceItem[];
  totalCount?: number;
}

/**
 * `publish` → row inserted with `active=true`.
 * `queue`   → row inserted with `active=false` (moderation queue, never deleted).
 * `skip`    → nothing is stored at all (safety stop-list or already known).
 */
export type Verdict = 'publish' | 'queue' | 'skip';

export interface Evaluation {
  /** Whitelisted aspect ratio the item was snapped to, when resolvable. */
  aspectRatio?: string;
  /** Machine-readable reasons, most specific first. */
  reasons: string[];
  requiresImage: boolean;
  verdict: Verdict;
}

/** A row ready to be written to `presets`. */
export interface PresetInsert {
  active: boolean;
  authorAvatar: string | null;
  authorName: string | null;
  authorUrl: string | null;
  category: string;
  /** One-line Russian summary of what the user will get (LLM step); `null` for heuristic rows. */
  description: string | null;
  externalId: string;
  license: string;
  modality: Modality;
  paramsLock: Record<string, string>;
  popularity: number;
  posterUrl: string | null;
  previewUrl: string;
  promptTemplate: string;
  recommendedModelId: string;
  requiresImage: boolean;
  slug: string;
  sortOrder: number;
  sourcePlatform: string;
  sourceUrl: string | null;
  title: string;
}

export interface RunReport {
  failedMedia: number;
  fetched: number;
  /** Token/cost accounting of the LLM labelling step; absent under `--no-llm`. */
  llm?: ClassifierStats;
  new: number;
  pagesFetched: number;
  published: number;
  queued: number;
  skippedDuplicate: number;
  /** Stop-list hits plus items the LLM flagged as unsafe. */
  skippedSafety: number;
  /** Subset of `skippedSafety` that came from the LLM rather than the stop-list. */
  skippedUnsafeLlm: number;
}
