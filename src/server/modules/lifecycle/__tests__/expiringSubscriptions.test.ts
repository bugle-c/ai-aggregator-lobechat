import { describe, expect, it } from 'vitest';

import { isExpiringWithinWindow } from '../expiringSubscriptions';
import { buildExpiryReminderEmail, buildSubscriptionConfirmationEmail } from '../templates';

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
