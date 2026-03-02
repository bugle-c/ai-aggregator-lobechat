// Credit costs by action type (flat overrides, model-specific pricing in model-rates.ts)
export const CREDIT_COSTS = {
  text: 1, // standard text message (overridden by per-model calculation)
  image: 10, // image generation (DALL-E)
  video: 30, // video generation
} as const;

export const TOPUP_PACKAGES = [
  { amountRub: 99, credits: 400, label: '400 кредитов' },
  { amountRub: 399, credits: 1800, label: '1 800 кредитов' },
  { amountRub: 999, credits: 5000, label: '5 000 кредитов' },
] as const;

export type TopupPackage = (typeof TOPUP_PACKAGES)[number];

export function getTopupPackage(amountRub: number): TopupPackage | undefined {
  return TOPUP_PACKAGES.find((p) => p.amountRub === amountRub);
}

// Re-export from model-rates for backward compatibility
export { TOKENS_PER_CREDIT, tokensToCredits } from './model-rates';
