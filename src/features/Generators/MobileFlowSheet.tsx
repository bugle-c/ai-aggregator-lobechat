'use client';

import { Drawer } from 'antd';
import { type ComponentProps, memo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  onClose: () => void;
  open: boolean;
}

const drawerStyles: ComponentProps<typeof Drawer>['styles'] = {
  body: { padding: 16 },
  header: { display: 'none' },
};

const MobileFlowSheet = memo<Props>(({ children, onClose, open }) => {
  return (
    <Drawer
      destroyOnHidden
      closable={false}
      height="80vh"
      open={open}
      placement="bottom"
      styles={drawerStyles}
      onClose={onClose}
    >
      {children}
    </Drawer>
  );
});

MobileFlowSheet.displayName = 'MobileFlowSheet';

export default MobileFlowSheet;
