'use client';

import { Avatar } from '@lobehub/ui';
import { memo } from 'react';
import { Link } from 'react-router-dom';

import { DEFAULT_AVATAR } from '@/const/meta';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useHomeStore } from '@/store/home';
import { homeRecentSelectors } from '@/store/home/selectors';

/**
 * Compact recent-chats list rendered inside the LEFT sidebar (Light mode).
 *
 * Reuses the same recent-topics data as the home-page RecentTopic block, but
 * renders slim NavItem rows (matching the sidebar visual language) instead of
 * the wide home-page cards. Each row links to the exact conversation the user
 * left off in: `/agent/<id>?topic=<id>` (or `/group/<id>?topic=<id>`).
 */
const RecentChatsList = memo(() => {
  const recentTopics = useHomeStore(homeRecentSelectors.recentTopics);

  return recentTopics.map((topic) => {
    const isGroup = topic.type === 'group' && topic.group;
    const topicUrl = isGroup
      ? `/group/${topic.group?.id}?topic=${topic.id}`
      : `/agent/${topic?.agent?.id}?topic=${topic.id}`;

    const avatar = isGroup
      ? topic.group?.members?.[0]?.avatar || DEFAULT_AVATAR
      : topic.agent?.avatar || DEFAULT_AVATAR;
    const background = isGroup
      ? topic.group?.members?.[0]?.backgroundColor
      : topic.agent?.backgroundColor;

    return (
      <Link key={topic.id} style={{ color: 'inherit', textDecoration: 'none' }} to={topicUrl}>
        <NavItem
          title={topic.title}
          slots={{
            iconPostfix: (
              <Avatar
                avatar={avatar}
                background={background || undefined}
                shape={'square'}
                size={20}
                style={{ borderRadius: 4, flex: 'none' }}
              />
            ),
          }}
        />
      </Link>
    );
  });
});

export default RecentChatsList;
