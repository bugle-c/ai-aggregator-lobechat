import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// `BalanceBadge` (the only nested component with side-effect deps) needs
// react-router context + a tRPC query. Stub it: this is a smoke test for
// the header chrome itself.
vi.mock('@/features/Onboarding', () => ({
  BalanceBadge: () => null,
}));

import MobileGlobalHeader from '..';

describe('MobileGlobalHeader', () => {
  it('renders WebGPT brand', () => {
    render(<MobileGlobalHeader />);
    expect(screen.getByText('WebGPT')).toBeInTheDocument();
  });
});
