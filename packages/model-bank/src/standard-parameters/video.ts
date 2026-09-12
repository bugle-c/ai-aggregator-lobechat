/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
import type { Simplify } from 'type-fest';
import { z } from 'zod';

export const MAX_VIDEO_SEED = 2 ** 32 - 1;

export const PRESET_VIDEO_ASPECT_RATIOS = [
  '16:9', // Landscape video standard
  '9:16', // Portrait/short-form video
  '1:1', // Square
  '4:3', // Traditional
  '3:4', // Portrait traditional
  '21:9', // Ultra-wide cinematic
];

export const PRESET_VIDEO_RESOLUTIONS = ['480p', '720p', '1080p'];

export const VideoModelParamsMetaSchema = z.object({
  prompt: z.object({
    default: z.string().optional().default(''),
    description: z.string().optional(),
    type: z.literal('string').optional(),
  }),

  imageUrl: z
    .object({
      default: z.string().nullable().optional(),
      description: z.string().optional(),
      maxFileSize: z.number().optional(),
      type: z.tuple([z.literal('string'), z.literal('null')]).optional(),
    })
    .optional(),

  endImageUrl: z
    .object({
      default: z.string().nullable().optional(),
      description: z.string().optional(),
      maxFileSize: z.number().optional(),
      requiresImageUrl: z.boolean().optional(),
      type: z.tuple([z.literal('string'), z.literal('null')]).optional(),
    })
    .optional(),

  aspectRatio: z
    .object({
      default: z.string(),
      description: z.string().optional(),
      enum: z.array(z.string()),
      type: z.literal('string').optional(),
    })
    .optional(),

  resolution: z
    .object({
      default: z.string(),
      description: z.string().optional(),
      enum: z.array(z.string()),
      type: z.literal('string').optional(),
    })
    .optional(),

  duration: z
    .object({
      default: z.number(),
      description: z.string().optional(),
      max: z.number(),
      min: z.number(),
      step: z.number().optional().default(1),
      type: z.literal('number').optional(),
    })
    .optional(),

  cameraFixed: z
    .object({
      default: z.boolean().default(false),
      description: z.string().optional(),
      type: z.literal('boolean').optional(),
    })
    .optional(),

  generateAudio: z
    .object({
      default: z.boolean().default(true),
      description: z.string().optional(),
      type: z.literal('boolean').optional(),
    })
    .optional(),

  seed: z
    .object({
      default: z.number().nullable().default(null),
      description: z.string().optional(),
      max: z.number().optional().default(MAX_VIDEO_SEED),
      min: z.number().optional().default(-1),
      type: z.tuple([z.literal('number'), z.literal('null')]).optional(),
    })
    .optional(),
  /**
   * Reference images (style / character / composition guidance) for models
   * that take them next to the prompt — Seedance 2.0 Mini and full 2.0
   * (`reference_images`, ≤ 9). Unlike `imageUrl` this is NOT a start frame
   * and does not switch the model to its image-to-video endpoint.
   */
  imageUrls: z
    .object({
      default: z.array(z.string()),
      description: z.string().optional(),
      maxCount: z.number().optional(),
      maxFileSize: z.number().optional(),
      type: z.literal('array').optional(),
    })
    .optional(),
  /**
   * Reference videos (camera / motion guidance), `reference_videos` ≤ 3,
   * combined length ≤ `maxTotalSeconds`. The provider bills their normalized
   * duration at the output rate — see `referenceSeconds`.
   */
  videoUrls: z
    .object({
      default: z.array(z.string()),
      description: z.string().optional(),
      maxCount: z.number().optional(),
      maxFileSize: z.number().optional(),
      maxTotalSeconds: z.number().optional(),
      type: z.literal('array').optional(),
    })
    .optional(),
  /**
   * Billable seconds of the attached reference videos (each clip ≥ 2 s,
   * combined ≤ 15 s, rounded up) — measured on the client when the clips are
   * attached, clamped server-side. Not a user-facing knob.
   */
  referenceSeconds: z
    .object({
      default: z.number().default(0),
      type: z.literal('number').optional(),
    })
    .optional(),
});

export type VideoModelParamsSchema = z.input<typeof VideoModelParamsMetaSchema>;
export type VideoModelParamsOutputSchema = z.output<typeof VideoModelParamsMetaSchema>;
export type VideoModelParamsKeys = Simplify<keyof VideoModelParamsOutputSchema>;

type VideoTypeMapping<T> = T extends 'string'
  ? string
  : T extends 'number'
    ? number
    : T extends ['number', 'null']
      ? number | null
      : T extends ['string', 'null']
        ? string | null
        : T extends 'boolean'
          ? boolean
          : never;

type VideoTypeType<K extends VideoModelParamsKeys> = NonNullable<
  VideoModelParamsOutputSchema[K]
>['type'];
type _StandardVideoGenerationParameters<P extends VideoModelParamsKeys = VideoModelParamsKeys> = {
  [key in P]: NonNullable<VideoTypeType<key>> extends 'array'
    ? string[]
    : VideoTypeMapping<VideoTypeType<key>>;
};

export type RuntimeVideoGenParams = Pick<_StandardVideoGenerationParameters, 'prompt'> &
  Partial<Omit<_StandardVideoGenerationParameters, 'prompt'>>;
export type RuntimeVideoGenParamsKeys = keyof RuntimeVideoGenParams;
export type RuntimeVideoGenParamsValue = RuntimeVideoGenParams[RuntimeVideoGenParamsKeys];

export function validateVideoModelParamsSchema(
  paramsSchema: unknown,
): VideoModelParamsOutputSchema {
  return VideoModelParamsMetaSchema.parse(paramsSchema);
}

/**
 * Extract default values from video parameter definition object
 */
export function extractVideoDefaultValues(paramsSchema: VideoModelParamsSchema) {
  const schemaWithDefault = VideoModelParamsMetaSchema.parse(paramsSchema);
  return Object.fromEntries(
    Object.entries(schemaWithDefault).map(([key, value]) => {
      return [key, value.default];
    }),
  ) as RuntimeVideoGenParams;
}
