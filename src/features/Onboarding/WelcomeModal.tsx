'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Modal, Typography } from 'antd';
import { Sparkles } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

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

  if (!isLogin || isLoading || !data) return null;
  if (data.firstLoginSeen || localDismissed) return null;

  return (
    <Modal
      centered
      closable
      footer={null}
      maskClosable
      open
      width={520}
      onCancel={handleClose}
    >
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

        <Paragraph style={{ fontSize: 15, marginBottom: 0, textAlign: 'center' }} type="secondary">
          {t('welcome.body')}
        </Paragraph>

        <Button block size="large" type="primary" onClick={handleClose}>
          {t('welcome.cta')}
        </Button>
      </Flexbox>
    </Modal>
  );
});

WelcomeModal.displayName = 'OnboardingWelcomeModal';

export default WelcomeModal;
