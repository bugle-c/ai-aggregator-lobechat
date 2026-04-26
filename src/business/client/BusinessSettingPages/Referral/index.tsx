'use client';

import { Flexbox } from '@lobehub/ui';
import { App, Button, Card, Spin, Statistic, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { Copy, Gift, Send } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SettingHeader from '@/app/[variants]/(main)/settings/features/SettingHeader';
import { lambdaQuery } from '@/libs/trpc/client';

import CashoutModal from './CashoutModal';

const { Title, Text, Paragraph } = Typography;

/**
 * User-facing referral & cashout page (Phase 2.1, T2).
 *
 * Reads state from the `referral.*` lambda router and renders:
 *   - share block (copy / Telegram / WhatsApp / X)
 *   - bonus structure
 *   - aggregate stats + referrals table
 *   - cashout request CTA + history
 *
 * Backend procedures used:
 *   - referral.getMyState        — code, totals, balance, rate/min
 *   - referral.getMyList         — paginated referrals (masked emails)
 *   - referral.requestCashout    — invoked from CashoutModal
 *   - referral.listMyCashouts    — last N cashout requests
 */
const Referral = memo(() => {
  const { t } = useTranslation('subscription');
  const { message } = App.useApp();
  const [cashoutOpen, setCashoutOpen] = useState(false);

  const stateQuery = lambdaQuery.referral.getMyState.useQuery();
  const listQuery = lambdaQuery.referral.getMyList.useQuery({ limit: 50, offset: 0 });
  const cashoutsQuery = lambdaQuery.referral.listMyCashouts.useQuery({ limit: 10 });

  // Build the share link from the running origin so it works in dev, preview,
  // and prod without hard-coding the canonical domain.
  const referralLink = useMemo(() => {
    if (!stateQuery.data?.code) return '';
    const origin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'https://ask.gptweb.ru';
    return `${origin}/?ref=${stateQuery.data.code}`;
  }, [stateQuery.data?.code]);

  const handleCopy = async () => {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      message.success(t('referrals.copied'));
    } catch {
      // Fallback for browsers blocking clipboard API: select via temp textarea.
      const ta = document.createElement('textarea');
      ta.value = referralLink;
      document.body.append(ta);
      ta.select();
      try {
        document.execCommand('copy');
        message.success(t('referrals.copied'));
      } finally {
        ta.remove();
      }
    }
  };

  const shareText = useMemo(
    () => t('referrals.shareMessage', { link: referralLink }),
    [t, referralLink],
  );

  const shareUrls = useMemo(() => {
    const encoded = encodeURIComponent(shareText);
    const linkOnly = encodeURIComponent(referralLink);
    return {
      // Telegram's share-url endpoint takes `url` + `text` separately.
      telegram: `https://t.me/share/url?url=${linkOnly}&text=${encoded}`,
      // WhatsApp can take a single `text` param with the message + URL inline.
      whatsapp: `https://api.whatsapp.com/send?text=${encoded}`,
      // X (Twitter) uses `text` for the tweet body.
      x: `https://twitter.com/intent/tweet?text=${encoded}`,
    };
  }, [shareText, referralLink]);

  const isLoading = stateQuery.isLoading;

  if (isLoading) {
    return (
      <>
        <SettingHeader title={t('referrals.title')} />
        <Flexbox align="center" justify="center" style={{ padding: 64 }}>
          <Spin />
        </Flexbox>
      </>
    );
  }

  const state = stateQuery.data;
  const balance = state?.currentBalance ?? 0;
  const minCredits = state?.cashout.minCredits ?? 5000;
  const ratePerCredit = state?.cashout.ratePerCredit ?? 0.05;
  const minRub = Math.round(minCredits * ratePerCredit);
  const canCashout = balance >= minCredits;

  const items = listQuery.data || [];
  const cashouts = cashoutsQuery.data || [];

  return (
    <>
      <SettingHeader title={t('referrals.title')} />

      {/* Share / link block */}
      <Card style={{ marginTop: 16 }}>
        <Flexbox gap={12}>
          <Flexbox horizontal align="center" gap={4}>
            <Gift size={20} />
            <Title level={5} style={{ margin: 0 }}>
              {t('referrals.subtitle')}
            </Title>
          </Flexbox>

          <Text type="secondary">{t('referrals.yourLink')}</Text>
          <Flexbox horizontal align="center" gap={8} wrap="wrap">
            <Typography.Text
              code
              copyable={false}
              style={{ flex: 1, minWidth: 220, padding: '6px 12px' }}
            >
              {referralLink || '—'}
            </Typography.Text>
            <Button icon={<Copy size={14} />} onClick={handleCopy}>
              {t('referrals.copy')}
            </Button>
          </Flexbox>

          <Flexbox horizontal gap={8} wrap="wrap">
            <Text type="secondary">{t('referrals.shareLabel')}:</Text>
            <Button
              size="small"
              onClick={() => window.open(shareUrls.telegram, '_blank', 'noopener,noreferrer')}
            >
              {t('referrals.shareTelegram')}
            </Button>
            <Button
              size="small"
              onClick={() => window.open(shareUrls.whatsapp, '_blank', 'noopener,noreferrer')}
            >
              {t('referrals.shareWhatsapp')}
            </Button>
            <Button
              size="small"
              onClick={() => window.open(shareUrls.x, '_blank', 'noopener,noreferrer')}
            >
              {t('referrals.shareX')}
            </Button>
          </Flexbox>
        </Flexbox>
      </Card>

      {/* Bonus list */}
      <Card style={{ marginTop: 16 }}>
        <Title level={5} style={{ marginBottom: 12, marginTop: 0 }}>
          {t('referrals.bonusListTitle')}
        </Title>
        <ul style={{ marginBottom: 0, paddingLeft: 24 }}>
          <li>
            <Text>{t('referrals.bonusReferred')}</Text>
          </li>
          <li>
            <Text>{t('referrals.bonusL1')}</Text>
          </li>
          <li>
            <Text>{t('referrals.bonusL2')}</Text>
          </li>
        </ul>
      </Card>

      {/* Stats + referrals table */}
      <Card style={{ marginTop: 16 }}>
        <Flexbox horizontal gap={32} style={{ marginBottom: 16 }} wrap="wrap">
          <Statistic
            suffix={t('referrals.creditsUnit')}
            title={t('referrals.totalEarned')}
            value={state?.totalCreditsEarned ?? 0}
          />
          <Statistic
            suffix={t('referrals.peopleUnit')}
            title={t('referrals.totalReferred')}
            value={state?.totalReferred ?? 0}
          />
          <Statistic
            suffix={t('referrals.peopleUnit')}
            title={t('referrals.pendingPayments')}
            value={Math.max((state?.totalReferred ?? 0) - (state?.totalRewarded ?? 0), 0)}
          />
        </Flexbox>

        <Title level={5} style={{ marginBottom: 8 }}>
          {t('referrals.tableTitle')}
        </Title>

        <Table
          dataSource={items.map((r) => ({ ...r, key: r.id }))}
          loading={listQuery.isLoading}
          locale={{ emptyText: t('referrals.noReferrals') }}
          pagination={items.length > 10 ? { pageSize: 10 } : false}
          size="small"
          columns={[
            {
              dataIndex: 'referredEmailMasked',
              key: 'user',
              render: (v: string) => v || '—',
              title: t('referrals.table.user'),
            },
            {
              align: 'center',
              dataIndex: 'level',
              key: 'level',
              render: (v: number) => `L${v}`,
              title: t('referrals.table.level'),
              width: 80,
            },
            {
              dataIndex: 'status',
              key: 'status',
              render: (v: string) => {
                const colorMap: Record<string, string> = {
                  pending: 'gold',
                  rejected_abuse: 'red',
                  rejected_no_payment: 'default',
                  rewarded: 'green',
                };
                const labelKey = `referrals.status.${v}` as const;
                return (
                  <Tag color={colorMap[v] || 'default'}>{t(labelKey, { defaultValue: v })}</Tag>
                );
              },
              title: t('referrals.table.status'),
            },
            {
              align: 'right',
              dataIndex: 'creditsAwarded',
              key: 'credits',
              render: (v: number) => v.toLocaleString('ru-RU'),
              title: t('referrals.table.credits'),
              width: 120,
            },
            {
              dataIndex: 'createdAt',
              key: 'date',
              render: (v: string | Date | null) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '—'),
              title: t('referrals.table.date'),
              width: 160,
            },
          ]}
        />
      </Card>

      {/* Cashout CTA */}
      <Card style={{ marginTop: 16 }}>
        <Flexbox gap={12}>
          <Flexbox horizontal align="center" gap={6}>
            <Send size={18} />
            <Title level={5} style={{ margin: 0 }}>
              {t('referrals.cashout.title')}
            </Title>
          </Flexbox>
          <Paragraph style={{ marginBottom: 0 }} type="secondary">
            {t('referrals.cashout.description')}
          </Paragraph>
          <Text type="secondary">
            {t('referrals.cashout.rate', { rate: ratePerCredit })} ·{' '}
            {t('referrals.cashout.minimum', { min: minCredits, minRub })}
          </Text>
          <Text>{t('referrals.cashout.balance', { balance })}</Text>
          <Flexbox horizontal>
            <Button disabled={!canCashout} type="primary" onClick={() => setCashoutOpen(true)}>
              {t('referrals.cashout.request')}
            </Button>
          </Flexbox>
        </Flexbox>
      </Card>

      {/* Cashout history */}
      <Card style={{ marginTop: 16 }}>
        <Title level={5} style={{ marginBottom: 8, marginTop: 0 }}>
          {t('referrals.cashout.history')}
        </Title>
        <Table
          dataSource={cashouts.map((c) => ({ ...c, key: c.id }))}
          loading={cashoutsQuery.isLoading}
          locale={{ emptyText: t('referrals.cashout.historyEmpty') }}
          pagination={false}
          size="small"
          columns={[
            {
              dataIndex: 'createdAt',
              key: 'date',
              render: (v: string | Date | null) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '—'),
              title: t('referrals.table.date'),
              width: 160,
            },
            {
              key: 'amount',
              render: (_: unknown, row: { creditsRequested: number; amountRub: number }) =>
                t('referrals.cashout.historyAmount', {
                  credits: row.creditsRequested.toLocaleString('ru-RU'),
                  rub: row.amountRub.toLocaleString('ru-RU'),
                }),
              title: t('referrals.cashout.amount'),
            },
            {
              dataIndex: 'paymentMethod',
              key: 'method',
              render: (v: string) => {
                if (v === 'sbp') return t('referrals.cashout.methodSbp');
                if (v === 'sber') return t('referrals.cashout.methodSber');
                if (v === 'card') return t('referrals.cashout.methodCard');
                return v;
              },
              title: t('referrals.cashout.method'),
            },
            {
              dataIndex: 'status',
              key: 'status',
              render: (v: string) => {
                const colorMap: Record<string, string> = {
                  approved: 'blue',
                  paid: 'green',
                  pending: 'gold',
                  rejected: 'red',
                };
                const labelKey = `referrals.cashout.historyStatus.${v}` as const;
                return (
                  <Tag color={colorMap[v] || 'default'}>{t(labelKey, { defaultValue: v })}</Tag>
                );
              },
              title: t('referrals.table.status'),
            },
          ]}
        />
      </Card>

      <CashoutModal
        balance={balance}
        minCredits={minCredits}
        open={cashoutOpen}
        ratePerCredit={ratePerCredit}
        onClose={() => setCashoutOpen(false)}
        onSuccess={() => {
          // Refresh state + cashout history so the balance and history table
          // reflect the new pending request immediately.
          stateQuery.refetch();
          cashoutsQuery.refetch();
        }}
      />
    </>
  );
});

Referral.displayName = 'Referral';
export default Referral;
