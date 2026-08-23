import { afterEach, expect, test } from 'bun:test';
import { internalApiConfig, modmailTerminalConfig } from '../src/env.ts';

const names = [
  'REDDIT_INTERNAL_API_HOST',
  'REDDIT_INTERNAL_API_PORT',
  'REDDIT_INTERNAL_API_TOKEN',
  'REDDIT_MODMAIL_WEBAPP_HOST',
  'REDDIT_MODMAIL_WEBAPP_PORT',
  'REDDIT_MODMAIL_WEBAPP_BASE',
] as const;

const original = new Map<string, string | undefined>(names.map(name => [name, process.env[name]]));

afterEach(() => {
  for (const name of names) {
    const value = original.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test('Reddit internal APIs stay loopback-only and focused Modmail defaults to 127.0.0.1:8892', () => {
  delete process.env['REDDIT_MODMAIL_WEBAPP_HOST'];
  delete process.env['REDDIT_MODMAIL_WEBAPP_PORT'];
  delete process.env['REDDIT_MODMAIL_WEBAPP_BASE'];
  expect(modmailTerminalConfig()).toMatchObject({
    host: '127.0.0.1',
    port: 8892,
    publicBase: null,
  });

  process.env['REDDIT_MODMAIL_WEBAPP_HOST'] = '0.0.0.0';
  expect(() => modmailTerminalConfig()).toThrow('must be a loopback host');

  process.env['REDDIT_INTERNAL_API_TOKEN'] = 'synthetic-token';
  process.env['REDDIT_INTERNAL_API_PORT'] = '8891';
  process.env['REDDIT_INTERNAL_API_HOST'] = '0.0.0.0';
  expect(() => internalApiConfig()).toThrow('must be a loopback host');

  process.env['REDDIT_INTERNAL_API_HOST'] = '127.0.0.1';
  expect(internalApiConfig()).toEqual({
    host: '127.0.0.1',
    port: 8891,
    token: 'synthetic-token',
  });
});
