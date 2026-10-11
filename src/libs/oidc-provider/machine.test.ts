/** @vitest-environment node */
import { createServer } from 'node:http';

import type { LobeChatDatabase } from '@lobechat/database';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

import { defaultClients } from './config';
import { createNodeRequest, createNodeResponse } from './http-adapter';
import { createOIDCProvider } from './provider';

vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://ask.gptweb.ru' } }));
vi.mock('@/config/db', () => ({
  serverDBEnv: { KEY_VAULTS_SECRET: 'isolated-provider-cookie-key' },
}));
vi.mock('./jwt', async () => {
  // Vitest hoists this factory before static imports initialize.
  const { generateKeyPairSync } = await import('node:crypto');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    getJWKS: () => ({
      keys: [
        { ...privateKey.export({ format: 'jwk' }), kid: 'isolated', use: 'sig', alg: 'RS256' },
      ],
    }),
  };
});
vi.mock('./adapter', () => ({
  DrizzleAdapter: {
    createAdapterFactory: () =>
      class {
        async find() {
          return undefined;
        }
        async upsert() {
          throw new Error('Read-only provider smoke must not write');
        }
      },
  },
}));

describe('Machine provider registration', () => {
  it('registers only the fixed public authorization-code callback', async () => {
    expect(defaultClients.find((client) => client.client_id === 'machine')).toEqual({
      application_type: 'web',
      client_id: 'machine',
      client_name: 'Machine',
      grant_types: ['authorization_code'],
      response_types: ['code'],
      redirect_uris: ['https://machine.pashavin.ru/api/oidc/callback'],
      token_endpoint_auth_method: 'none',
    });
    expect(defaultClients.map((client) => client.client_id)).toEqual([
      'lobehub-desktop',
      'lobehub-mobile',
      'lobehub-market',
      'machine',
    ]);
  });

  it('serves discovery and JWKS through the actual provider router without database access', async () => {
    // No database operation is valid for these public metadata endpoints.
    const provider = await createOIDCProvider(
      new Proxy({} as LobeChatDatabase, {
        get() {
          throw new Error('Discovery must not access the database');
        },
      }),
    );
    const callback = provider.callback();
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString();
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
        else if (value !== undefined) headers.set(name, value);
      }
      const adapted = await createNodeRequest(
        new NextRequest(`http://${req.headers.host}${req.url}`, {
          method: req.method,
          headers,
          ...(body ? { body } : {}),
        }),
      );
      await new Promise<void>((resolve) => {
        const collector = createNodeResponse(() => {
          res.writeHead(collector.responseStatus, collector.responseHeaders);
          res.end(collector.responseBody);
          resolve();
        });
        callback(adapted, collector.nodeResponse);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address() as { port: number };
      const origin = `http://127.0.0.1:${address.port}`;
      const response = await fetch(`${origin}/oidc/.well-known/openid-configuration`);
      expect(response.status).toBe(200);
      const discovery = await response.json();
      expect(discovery.issuer).toBe('https://ask.gptweb.ru/oidc');
      expect(discovery.authorization_endpoint).toBe(`${origin}/oidc/auth`);
      expect(discovery.token_endpoint).toBe(`${origin}/oidc/token`);
      expect(discovery.jwks_uri).toBe(`${origin}/oidc/jwks`);
      expect(discovery.code_challenge_methods_supported).toEqual(['S256']);
      expect(discovery.registration_endpoint).toBeUndefined();
      const jwks = await fetch(discovery.jwks_uri);
      expect(jwks.status).toBe(200);
      expect((await jwks.json()).keys[0]).not.toHaveProperty('d');
      const invalid = await fetch(`${origin}/oidc/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: 'machine',
          code: 'invalid-code',
          redirect_uri: 'https://machine.pashavin.ru/api/oidc/callback',
          code_verifier: 'a'.repeat(43),
        }),
        redirect: 'manual',
      });
      expect(invalid.status).toBe(400);
      expect(invalid.headers.get('location')).toBeNull();
      expect(invalid.headers.get('content-type')).toContain('application/json');
      expect(invalid.headers.get('cache-control')).toContain('no-store');
      expect(await invalid.json()).toMatchObject({ error: 'invalid_grant' });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
