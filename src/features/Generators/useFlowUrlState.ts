'use client';

import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export type FlowTab = 'presets' | 'feed';
export type FlowView = 'create' | undefined;

export interface FlowUrlState {
  category: string | undefined;
  modelId: string | undefined;
  preset: string | undefined;
  q: string | undefined;
  tab: FlowTab;
  /** When 'create' the page renders a full-screen creation view
      (preset + prompt + Generate). Used on mobile after user taps a
      preset card so the flow mirrors higgsfield's gallery → creation
      navigation. Desktop ignores this since the sidebar is always
      visible. */
  view: FlowView;
}

export interface FlowUrlSetters {
  setCategory: (v: string | undefined) => void;
  setModel: (v: string | undefined) => void;
  setPreset: (v: string | undefined) => void;
  setQ: (v: string | undefined) => void;
  setTab: (v: FlowTab) => void;
  setView: (v: FlowView) => void;
}

const COMPACT_KEYS = ['tab', 'model', 'category', 'preset', 'q', 'view'] as const;

const sanitizeTab = (raw: string | null): FlowTab => (raw === 'presets' ? 'presets' : 'feed');
const sanitizeView = (raw: string | null): FlowView => (raw === 'create' ? 'create' : undefined);

/**
 * Reads/writes flow page state through search-params:
 *   ?tab=presets|feed
 *   ?model=<slug>
 *   ?category=<slug>
 *   ?preset=<slug>
 *   ?q=<text>
 *
 * The defaultTab fallback is used when there is no `tab` param yet
 * (caller decides based on whether the feed is empty).
 */
export const useFlowUrlState = (defaultTab: FlowTab): FlowUrlState & FlowUrlSetters => {
  const [params, setParams] = useSearchParams();

  const value: FlowUrlState = {
    category: params.get('category') ?? undefined,
    modelId: params.get('model') ?? undefined,
    preset: params.get('preset') ?? undefined,
    q: params.get('q') ?? undefined,
    tab: params.has('tab') ? sanitizeTab(params.get('tab')) : defaultTab,
    view: sanitizeView(params.get('view')),
  };

  const update = useCallback(
    (key: (typeof COMPACT_KEYS)[number], val: string | undefined) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (val === undefined || val === '') next.delete(key);
          else next.set(key, val);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return {
    ...value,
    setCategory: (v) => update('category', v),
    setModel: (v) => update('model', v),
    setPreset: (v) => update('preset', v),
    setQ: (v) => update('q', v),
    setTab: (v) => update('tab', v),
    setView: (v) => update('view', v),
  };
};
