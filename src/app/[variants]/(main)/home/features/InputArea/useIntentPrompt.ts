import { useEffect } from 'react';

import { useChatStore } from '@/store/chat';

const STORAGE_KEY = 'webgpt_pending_intent_prompt';

/**
 * Blog CTAs deep-link with `?prompt=<template>`. Capture it BEFORE auth can
 * navigate away (sessionStorage survives the OAuth round-trip), then prefill
 * the main chat editor once it exists and the user is on the home surface.
 * One-shot: consumed on successful prefill.
 */
export const useIntentPrompt = () => {
  // Capture phase — run once on mount, even for anonymous visitors.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const prompt = params.get('prompt');
    if (!prompt) return;
    sessionStorage.setItem(STORAGE_KEY, prompt.slice(0, 2000));
    // Strip the param so reloads/auth redirects don't re-capture.
    params.delete('prompt');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }, []);

  // Inject phase — poll briefly for the editor (it mounts after hydration).
  useEffect(() => {
    const pending = sessionStorage.getItem(STORAGE_KEY);
    if (!pending) return;
    let tries = 0;
    const timer = setInterval(() => {
      const editor = useChatStore.getState().mainInputEditor;
      tries += 1;
      if (editor) {
        editor.instance?.setDocument('markdown', pending);
        useChatStore.setState({ inputMessage: pending });
        editor.focus();
        sessionStorage.removeItem(STORAGE_KEY);
        clearInterval(timer);
      } else if (tries > 40) {
        clearInterval(timer); // ~10s: editor never mounted (e.g. auth wall) — keep for next visit
      }
    }, 250);
    return () => clearInterval(timer);
  }, []);
};
