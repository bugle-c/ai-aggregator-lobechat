'use client';

import { createStyles } from 'antd-style';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Preset } from '@/types/preset';

import { applyPresetTemplate } from './applyPresetTemplate';

interface Props {
  /** Drop the preset, keep whatever the user typed. */
  onClear: () => void;
  /**
   * Hand the composed prompt back to the user's own input and detach the
   * preset, so what they now see in the textarea is exactly what will run.
   */
  onEdit: (composedPrompt: string) => void;
  preset: Preset | null;
  userPrompt: string;
}

const useStyles = createStyles(({ css, token }) => ({
  root: css`
    display: flex;
    flex-direction: column;
    gap: 6px;

    padding-block: 8px;
    padding-inline: 10px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;

    background: ${token.colorFillQuaternary};
  `,
  header: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    min-block-size: 40px;
    padding: 0;
    border: none;

    color: ${token.colorText};
    text-align: start;

    background: transparent;
  `,
  heading: css`
    display: flex;
    flex-direction: column;
    gap: 1px;
  `,
  title: css`
    font-size: 13px;
    font-weight: 600;
  `,
  hint: css`
    font-size: 11px;
    line-height: 1.3;
    color: ${token.colorTextTertiary};
  `,
  prompt: css`
    font-family: ${token.fontFamilyCode};
    font-size: 12px;
    line-height: 1.45;
    color: ${token.colorTextSecondary};
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  `,
  /**
   * Ingested prompt templates run to multiple kilobytes, so the resting
   * state shows about three lines and fades out rather than pretending the
   * text ended.
   */
  collapsed: css`
    overflow: hidden;
    max-block-size: 54px;

    mask-image: linear-gradient(180deg, #000 55%, transparent 100%);
  `,
  expanded: css`
    overflow-y: auto;
    max-block-size: 220px;
  `,
  actions: css`
    display: flex;
    gap: 12px;
    align-items: center;
  `,
  action: css`
    cursor: pointer;

    min-block-size: 32px;
    padding: 0;
    border: none;

    font-size: 12px;
    color: ${token.colorLink};

    background: transparent;

    &:hover {
      color: ${token.colorLinkHover};
    }
  `,
}));

/**
 * Shows the prompt a preset will actually send.
 *
 * `applyPresetTemplate` runs inside `createImage`/`createVideo` at submit
 * time, so until now the 89–196 characters of a curated template — and the
 * multi-kilobyte blobs on ingested rows — were applied invisibly. The user
 * spent credits on a prompt they had never seen, and had no way to keep the
 * wording while dropping the style.
 *
 * Two escapes, both one tap: «Изменить» copies the composed prompt into the
 * user's own input and detaches the preset (what you see is then literally
 * what runs), «Убрать стиль» drops the preset and leaves the typing alone.
 */
const PresetPromptPreview = memo<Props>(({ onClear, onEdit, preset, userPrompt }) => {
  const { styles, cx } = useStyles();
  const { t } = useTranslation('common');
  const [expanded, setExpanded] = useState(false);

  // Nothing to preview for a preset that only carries params (aspect ratio,
  // duration) — the composed prompt would just echo the textarea.
  if (!preset?.promptTemplate) return null;

  const composed = applyPresetTemplate(preset.promptTemplate, userPrompt);

  return (
    <div className={styles.root}>
      <button
        aria-expanded={expanded}
        className={styles.header}
        type="button"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className={styles.heading}>
          <span className={styles.title}>{t('preset.prompt.title')}</span>
          <span className={styles.hint}>{t('preset.prompt.hint')}</span>
        </span>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      <div className={cx(styles.prompt, expanded ? styles.expanded : styles.collapsed)}>
        {composed}
      </div>

      <div className={styles.actions}>
        <button className={styles.action} type="button" onClick={() => onEdit(composed)}>
          {t('preset.prompt.edit')}
        </button>
        <button className={styles.action} type="button" onClick={onClear}>
          {t('preset.prompt.detach')}
        </button>
      </div>
    </div>
  );
});

PresetPromptPreview.displayName = 'PresetPromptPreview';

export default PresetPromptPreview;
