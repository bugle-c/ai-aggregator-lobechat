import { createHash } from 'node:crypto';

import sharp from 'sharp';

import { type FileService } from '@/server/services/file';

/**
 * iPhone photos arrive as HEIC/HEIF. Every chat provider rejects that
 * media type (Anthropic: invalid `media_type`; OpenAI/Azure: "does not
 * represent a valid image" — only jpeg/png/gif/webp are accepted), so a
 * message with such an attachment fails on every model. The browser
 * uploads straight to S3 via a presigned URL, so the only server-side
 * hook is file-record creation: re-encode to JPEG there and swap the
 * record to the converted object. Non-HEIC files pass through untouched.
 *
 * Best-effort by contract: any failure returns `null` and the caller keeps
 * the original file (the user then sees the provider error, as before).
 */
export interface HeicConversionResult {
  fileType: 'image/jpeg';
  hash: string;
  key: string;
  name: string;
  size: number;
}

const HEIC_TYPES = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]);
const HEIC_EXT = /\.(heic|heif)$/i;

export function isHeic(
  fileType: string | undefined | null,
  name: string | undefined | null,
): boolean {
  if (fileType && HEIC_TYPES.has(fileType.toLowerCase())) return true;
  return !!name && HEIC_EXT.test(name);
}

export async function convertHeicToJpeg(
  fileService: Pick<FileService, 'getFileByteArray' | 'uploadBuffer' | 'deleteFile'>,
  file: { key: string; name: string },
): Promise<HeicConversionResult | null> {
  try {
    const bytes = await fileService.getFileByteArray(file.key);
    // `.rotate()` applies the EXIF orientation — iPhone shots are often
    // stored sideways with an orientation tag that providers ignore.
    const jpeg = await sharp(Buffer.from(bytes)).rotate().jpeg({ quality: 90 }).toBuffer();

    const key = file.key.replace(HEIC_EXT, '') + '.jpg';
    const name = file.name.replace(HEIC_EXT, '') + '.jpg';
    await fileService.uploadBuffer(key, jpeg, 'image/jpeg');
    // Drop the original so we don't store both; ignore failures.
    if (key !== file.key) await fileService.deleteFile(file.key).catch(() => undefined);

    return {
      fileType: 'image/jpeg',
      hash: createHash('sha256').update(jpeg).digest('hex'),
      key,
      name,
      size: jpeg.length,
    };
  } catch (error) {
    console.error('[heic] conversion failed, keeping original file %s: %O', file.key, error);
    return null;
  }
}
