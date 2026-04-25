export type UiMode = 'light' | 'pro';

export interface UIModeState {
  uiMode: UiMode;
  uiModeLoading: boolean;
}

export const initialUIModeState: UIModeState = {
  uiMode: 'light',
  uiModeLoading: false,
};
