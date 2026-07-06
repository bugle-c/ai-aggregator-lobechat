'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Modal, Typography } from 'antd';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  INTENT_PROMPT_CONSUMED_KEY,
  INTENT_PROMPT_STORAGE_KEY,
} from '@/app/[variants]/(main)/home/features/InputArea/useIntentPrompt';
import IntentChips from '@/features/Onboarding/IntentChips';
import { tgLinkHref } from '@/features/TgLinkBonusBanner/startTgLink';
import { useShouldShow } from '@/features/TgLinkBonusBanner/useShouldShow';
import { lambdaQuery } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

const { Title, Paragraph } = Typography;

/**
 * First-login welcome modal — the «Что делаем?» intent screen.
 *
 * Shows a centered modal once per user (gated by `first_login_seen` in
 * user_onboarding). The mark mutation runs in the background so dismissing
 * the modal feels instant; we hide the modal locally as soon as the user
 * clicks anywhere that closes it.
 *
 * Skipped entirely for blog-intent users who arrived with `?prompt=` —
 * their input is already charged, don't interrupt (we still stamp
 * first_login_seen in the background so the modal never shows later).
 */
const WelcomeModal = memo(() => {
  const { t } = useTranslation('onboarding');
  const isLogin = useUserStore(authSelectors.isLogin);
  const [localDismissed, setLocalDismissed] = useState(false);

  // Computed once: a pending or already-consumed intent prompt means the
  // user came from a blog CTA with a charged input.
  const [skipForChargedInput] = useState(
    () =>
      typeof window !== 'undefined' &&
      Boolean(
        sessionStorage.getItem(INTENT_PROMPT_STORAGE_KEY) ||
        sessionStorage.getItem(INTENT_PROMPT_CONSUMED_KEY),
      ),
  );

  const { data, isLoading } = lambdaQuery.userOnboarding.getOnboardingState.useQuery(undefined, {
    enabled: isLogin,
    staleTime: 60_000,
  });

  const utils = lambdaQuery.useUtils();
  const markSeen = lambdaQuery.userOnboarding.markFirstLoginSeen.useMutation({
    onSuccess: () => {
      utils.userOnboarding.getOnboardingState.invalidate();
    },
  });

  // Reset local dismissal whenever the user changes (logout/login).
  useEffect(() => {
    setLocalDismissed(false);
  }, [isLogin]);

  const handleClose = useCallback(() => {
    setLocalDismissed(true);
    if (!markSeen.isPending) markSeen.mutate();
  }, [markSeen]);

  const showTgBonus = useShouldShow();

  // Background stamp when skipping for a charged input, so the modal
  // never resurfaces on a later visit.
  const skipMarkedRef = useRef(false);
  useEffect(() => {
    if (!skipForChargedInput || skipMarkedRef.current) return;
    if (!isLogin || !data || data.firstLoginSeen) return;
    skipMarkedRef.current = true;
    markSeen.mutate();
  }, [skipForChargedInput, isLogin, data, markSeen]);

  if (!isLogin || isLoading || !data) return null;
  if (data.firstLoginSeen || localDismissed) return null;
  if (skipForChargedInput) return null;

  return (
    <Modal centered closable maskClosable open footer={null} width={520} onCancel={handleClose}>
      <Flexbox align="center" gap={16} paddingBlock={16} paddingInline={8}>
        <Title level={3} style={{ marginBottom: 0, textAlign: 'center' }}>
          {t('welcome.intentTitle')}
        </Title>

        <Paragraph style={{ fontSize: 15, marginBottom: 0, textAlign: 'center' }} type="secondary">
          {t('welcome.intentSubtitle')}
        </Paragraph>

        <IntentChips onDone={handleClose} />

        {showTgBonus && (
          <Flexbox
            align="center"
            gap={8}
            paddingBlock={12}
            paddingInline={16}
            style={{
              background: 'linear-gradient(135deg, #229ed9 0%, #1d8ec5 100%)',
              borderRadius: 12,
              color: '#fff',
              marginBlockStart: 4,
              width: '100%',
            }}
          >
            <Title level={5} style={{ color: '#fff', marginBlock: 0 }}>
              {t('welcome.tgLinkBonusTitle')}
            </Title>
            <Paragraph
              style={{
                color: 'rgba(255,255,255,0.92)',
                fontSize: 13,
                marginBlock: 0,
                textAlign: 'center',
              }}
            >
              {t('welcome.tgLinkBonusBody')}
            </Paragraph>
            <Button
              block
              ghost
              size="middle"
              style={{ background: 'rgba(255,255,255,0.15)', borderColor: 'rgba(255,255,255,0.4)' }}
              onClick={() => {
                // Close the welcome modal AND start the TG link flow
                // via a synchronous navigation — async oauth2.link()
                // breaks the user-gesture chain in Safari and gets
                // blocked. The server-side oauth-start route handles
                // both signin and link for already-logged-in users.
                handleClose();
                window.location.href = tgLinkHref();
              }}
            >
              {t('welcome.tgLinkBonusCta')}
            </Button>
          </Flexbox>
        )}
      </Flexbox>
    </Modal>
  );
});

WelcomeModal.displayName = 'OnboardingWelcomeModal';

export default WelcomeModal;
