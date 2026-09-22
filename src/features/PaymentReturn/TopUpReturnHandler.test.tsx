import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TopUpReturnHandler from './TopUpReturnHandler';

// --- mocks -----------------------------------------------------------------

const reachGoal = vi.fn();
vi.mock('@/business/client/analytics/ym', () => ({
  reachGoal: (...args: unknown[]) => reachGoal(...args),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: any) => unknown) => selector({ isSignedIn: true }),
}));
vi.mock('@/store/user/slices/auth/selectors', () => ({
  authSelectors: { isLogin: (s: any) => !!s.isSignedIn },
}));

let queryState: { data: any; dataUpdatedAt: number; errorUpdatedAt?: number } = {
  data: undefined,
  dataUpdatedAt: 0,
};
const useQuerySpy = vi.fn();
const invalidateBilling = vi.fn();
const invalidateSpend = vi.fn();

vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    subscription: {
      getPaymentStatus: {
        useQuery: (input: unknown, opts: unknown) => {
          useQuerySpy(input, opts);
          return queryState;
        },
      },
    },
    useUtils: () => ({
      spend: { invalidate: invalidateSpend },
      subscription: { getBillingState: { invalidate: invalidateBilling } },
    }),
  },
}));

// --- helpers ---------------------------------------------------------------

const LocationProbe = () => {
  const loc = useLocation();
  return <div data-testid="loc">{`${loc.pathname}${loc.search}`}</div>;
};

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <TopUpReturnHandler />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

const rerenderAt = async (view: ReturnType<typeof renderAt>, url: string) => {
  await act(async () => {
    view.rerender(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route element={<TopUpReturnHandler />} path="*" />
        </Routes>
      </MemoryRouter>,
    );
  });
};

const setQuery = (data: any, dataUpdatedAt: number) => {
  queryState = { data, dataUpdatedAt };
};

const row = (status: string) => ({ amountRub: 99, id: 'top-1', status });

describe('TopUpReturnHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    queryState = { data: undefined, dataUpdatedAt: 0 };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stays idle without topUpFor', () => {
    renderAt('/settings/billing?payment=success');
    const opts = useQuerySpy.mock.calls.at(-1)?.[1] as any;
    expect(opts.enabled).toBe(false);
    expect(opts.refetchInterval).toBe(false);
    expect(reachGoal).not.toHaveBeenCalled();
  });

  it('leaves a subscription return (recoveryFor) to PaymentReturnHandler', () => {
    setQuery(row('succeeded'), 1);
    renderAt('/agent/a1?recoveryFor=pay-1&topUpFor=top-1');
    const opts = useQuerySpy.mock.calls.at(-1)?.[1] as any;
    expect(opts.enabled).toBe(false);
    expect(reachGoal).not.toHaveBeenCalled();
  });

  it('does NOT fire on the payment=success marker alone while the row is pending', async () => {
    setQuery(row('pending'), 1);
    renderAt('/agent/a1?topic=t1&payment=success&topUpFor=top-1');

    const opts = useQuerySpy.mock.calls.at(-1)?.[1] as any;
    expect(opts.enabled).toBe(true);
    expect(opts.refetchInterval).toBe(1500);
    expect(reachGoal).not.toHaveBeenCalled();
  });

  it('fires payment_success {kind:topup} once the row is succeeded and invalidates balance', async () => {
    setQuery(row('pending'), 1);
    const view = renderAt('/agent/a1?topic=t1&payment=success&topUpFor=top-1');
    expect(reachGoal).not.toHaveBeenCalled();

    setQuery(row('succeeded'), 2);
    await rerenderAt(view, '/agent/a1?topic=t1&payment=success&topUpFor=top-1');

    await waitFor(() => expect(reachGoal).toHaveBeenCalledTimes(1));
    expect(reachGoal).toHaveBeenCalledWith('payment_success', { kind: 'topup' });
    expect(invalidateBilling).toHaveBeenCalledTimes(1);
    expect(invalidateSpend).toHaveBeenCalledTimes(1);
  });

  it('fires once per payment id across re-renders', async () => {
    setQuery(row('succeeded'), 1);
    const view = renderAt('/agent/a1?payment=success&topUpFor=top-1');
    await waitFor(() => expect(reachGoal).toHaveBeenCalledTimes(1));

    for (const ts of [2, 3]) {
      setQuery(row('succeeded'), ts);
      await rerenderAt(view, '/agent/a1?payment=success&topUpFor=top-1');
    }
    expect(reachGoal).toHaveBeenCalledTimes(1);
  });

  it('strips topUpFor but keeps payment=success for the billing alert', async () => {
    setQuery(row('succeeded'), 1);
    renderAt('/settings/billing?payment=success&topUpFor=top-1');
    await waitFor(() =>
      expect(screen.getByTestId('loc').textContent).toBe('/settings/billing?payment=success'),
    );
  });

  it('never fires for a canceled top-up, and hands the UX to RetryModal', async () => {
    setQuery(row('canceled'), 1);
    renderAt('/agent/a1?payment=success&topUpFor=top-1');
    await waitFor(() =>
      expect(screen.getByTestId('loc').textContent).toBe('/agent/a1?payment=success'),
    );
    expect(reachGoal).not.toHaveBeenCalled();
    expect(invalidateSpend).not.toHaveBeenCalled();
  });

  it('stops polling after repeated query errors without firing the goal', async () => {
    queryState = { data: undefined, dataUpdatedAt: 0, errorUpdatedAt: 1 };
    const view = renderAt('/agent/a1?payment=success&topUpFor=top-1');

    for (let ts = 2; ts <= 8; ts++) {
      queryState = { data: undefined, dataUpdatedAt: 0, errorUpdatedAt: ts };
      await act(async () => {
        view.rerender(
          <MemoryRouter initialEntries={['/agent/a1?payment=success&topUpFor=top-1']}>
            <Routes>
              <Route
                path="*"
                element={
                  <>
                    <TopUpReturnHandler />
                    <LocationProbe />
                  </>
                }
              />
            </Routes>
          </MemoryRouter>,
        );
      });
    }

    await waitFor(() =>
      expect(screen.getByTestId('loc').textContent).toBe('/agent/a1?payment=success'),
    );
    expect(reachGoal).not.toHaveBeenCalled();
  });
});
