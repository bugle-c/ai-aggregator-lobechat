'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';

const useStyles = createStyles(({ css, cssVar }) => ({
  card: css`
    flex: 1;

    min-width: 0;
    padding-block: 12px;
    padding-inline: 16px;
    border-radius: 12px;

    font-size: 14px;
    line-height: 1.4;
    color: ${cssVar.colorText};

    transition: all 0.15s ease;

    &:hover {
      transform: translateY(-1px);
      box-shadow: 0 2px 8px rgb(0 0 0 / 6%);
    }
  `,
  title: css`
    margin-block-end: 4px;
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
}));

export interface SuggestedPromptsProps {
  /**
   * Optional className applied to the outer container.
   */
  className?: string;
  /**
   * Called with the chosen prompt text. Caller decides whether to pre-fill an
   * input editor or to send the message directly.
   */
  onSelect: (prompt: string) => void;
  /**
   * Whether to render the small "Try a sample prompt" caption above the cards.
   */
  showHint?: boolean;
}

/**
 * Three onboarding starter prompts shown above the chat input on the empty
 * state. Localized via the `onboarding` namespace
 * (`suggested.prompt1` / `prompt2` / `prompt3`).
 */
const SuggestedPrompts = memo<SuggestedPromptsProps>(({ className, onSelect, showHint = true }) => {
  const { t } = useTranslation('onboarding');
  const { styles } = useStyles();
  const isMobile = useIsMobile();

  const prompts = [t('suggested.prompt1'), t('suggested.prompt2'), t('suggested.prompt3')];

  return (
    <Flexbox className={className} gap={8} width={'100%'}>
      {showHint && <div className={styles.title}>{t('suggested.hint')}</div>}
      <Flexbox gap={8} horizontal={!isMobile} width={'100%'}>
        {prompts.map((prompt) => (
          <Block
            clickable
            className={styles.card}
            key={prompt}
            variant={'filled'}
            onClick={() => onSelect(prompt)}
          >
            {prompt}
          </Block>
        ))}
      </Flexbox>
    </Flexbox>
  );
});

SuggestedPrompts.displayName = 'OnboardingSuggestedPrompts';

export default SuggestedPrompts;
