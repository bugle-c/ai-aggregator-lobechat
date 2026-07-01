'use client';

import { Avatar, Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { Spin } from 'antd';
import { cssVar } from 'antd-style';
import { Loader2 } from 'lucide-react';
import { memo } from 'react';

import { DEFAULT_AVATAR } from '@/const/meta';
import { type DiscoverAssistantItem } from '@/types/discover';

interface HomeAssistantItemProps extends DiscoverAssistantItem {
  /** While true the card shows a spinner overlay and ignores pointer input. */
  loading?: boolean;
  onClick?: () => void;
}

/**
 * Popular-assistant card for the home grid: square avatar + name + one-line
 * description + a subtle meta line (author). Clean outlined block with a hover
 * lift, matching the other home cards. Mirrors the look of the community agent
 * card but compact and grid-friendly.
 *
 * Clicking a card starts a chat with the assistant; while that create is
 * in-flight the card renders `loading` (dimmed + a centered spinner) and
 * blocks further clicks.
 */
const HomeAssistantItem = memo<HomeAssistantItemProps>(
  ({ title, avatar, backgroundColor, author, description, loading, onClick }) => {
    return (
      <Block
        clickable
        gap={12}
        height={'100%'}
        padding={16}
        variant={'outlined'}
        width={'100%'}
        style={{
          borderRadius: cssVar.borderRadiusLG,
          opacity: loading ? 0.6 : 1,
          overflow: 'hidden',
          pointerEvents: loading ? 'none' : undefined,
          position: 'relative',
        }}
        onClick={onClick}
      >
        {loading && (
          <Flexbox
            align={'center'}
            justify={'center'}
            style={{
              inset: 0,
              position: 'absolute',
              zIndex: 1,
            }}
          >
            <Spin indicator={<Icon spin icon={Loader2} size={22} />} />
          </Flexbox>
        )}
        <Flexbox horizontal align={'center'} gap={12} style={{ overflow: 'hidden' }}>
          <Avatar
            emojiScaleWithBackground
            avatar={avatar || DEFAULT_AVATAR}
            background={backgroundColor || undefined}
            shape={'square'}
            size={40}
            style={{ flex: 'none' }}
          />
          <Flexbox flex={1} gap={1} style={{ overflow: 'hidden' }}>
            <Text ellipsis fontSize={15} weight={500}>
              {title}
            </Text>
            {author && (
              <Text ellipsis fontSize={12} type={'secondary'}>
                {author}
              </Text>
            )}
          </Flexbox>
        </Flexbox>
        <Text color={cssVar.colorTextSecondary} ellipsis={{ rows: 2 }} fontSize={13}>
          {description}
        </Text>
      </Block>
    );
  },
);

HomeAssistantItem.displayName = 'HomeAssistantItem';

export default HomeAssistantItem;
