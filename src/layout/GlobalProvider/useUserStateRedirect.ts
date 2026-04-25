'use client';

import { OFFICIAL_URL } from '@lobechat/const';
import { useCallback } from 'react';

import { getDesktopOnboardingCompleted } from '@/app/[variants]/(desktop)/desktop-onboarding/storage';
import { isDesktop } from '@/const/version';
import { useElectronStore } from '@/store/electron';
import { useUserStore } from '@/store/user';
import { type UserInitializationState } from '@/types/user';

const redirectIfNotOn = (currentPath: string, path: string) => {
  if (!currentPath.startsWith(path)) {
    window.location.href = path;
  }
};

export const useDesktopUserStateRedirect = () => {
  const dataSyncConfig = useElectronStore((s) => s.dataSyncConfig);
  const logout = useUserStore((s) => s.logout);

  const openExternalAndLogout = useCallback(
    async (path: string) => {
      const baseUrl = dataSyncConfig.remoteServerUrl || OFFICIAL_URL;
      let targetUrl = baseUrl;
      try {
        targetUrl = new URL(path, baseUrl).toString();
      } catch {
        // Ignore: keep fallback URL for external open attempt.
      }

      try {
        const { electronSystemService } = await import('@/services/electron/system');
        await electronSystemService.openExternalLink(targetUrl);
      } catch {
        // Ignore: fallback to logout flow even if IPC is unavailable.
      }

      try {
        const { remoteServerService } = await import('@/services/electron/remoteServer');
        await remoteServerService.clearRemoteServerConfig();
      } catch {
        // Ignore: fallback to logout flow even if IPC is unavailable.
      }

      await logout();
    },
    [dataSyncConfig.remoteServerUrl, logout],
  );

  return useCallback(
    (state: UserInitializationState) => {
      if (!getDesktopOnboardingCompleted()) return;
      // Desktop onboarding is handled by desktop-only flow.
    },
    [openExternalAndLogout],
  );
};

export const useWebUserStateRedirect = () =>
  useCallback((_state: UserInitializationState) => {
    // Onboarding redirect disabled for WebGPT — the upstream LobeChat
    // onboarding flow (TelemetryStep, FullNameStep, etc.) is replaced by our
    // lightweight Welcome modal that fires on the first chat visit
    // (`src/features/Onboarding/WelcomeModal.tsx`, Task 1.3). The /onboarding
    // route still exists but is no longer auto-routed to.
    return;
  }, []);

export const useUserStateRedirect = () => {
  const desktopRedirect = useDesktopUserStateRedirect();
  const webRedirect = useWebUserStateRedirect();

  return useCallback(
    (state: UserInitializationState) => {
      const redirect = isDesktop ? desktopRedirect : webRedirect;
      redirect(state);
    },
    [desktopRedirect, webRedirect],
  );
};
