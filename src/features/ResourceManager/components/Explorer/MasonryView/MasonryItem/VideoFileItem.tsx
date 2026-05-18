import { Modal } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Maximize2, Play } from 'lucide-react';
import { memo, useState } from 'react';

import { type AsyncTaskStatus, type IAsyncTaskError } from '@/types/asyncTask';

interface VideoFileItemProps {
  chunkCount?: number | null;
  chunkingError?: IAsyncTaskError | null;
  chunkingStatus?: AsyncTaskStatus | null;
  embeddingError?: IAsyncTaskError | null;
  embeddingStatus?: AsyncTaskStatus | null;
  fileType?: string;
  finishEmbedding?: boolean;
  id: string;
  isInView: boolean;
  name: string;
  size: number;
  url?: string;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  maximizeBtn: css`
    pointer-events: auto;
    cursor: pointer;

    position: absolute;
    z-index: 2;
    inset-block-start: 8px;
    inset-inline-end: 8px;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 28px;
    height: 28px;
    border: none;
    border-radius: 6px;

    color: #fff;

    background: rgb(0 0 0 / 55%);
    backdrop-filter: blur(4px);

    transition: background 0.18s ease;

    &:hover {
      background: rgb(0 0 0 / 80%);
    }
  `,
  playBadge: css`
    pointer-events: none;

    position: absolute;
    z-index: 1;
    inset-block-start: 50%;
    inset-inline-start: 50%;
    transform: translate(-50%, -50%);

    display: flex;
    align-items: center;
    justify-content: center;

    width: 48px;
    height: 48px;
    border-radius: 50%;

    color: #fff;

    background: rgb(0 0 0 / 50%);
  `,
  videoWrapper: css`
    cursor: pointer;

    position: relative;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 100%;
    min-height: 120px;

    background: ${cssVar.colorFillQuaternary};

    video {
      display: block;
      width: 100%;
      height: auto;
    }
  `,
}));

const VideoFileItem = memo<VideoFileItemProps>(({ isInView, name, url }) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [posterErrored, setPosterErrored] = useState(false);

  const openModal = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setModalOpen(true);
  };

  return (
    <>
      <div
        aria-label={name}
        className={styles.videoWrapper}
        role="button"
        tabIndex={0}
        onClick={openModal}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') openModal(e);
        }}
      >
        {isInView && url && !posterErrored && (
          <video
            muted
            playsInline
            preload="metadata"
            src={`${url}#t=0.1`}
            onError={() => setPosterErrored(true)}
          />
        )}
        <div className={styles.playBadge}>
          <Play fill="#fff" size={24} strokeWidth={0} />
        </div>
        <button
          aria-label="Maximize"
          className={styles.maximizeBtn}
          type="button"
          onClick={openModal}
        >
          <Maximize2 size={16} />
        </button>
      </div>
      <Modal
        centered
        destroyOnClose
        footer={null}
        open={modalOpen}
        styles={{ body: { padding: 0 } }}
        title={name}
        width="auto"
        onCancel={() => setModalOpen(false)}
      >
        {url && (
          <video
            autoPlay
            controls
            playsInline
            src={url}
            style={{ display: 'block', maxHeight: '85vh', maxWidth: '90vw' }}
          />
        )}
      </Modal>
    </>
  );
});

VideoFileItem.displayName = 'VideoFileItem';

export default VideoFileItem;
