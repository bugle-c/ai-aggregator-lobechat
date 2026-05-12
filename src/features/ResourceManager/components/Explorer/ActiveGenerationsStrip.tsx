'use client';

import { Flexbox } from '@lobehub/ui';
import { Skeleton } from 'antd';
import { createStyles } from 'antd-style';
import { AlertCircle, Loader2, X } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useResourceManagerStore } from '@/app/[variants]/(main)/resource/features/store';
import { useClientDataSWR } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';
import { revalidateResources } from '@/store/file/slices/resource/hooks';
import { FilesTabs } from '@/types/files';

const POLL_INTERVAL_MS = 4000;

const useStyles = createStyles(({ css, token }) => ({
  strip: css`
    margin-block: 8px;
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${token.borderRadiusLG}px;

    background: ${token.colorFillTertiary};
  `,
  tile: css`
    position: relative;

    overflow: hidden;
    flex: 0 0 auto;

    width: 160px;
    height: 160px;
    border-radius: ${token.borderRadiusLG}px;
  `,
  overlay: css`
    pointer-events: none;

    position: absolute;
    inset: 0;

    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: center;
    justify-content: center;

    font-size: 12px;
    color: ${token.colorTextSecondary};

    background: rgb(0 0 0 / 18%);
  `,
  spin: css`
    animation: spin 1.2s linear infinite;

    @keyframes spin {
      from {
        transform: rotate(0deg);
      }
      to {
        transform: rotate(360deg);
      }
    }
  `,
  errorTile: css`
    position: relative;

    overflow: hidden;
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    gap: 6px;

    width: 160px;
    height: 160px;
    padding: 10px;
    border: 1px solid ${token.colorErrorBorder};
    border-radius: ${token.borderRadiusLG}px;

    font-size: 11px;
    line-height: 1.35;
    color: ${token.colorErrorText};

    background: ${token.colorErrorBg};
  `,
  errorTitle: css`
    display: flex;
    gap: 4px;
    align-items: center;
    justify-content: space-between;

    font-size: 12px;
    font-weight: 600;
  `,
  closeBtn: css`
    cursor: pointer;
    padding: 2px;
    border: 0;
    background: transparent;
    color: ${token.colorErrorText};
    display: inline-flex;
    align-items: center;
    border-radius: 4px;
    opacity: 0.7;
    transition: opacity 0.15s, background 0.15s;
    &:hover {
      opacity: 1;
      background: rgb(0 0 0 / 8%);
    }
  `,
  errorBody: css`
    overflow: hidden;
    display: -webkit-box;
    flex: 1;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 5;

    text-overflow: ellipsis;
  `,
  errorRefund: css`
    font-size: 10px;
    opacity: 0.85;
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
const DISMISSED_KEY = 'wgpt:dismissed-error-tasks';

const loadDismissed = (): Set<string> => {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
};

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

  const { data } = useClientDataSWR(kind ? ['active-generations', kind] : null, fetcher, {
    refreshInterval: POLL_INTERVAL_MS,
  });

  // Dismissed-error tracking. Stored in localStorage so refresh /
  // walking-away-and-coming-back doesn't lose state. Error tiles stay
  // visible until the user clicks ×.
  const [dismissed, setDismissed] = useState<Set<string>>(() =>
    typeof window === 'undefined' ? new Set() : loadDismissed(),
  );
  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
      } catch {
        /* quota / disabled storage — fine, in-memory dismissal still works for this session */
      }
      return next;
    });
  }, []);

  const visible = (data ?? []).filter(
    (t) => !(t.status === 'error' && dismissed.has(t.id)),
  );
  const previousCountRef = useRef(0);
  const count = visible.length;

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
    <Flexbox horizontal align="center" className={styles.strip} gap={8}>
      {data!.map((task) =>
        task.status === 'error' ? (
          <div className={styles.errorTile} key={task.id}>
            <div className={styles.errorTitle}>
              <AlertCircle size={14} />
              <span>Ошибка генерации</span>
            </div>
            <div className={styles.errorBody}>
              {task.error?.body || task.error?.name || 'Не удалось сгенерировать'}
            </div>
            <div className={styles.errorRefund}>Кредиты возвращены</div>
          </div>
        ) : (
          <div className={styles.tile} key={task.id}>
            <Skeleton.Image active style={{ width: '100%', height: '100%', borderRadius: 0 }} />
            <div className={styles.overlay}>
              <Loader2 className={styles.spin} size={20} />
              <span>{t('placeholder.generating', { defaultValue: 'Генерация…' })}</span>
            </div>
          </div>
        ),
      )}
    </Flexbox>
  );
});

ActiveGenerationsStrip.displayName = 'ActiveGenerationsStrip';

export default ActiveGenerationsStrip;
