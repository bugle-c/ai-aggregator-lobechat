'use client';

import { Button, Image, Modal } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { PresetListItem } from '@/types/preset';

import { presetAspectRatio } from './presetAspect';
import PresetAttribution from './PresetAttribution';
import RequiresImageBadge from './RequiresImageBadge';

interface Props {
  onApply: () => void;
  onClose: () => void;
  open: boolean;
  preset: PresetListItem;
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
  const { t } = useTranslation('common');
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
              // The gallery grid crops every card to one aspect per modality;
              // this is the surface that shows the preset at its true shape.
              // Declaring it up front also stops the dialog jumping from the
              // 300×150 default <video> box once metadata arrives.
              style={{
                aspectRatio: presetAspectRatio(preset),
                display: 'block',
                maxHeight: '70vh',
                maxWidth: '90vw',
              }}
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
          {preset.requiresImage && (
            <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
              <RequiresImageBadge variant="inline" />
              <span style={{ color: 'var(--lobe-chat-text-secondary)', fontSize: 13 }}>
                {t('preset.requiresImageHint')}
              </span>
            </div>
          )}
          <PresetAttribution preset={preset} />
          <Button
            size="large"
            style={{ alignSelf: 'flex-end' }}
            type="primary"
            onClick={() => {
              onApply();
              onClose();
            }}
          >
            {t('preset.useStyle')}
          </Button>
        </div>
      </div>
    </Modal>
  );
});

PresetZoomModal.displayName = 'PresetZoomModal';

export default PresetZoomModal;
