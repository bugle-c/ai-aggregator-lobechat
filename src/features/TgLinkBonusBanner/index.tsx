'use client';

import { memo } from 'react';

import { useIsMobile } from '@/hooks/useIsMobile';
import dynamic from '@/libs/next/dynamic';

import { useClaimOnReturn } from './useClaimOnReturn';

const MobileStickyBar = dynamic(() => import('./MobileStickyBar'));
const PcSidebarCardImpl = dynamic(() => import('./PcSidebarCard'));

/**
 * Global mount — runs the claim-on-return hook unconditionally, then
 * renders the mobile sticky bar only on mobile viewports. The PC card
 * is mounted separately inside the sidebar (see SideBarLayout).
 */
export const TgLinkBonusGlobal = memo(() => {
  useClaimOnReturn();
  const isMobile = useIsMobile();
  if (!isMobile) return null;
  return <MobileStickyBar />;
});

TgLinkBonusGlobal.displayName = 'TgLinkBonusGlobal';

/** PC variant — mount inside the sidebar layout. */
export const PcSidebarCard = PcSidebarCardImpl;
