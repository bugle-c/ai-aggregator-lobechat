'use client';

import { Flexbox } from '@lobehub/ui';
import { Skeleton } from 'antd';
import { createStyles } from 'antd-style';
import { Loader2 } from 'lucide-react';
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useResourceManagerStore } from '@/app/[variants]/(main)/resource/features/store';
import { lambdaClient } from '@/libs/trpc/client';
import { useClientDataSWR } from '@/libs/swr';
import { revalidateResources } from '@/store/file/slices/resource/hooks';
import { FilesTabs } from '@/types/files';

const POLL_INTERVAL_MS = 4000;

const useStyles = createStyles(({ css, token }) => ({
  strip: css`
    margin-block: 8px;
    padding: 8px 12px;
    border-radius: ${token.borderRadiusLG}px;
    background: ${token.colorFillTertiary};
  `,
  tile: css`
    position: relative;
    width: 160px;
    height: 160px;
    border-radius: ${token.borderRadiusLG}px;
    overflow: hidden;
    flex: 0 0 auto;
  `,
  overlay: css`
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    color: ${token.colorTextSecondary};
    background: rgba(0, 0, 0, 0.18);
    pointer-events: none;
    font-size: 12px;
  `,
  spin: css`
    animation: spin 1.2s linear infinite;
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `,
}));

/**
 * Shows a row of skeleton tiles above the gallery for every async image/video
 * generation task that is still Pending or Processing. Polls the server every
 * 4 seconds; when the count drops we know wavespeed finished one and trigger
 * a resource-list revalidate so the new file lands in the gallery itself.
 *
 * Only mounts when the user is viewing /resource with category=images or
 * category=videos — outside those views the placeholder is noise.
 */
const ActiveGenerationsStrip = memo(() => {
  const { styles } = useStyles();
  const { t } = useTranslation('file');
  const category = useResourceManagerStore((s) => s.category);

  const kind: 'image' | 'video' | null =
    category === FilesTabs.Images ? 'image' : category === FilesTabs.Videos ? 'video' : null;

  const fetcher = async () => {
    if (kind === 'image') return lambdaClient.image.listActiveTasks.query();
    if (kind === 'video') return lambdaClient.video.listActiveTasks.query();
    return [];
  };

  const { data } = useClientDataSWR(
    kind ? ['active-generations', kind] : null,
    fetcher,
    { refreshInterval: POLL_INTERVAL_MS },
  );

  const previousCountRef = useRef(0);
  const count = data?.length ?? 0;

  // When count drops, at least one task finished — refresh the gallery so
  // the freshly-generated file lands. The list query itself stops returning
  // that row (status flipped to Success/Error), so the strip naturally
  // shrinks without us removing items by hand.
  useEffect(() => {
    if (count < previousCountRef.current) {
      revalidateResources();
    }
    previousCountRef.current = count;
  }, [count]);

  if (!kind || count === 0) return null;

  return (
    <Flexbox horizontal align="center" gap={8} className={styles.strip}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={styles.tile}>
          <Skeleton.Image
            active
            style={{ width: '100%', height: '100%', borderRadius: 0 }}
          />
          <div className={styles.overlay}>
            <Loader2 size={20} className={styles.spin} />
            <span>{t('placeholder.generating', { defaultValue: 'Генерация…' })}</span>
          </div>
        </div>
      ))}
    </Flexbox>
  );
});

ActiveGenerationsStrip.displayName = 'ActiveGenerationsStrip';

export default ActiveGenerationsStrip;
