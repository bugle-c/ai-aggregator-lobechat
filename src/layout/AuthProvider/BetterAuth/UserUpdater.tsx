'use client';

import { memo, useEffect } from 'react';
import { createStoreUpdater } from 'zustand-utils';

import { useSession } from '@/libs/better-auth/auth-client';
import { useUserStore } from '@/store/user';
import { type LobeUser } from '@/types/user';

/**
 * Sync Better-Auth session state to Zustand store.
 *
 * IMPORTANT: this component fires on every tab focus / visibilitychange
 * because Better Auth's useSession re-fetches the session when the page
 * regains visibility. During that re-fetch `isPending` flips to true and
 * `data` is briefly undefined.
 *
 * If we naively wrote `isSignedIn = !!session?.user` to the store on
 * every render, the AuthGuardOverlay would FLASH the registration modal
 * every time the user came back to the tab — even though they're still
 * logged in. The store would go true → false → true within ~300ms.
 *
 * Fix: only commit `isSignedIn` / clear `user` when the session call has
 * settled (`!isPending`). During pending we keep the previous value.
 */
const UserUpdater = memo(() => {
  const { data: session, isPending, error } = useSession();

  const isSignedIn = !!session?.user && !error;
  const betterAuthUser = session?.user;
  const useStoreUpdater = createStoreUpdater(useUserStore);

  // isLoaded should reflect "the very first session check has finished"
  // — once true, never flip back to false on subsequent refetches. The
  // store updater only writes when the value changes, so calling with
  // `true` repeatedly is a no-op after the first time.
  useStoreUpdater('isLoaded', !isPending);

  // Only sync isSignedIn after pending settles. Otherwise mid-refetch
  // we write `false` and the AuthGuardOverlay flashes.
  useEffect(() => {
    if (isPending) return;
    useUserStore.setState({ isSignedIn });
  }, [isPending, isSignedIn]);

  // Sync user data from Better-Auth session to Zustand store. Same
  // pending guard — don't clear the user during refetch.
  useEffect(() => {
    if (isPending) return;

    if (betterAuthUser) {
      const userAvatar = useUserStore.getState().user?.avatar;

      const lobeUser = {
        // Preserve avatar from settings, don't override with auth provider value
        avatar: userAvatar || '',
        email: betterAuthUser.email,
        fullName: betterAuthUser.name,
        id: betterAuthUser.id,
        username: betterAuthUser.username,
      } as LobeUser;

      useUserStore.setState({ user: lobeUser });
      return;
    }

    // Clear user data only when the session call definitively returned
    // no user (not while still pending).
    useUserStore.setState({ user: undefined });
  }, [betterAuthUser, isPending]);

  return null;
});

export default UserUpdater;
