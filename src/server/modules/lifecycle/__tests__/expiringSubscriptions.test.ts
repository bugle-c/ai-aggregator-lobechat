import { describe, expect, it } from 'vitest';

import {
  EXPIRED_BANNER_WINDOW_DAYS,
  EXPIRED_EMAIL_WINDOW_DAYS,
  isExpiredNoticeDue,
  isExpiringWithinWindow,
  isSyntheticEmail,
  resolveExpiredPlanNotice,
} from '../expiringSubscriptions';
import { escapeMarkdownV2 } from '../telegram';
import {
  buildExpiryReminderEmail,
  buildSubscriptionConfirmationEmail,
  buildSubscriptionExpiredEmail,
} from '../templates';

const NOW = new Date('2026-04-25T10:00:00Z');
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe('isExpiringWithinWindow', () => {
  it('matches a sub expiring in ~2.5 days, paid, no reminder yet', () => {
    expect(
      isExpiringWithinWindow({
        expiresAt: days(2.5),
        reminderSentAt: null,
        priceRub: 990,
        now: NOW,
      }),
    ).toBe(true);
  });

  it('rejects free plan even in window', () => {
    expect(
      isExpiringWithinWindow({
        expiresAt: days(2.5),
        reminderSentAt: null,
        priceRub: 0,
        now: NOW,
      }),
    ).toBe(false);
  });

  it('rejects when reminder already sent', () => {
    expect(
      isExpiringWithinWindow({
        expiresAt: days(2.5),
        reminderSentAt: new Date(NOW.getTime() - 86_400_000),
        priceRub: 990,
        now: NOW,
      }),
    ).toBe(false);
  });

  it('rejects when expires sooner than 2 days', () => {
    expect(
      isExpiringWithinWindow({
        expiresAt: days(1.5),
        reminderSentAt: null,
        priceRub: 990,
        now: NOW,
      }),
    ).toBe(false);
  });

  it('rejects when expires later than 3 days', () => {
    expect(
      isExpiringWithinWindow({
        expiresAt: days(3.5),
        reminderSentAt: null,
        priceRub: 990,
        now: NOW,
      }),
    ).toBe(false);
  });

  it('rejects when expiresAt is null', () => {
    expect(
      isExpiringWithinWindow({
        expiresAt: null,
        reminderSentAt: null,
        priceRub: 990,
        now: NOW,
      }),
    ).toBe(false);
  });

  it('matches exactly at +3 days (inclusive upper)', () => {
    expect(
      isExpiringWithinWindow({
        expiresAt: days(3),
        reminderSentAt: null,
        priceRub: 990,
        now: NOW,
      }),
    ).toBe(true);
  });

  it('rejects exactly at +2 days (exclusive lower)', () => {
    expect(
      isExpiringWithinWindow({
        expiresAt: days(2),
        reminderSentAt: null,
        priceRub: 990,
        now: NOW,
      }),
    ).toBe(false);
  });
});

describe('isSyntheticEmail', () => {
  it('flags bot/telegram/wechat addresses and missing emails', () => {
    expect(isSyntheticEmail('tg_123@bot.gptweb.ru')).toBe(true);
    expect(isSyntheticEmail('123@telegram.local')).toBe(true);
    expect(isSyntheticEmail('abc@wechat.lobehub')).toBe(true);
    expect(isSyntheticEmail(null)).toBe(true);
    expect(isSyntheticEmail('')).toBe(true);
  });

  it('accepts a real mailbox', () => {
    expect(isSyntheticEmail('user@gmail.com')).toBe(false);
    expect(isSyntheticEmail('telegram-fan@yandex.ru')).toBe(false);
  });
});

describe('isExpiredNoticeDue (T0 selection)', () => {
  const base = {
    eventCreatedAt: new Date(NOW.getTime() - 2 * 3_600_000),
    eventType: 'cancelled',
    now: NOW,
    planId: 1,
    reminderSentAt: null,
  };

  it('is due right after the plan dropped to free', () => {
    expect(isExpiredNoticeDue(base)).toBe(true);
  });

  it('is due when only the T-3 reminder was stamped (stamp predates the expiry)', () => {
    expect(
      isExpiredNoticeDue({ ...base, reminderSentAt: new Date(NOW.getTime() - 3 * 86_400_000) }),
    ).toBe(true);
  });

  it('is NOT due once the T0 notice was stamped (stamp postdates the expiry)', () => {
    expect(
      isExpiredNoticeDue({ ...base, reminderSentAt: new Date(NOW.getTime() - 3_600_000) }),
    ).toBe(false);
  });

  it('waits for the real expiry when the user only cancelled auto-renew (still paid)', () => {
    expect(isExpiredNoticeDue({ ...base, planId: 2 })).toBe(false);
  });

  it('ignores non-expiry latest events', () => {
    expect(isExpiredNoticeDue({ ...base, eventType: 'created' })).toBe(false);
    expect(isExpiredNoticeDue({ ...base, eventCreatedAt: null })).toBe(false);
  });

  it('drops out of the email window after EXPIRED_EMAIL_WINDOW_DAYS', () => {
    const old = new Date(NOW.getTime() - (EXPIRED_EMAIL_WINDOW_DAYS + 0.5) * 86_400_000);
    expect(isExpiredNoticeDue({ ...base, eventCreatedAt: old })).toBe(false);
    expect(
      isExpiredNoticeDue({ ...base, eventCreatedAt: old, windowDays: EXPIRED_BANNER_WINDOW_DAYS }),
    ).toBe(true);
  });
});

describe('resolveExpiredPlanNotice (banner)', () => {
  const event = {
    createdAt: new Date(NOW.getTime() - 5 * 86_400_000),
    eventType: 'cancelled',
    id: 'evt-1',
    planName: 'Pro',
  };

  it('returns the notice for a free user whose plan lapsed within 14 days', () => {
    expect(resolveExpiredPlanNotice({ latestEvent: event, now: NOW, planId: 1 })).toEqual({
      eventId: 'evt-1',
      expiredAt: event.createdAt,
      planName: 'Pro',
    });
  });

  it('returns null when the user re-subscribed, the event is old, or there is no event', () => {
    expect(resolveExpiredPlanNotice({ latestEvent: event, now: NOW, planId: 2 })).toBeNull();
    expect(
      resolveExpiredPlanNotice({
        latestEvent: { ...event, createdAt: new Date(NOW.getTime() - 15 * 86_400_000) },
        now: NOW,
        planId: 1,
      }),
    ).toBeNull();
    expect(resolveExpiredPlanNotice({ latestEvent: null, now: NOW, planId: 1 })).toBeNull();
  });
});

describe('buildSubscriptionExpiredEmail', () => {
  it('names the plan, the date and links to /settings/plans', () => {
    const out = buildSubscriptionExpiredEmail({
      expiredAt: new Date('2026-09-10T10:00:00Z'),
      planName: 'Pro',
    });
    expect(out.subject).toMatch(/закончился/);
    expect(out.html).toContain('Pro');
    expect(out.html).toMatch(/10 сентября 2026/);
    expect(out.html).toMatch(/\/settings\/plans/);
    expect(out.textBody).toMatch(/Продлить подписку/);
  });
});

describe('escapeMarkdownV2', () => {
  it('escapes every Telegram-reserved character', () => {
    expect(escapeMarkdownV2('Тариф «Pro+» закончился 10.09! (см. план_1)')).toBe(
      'Тариф «Pro\\+» закончился 10\\.09\\! \\(см\\. план\\_1\\)',
    );
  });
});

describe('buildExpiryReminderEmail', () => {
  it('produces Russian subject and CTA link to /settings/plans', () => {
    const out = buildExpiryReminderEmail({
      planName: 'Pro',
      expiresAt: new Date('2026-04-28T10:00:00Z'),
    });
    expect(out.subject).toMatch(/истекает через 3 дня/);
    expect(out.html).toContain('Pro');
    expect(out.html).toMatch(/\/settings\/plans/);
    expect(out.textBody).toMatch(/Продлить подписку/);
  });

  it('escapes plan name HTML injection attempts', () => {
    const out = buildExpiryReminderEmail({
      planName: '<script>alert(1)</script>',
      expiresAt: new Date(),
    });
    expect(out.html).not.toContain('<script>');
    expect(out.html).toContain('&lt;script&gt;');
  });
});

describe('buildSubscriptionConfirmationEmail', () => {
  it('mentions plan name, expiresAt, and credit amount', () => {
    const out = buildSubscriptionConfirmationEmail({
      planName: 'Pro',
      expiresAt: new Date('2026-05-25T10:00:00Z'),
      creditAmount: 12_000,
    });
    expect(out.subject).toMatch(/активирована/);
    expect(out.html).toContain('Pro');
    expect(out.html).toMatch(/12\s?000/); // ru-RU thousands separator
  });

  it('omits date string gracefully when expiresAt is null', () => {
    const out = buildSubscriptionConfirmationEmail({
      planName: 'Pro',
      expiresAt: null,
      creditAmount: 1000,
    });
    expect(out.subject).toBeTruthy();
    expect(out.html).toContain('Pro');
  });
});
