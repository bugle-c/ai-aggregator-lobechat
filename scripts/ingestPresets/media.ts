/**
 * Media pipeline: CDN download → ffmpeg → RustFS via the S3 API.
 *
 * The media CDN (`images.meigen.ai`) is NOT behind the Cloudflare challenge
 * that guards the listing API, so these fetches go direct — no reader proxy.
 *
 * NEVER write into the RustFS data directory on the host: bare directories
 * created outside the S3 API corrupt its metadata and every later PUT returns
 * AccessDenied (KNOWLEDGE.md, "RustFS gotcha"). Everything goes through
 * PutObject.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { posterKeyFor, previewKeyFor, publicUrlFor } from './derive';
import type { Modality } from './types';

const execFileAsync = promisify(execFile);

const YEAR_SECONDS = 365 * 24 * 60 * 60;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const FFMPEG_TIMEOUT_MS = 180_000;

export const videoSourceUrl = (externalId: string) =>
  `https://images.meigen.ai/videos/${externalId}/video.mp4`;
export const posterSourceUrl = (externalId: string) =>
  `https://images.meigen.ai/videos/${externalId}/thumb.jpg`;

// --- S3 ---------------------------------------------------------------------

export interface S3Config {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  forcePathStyle: boolean;
  region: string;
  secretAccessKey: string;
}

export const s3ConfigFromEnv = (env = process.env): S3Config => {
  const accessKeyId = env.S3_ACCESS_KEY_ID || env.S3_ACCESS_KEY || env.RUSTFS_ACCESS_KEY;
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY || env.RUSTFS_SECRET_KEY;
  const endpoint = env.S3_ENDPOINT;
  const bucket = env.S3_BUCKET || env.RUSTFS_LOBE_BUCKET;

  if (!accessKeyId || !secretAccessKey || !endpoint || !bucket) {
    throw new Error(
      'S3 is not configured: need S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_ENDPOINT, S3_BUCKET',
    );
  }

  return {
    accessKeyId,
    bucket,
    endpoint,
    // RustFS is path-style; only an explicit "0" turns it off.
    forcePathStyle: env.S3_ENABLE_PATH_STYLE !== '0',
    region: env.S3_REGION || 'us-east-1',
    secretAccessKey,
  };
};

export class MediaUploader {
  private readonly client: S3Client;

  private readonly bucket: string;

  constructor(config: S3Config) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      region: config.region,
      // refs: https://github.com/lobehub/lobe-chat/pull/5479
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Body: body,
        Bucket: this.bucket,
        CacheControl: `public, max-age=${YEAR_SECONDS}`,
        ContentType: contentType,
        Key: key,
      }),
    );
  }
}

// --- download + transcode ---------------------------------------------------

const download = async (url: string, destination: string): Promise<number> => {
  const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0) throw new Error(`GET ${url} → empty body`);
  await writeFile(destination, buffer);
  return buffer.length;
};

const ffmpeg = async (args: string[]): Promise<void> => {
  await execFileAsync('ffmpeg', args, { timeout: FFMPEG_TIMEOUT_MS });
};

/** 5s, silent, 640px-wide h264 — 11 MB sources come out at 80–440 KB. */
export const transcodeVideo = async (source: string, destination: string): Promise<void> => {
  await ffmpeg([
    '-y',
    '-v',
    'error',
    '-i',
    source,
    '-t',
    '5',
    '-an',
    '-vf',
    'scale=640:-2:flags=lanczos,fps=24',
    '-c:v',
    'libx264',
    '-profile:v',
    'high',
    '-crf',
    '30',
    '-preset',
    'slow',
    '-movflags',
    '+faststart',
    destination,
  ]);
};

export const toWebp = async (source: string, destination: string): Promise<void> => {
  await ffmpeg([
    '-y',
    '-v',
    'error',
    '-i',
    source,
    '-vf',
    'scale=640:-2:flags=lanczos',
    '-c:v',
    'libwebp',
    '-quality',
    '82',
    destination,
  ]);
};

export interface ProcessedMedia {
  posterUrl: string | null;
  previewUrl: string;
  /** Bytes uploaded, for the run log. */
  size: number;
}

/**
 * Download, convert and upload one item's media. Temp files always cleaned up.
 * Throws on any failure — the caller counts the item as `failed-media` and
 * stores nothing (a preset row without a `preview_url` is not insertable).
 */
export const processMedia = async (
  uploader: MediaUploader,
  externalId: string,
  modality: Modality,
  sourceUrl: string,
): Promise<ProcessedMedia> => {
  const dir = await mkdtemp(path.join(tmpdir(), `preset-${externalId}-`));

  try {
    if (modality === 'video') {
      const rawVideo = path.join(dir, 'source.mp4');
      const outVideo = path.join(dir, 'out.mp4');
      await download(sourceUrl, rawVideo);
      await transcodeVideo(rawVideo, outVideo);

      const videoKey = previewKeyFor(externalId, 'video');
      const videoBuffer = await readFile(outVideo);
      if (videoBuffer.length === 0) throw new Error('ffmpeg produced an empty mp4');
      await uploader.put(videoKey, videoBuffer, 'video/mp4');

      // A missing poster degrades the card but must not lose the preset.
      let posterUrl: string | null = null;
      let posterSize = 0;
      try {
        const rawPoster = path.join(dir, 'thumb.jpg');
        const outPoster = path.join(dir, 'poster.webp');
        await download(posterSourceUrl(externalId), rawPoster);
        await toWebp(rawPoster, outPoster);
        const posterBuffer = await readFile(outPoster);
        const posterKey = posterKeyFor(externalId);
        await uploader.put(posterKey, posterBuffer, 'image/webp');
        posterUrl = publicUrlFor(posterKey);
        posterSize = posterBuffer.length;
      } catch (error) {
        console.warn(`[ingest] poster failed for ${externalId}: ${String(error)}`);
      }

      return {
        posterUrl,
        previewUrl: publicUrlFor(videoKey),
        size: videoBuffer.length + posterSize,
      };
    }

    const rawImage = path.join(dir, 'source.jpg');
    const outImage = path.join(dir, 'out.webp');
    await download(sourceUrl, rawImage);
    await toWebp(rawImage, outImage);

    const key = previewKeyFor(externalId, 'image');
    const buffer = await readFile(outImage);
    if (buffer.length === 0) throw new Error('ffmpeg produced an empty webp');
    await uploader.put(key, buffer, 'image/webp');

    const url = publicUrlFor(key);
    // For images the preview *is* the poster — one object, one URL.
    return { posterUrl: url, previewUrl: url, size: buffer.length };
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
};

/** Preflight: fail fast with a clear message instead of per-item ffmpeg errors. */
export const assertFfmpegAvailable = async (): Promise<void> => {
  await execFileAsync('ffmpeg', ['-version'], { timeout: 10_000 });
};
