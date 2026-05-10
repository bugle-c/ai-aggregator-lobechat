import { type DynamicLayoutProps } from '@/types/next';

import DesktopRouter from './router';

// Phase 3 of mobile-redesign: legacy `(mobile)` route was removed. All
// users — desktop and mobile — now go through the responsive `(main)`
// tree. The previous `NEXT_PUBLIC_MOBILE_REDESIGN` flag and UA-based
// branch are gone.
export default async (_props: DynamicLayoutProps) => {
  return <DesktopRouter />;
};
