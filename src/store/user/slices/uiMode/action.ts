import { lambdaClient } from '@/libs/trpc/client';
import { type StoreSetter } from '@/store/types';
import { type UserStore } from '@/store/user';

import { type UiMode } from './initialState';

type Setter = StoreSetter<UserStore>;

export const createUIModeSlice = (set: Setter, get: () => UserStore, _api?: unknown) =>
  new UIModeActionImpl(set, get, _api);

export class UIModeActionImpl {
  readonly #get: () => UserStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => UserStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  loadUiMode = async (): Promise<void> => {
    this.#set({ uiModeLoading: true }, false, 'loadUiMode/start');
    try {
      const state = await lambdaClient.userOnboarding.getOnboardingState.query();
      const next: UiMode = ((state as { uiMode?: UiMode } | null)?.uiMode ?? 'light') as UiMode;
      this.#set({ uiMode: next, uiModeLoading: false }, false, 'loadUiMode/success');
    } catch (e) {
      console.warn('[uiMode] load failed, falling back to light', e);
      this.#set({ uiMode: 'light', uiModeLoading: false }, false, 'loadUiMode/error');
    }
  };

  setUiMode = async (mode: UiMode): Promise<void> => {
    const prev = this.#get().uiMode;
    this.#set({ uiMode: mode }, false, 'setUiMode/optimistic');
    try {
      await lambdaClient.userOnboarding.setUiMode.mutate({ mode });
    } catch (e) {
      this.#set({ uiMode: prev }, false, 'setUiMode/rollback');
      throw e;
    }
  };
}

export type UIModeAction = Pick<UIModeActionImpl, keyof UIModeActionImpl>;
