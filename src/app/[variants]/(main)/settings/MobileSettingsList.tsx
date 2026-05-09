'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { Typography } from 'antd';
import { ChevronRight, ExternalLink, LogOut } from 'lucide-react';
import { memo } from 'react';
import { useNavigate } from 'react-router-dom';

const { Text } = Typography;

interface SettingsItem {
  href: string;
  label: string;
}

const ITEMS: SettingsItem[] = [
  { href: '/settings/profile', label: 'Профиль' },
  { href: '/settings/subscription/plans', label: 'Подписка и тарифы' },
  { href: '/settings/referral', label: 'Реферальная программа' },
  { href: '/settings/customization', label: 'Персонализация' },
  { href: '/settings/billing', label: 'Платежи' },
  { href: '/settings/about', label: 'О сервисе' },
];

/**
 * Mobile entry-point for `/settings`.
 *
 * Replaces the desktop sidebar + content split with a vertical list of
 * navigation rows. Tapping a row pushes to the desktop sub-page (which
 * renders fine at narrow widths since each is mostly forms).
 *
 * Power-user surfaces that don't fit on a phone (Agents, Pages, Search,
 * Community, Admin) are linked via the "Open full version" row below.
 *
 * Logout uses better-auth's `/api/auth/sign-out` endpoint to match the
 * desktop UserPanel logout button.
 */
const MobileSettingsList = memo(() => {
  const navigate = useNavigate();

  return (
    <Flexbox gap={6} paddingBlock={12} paddingInline={12}>
      {ITEMS.map((item) => (
        <Block
          clickable
          key={item.href}
          onClick={() => navigate(item.href)}
          padding={14}
          variant="filled"
        >
          <Flexbox align="center" horizontal justify="space-between">
            <Text>{item.label}</Text>
            <ChevronRight size={18} style={{ opacity: 0.5 }} />
          </Flexbox>
        </Block>
      ))}

      <Block padding={14} variant="filled">
        <a
          href="?mobile_redesign=0"
          style={{
            alignItems: 'center',
            color: 'var(--ant-color-link)',
            display: 'flex',
            gap: 8,
            textDecoration: 'none',
          }}
        >
          <ExternalLink size={16} />
          <Text style={{ color: 'inherit' }}>Открыть полную версию на компьютере</Text>
        </a>
      </Block>

      <Block padding={14} variant="filled">
        <button
          onClick={() => {
            window.location.href = '/api/auth/sign-out';
          }}
          style={{
            alignItems: 'center',
            background: 'transparent',
            border: 0,
            color: 'var(--ant-color-error)',
            cursor: 'pointer',
            display: 'flex',
            font: 'inherit',
            gap: 8,
            inlineSize: '100%',
            justifyContent: 'flex-start',
            padding: 0,
          }}
          type="button"
        >
          <LogOut size={16} />
          <Text style={{ color: 'inherit' }}>Выйти</Text>
        </button>
      </Block>
    </Flexbox>
  );
});

MobileSettingsList.displayName = 'MobileSettingsList';

export default MobileSettingsList;
