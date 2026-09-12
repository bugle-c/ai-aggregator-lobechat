'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { App, Button, Progress } from 'antd';
import { createStyles } from 'antd-style';
import { Clapperboard, Plus, X } from 'lucide-react';
import { memo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useFileStore } from '@/store/file';
import { useVideoStore } from '@/store/video';
import { useVideoGenerationConfigParam } from '@/store/video/slices/generationConfig/hooks';

/** Provider normalises every clip to at least this many seconds for billing. */
const MIN_CLIP_SECONDS = 2;
const DEFAULT_MAX_TOTAL_SECONDS = 15;
const DEFAULT_MAX_COUNT = 3;

const useStyles = createStyles(({ css, token }) => ({
  row: css`
    display: flex;
    gap: 8px;
    align-items: center;

    padding: 6px 8px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;

    font-size: 12px;
  `,
  name: css`
    overflow: hidden;
    flex: 1 1 auto;

    min-inline-size: 0;

    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  seconds: css`
    flex: 0 0 auto;
    font-variant-numeric: tabular-nums;
    color: ${token.colorTextSecondary};
  `,
  hint: css`
    font-size: 11px;
    line-height: 1.35;
    color: ${token.colorTextTertiary};
  `,
}));

interface Clip {
  name: string;
  seconds: number;
  url: string;
}

/** Duration of a local video file, read from its metadata; NaN when unreadable. */
const readDuration = (file: File): Promise<number> =>
  new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    const done = (seconds: number) => {
      URL.revokeObjectURL(url);
      resolve(seconds);
    };
    video.preload = 'metadata';
    video.addEventListener('loadedmetadata', () => done(video.duration), { once: true });
    video.addEventListener('error', () => done(Number.NaN), { once: true });
    video.src = url;
  });

/** Seconds the provider bills for a clip: at least MIN_CLIP_SECONDS, whole seconds. */
export const billableClipSeconds = (seconds: number): number =>
  Math.max(MIN_CLIP_SECONDS, Math.ceil(Number.isFinite(seconds) && seconds > 0 ? seconds : 0));

/**
 * Reference videos for Seedance 2.0 Mini / full (`reference_videos`): up to
 * `maxCount` clips, `maxTotalSeconds` combined. The provider bills their
 * normalised length at the output rate, so the measured total is written to
 * `parameters.referenceSeconds` next to the urls and the cost preview / the
 * precharge include it. Clip names live only in this component; the store
 * keeps urls + seconds.
 */
const ReferenceVideosUpload = memo(() => {
  const { t } = useTranslation('video');
  const { styles } = useStyles();
  const { message } = App.useApp();
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);

  const { value: urls, setValue: setUrls, maxCount, maxFileSize, maxTotalSeconds } =
    useVideoGenerationConfigParam('videoUrls');
  const { value: referenceSeconds } = useVideoGenerationConfigParam('referenceSeconds');
  const setParam = useVideoStore((s) => s.setParamOnInput);

  const limitCount = maxCount ?? DEFAULT_MAX_COUNT;
  const limitSeconds = maxTotalSeconds ?? DEFAULT_MAX_TOTAL_SECONDS;

  // Per-url metadata (name, seconds). Survives re-renders but not a reload —
  // after a reload the store still has urls + total seconds, which is all
  // billing needs; names fall back to the url tail.
  const [clips, setClips] = useState<Record<string, Clip>>({});
  const [progress, setProgress] = useState<number | null>(null);

  const current: string[] = Array.isArray(urls) ? urls : [];
  const totalSeconds = current.reduce(
    (sum, url) => sum + (clips[url]?.seconds ?? 0),
    0,
  );

  const commit = (nextUrls: string[], nextClips: Record<string, Clip>) => {
    setClips(nextClips);
    setUrls(nextUrls as any);
    const seconds = nextUrls.reduce((sum, url) => sum + (nextClips[url]?.seconds ?? 0), 0);
    // Seconds from a previous session (names lost) are kept when nothing changed.
    setParam('referenceSeconds', (nextUrls.length === 0 ? 0 : seconds || referenceSeconds || 0) as any);
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (maxFileSize && file.size > maxFileSize) {
      message.error(t('config.referenceVideos.uploadFailed'));
      return;
    }
    const seconds = billableClipSeconds(await readDuration(file));
    if (totalSeconds + seconds > limitSeconds) {
      message.warning(t('config.referenceVideos.tooLong', { seconds: String(limitSeconds) }));
      return;
    }
    setProgress(0);
    try {
      const result = await uploadWithProgress({
        file,
        onStatusUpdate: (update) => {
          const p = (update as { value?: { uploadState?: { progress?: number } } }).value
            ?.uploadState?.progress;
          if (typeof p === 'number') setProgress(p);
        },
        skipCheckFileType: true,
      });
      if (!result?.url) throw new Error('upload returned no url');
      commit([...current, result.url], {
        ...clips,
        [result.url]: { name: file.name, seconds, url: result.url },
      });
    } catch (error) {
      console.error('[ReferenceVideosUpload] upload failed', error);
      message.error(t('config.referenceVideos.uploadFailed'));
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = (url: string) => {
    const { [url]: _gone, ...rest } = clips;
    commit(
      current.filter((u) => u !== url),
      rest,
    );
  };

  return (
    <Flexbox gap={6}>
      {current.map((url) => (
        <div className={styles.row} key={url}>
          <Clapperboard size={14} />
          <span className={styles.name} title={clips[url]?.name ?? url}>
            {clips[url]?.name ?? url.split('/').pop()}
          </span>
          {clips[url] && <span className={styles.seconds}>{clips[url].seconds} с</span>}
          <ActionIcon icon={X} size="small" onClick={() => remove(url)} />
        </div>
      ))}
      {progress !== null && <Progress percent={Math.round(progress)} showInfo={false} size="small" />}
      {current.length < limitCount && progress === null && (
        <>
          <Button
            block
            icon={<Plus size={14} />}
            size="small"
            variant="dashed"
            onClick={() => inputRef.current?.click()}
          >
            {t('config.referenceVideos.add')}
          </Button>
          <input
            hidden
            accept="video/*"
            ref={inputRef}
            type="file"
            onChange={(e) => void onFiles(e.target.files)}
          />
        </>
      )}
      <span className={styles.hint}>
        {t('config.referenceVideos.hint', { max: String(limitCount), seconds: String(limitSeconds) })}
        {totalSeconds > 0 ? ` · ${totalSeconds}/${limitSeconds} с` : ''}
      </span>
    </Flexbox>
  );
});

ReferenceVideosUpload.displayName = 'ReferenceVideosUpload';

export default ReferenceVideosUpload;
