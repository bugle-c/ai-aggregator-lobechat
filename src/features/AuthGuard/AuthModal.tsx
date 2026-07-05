'use client';

import { Card, Checkbox, Divider, Typography } from 'antd';
import { memo, useState } from 'react';

import { CONSENT_URL, PRIVACY_URL, TERMS_URL } from '@/const/url';

import EmailSignIn from './EmailSignIn';
import EmailSignUp from './EmailSignUp';
import TelegramButton from './TelegramButton';
import YandexButton from './YandexButton';

const { Title, Text, Link: TextLink } = Typography;

interface Props {
  defaultTab: 'signin' | 'signup';
}

const AuthModal = memo<Props>(function AuthModal({ defaultTab }) {
  const [tab, setTab] = useState<'signin' | 'signup'>(defaultTab);
  // Legal consent is collected at the point of registration (152-ФЗ): the
  // signup tab requires the checkbox before any registration method works.
  // OAuth auto-creates accounts, so we gate the SSO buttons too, not just email.
  const [accepted, setAccepted] = useState(false);
  // Email is a fallback path: collapsed behind a link so the SSO buttons
  // (Telegram first — largest persona segment) stay the primary entry.
  const [showEmail, setShowEmail] = useState(false);
  const gate = tab === 'signup' && !accepted;

  return (
    <Card
      styles={{ body: { padding: 28 } }}
      style={{
        width: 420,
        maxWidth: '100%',
        borderRadius: 16,
        boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
      }}
    >
      <Title level={3} style={{ margin: 0 }}>
        {tab === 'signup' ? 'Создать аккаунт WebGPT' : 'Войти'}
      </Title>
      <Text style={{ display: 'block', marginTop: 6, color: '#666', fontSize: 13 }}>
        {tab === 'signup'
          ? 'Бесплатные кредиты, доступ к GPT/Claude/Gemini, без VPN'
          : 'С возвращением!'}
      </Text>

      {tab === 'signup' && (
        <Checkbox
          checked={accepted}
          style={{ alignItems: 'flex-start', marginTop: 18 }}
          onChange={(e) => setAccepted(e.target.checked)}
        >
          <span style={{ color: '#666', fontSize: 12, lineHeight: 1.5 }}>
            Я принимаю{' '}
            <a href={TERMS_URL} rel="noopener noreferrer" target="_blank">
              Оферту
            </a>
            ,{' '}
            <a href={PRIVACY_URL} rel="noopener noreferrer" target="_blank">
              Политику конфиденциальности
            </a>{' '}
            и даю{' '}
            <a href={CONSENT_URL} rel="noopener noreferrer" target="_blank">
              Согласие на обработку персональных данных
            </a>
          </span>
        </Checkbox>
      )}

      <div
        style={{
          marginTop: tab === 'signup' ? 14 : 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <TelegramButton disabled={gate} mode={tab} />
        <YandexButton disabled={gate} mode={tab} />
      </div>

      {showEmail ? (
        <>
          <Divider plain style={{ marginBlock: 18, fontSize: 12, color: '#999' }}>
            по email
          </Divider>
          {tab === 'signup' ? <EmailSignUp disabled={gate} /> : <EmailSignIn />}
        </>
      ) : (
        <div style={{ marginTop: 14, textAlign: 'center', fontSize: 13 }}>
          <TextLink onClick={() => setShowEmail(true)}>Войти по почте</TextLink>
        </div>
      )}

      <div style={{ marginTop: 16, textAlign: 'center', fontSize: 13 }}>
        {tab === 'signup' ? (
          <Text type="secondary">
            Уже есть аккаунт? <TextLink onClick={() => setTab('signin')}>Войти</TextLink>
          </Text>
        ) : (
          <Text type="secondary">
            Нет аккаунта? <TextLink onClick={() => setTab('signup')}>Зарегистрироваться</TextLink>
          </Text>
        )}
      </div>
    </Card>
  );
});

export default AuthModal;
