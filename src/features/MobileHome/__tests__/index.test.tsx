import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import MobileHome from '..';

// SuggestedPrompts pulls in tRPC + react-router. Stub it for this smoke
// test — we're verifying MobileHome's own chrome (greeting, dividers,
// chips), not nested feature trees.
vi.mock('@/features/Onboarding', () => ({
  SuggestedPrompts: () => null,
}));

vi.mock('@/features/Upsell/MobileUpgradePill', () => ({
  default: () => null,
}));

vi.mock('../FeatureChipsRow', () => ({
  default: () => null,
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    spend: { getCreditState: { useQuery: () => ({ data: undefined }) } },
    subscription: { getBillingState: { useQuery: () => ({ data: undefined }) } },
  },
}));

describe('MobileHome', () => {
  it('renders chips section title', () => {
    render(<MobileHome onSelectPrompt={() => {}} />);
    expect(screen.getByText('Быстрые действия')).toBeInTheDocument();
    expect(screen.getByText('Попробуй')).toBeInTheDocument();
  });
});
