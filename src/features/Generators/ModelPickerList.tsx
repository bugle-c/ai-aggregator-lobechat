'use client';

import { createStyles } from 'antd-style';
import { Check } from 'lucide-react';
import { type AiModelForSelect } from 'model-bank';
import { memo, type ReactNode } from 'react';

import { ProviderItemRender } from '@/components/ModelSelect';
import type { EnabledProviderWithModels } from '@/types/index';

interface Props {
  currentModel: string | undefined;
  currentProvider: string | undefined;
  onPick: (modelId: string, providerId: string) => void;
  providers: readonly EnabledProviderWithModels[];
  /** Row body — `ImageModelItem` / `VideoModelItem`, which also draw the lock. */
  renderModel: (model: AiModelForSelect, providerId: string) => ReactNode;
}

const useStyles = createStyles(({ css, token }) => ({
  root: css`
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;

    max-block-size: min(60vh, 420px);
    min-inline-size: 260px;
  `,
  group: css`
    padding-block: 6px 2px;
    padding-inline: 8px;
    font-size: 12px;
    color: ${token.colorTextTertiary};
  `,
  row: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    min-block-size: 40px;
    padding-block: 4px;
    padding-inline: 8px;
    border: none;
    border-radius: 8px;

    color: ${token.colorText};
    text-align: start;

    background: transparent;

    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  rowActive: css`
    background: ${token.colorPrimaryBg};

    &:hover {
      background: ${token.colorPrimaryBg};
    }
  `,
  body: css`
    flex: 1 1 auto;
    min-inline-size: 0;
  `,
}));

/**
 * Flat, tappable model list for the settings chip's popover / drawer. The
 * `Select`-based `ModelSelect` opens a dropdown inside a popover, which is
 * one layer too many on a phone; this is the same rows without the
 * `Select` chrome. Lock handling is the caller's: it decides between
 * switching and upselling once a row is picked.
 */
const ModelPickerList = memo<Props>(
  ({ currentModel, currentProvider, onPick, providers, renderModel }) => {
    const { styles, cx } = useStyles();
    const grouped = providers.length > 1;

    return (
      <div className={styles.root} role="listbox">
        {providers.map((provider) => (
          <div key={provider.id}>
            {grouped && (
              <div className={styles.group}>
                <ProviderItemRender
                  logo={provider.logo}
                  name={provider.name}
                  provider={provider.id}
                  source={provider.source}
                />
              </div>
            )}
            {provider.children.map((model) => {
              const active = model.id === currentModel && provider.id === currentProvider;
              return (
                <button
                  aria-selected={active}
                  className={cx(styles.row, active && styles.rowActive)}
                  key={`${provider.id}/${model.id}`}
                  role="option"
                  type="button"
                  onClick={() => onPick(model.id, provider.id)}
                >
                  <span className={styles.body}>{renderModel(model, provider.id)}</span>
                  {active && <Check size={14} />}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    );
  },
);

ModelPickerList.displayName = 'ModelPickerList';

export default ModelPickerList;
