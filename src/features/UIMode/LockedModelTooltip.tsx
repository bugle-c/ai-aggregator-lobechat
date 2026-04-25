'use client';

import { Flexbox } from '@lobehub/ui';
import { Lock } from 'lucide-react';
import { memo, type MouseEvent, useState } from 'react';

import UpsellModal from './UpsellModal';

interface Props {
  children: React.ReactNode;
  isLocked: boolean;
  modelName: string;
  planPriceRub: number;
  requiredPlan: string;
}

const LockedModelTooltip = memo<Props>(
  ({ children, isLocked, modelName, planPriceRub, requiredPlan }) => {
    const [open, setOpen] = useState(false);

    if (!isLocked) return <>{children}</>;

    return (
      <>
        <Flexbox
          horizontal
          align="center"
          gap={6}
          style={{ cursor: 'pointer', opacity: 0.6 }}
          onClick={(e: MouseEvent<HTMLDivElement>) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }}
        >
          <Lock size={14} />
          {children}
        </Flexbox>
        <UpsellModal
          modelName={modelName}
          open={open}
          planPriceRub={planPriceRub}
          requiredPlan={requiredPlan}
          onClose={() => setOpen(false)}
        />
      </>
    );
  },
);

LockedModelTooltip.displayName = 'LockedModelTooltip';

export default LockedModelTooltip;
