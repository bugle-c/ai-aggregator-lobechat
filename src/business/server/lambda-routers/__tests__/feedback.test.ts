// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';

import { feedbackRouter } from '../feedback';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));

const mockCtx = { authorizationHeader: 'Bearer mock-token', userId: 'user-abc' };

/** Build a minimal Drizzle-like stub that records insert().values().onConflictDoUpdate() calls. */
const makeDbStub = () => {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });
  return { db: { insert }, insert, values, onConflictDoUpdate };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('feedbackRouter.create', () => {
  it('inserts a new feedback row with rating=up', async () => {
    const { db, insert, values, onConflictDoUpdate } = makeDbStub();
    vi.mocked(getServerDB).mockResolvedValue(db as any);

    const caller = feedbackRouter.createCaller(mockCtx as any);
    const result = await caller.create({ messageId: 'msg-1', rating: 'up', source: 'bot' });

    expect(result).toEqual({ ok: true });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-abc',
        messageId: 'msg-1',
        rating: 'up',
        source: 'bot',
      }),
    );
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it('calls onConflictDoUpdate with the flipped rating when the user reacts again (up → down)', async () => {
    const { db, onConflictDoUpdate } = makeDbStub();
    vi.mocked(getServerDB).mockResolvedValue(db as any);

    const caller = feedbackRouter.createCaller(mockCtx as any);

    // First call: up
    await caller.create({ messageId: 'msg-2', rating: 'up', source: 'bot' });
    // Second call: flip to down — the mutation runs the same upsert path
    await caller.create({ messageId: 'msg-2', rating: 'down', source: 'bot' });

    // Both calls should reach onConflictDoUpdate; the second one carries rating='down'
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(2);
    const secondCallArgs = onConflictDoUpdate.mock.calls[1][0];
    expect(secondCallArgs.set).toMatchObject({ rating: 'down' });
  });

  it('rejects rating="maybe" via Zod validation', async () => {
    const { db } = makeDbStub();
    vi.mocked(getServerDB).mockResolvedValue(db as any);

    const caller = feedbackRouter.createCaller(mockCtx as any);

    await expect(caller.create({ messageId: 'msg-3', rating: 'maybe' as any })).rejects.toThrow(
      TRPCError,
    );
  });

  it('rejects an empty messageId via Zod validation', async () => {
    const { db } = makeDbStub();
    vi.mocked(getServerDB).mockResolvedValue(db as any);

    const caller = feedbackRouter.createCaller(mockCtx as any);

    await expect(caller.create({ messageId: '', rating: 'up' })).rejects.toThrow(TRPCError);
  });
});
