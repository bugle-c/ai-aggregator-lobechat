import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SubscriptionActivatedModal from './SubscriptionActivatedModal';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts?.model ? `${key}:${opts.model}` : opts?.plan ? `${key}:${opts.plan}` : key,
  }),
}));

let enabledModels: any[] = [];
vi.mock('@/hooks/useEnabledChatModels', () => ({
  useEnabledChatModels: () => enabledModels,
}));

vi.mock('@/hooks/useInitRecentTopic', () => ({
  useInitRecentTopic: () => ({}),
}));

let recentTopics: any[] = [];
vi.mock('@/store/home', () => ({
  useHomeStore: (selector: (s: any) => unknown) => selector({ recentTopics }),
}));
vi.mock('@/store/home/selectors', () => ({
  homeRecentSelectors: { recentTopics: (s: any) => s.recentTopics },
}));

const updateAgentConfigById = vi.fn();
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: any) => unknown) => selector({ updateAgentConfigById }),
}));

const LocationProbe = () => {
  const loc = useLocation();
  return <div data-testid="loc">{`${loc.pathname}${loc.search}`}</div>;
};

const renderModal = (props: Partial<React.ComponentProps<typeof SubscriptionActivatedModal>>) =>
  render(
    <MemoryRouter initialEntries={['/settings/plans']}>
      <SubscriptionActivatedModal open planSlug="basic" onClose={() => {}} {...props} />
      <LocationProbe />
    </MemoryRouter>,
  );

const lobehubWith = (ids: string[]) => [
  {
    children: ids.map((id) => ({ displayName: id.toUpperCase(), id })),
    id: 'lobehub',
    name: 'LobeHub',
  },
];

describe('SubscriptionActivatedModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enabledModels = [];
    recentTopics = [];
  });

  it('hides the switch CTA until the enabled model list has loaded', () => {
    renderModal({ agentId: 'a1' });
    expect(screen.queryByText(/activated\.continueWith/)).toBeNull();
    expect(screen.getByText('activated.continue')).toBeInTheDocument();
    expect(screen.getByText('activated.keepModel')).toBeInTheDocument();
  });

  it('switches to the best recommended model with the provider from the enabled list', () => {
    enabledModels = [
      { children: [{ displayName: 'DS Flash (byok)', id: 'deepseek-v4.1-flash' }], id: 'byok' },
      ...lobehubWith(['gpt-5-mini']),
    ];
    renderModal({ agentId: 'a1' });
    // basic tier: #1 is deepseek-v4.1-flash — only `byok` exposes it here,
    // so that is the provider written, never a hard-coded 'lobehub'.
    fireEvent.click(screen.getByText('activated.continueWith:DS Flash (byok)'));
    expect(updateAgentConfigById).toHaveBeenCalledWith('a1', {
      model: 'deepseek-v4.1-flash',
      provider: 'byok',
    });
  });

  it('skips recommended models that are not enabled', () => {
    enabledModels = lobehubWith(['gpt-5-mini']);
    renderModal({ agentId: 'a1' });
    fireEvent.click(screen.getByText('activated.continueWith:GPT-5-MINI'));
    expect(updateAgentConfigById).toHaveBeenCalledWith('a1', {
      model: 'gpt-5-mini',
      provider: 'lobehub',
    });
  });

  it('never switches without a click', () => {
    enabledModels = lobehubWith(['gpt-5-mini']);
    renderModal({ agentId: 'a1' });
    expect(updateAgentConfigById).not.toHaveBeenCalled();
  });

  it('returnToChat: navigates to the latest topic when it has an agent', () => {
    recentTopics = [{ agent: { id: 'ag-9' }, group: null, id: 't-1', type: 'agent' }];
    renderModal({ returnToChat: true });
    fireEvent.click(screen.getByText('activated.keepModel'));
    expect(screen.getByTestId('loc').textContent).toBe('/agent/ag-9?topic=t-1');
  });

  it('returnToChat: falls back to / when the latest topic has no agent id', () => {
    recentTopics = [{ agent: null, group: null, id: 't-1', type: 'agent' }];
    renderModal({ returnToChat: true });
    fireEvent.click(screen.getByText('activated.keepModel'));
    expect(screen.getByTestId('loc').textContent).toBe('/');
  });

  it('returnToChat: falls back to / with no recent topics', () => {
    renderModal({ returnToChat: true });
    fireEvent.click(screen.getByText('activated.continue'));
    expect(screen.getByTestId('loc').textContent).toBe('/');
  });
});
