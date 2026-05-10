'use client';

import { Sparkles } from 'lucide-react';
import { memo } from 'react';

interface Props {
  hidden?: boolean;
  label?: string;
  onClick: () => void;
}

/**
 * Bottom-right floating button. Sits ~80px above bottom edge so it
 * stays clear of `MobileTabBar`.
 */
const MobileFlowFAB = memo<Props>(({ hidden, label = 'Создать', onClick }) => {
  if (hidden) return null;

  return (
    <button
      type="button"
      style={{
        alignItems: 'center',
        background: 'var(--ant-color-primary)',
        border: 0,
        borderRadius: 999,
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        color: '#fff',
        cursor: 'pointer',
        display: 'flex',
        fontSize: 14,
        fontWeight: 600,
        gap: 8,
        insetInlineEnd: 16,
        padding: '12px 18px',
        position: 'fixed',
        zIndex: 40,
      }}
      onClick={onClick}
    >
      <Sparkles size={16} />
      {label}
    </button>
  );
});

MobileFlowFAB.displayName = 'MobileFlowFAB';

export default MobileFlowFAB;
