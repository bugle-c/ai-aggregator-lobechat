'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Modal, Typography } from 'antd';
import { Sparkles } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { startTgLink } from '@/features/TgLinkBonusBanner/startTgLink';
import { useShouldShow } from '@/features/TgLinkBonusBanner/useShouldShow';
import { lambdaQuery } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

const { Title, Paragraph } = Typography;

/**
 * First-login welcome modal.
 *
 * Shows a centered modal once per user (gated by `first_login_seen` in
 * user_onboarding). The mark mutation runs in the background so dismissing
 * the modal feels instant; we hide the modal locally as soon as the user
 * clicks anywhere that closes it.
 */
const WelcomeModal = memo(() => {
  const { t } = useTranslation('onboarding');
  const isLogin = useUserStore(authSelectors.isLogin);
  const [localDismissed, setLocalDismissed] = useState(false);

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

  if (!isLogin || isLoading || !data) return null;
  if (data.firstLoginSeen || localDismissed) return null;

  return (
    <Modal centered closable maskClosable open footer={null} width={520} onCancel={handleClose}>
      <Flexbox align="center" gap={16} paddingBlock={16} paddingInline={8}>
        <Flexbox
          align="center"
          justify="center"
          style={{
            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
            borderRadius: 24,
            height: 64,
            width: 64,
          }}
        >
          <Icon icon={Sparkles} size={32} style={{ color: '#fff' }} />
        </Flexbox>

        <Title level={3} style={{ marginBottom: 0, textAlign: 'center' }}>
          {t('welcome.title')}
        </Title>

        <Paragraph
          style={{ fontSize: 15, marginBottom: 0, textAlign: 'center', whiteSpace: 'pre-line' }}
          type="secondary"
        >
          <Trans components={{ 1: <strong /> }} i18nKey="welcome.body" ns="onboarding" t={t} />
        </Paragraph>

        <Button block size="large" type="primary" onClick={handleClose}>
          {t('welcome.cta')}
        </Button>

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
                // Close the welcome modal AND start the TG link flow.
                handleClose();
                void startTgLink();
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
