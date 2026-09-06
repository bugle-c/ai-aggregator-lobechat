import type { PresetParamsLock } from '@/types/preset';

/**
 * Curated presets store their locked params in `params_lock` using the
 * snake_case names the ops/ingest side writes (`aspect_ratio`,
 * `duration_sec`). The runtime generation schemas
 * (`@lobechat/model-bank/standard-parameters`) declare camelCase names
 * (`aspectRatio`, `duration`). Spreading the raw keys into
 * `setParamOnInput` therefore silently dropped every curated value.
 *
 * This map translates the storage names into runtime parameter names.
 */
const PARAM_KEY_ALIASES: Record<string, string> = {
  aspect_ratio: 'aspectRatio',
  duration_sec: 'duration',
};

/**
 * Whitelist of runtime parameter keys accepted from `params_lock`.
 * Union of the image (`standard-parameters/index.ts`) and video
 * (`standard-parameters/video.ts`) schemas, minus `prompt` — the prompt
 * comes from `prompt_template` + user input, never from `params_lock`.
 *
 * Anything outside this set is ignored (with a warning) instead of being
 * pushed into the input as an unknown key.
 */
const ALLOWED_PARAM_KEYS = new Set<string>([
  'aspectRatio',
  'cameraFixed',
  'cfg',
  'duration',
  'endImageUrl',
  'generateAudio',
  'height',
  'imageUrl',
  'imageUrls',
  'quality',
  'resolution',
  'samplerName',
  'scheduler',
  'seed',
  'size',
  'steps',
  'strength',
  'width',
]);

export interface NormalizedPresetParam {
  key: string;
  value: unknown;
}

/**
 * Translate a preset's `params_lock` object into the list of
 * (runtime key, value) pairs that should be applied via `setParamOnInput`.
 *
 * - snake_case storage keys are mapped through `PARAM_KEY_ALIASES`
 * - already-correct camelCase keys pass through untouched
 * - `undefined` values are skipped
 * - unknown keys are dropped with a `console.warn` so bad curation is
 *   visible in the browser console instead of failing silently
 */
export const normalizePresetParams = (
  paramsLock: PresetParamsLock | null | undefined,
): NormalizedPresetParam[] => {
  if (!paramsLock || typeof paramsLock !== 'object' || Array.isArray(paramsLock)) return [];

  const result: NormalizedPresetParam[] = [];

  for (const [rawKey, value] of Object.entries(paramsLock)) {
    if (value === undefined) continue;

    const key = PARAM_KEY_ALIASES[rawKey] ?? rawKey;

    if (!ALLOWED_PARAM_KEYS.has(key)) {
      console.warn(
        `[preset] ignoring unknown params_lock key "${rawKey}" — not a known generation parameter`,
      );
      continue;
    }

    result.push({ key, value });
  }

  return result;
};
