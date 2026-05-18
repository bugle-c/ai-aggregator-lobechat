'use client';

import { Alert, Button, Form, Input } from 'antd';
import Link from 'next/link';
import { useState } from 'react';

import { signIn } from '@/libs/better-auth/auth-client';

interface FormValues {
  email: string;
  password: string;
}

export default function EmailSignIn() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFinish(values: FormValues) {
    setError(null);
    setLoading(true);
    try {
      const res = await signIn.email({
        email: values.email.trim().toLowerCase(),
        password: values.password,
      });
      if ((res as any).error) {
        throw new Error((res as any).error.message || 'Не удалось войти');
      }
      // Session cookie set — reload triggers root layout to drop the overlay.
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось войти');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Form autoComplete="on" layout="vertical" onFinish={onFinish}>
      <Form.Item
        name="email"
        rules={[
          { required: true, message: 'Введите email' },
          { type: 'email', message: 'Некорректный email' },
        ]}
      >
        <Input autoComplete="email" placeholder="Email" size="large" />
      </Form.Item>
      <Form.Item
        name="password"
        rules={[{ required: true, min: 6, message: 'Минимум 6 символов' }]}
      >
        <Input.Password autoComplete="current-password" placeholder="Пароль" size="large" />
      </Form.Item>
      {error && <Alert showIcon message={error} style={{ marginBottom: 12 }} type="error" />}
      <Button block htmlType="submit" loading={loading} size="large" type="primary">
        Войти
      </Button>
      <div style={{ marginTop: 10, textAlign: 'center' }}>
        <Link href="/reset-password" style={{ fontSize: 12, color: '#888' }}>
          Забыли пароль?
        </Link>
      </div>
    </Form>
  );
}
