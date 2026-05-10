'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { type ReactNode } from 'react';

interface NextThemeProviderProps {
  children: ReactNode;
}

/**
 * Default theme: light, irrespective of OS preference.
 *
 * `enableSystem` is intentionally off — earlier the provider followed
 * `prefers-color-scheme` so users on dark-OS-by-default landed on the
 * dark UI without ever seeing the lighter palette the brand uses on
 * the marketing site. Light is the brand default; users who prefer
 * dark can flip the toggle in /settings/common (next-themes still
 * persists the explicit choice in localStorage).
 */
export default function NextThemeProvider({ children }: NextThemeProviderProps) {
  return (
    <NextThemesProvider
      disableTransitionOnChange
      attribute="data-theme"
      defaultTheme="light"
      enableSystem={false}
      forcedTheme={undefined}
    >
      {children}
    </NextThemesProvider>
  );
}
