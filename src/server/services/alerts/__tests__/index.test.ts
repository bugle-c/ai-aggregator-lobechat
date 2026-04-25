import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sendAlert } from '../index';

const ORIGINAL_FETCH = globalThis.fetch;

describe('sendAlert', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    globalThis.fetch = ORIGINAL_FETCH;
    delete process.env.TELEGRAM_ALERT_BOT_TOKEN;
    delete process.env.TELEGRAM_ALERT_CHAT_ID;
    vi.restoreAllMocks();
  });

  it('logs to console.error with severity tag', async () => {
    await sendAlert({
      body: 'something is wrong',
      severity: 'critical',
      title: 'boom',
    });
    expect(consoleErrorSpy).toHaveBeenCalled();
    const firstCall = consoleErrorSpy.mock.calls[0]?.[0] as string;
    expect(firstCall).toContain('[CRITICAL]');
    expect(firstCall).toContain('boom');
    expect(firstCall).toContain('something is wrong');
  });

  it('does not call fetch when Telegram env vars are missing', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await sendAlert({
      body: 'b',
      severity: 'info',
      title: 't',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('calls Telegram API when env vars are configured', async () => {
    process.env.TELEGRAM_ALERT_BOT_TOKEN = 'test-bot-token';
    process.env.TELEGRAM_ALERT_CHAT_ID = '123456';

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'ok',
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await sendAlert({
      body: 'details',
      severity: 'warning',
      title: 'hello',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/bottest-bot-token/sendMessage');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.chat_id).toBe('123456');
    expect(body.parse_mode).toBe('Markdown');
    expect(body.text).toContain('[WARNING]');
    expect(body.text).toContain('hello');
    expect(body.text).toContain('details');
  });

  it('does not throw when Telegram fetch rejects', async () => {
    process.env.TELEGRAM_ALERT_BOT_TOKEN = 'test-bot-token';
    process.env.TELEGRAM_ALERT_CHAT_ID = '123456';

    const fetchSpy = vi.fn().mockRejectedValue(new Error('network down'));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(
      sendAlert({
        body: 'b',
        severity: 'critical',
        title: 't',
      }),
    ).resolves.toBeUndefined();

    // Should have logged the failure too (alert log + telegram failure log)
    const calls = consoleErrorSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.includes('telegram delivery failed'))).toBe(true);
  });

  it('logs warning when Telegram returns non-2xx but does not throw', async () => {
    process.env.TELEGRAM_ALERT_BOT_TOKEN = 'test-bot-token';
    process.env.TELEGRAM_ALERT_CHAT_ID = '123456';

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Bad Request',
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(
      sendAlert({
        body: 'b',
        severity: 'info',
        title: 't',
      }),
    ).resolves.toBeUndefined();

    const calls = consoleErrorSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.includes('telegram delivery returned 400'))).toBe(true);
  });
});
