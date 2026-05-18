'use client';

import { Card, Divider, Typography } from 'antd';
import { memo, useState } from 'react';

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

      <div
        style={{
          marginTop: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <YandexButton mode={tab} />
        <TelegramButton mode={tab} />
      </div>

      <Divider plain style={{ marginBlock: 18, fontSize: 12, color: '#999' }}>
        или по email
      </Divider>

      {tab === 'signup' ? <EmailSignUp /> : <EmailSignIn />}

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
