'use client';

import { useEffect } from 'react';

import { useChatStore } from '@/store/chat';

interface Options {
  enabled: boolean;
}

/**
 * Auto-focus the home chat input on first visit only.
 *
 * Conditions:
 * - Caller passes `enabled` (typically `firstMessageSeen === false &&
 *   signupAt > now() - 5m`)
 * - Viewport tall enough (>600px) so iOS virtual keyboard isn't already
 *   open or about to dock; otherwise focus + keyboard race causes the
 *   page to jump
 *
 * No-ops on subsequent renders even if conditions change.
 */
export const useMobileAutofocus = ({ enabled }: Options) => {
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;
    if (window.innerHeight <= 600) return;

    // setTimeout to let editor mount
    const id = setTimeout(() => {
      const editor = useChatStore.getState().mainInputEditor;
      editor?.focus();
    }, 50);
    return () => clearTimeout(id);
  }, [enabled]);
};
