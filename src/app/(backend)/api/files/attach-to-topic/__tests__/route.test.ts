import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '../route';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  // auth mock — default: no session
  const getSessionMock = vi.fn(async () => null as any);

  // DB chain mocks
  const limitMock = vi.fn(async () => [] as any[]);
  const whereMock = vi.fn(() => ({ limit: limitMock }));
  const fromMock = vi.fn(() => ({ where: whereMock }));
  const selectMock = vi.fn(() => ({ from: fromMock }));

  const txInsertValuesMock = vi.fn(async () => undefined);
  const txInsertMock = vi.fn(() => ({ values: txInsertValuesMock }));
  const txMock = {
    insert: txInsertMock,
  };
  const transactionMock = vi.fn(async (fn: (tx: any) => any) => fn(txMock));

  const getServerDBMock = vi.fn(async () => ({
    select: selectMock,
    transaction: transactionMock,
  }));

  // FileService mocks
  const uploadBufferMock = vi.fn(async () => ({ key: 'files/user/timestamp-test.pdf' }));
  const createFileRecordMock = vi.fn(async () => ({
    fileId: 'file-abc-123',
    url: 'https://app/f/file-abc-123',
  }));

  // Notify (global fetch) mock
  const globalFetchMock = vi.fn(
    async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  );

  return {
    getSessionMock,
    limitMock,
    whereMock,
    fromMock,
    selectMock,
    txInsertValuesMock,
    txInsertMock,
    txMock,
    transactionMock,
    getServerDBMock,
    uploadBufferMock,
    createFileRecordMock,
    globalFetchMock,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/auth', () => ({
  auth: {
    api: {
      getSession: mocks.getSessionMock,
    },
  },
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: mocks.getServerDBMock,
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    uploadBuffer: mocks.uploadBufferMock,
    createFileRecord: mocks.createFileRecordMock,
  })),
}));

// idGenerator produces deterministic IDs in tests
vi.mock('@/database/utils/idGenerator', () => ({
  idGenerator: vi.fn(() => 'msg_test-id-1234'),
}));

vi.stubGlobal('fetch', mocks.globalFetchMock);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFormData(fields: {
  topicId?: string;
  file?: { name: string; type: string; content: string };
}) {
  const fd = new FormData();
  if (fields.topicId) fd.append('topicId', fields.topicId);
  if (fields.file) {
    fd.append(
      'file',
      new File([fields.file.content], fields.file.name, { type: fields.file.type }),
    );
  }
  return fd;
}

function makeRequest(
  opts: {
    formData?: FormData;
    cookie?: string;
  } = {},
) {
  const fd =
    opts.formData ??
    makeFormData({
      topicId: 'topic-1',
      file: { name: 'test.pdf', type: 'application/pdf', content: 'hello' },
    });
  const headers: Record<string, string> = {};
  if (opts.cookie) headers['cookie'] = opts.cookie;
  return new Request('http://localhost/api/files/attach-to-topic', {
    method: 'POST',
    body: fd,
    headers,
  }) as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/files/attach-to-topic', () => {
  beforeEach(() => {
    process.env.BOT_INTERNAL_URL = 'http://127.0.0.1:8081';
    process.env.BOT_NOTIFY_SECRET = 'test-notify-secret';

    // Default DB: first select returns topic, second returns billing (with chatId)
    let selectCallCount = 0;
    mocks.selectMock.mockImplementation((() => {
      selectCallCount++;
      const callNum = selectCallCount;
      return {
        from: () => ({
          where: () => ({
            limit: async () => {
              if (callNum === 1) {
                // topics ownership check
                return [{ id: 'topic-1', sessionId: 'ssn_inbox_user-1' }];
              }
              // user_billing select
              return [{ tgBotChatId: 99999 }];
            },
          }),
        }),
      };
    }) as any);

    mocks.getSessionMock.mockResolvedValue(null);
    mocks.uploadBufferMock.mockResolvedValue({ key: 'files/user/ts-test.pdf' });
    mocks.createFileRecordMock.mockResolvedValue({
      fileId: 'file-abc-123',
      url: 'https://app/f/file-abc-123',
    });
    mocks.txInsertValuesMock.mockResolvedValue(undefined);
    mocks.transactionMock.mockImplementation(async (fn: any) =>
      fn(mocks.txMock ?? { insert: mocks.txInsertMock }),
    );
    mocks.globalFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.BOT_INTERNAL_URL;
    delete process.env.BOT_NOTIFY_SECRET;
  });

  // =========================================================================
  // Auth
  // =========================================================================

  it('returns 401 without a session', async () => {
    mocks.getSessionMock.mockResolvedValue(null);
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthorized');
  });

  // =========================================================================
  // Validation
  // =========================================================================

  it('returns 400 when topicId is missing', async () => {
    mocks.getSessionMock.mockResolvedValue({ user: { id: 'user-1' } });
    const fd = makeFormData({ file: { name: 'f.pdf', type: 'application/pdf', content: 'x' } });
    // No topicId appended
    const res = await POST(makeRequest({ formData: fd }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('missing_topicId');
  });

  it('returns 400 when file is missing', async () => {
    mocks.getSessionMock.mockResolvedValue({ user: { id: 'user-1' } });
    const fd = makeFormData({ topicId: 'topic-1' });
    // No file appended
    const res = await POST(makeRequest({ formData: fd }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('missing_file');
  });

  // =========================================================================
  // Ownership
  // =========================================================================

  it('returns 403 when topic does not belong to current user', async () => {
    mocks.getSessionMock.mockResolvedValue({ user: { id: 'user-1' } });

    // Override DB to return no topic (ownership fails)
    mocks.selectMock.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: (async () => []) as any,
        }),
      }),
    } as any);

    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('topic_not_found_or_forbidden');
  });

  // =========================================================================
  // Happy path
  // =========================================================================

  it('200 happy path: file saved, message created, notify fired', async () => {
    mocks.getSessionMock.mockResolvedValue({ user: { id: 'user-1' } });

    // Track transaction calls
    const insertedRows: any[] = [];
    mocks.transactionMock.mockImplementation(async (fn: any) => {
      const fakeTrx = {
        insert: vi.fn(() => ({
          values: vi.fn(async (row: any) => {
            insertedRows.push(row);
          }),
        })),
      };
      return fn(fakeTrx);
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.fileId).toBe('file-abc-123');
    expect(body.fileName).toBe('test.pdf');
    expect(body.messageId).toBe('msg_test-id-1234');
    expect(body.topicId).toBe('topic-1');

    // File was uploaded
    expect(mocks.uploadBufferMock).toHaveBeenCalledTimes(1);
    expect(mocks.createFileRecordMock).toHaveBeenCalledTimes(1);

    // Two rows inserted: message + messagesFiles
    expect(insertedRows).toHaveLength(2);
    expect(insertedRows[0].role).toBe('user');
    expect(insertedRows[1].fileId).toBe('file-abc-123');

    // Bot was notified
    await vi.waitFor(() => {
      expect(mocks.globalFetchMock).toHaveBeenCalled();
    });
    const notifyCall = mocks.globalFetchMock.mock.calls[0] as any[];
    expect(notifyCall[0]).toContain('/internal/notify');
    const notifyBody = JSON.parse((notifyCall[1] as RequestInit).body as string);
    expect(notifyBody.type).toBe('file_attached');
    expect(notifyBody.payload.fileName).toBe('test.pdf');
  });

  it('200 even if bot notify call fails (graceful degradation)', async () => {
    mocks.getSessionMock.mockResolvedValue({ user: { id: 'user-1' } });

    // Make bot notify throw
    mocks.globalFetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await POST(makeRequest());
    // Should still succeed
    expect(res.status).toBe(200);
  });
});
