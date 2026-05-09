import Loading from '@/components/Loading/BrandTextLoading';
import { isMobileRedesignEnabled } from '@/envs/app';
import dynamic from '@/libs/next/dynamic';
import { type DynamicLayoutProps } from '@/types/next';
import { RouteVariants } from '@/utils/server/routeVariants';

import DesktopRouter from './router';

const MobileRouter = dynamic(() => import('./(mobile)'), {
  loading: () => <Loading debugId={'Root'} />,
});

export default async (props: DynamicLayoutProps) => {
  const isMobile = await RouteVariants.getIsMobile(props);

  // Phase 1 of mobile-redesign migration: when the feature flag is on,
  // mobile users land on the responsive (main) route. The legacy
  // (mobile) route stays in code as a rollback path until Phase 3.
  const sp = await props.searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp ?? {})) {
    if (typeof v === 'string') params.set(k, v);
  }
  const redesign = isMobileRedesignEnabled(params);

  if (isMobile && !redesign) return <MobileRouter />;
  return <DesktopRouter />;
};
