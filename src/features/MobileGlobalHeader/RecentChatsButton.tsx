'use client';

import { ActionIcon, Avatar, Empty, Flexbox, Text } from '@lobehub/ui';
import { Drawer } from 'antd';
import { HistoryIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { DEFAULT_AVATAR } from '@/const/meta';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useInitRecentTopic } from '@/hooks/useInitRecentTopic';
import { useHomeStore } from '@/store/home';
import { homeRecentSelectors } from '@/store/home/selectors';

/**
 * Mobile-only "recent chats" entry. Opens a bottom-anchored Drawer listing the
 * user's recent conversations so a Light user on mobile can return to past
 * chats without restructuring the 5-item MobileTabBar.
 */
const RecentChatsButton = memo(() => {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  // Load recent topics into the store (no-op if already loaded).
  useInitRecentTopic();
  const recentTopics = useHomeStore(homeRecentSelectors.recentTopics);

  const handleNavigate = (url: string) => {
    setOpen(false);
    navigate(url);
  };

  return (
    <>
      <ActionIcon
        aria-label={t('topic.recent')}
        icon={HistoryIcon}
        size="large"
        onClick={() => setOpen(true)}
      />
      <Drawer
        height="70vh"
        open={open}
        placement="bottom"
        styles={{ body: { padding: 12 } }}
        title={t('topic.recent')}
        onClose={() => setOpen(false)}
      >
        {recentTopics.length === 0 ? (
          <Empty />
        ) : (
          <Flexbox gap={2}>
            {recentTopics.map((topic) => {
              const isGroup = topic.type === 'group' && topic.group;
              const url = isGroup
                ? `/group/${topic.group?.id}?topic=${topic.id}`
                : `/agent/${topic?.agent?.id}?topic=${topic.id}`;
              const avatar = isGroup
                ? topic.group?.members?.[0]?.avatar || DEFAULT_AVATAR
                : topic.agent?.avatar || DEFAULT_AVATAR;
              const background = isGroup
                ? topic.group?.members?.[0]?.backgroundColor
                : topic.agent?.backgroundColor;

              return (
                <NavItem
                  key={topic.id}
                  title={<Text ellipsis>{topic.title}</Text>}
                  slots={{
                    iconPostfix: (
                      <Avatar
                        avatar={avatar}
                        background={background || undefined}
                        shape={'square'}
                        size={24}
                        style={{ borderRadius: 4, flex: 'none' }}
                      />
                    ),
                  }}
                  onClick={() => handleNavigate(url)}
                />
              );
            })}
          </Flexbox>
        )}
      </Drawer>
    </>
  );
});

RecentChatsButton.displayName = 'MobileRecentChatsButton';

export default RecentChatsButton;
