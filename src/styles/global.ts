import { CLASSNAMES } from '@lobehub/ui';
import type { Theme } from 'antd-style';
import { css } from 'antd-style';

// fix ios input keyboard
// overflow: hidden;
// ref: https://zhuanlan.zhihu.com/p/113855026
// eslint-disable-next-line unicorn/no-anonymous-default-export
export default ({ token }: { prefixCls: string; token: Theme }) => css`
  html,
  body,
  #__next {
    position: relative;

    overscroll-behavior: none;

    height: 100%;
    min-height: 100dvh;
    max-height: 100dvh;

    @media (device-width >= 576px) {
      overflow: hidden;
    }

    /* Lock body on mobile too — MobileShell.ScrollArea owns the only
       scroll surface, so allowing body to scroll just enables iOS
       Safari's rubber-band on the entire page, which makes the tab
       bar (sibling of ScrollArea inside the shell) appear to bounce
       even though it's structurally flex-shrink:0. Locking html/body
       removes the bounce surface entirely. ScrollArea's
       overscroll-behavior: contain keeps scroll-chains from reaching
       this layer in the first place; this is belt-and-braces for
       aggressive drag gestures that try to drag the viewport itself. */
    @media (width <= 575px) {
      overflow: hidden;
    }
  }

  body {
    /* 提高合成层级，强制硬件加速，否则会有渲染黑边出现 */
    will-change: opacity;
    transform: translateZ(0);
  }

  * {
    scrollbar-color: ${token.colorFill} transparent;
    scrollbar-width: thin;

    ::-webkit-scrollbar {
      width: 0.75em;
      height: 0.75em;
    }

    ::-webkit-scrollbar-thumb {
      border-radius: 10px;
    }

    :hover::-webkit-scrollbar-thumb {
      border: 3px solid transparent;
      background-color: ${token.colorText};
      background-clip: content-box;
    }

    ::-webkit-scrollbar-track {
      background-color: transparent;
    }
  }

  button {
    -webkit-app-region: no-drag;
  }

  .${CLASSNAMES.ContextTrigger}[data-popup-open]:not([data-no-highlight]),
  .${CLASSNAMES.DropdownMenuTrigger}[data-popup-open]:not([data-no-highlight]) {
    background: ${token.colorFillTertiary};
  }
  .accordion-action:has(
    .${CLASSNAMES.DropdownMenuTrigger}[data-popup-open]:not([data-no-highlight])
  ) {
    opacity: 1;
  }
`;
