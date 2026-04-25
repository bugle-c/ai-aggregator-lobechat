import {
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuRoot,
  DropdownMenuTrigger,
  TooltipGroup,
} from '@lobehub/ui';
import { memo, useCallback, useState } from 'react';

import { PanelContent } from './components/PanelContent';
import { styles } from './styles';
import { type ModelSwitchPanelProps } from './types';

const ModelSwitchPanel = memo<ModelSwitchPanelProps>(
  ({
    children,
    extraControls,
    model: modelProp,
    onModelChange,
    onOpenChange,
    open,
    placement = 'topLeft',
    provider: providerProp,
    openOnHover = true,
  }) => {
    const [internalOpen, setInternalOpen] = useState(false);
    const isOpen = open ?? internalOpen;

    // Bug fix: lifting `showAll` here (instead of inside PanelContent) keeps
    // the toggle state alive across PanelContent remounts. The dropdown
    // portal can unmount/remount its children when scroll/focus events
    // bubble to Radix's outside-click detection — without this, every scroll
    // tick that briefly closed-then-reopened the popup reset showAll → false.
    const [showAll, setShowAll] = useState(false);
    const handleToggleShowAll = useCallback(() => setShowAll((prev) => !prev), []);

    const handleOpenChange = useCallback(
      (nextOpen: boolean) => {
        setInternalOpen(nextOpen);
        onOpenChange?.(nextOpen);
      },
      [onOpenChange],
    );

    return (
      <TooltipGroup>
        <DropdownMenuRoot open={isOpen} onOpenChange={handleOpenChange}>
          <DropdownMenuTrigger openOnHover={openOnHover}>{children}</DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuPositioner hoverTrigger={openOnHover} placement={placement}>
              <DropdownMenuPopup className={styles.container}>
                <PanelContent
                  extraControls={extraControls}
                  model={modelProp}
                  provider={providerProp}
                  showAll={showAll}
                  onModelChange={onModelChange}
                  onOpenChange={handleOpenChange}
                  onToggleShowAll={handleToggleShowAll}
                />
              </DropdownMenuPopup>
            </DropdownMenuPositioner>
          </DropdownMenuPortal>
        </DropdownMenuRoot>
      </TooltipGroup>
    );
  },
);

ModelSwitchPanel.displayName = 'ModelSwitchPanel';

export default ModelSwitchPanel;

export { type ModelSwitchPanelProps } from './types';
