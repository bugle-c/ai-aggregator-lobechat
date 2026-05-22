'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Drawer, Input, Typography } from 'antd';
import { memo, useState } from 'react';

const { Title } = Typography;

const REASONS: { code: string; label: string }[] = [
  { code: 'too_expensive', label: 'Слишком дорого' },
  { code: 'not_using', label: 'Не пользовался' },
  { code: 'missing_feature', label: 'Не хватало функций' },
  { code: 'switched', label: 'Перешёл на другой сервис' },
  { code: 'temporary', label: 'Временно — потом вернусь' },
  { code: 'other', label: 'Другое' },
];

interface Props {
  loading?: boolean;
  onClose: () => void;
  onConfirm: (reasonCode: string, reasonText: string) => Promise<void> | void;
  open: boolean;
}

/**
 * Mobile bottom-sheet cancellation survey.
 *
 * Replaces the desktop Modal in `Plans.tsx` on small screens. Same six
 * reason codes as the desktop flow, optional free-text. Submission ends
 * with `onConfirm` — caller drives the tRPC mutation
 * (`subscription.cancelSubscription`) and closes the sheet on success.
 */
const MobileCancelFlow = memo<Props>(({ loading, onClose, onConfirm, open }) => {
  const [reason, setReason] = useState<string>('');
  const [text, setText] = useState('');

  return (
    <Drawer
      height="auto"
      open={open}
      placement="bottom"
      styles={{ body: { padding: 0 }, header: { display: 'none' } }}
      onClose={onClose}
    >
      <Flexbox gap={12} paddingBlock={20} paddingInline={20}>
        <Title level={5} style={{ margin: 0 }}>
          Жаль, что уходишь. Почему?
        </Title>
        <Flexbox gap={8}>
          {REASONS.map((r) => (
            <Button
              block
              key={r.code}
              type={reason === r.code ? 'primary' : 'default'}
              onClick={() => setReason(r.code)}
            >
              {r.label}
            </Button>
          ))}
        </Flexbox>
        <Input.TextArea
          maxLength={500}
          placeholder="Расскажи подробнее (опционально)"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button
          block
          danger
          disabled={!reason || loading}
          loading={loading}
          size="large"
          onClick={async () => {
            await onConfirm(reason, text);
          }}
        >
          Подтвердить отмену
        </Button>
        <Button block type="text" onClick={onClose}>
          Передумал
        </Button>
      </Flexbox>
    </Drawer>
  );
});

MobileCancelFlow.displayName = 'MobileCancelFlow';

export default MobileCancelFlow;
