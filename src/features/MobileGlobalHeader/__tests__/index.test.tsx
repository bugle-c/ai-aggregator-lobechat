import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import MobileGlobalHeader from '..';

// `BalanceBadge` (the only nested component with side-effect deps) needs
// react-router context + a tRPC query. Stub it: this is a smoke test for
// the header chrome itself.
vi.mock('@/features/Onboarding', () => ({
  BalanceBadge: () => null,
}));

describe('MobileGlobalHeader', () => {
  it('renders WebGPT brand', () => {
    render(
      <MemoryRouter>
        <MobileGlobalHeader />
      </MemoryRouter>,
    );
    expect(screen.getByText('WebGPT')).toBeInTheDocument();
  });
});
