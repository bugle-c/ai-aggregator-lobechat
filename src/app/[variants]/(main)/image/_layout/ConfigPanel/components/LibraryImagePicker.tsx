'use client';

import { Flexbox, Modal, Text } from '@lobehub/ui';
import { Empty, Spin } from 'antd';
import { createStyles } from 'antd-style';
import { type FC, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { lambdaClient } from '@/libs/trpc/client';

interface LibraryItem {
  fileType?: string | null;
  id: string;
  name: string;
  url: string;
}

interface LibraryImagePickerProps {
  /** Max number of items the user can still pick (informational — picker
   *  allows single click; pre-existing selection count belongs to the
   *  caller). When the limit is 1 we close on first pick. */
  maxRemaining?: number;
  onClose: () => void;
  /** Called with the picked file's URL. */
  onPick: (url: string) => void;
  open: boolean;
}

const useStyles = createStyles(({ css, token }) => ({
  centered: css`
    padding: 32px;
  `,
  grid: css`
    overflow-y: auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 12px;

    max-height: 60vh;
    padding: 4px;
  `,
  thumb: css`
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  `,
  tile: css`
    cursor: pointer;

    position: relative;

    overflow: hidden;

    aspect-ratio: 1;
    border-radius: ${token.borderRadiusLG}px;

    background: ${token.colorFillTertiary};

    transition: transform 0.15s ease;

    &:hover {
      transform: scale(1.04);
      outline: 2px solid ${token.colorPrimary};
    }
  `,
}));

function isImageItem(item: LibraryItem): boolean {
  if (item.fileType?.startsWith('image/')) return true;
  // Fallback: check extension when fileType is missing/wrong
  const lower = item.name.toLowerCase();
  return (
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.gif') ||
    lower.endsWith('.bmp') ||
    lower.endsWith('.avif')
  );
}

const LibraryImagePicker: FC<LibraryImagePickerProps> = memo(({ open, onClose, onPick }) => {
  const { t } = useTranslation('image');
  const { styles } = useStyles();

  // Fetch only when the modal is open — saves a network call on every panel mount.
  const { data, isLoading, error } = useSWR(
    open ? ['library-image-picker'] : null,
    () => lambdaClient.file.recentFiles.query({ limit: 60 }),
    { revalidateOnFocus: false },
  );

  const images = useMemo<LibraryItem[]>(() => {
    if (!Array.isArray(data)) return [];
    return data
      .filter((d) => d.url && d.name)
      .map((d) => ({ fileType: d.fileType ?? null, id: d.id, name: d.name, url: d.url }))
      .filter(isImageItem);
  }, [data]);

  const handlePick = (url: string) => {
    onPick(url);
    onClose();
  };

  return (
    <Modal
      destroyOnClose
      footer={null}
      open={open}
      title={t('libraryPicker.title', { defaultValue: 'Выбрать из библиотеки' })}
      width={720}
      onCancel={onClose}
    >
      {isLoading ? (
        <Flexbox align="center" className={styles.centered} justify="center">
          <Spin />
        </Flexbox>
      ) : error ? (
        <Flexbox align="center" className={styles.centered} justify="center">
          <Text type="danger">
            {t('libraryPicker.error', { defaultValue: 'Не удалось загрузить список файлов' })}
          </Text>
        </Flexbox>
      ) : images.length === 0 ? (
        <Flexbox align="center" className={styles.centered} justify="center">
          <Empty
            description={t('libraryPicker.empty', {
              defaultValue:
                'В вашей библиотеке пока нет картинок. Загрузите хотя бы одну, потом она появится здесь.',
            })}
          />
        </Flexbox>
      ) : (
        <div className={styles.grid}>
          {images.map((img) => (
            <div
              className={styles.tile}
              key={img.id}
              role="button"
              tabIndex={0}
              title={img.name}
              onClick={() => handlePick(img.url)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handlePick(img.url);
                }
              }}
            >
              {}
              <img alt={img.name} className={styles.thumb} loading="lazy" src={img.url} />
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
});

LibraryImagePicker.displayName = 'LibraryImagePicker';

export default LibraryImagePicker;
