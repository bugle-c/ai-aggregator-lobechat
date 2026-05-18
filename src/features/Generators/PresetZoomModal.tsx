'use client';

import { Image, Modal } from 'antd';
import { memo } from 'react';

import type { Preset } from '@/types/preset';

interface Props {
  onApply: () => void;
  onClose: () => void;
  open: boolean;
  preset: Preset;
}

const isVideoUrl = (url: string): boolean => {
  const path = url.split('?')[0].toLowerCase();
  return /\.(?:mp4|webm|mov|ogg)$/.test(path);
};

/**
 * Full-screen preview of a preset's media. MP4/video renders in
 * <video controls autoPlay loop>; images render via antd <Image> with
 * its built-in zoom/rotate. Footer shows description + Apply button.
 */
const PresetZoomModal = memo<Props>(({ onApply, onClose, open, preset }) => {
  const isVideo = isVideoUrl(preset.previewUrl);

  return (
    <Modal
      centered
      destroyOnClose
      footer={null}
      open={open}
      styles={{ body: { maxWidth: '90vw', padding: 0 } }}
      title={preset.title}
      width="auto"
      onCancel={onClose}
    >
      <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '85vh' }}>
        <div style={{ background: '#000', display: 'flex', justifyContent: 'center' }}>
          {isVideo ? (
            <video
              autoPlay
              controls
              loop
              playsInline
              src={preset.previewUrl}
              style={{ display: 'block', maxHeight: '70vh', maxWidth: '90vw' }}
            />
          ) : (
            <Image
              alt={preset.title}
              preview={false}
              src={preset.previewUrl}
              style={{ maxHeight: '70vh', maxWidth: '90vw', objectFit: 'contain' }}
            />
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16 }}>
          {preset.description && (
            <div style={{ color: 'var(--lobe-chat-text-secondary)', fontSize: 13 }}>
              {preset.description}
            </div>
          )}
          <button
            type="button"
            style={{
              alignSelf: 'flex-end',
              background: 'var(--lobe-chat-color-primary, #1677ff)',
              border: 'none',
              borderRadius: 6,
              color: '#fff',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
              padding: '8px 16px',
            }}
            onClick={() => {
              onApply();
              onClose();
            }}
          >
            Применить пресет
          </button>
        </div>
      </div>
    </Modal>
  );
});

PresetZoomModal.displayName = 'PresetZoomModal';

export default PresetZoomModal;
