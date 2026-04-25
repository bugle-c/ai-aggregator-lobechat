import { css } from 'antd-style';

/**
 * Task 1.2 — simplify-ui CSS hides.
 *
 * These rules apply only when `<html data-simple-ui="true">`, which is set
 * from the `NEXT_PUBLIC_SIMPLE_UI` env flag in
 * `src/app/[variants]/layout.tsx`.
 *
 * We use CSS-only hides (rather than a component refactor) for surfaces that
 * are deeply baked-in or rendered by vendor components, where conditional
 * rendering would require touching many files.
 *
 * Anything that can be hidden cleanly via a feature flag in the component
 * itself is preferred — this file is a fallback, not a default.
 */

// eslint-disable-next-line unicorn/no-anonymous-default-export
export default () => css`
  /*
   * Workspace tabs / multi-session tabs that some vendor builds render on top
   * of the chat. We do not have a stable selector for this in canary, but if
   * a future build adds one we can target it here without touching the
   * component tree.
   */
  html[data-simple-ui='true'] [data-simple-ui-hide='true'] {
    display: none !important;
  }
`;
