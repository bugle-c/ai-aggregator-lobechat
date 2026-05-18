'use client';

import { Alert, Button, Form, Input } from 'antd';
import { useState } from 'react';

import { signUp } from '@/libs/better-auth/auth-client';

interface FormValues {
  email: string;
  name: string;
  password: string;
}

export default function EmailSignUp() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFinish(values: FormValues) {
    setError(null);
    setLoading(true);
    try {
      const res = await signUp.email({
        email: values.email.trim().toLowerCase(),
        password: values.password,
        name: values.name.trim(),
      });
      if ((res as any).error) {
        throw new Error((res as any).error.message || 'Не удалось зарегистрироваться');
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось зарегистрироваться');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Form autoComplete="on" layout="vertical" onFinish={onFinish}>
      <Form.Item name="name" rules={[{ required: true, min: 2, message: 'Введите имя' }]}>
        <Input autoComplete="name" placeholder="Имя" size="large" />
      </Form.Item>
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
        <Input.Password
          autoComplete="new-password"
          placeholder="Пароль (минимум 6 символов)"
          size="large"
        />
      </Form.Item>
      {error && <Alert showIcon message={error} style={{ marginBottom: 12 }} type="error" />}
      <Button block htmlType="submit" loading={loading} size="large" type="primary">
        Создать аккаунт
      </Button>
    </Form>
  );
}
