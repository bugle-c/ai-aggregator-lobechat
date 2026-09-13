import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PaymentReturnHandler from './PaymentReturnHandler';

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

const activatedModal = vi.fn();
vi.mock('@/features/SubscriptionActivatedModal', () => ({
  SubscriptionActivatedModal: (props: any) => {
    activatedModal(props);
    return <div data-testid="activated">{`${props.planSlug}|${props.agentId}`}</div>;
  },
}));

// Controllable tRPC query: tests set `queryState` and bump `dataUpdatedAt`
// to simulate successive polls.
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
              <PaymentReturnHandler />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

const setQuery = (data: any, dataUpdatedAt: number) => {
  queryState = { data, dataUpdatedAt };
};

const row = (status: string) => ({
  id: 'pay-1',
  planName: 'Базовый',
  planSlug: 'basic',
  status,
});

describe('PaymentReturnHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryState = { data: undefined, dataUpdatedAt: 0 };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stays idle without recoveryFor', () => {
    renderAt('/agent/a1?topic=t1');
    const opts = useQuerySpy.mock.calls.at(-1)?.[1] as any;
    expect(opts.enabled).toBe(false);
    expect(opts.refetchInterval).toBe(false);
    expect(screen.queryByTestId('activated')).toBeNull();
  });

  it('stays out of /settings/plans, which keeps its own handler', () => {
    renderAt('/settings/plans?recoveryFor=pay-1');
    const opts = useQuerySpy.mock.calls.at(-1)?.[1] as any;
    expect(opts.enabled).toBe(false);
    expect(screen.getByTestId('loc').textContent).toBe('/settings/plans?recoveryFor=pay-1');
  });

  it('polls while pending, then on succeeded opens the modal, invalidates, fires the goal once and strips the param', async () => {
    setQuery(row('pending'), 1);
    const view = renderAt('/agent/a1?topic=t1&recoveryFor=pay-1');

    const opts = useQuerySpy.mock.calls.at(-1)?.[1] as any;
    expect(opts.enabled).toBe(true);
    expect(opts.refetchInterval).toBe(1500);
    expect(screen.queryByTestId('activated')).toBeNull();

    setQuery(row('succeeded'), 2);
    await act(async () => {
      view.rerender(
        <MemoryRouter initialEntries={['/agent/a1?topic=t1&recoveryFor=pay-1']}>
          <Routes>
            <Route element={<PaymentReturnHandler />} path="*" />
          </Routes>
        </MemoryRouter>,
      );
    });

    await waitFor(() => expect(screen.getByTestId('activated')).toBeInTheDocument());
    expect(screen.getByTestId('activated').textContent).toBe('basic|a1');
    expect(invalidateBilling).toHaveBeenCalledTimes(1);
    expect(invalidateSpend).toHaveBeenCalledTimes(1);
    expect(reachGoal).toHaveBeenCalledTimes(1);
    expect(reachGoal).toHaveBeenCalledWith('payment_success', { kind: 'subscribe' });
  });

  it('fires payment_success once per payment id across re-renders', async () => {
    setQuery(row('succeeded'), 1);
    const view = renderAt('/agent/a1?recoveryFor=pay-1');
    await waitFor(() => expect(reachGoal).toHaveBeenCalledTimes(1));

    // Simulate a couple more polls landing before the URL update settles.
    for (const ts of [2, 3]) {
      setQuery(row('succeeded'), ts);
      await act(async () => {
        view.rerender(
          <MemoryRouter initialEntries={['/agent/a1?recoveryFor=pay-1']}>
            <Routes>
              <Route element={<PaymentReturnHandler />} path="*" />
            </Routes>
          </MemoryRouter>,
        );
      });
    }
    expect(reachGoal).toHaveBeenCalledTimes(1);
  });

  it('strips recoveryFor from the chat url on success', async () => {
    setQuery(row('succeeded'), 1);
    renderAt('/agent/a1?topic=t1&recoveryFor=pay-1');
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/agent/a1?topic=t1'));
  });

  it('hands canceled payments to the plans recovery flow', async () => {
    setQuery(row('canceled'), 1);
    renderAt('/agent/a1?topic=t1&recoveryFor=pay-1');
    await waitFor(() =>
      expect(screen.getByTestId('loc').textContent).toBe('/settings/plans?recoveryFor=pay-1'),
    );
    expect(reachGoal).not.toHaveBeenCalled();
    expect(screen.queryByTestId('activated')).toBeNull();
  });

  it('stops polling after repeated query errors and hands off to the plans page', async () => {
    queryState = { data: undefined, dataUpdatedAt: 0, errorUpdatedAt: 1 };
    const view = renderAt('/agent/a1?recoveryFor=pay-1');
    expect(screen.getByTestId('loc').textContent).toBe('/agent/a1?recoveryFor=pay-1');

    for (let ts = 2; ts <= 7; ts++) {
      queryState = { data: undefined, dataUpdatedAt: 0, errorUpdatedAt: ts };
      await act(async () => {
        view.rerender(
          <MemoryRouter initialEntries={['/agent/a1?recoveryFor=pay-1']}>
            <Routes>
              <Route
                element={
                  <>
                    <PaymentReturnHandler />
                    <LocationProbe />
                  </>
                }
                path="*"
              />
            </Routes>
          </MemoryRouter>,
        );
      });
    }
    await waitFor(() =>
      expect(screen.getByTestId('loc').textContent).toBe('/settings/plans?recoveryFor=pay-1'),
    );
    expect(reachGoal).not.toHaveBeenCalled();
  });

  it('hands a row that does not belong to the user (null) to the plans page', async () => {
    setQuery(null, 1);
    renderAt('/agent/a1?recoveryFor=pay-1');
    await waitFor(() =>
      expect(screen.getByTestId('loc').textContent).toBe('/settings/plans?recoveryFor=pay-1'),
    );
  });
});
