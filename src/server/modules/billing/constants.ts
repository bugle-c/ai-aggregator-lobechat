// Credit conversion: 1 credit ≈ 1 standard message ≈ 2500 tokens
export const TOKENS_PER_CREDIT = 2500;

// Credit costs by action type
export const CREDIT_COSTS = {
  text: 1, // standard text message
  image: 10, // image generation (DALL-E)
  video: 30, // video generation
  reasoning: 3, // heavy reasoning models (o1, etc.)
} as const;

export const TOPUP_PACKAGES = [
  { amountRub: 149, credits: 200, label: '200 кредитов' },
  { amountRub: 599, credits: 1000, label: '1 000 кредитов' },
  { amountRub: 2499, credits: 5000, label: '5 000 кредитов' },
] as const;

export type TopupPackage = (typeof TOPUP_PACKAGES)[number];

export function getTopupPackage(amountRub: number): TopupPackage | undefined {
  return TOPUP_PACKAGES.find((p) => p.amountRub === amountRub);
}

// Convert raw token usage to credits consumed
export function tokensToCredits(tokens: number): number {
  return Math.max(1, Math.ceil(tokens / TOKENS_PER_CREDIT));
}
