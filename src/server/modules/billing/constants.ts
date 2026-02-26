export const TOPUP_PACKAGES = [
  { amountRub: 199, tokens: 500_000, label: '500K токенов' },
  { amountRub: 699, tokens: 2_000_000, label: '2M токенов' },
  { amountRub: 1499, tokens: 5_000_000, label: '5M токенов' },
] as const;

export type TopupPackage = (typeof TOPUP_PACKAGES)[number];

export function getTopupPackage(amountRub: number): TopupPackage | undefined {
  return TOPUP_PACKAGES.find((p) => p.amountRub === amountRub);
}
