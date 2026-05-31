import { lambdaClient } from '@/libs/trpc/client';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
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

  setUiMode = async (mode: UiMode): Promise<{ modelWasReset?: boolean }> => {
    const state = this.#get();
    const prev = state.uiMode;

    // 1. No-op when already in target mode (guard against repeated clicks)
    if (prev === mode) return {};

    // 2. Reject concurrent mutations — wait for in-flight request to finish
    if (state.uiModeLoading) return {};

    this.#set({ uiMode: mode, uiModeLoading: true }, false, 'setUiMode/optimistic');

    // 3. Persist the mode first — this is the critical operation
    try {
      await lambdaClient.userOnboarding.setUiMode.mutate({ mode });
    } catch (e) {
      // Mode persistence failed → full rollback (and release the lock)
      this.#set({ uiMode: prev, uiModeLoading: false }, false, 'setUiMode/rollback');
      throw e;
    }

    // 4. Best-effort model reset on Pro→Light. MUST NOT fail the mode switch.
    let modelWasReset = false;
    if (mode === 'light') {
      try {
        const agentStoreState = useAgentStore.getState();
        const currentProvider = agentSelectors.currentAgentModelProvider(agentStoreState);
        const activeAgentId = agentStoreState.activeAgentId;

        if (currentProvider && currentProvider !== 'lobehub' && activeAgentId) {
          // Reset to our local Gemma (branded as "WebGPT Mini" in the UI) on
          // Light switch. Earlier this was 'gpt-5-mini', which silently
          // burned OpenAI spend on the 87% of users who sit in Light —
          // gemma4:e4b runs on our Ollama box (zero provider cost) and is
          // already the global DEFAULT_MODEL in @lobechat/const/settings/llm.
          await agentStoreState.updateAgentConfigById(activeAgentId, {
            model: 'gemma4:e4b',
            provider: 'lobehub',
          });
          modelWasReset = true;
        }
      } catch (e) {
        // Non-fatal: server-side mode is already saved. Log + continue.
        console.warn('[uiMode] best-effort model reset failed on Light switch:', e);
      }
    }

    // 5. Always release the lock at the end
    this.#set({ uiModeLoading: false }, false, 'setUiMode/done');
    return { modelWasReset };
  };
}

export type UIModeAction = Pick<UIModeActionImpl, keyof UIModeActionImpl>;
