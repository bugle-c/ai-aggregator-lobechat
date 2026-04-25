'use client';

import { memo, useEffect } from 'react';

/**
 * WebGPT replaced the upstream LobeChat onboarding flow (Telemetry/FullName/
 * Interests/ResponseLanguage/ProSettings steps) with a lightweight Welcome
 * modal in `src/features/Onboarding/WelcomeModal.tsx` (Task 1.3) that fires
 * on first chat visit. The auto-redirect to /onboarding is disabled in
 * `src/layout/GlobalProvider/useUserStateRedirect.ts`.
 *
 * If a user lands here manually (old bookmark, direct URL), redirect to /chat.
 */
const OnboardingPage = memo(() => {
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.location.replace('/chat');
    }
  }, []);

  return null;
});

OnboardingPage.displayName = 'OnboardingPage';

export default OnboardingPage;
