import { beforeEach, describe, expect, it, vi } from 'vitest';

import { convertHeicToJpeg, isHeic } from '../heic';

const toBuffer = vi.fn();
const jpeg = vi.fn(() => ({ toBuffer }));
const rotate = vi.fn(() => ({ jpeg }));
vi.mock('sharp', () => ({ default: vi.fn(() => ({ rotate })) }));

describe('isHeic', () => {
  it('detects by mime and by extension, case-insensitive', () => {
    expect(isHeic('image/heic', 'a.bin')).toBe(true);
    expect(isHeic('image/HEIF', 'a.bin')).toBe(true);
    expect(isHeic('application/octet-stream', 'IMG_8735 (1).HEIC')).toBe(true);
    expect(isHeic('image/jpeg', 'photo.jpg')).toBe(false);
    expect(isHeic(undefined, undefined)).toBe(false);
  });
});

describe('convertHeicToJpeg', () => {
  const fs = {
    deleteFile: vi.fn().mockResolvedValue(undefined),
    getFileByteArray: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    uploadBuffer: vi.fn().mockResolvedValue({ key: 'x' }),
  };
  beforeEach(() => {
    vi.clearAllMocks();
    toBuffer.mockResolvedValue(Buffer.from('jpeg-bytes'));
  });

  it('re-encodes with EXIF rotation, uploads as image/jpeg next to the original, deletes the original', async () => {
    const r = await convertHeicToJpeg(fs, { key: 'files/1/abc.heic', name: 'IMG_8735 (1).heic' });
    expect(rotate).toHaveBeenCalled();
    expect(jpeg).toHaveBeenCalledWith({ quality: 90 });
    expect(fs.uploadBuffer).toHaveBeenCalledWith(
      'files/1/abc.jpg',
      Buffer.from('jpeg-bytes'),
      'image/jpeg',
    );
    expect(fs.deleteFile).toHaveBeenCalledWith('files/1/abc.heic');
    expect(r).toMatchObject({
      fileType: 'image/jpeg',
      key: 'files/1/abc.jpg',
      name: 'IMG_8735 (1).jpg',
      size: 10,
    });
    expect(r!.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns null (keeps original) when decoding fails', async () => {
    toBuffer.mockRejectedValueOnce(new Error('unsupported image format'));
    const r = await convertHeicToJpeg(fs, { key: 'files/1/bad.heic', name: 'bad.heic' });
    expect(r).toBeNull();
    expect(fs.uploadBuffer).not.toHaveBeenCalled();
    expect(fs.deleteFile).not.toHaveBeenCalled();
  });
});
