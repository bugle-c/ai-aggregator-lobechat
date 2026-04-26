// Re-export the new Referral page implementation. The page itself lives in
// `./Referral/index.tsx` so it can split into multiple files (modal + helpers)
// without touching the dynamic-import path used by SettingsContent.tsx.
export { default } from './Referral/index';
