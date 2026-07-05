import { BRANDING_NAME } from '@lobechat/business-const';
import { Alert, Button, Flexbox, Icon, Input, Skeleton, Text } from '@lobehub/ui';
import { type FormInstance, type InputRef } from 'antd';
import { Checkbox, Divider, Form } from 'antd';
import { createStaticStyles } from 'antd-style';
import { ChevronRight, Mail } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import AuthIcons from '@/components/AuthIcons';
import { CONSENT_URL, PRIVACY_URL, TERMS_URL } from '@/const/url';

import AuthCard from '../../../../features/AuthCard';

const styles = createStaticStyles(({ css, cssVar }) => ({
  setPasswordLink: css`
    cursor: pointer;
    color: ${cssVar.colorPrimary};
    text-decoration: underline;
  `,
}));

export const EMAIL_REGEX = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/;
export const USERNAME_REGEX = /^\w+$/;

export interface SignInEmailStepProps {
  disableEmailPassword?: boolean;
  form: FormInstance<{ email: string }>;
  isSocialOnly: boolean;
  loading: boolean;
  oAuthSSOProviders: string[];
  onCheckUser: (values: { email: string }) => Promise<void>;
  onSetPassword: () => void;
  onSocialSignIn: (provider: string) => void;
  serverConfigInit: boolean;
  socialLoading: string | null;
}

export const SignInEmailStep = ({
  disableEmailPassword,
  form,
  isSocialOnly,
  loading,
  oAuthSSOProviders,
  serverConfigInit,
  socialLoading,
  onCheckUser,
  onSetPassword,
  onSocialSignIn,
}: SignInEmailStepProps) => {
  const { t } = useTranslation('auth');
  const emailInputRef = useRef<InputRef>(null);

  // Required legal consent — user must tick this before ANY login method
  // (Yandex/Telegram OAuth or email/password) is allowed. Local UI state only.
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    emailInputRef.current?.focus();
  }, []);

  // Gated wrappers: block the underlying handlers until consent is accepted.
  const handleSocialClick = (provider: string) => {
    if (!accepted) return;
    onSocialSignIn(provider);
  };

  const handleCheckUserGated = (values: { email: string }) => {
    if (!accepted) return Promise.resolve();
    return onCheckUser(values);
  };

  const consentLinkStyle = {
    color: 'inherit',
    cursor: 'pointer',
    textDecoration: 'underline',
  } as const;

  const consent = (
    <Flexbox gap={4} style={{ marginBottom: 12 }}>
      <Checkbox checked={accepted} onChange={(e) => setAccepted(e.target.checked)}>
        <Text fontSize={13} type={'secondary'}>
          <Trans
            i18nKey={'betterAuth.signin.consent'}
            ns={'auth'}
            components={{
              consent: (
                <a
                  href={CONSENT_URL}
                  rel="noopener noreferrer"
                  style={consentLinkStyle}
                  target="_blank"
                />
              ),
              privacy: (
                <a
                  href={PRIVACY_URL}
                  rel="noopener noreferrer"
                  style={consentLinkStyle}
                  target="_blank"
                />
              ),
              terms: (
                <a
                  href={TERMS_URL}
                  rel="noopener noreferrer"
                  style={consentLinkStyle}
                  target="_blank"
                />
              ),
            }}
          />
        </Text>
      </Checkbox>
    </Flexbox>
  );

  const divider = (
    <Divider>
      <Text fontSize={12} type={'secondary'}>
        {t('betterAuth.signin.orContinueWith')}
      </Text>
    </Divider>
  );

  const getProviderLabel = (provider: string) => {
    const normalized = provider
      .toLowerCase()
      .replaceAll(/(^|[_-])([a-z])/g, (_, __, c) => c.toUpperCase());
    const normalizedKey = normalized.replaceAll(/[^\da-z]/gi, '');
    const key = `betterAuth.signin.continueWith${normalizedKey}`;
    return t(key, { defaultValue: `Continue with ${normalized}` });
  };

  const footer = (
    <Text fontSize={13} type={'secondary'}>
      <Trans
        i18nKey={'footer.agreement'}
        ns={'auth'}
        components={{
          privacy: (
            <a
              href={PRIVACY_URL}
              style={{ color: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}
            >
              {t('footer.terms')}
            </a>
          ),
          terms: (
            <a
              href={TERMS_URL}
              style={{ color: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}
            >
              {t('footer.privacy')}
            </a>
          ),
        }}
      />
    </Text>
  );

  return (
    <AuthCard
      footer={footer}
      subtitle={t('signin.subtitle', { appName: BRANDING_NAME })}
      title={t('signin.title')}
    >
      {consent}
      {!serverConfigInit && (
        <Flexbox gap={12}>
          <Skeleton.Button active block size="large" />
          <Skeleton.Button active block size="large" />
          {divider}
        </Flexbox>
      )}
      {serverConfigInit && oAuthSSOProviders.length > 0 && (
        <Flexbox gap={12}>
          {oAuthSSOProviders.map((provider) => (
            <Button
              block
              disabled={!accepted}
              key={provider}
              loading={socialLoading === provider}
              size="large"
              icon={
                <Icon
                  icon={AuthIcons(provider, 18)}
                  style={{
                    left: 12,
                    position: 'absolute',
                    top: 13,
                  }}
                />
              }
              onClick={() => handleSocialClick(provider)}
            >
              {getProviderLabel(provider)}
            </Button>
          ))}
          {!disableEmailPassword && divider}
        </Flexbox>
      )}
      {serverConfigInit && disableEmailPassword && oAuthSSOProviders.length === 0 && (
        <Alert showIcon description={t('betterAuth.signin.ssoOnlyNoProviders')} type="warning" />
      )}
      {!disableEmailPassword && (
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => handleCheckUserGated(values as { email: string })}
        >
          <Form.Item
            name="email"
            style={{ marginBottom: 0 }}
            rules={[
              { message: t('betterAuth.errors.emailRequired'), required: true },
              {
                validator: (_, value) => {
                  if (!value) return Promise.resolve();
                  const trimmedValue = (value as string).trim();
                  if (EMAIL_REGEX.test(trimmedValue) || USERNAME_REGEX.test(trimmedValue)) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error(t('betterAuth.errors.emailInvalid')));
                },
              },
            ]}
          >
            <Input
              placeholder={t('betterAuth.signin.emailPlaceholder')}
              ref={emailInputRef}
              size="large"
              prefix={
                <Icon
                  icon={Mail}
                  style={{
                    marginInline: 6,
                  }}
                />
              }
              style={{
                padding: 6,
              }}
              suffix={
                <Button
                  disabled={!accepted}
                  icon={ChevronRight}
                  loading={loading}
                  variant={'filled'}
                  title={
                    accepted
                      ? t('betterAuth.signin.nextStep')
                      : t('betterAuth.signin.consentRequired')
                  }
                  onClick={() => form.submit()}
                />
              }
            />
          </Form.Item>
        </Form>
      )}
      {isSocialOnly && (
        <Alert
          showIcon
          style={{ marginTop: 12 }}
          type="info"
          description={
            <>
              {t('betterAuth.signin.socialOnlyHint')}{' '}
              <a className={styles.setPasswordLink} onClick={onSetPassword}>
                {t('betterAuth.signin.setPassword')}
              </a>
            </>
          }
        />
      )}
    </AuthCard>
  );
};
