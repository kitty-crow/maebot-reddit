import { describe, expect, test } from 'bun:test';
import { DevvitExternalClient, type DevvitExternalFetch } from '../src/reddit/devvitExternal.ts';

const config = {
  baseUrl: 'https://this-is-the-mae-abc123-external.devvit.net',
  managedToken: 'devvit_at_test_secret_key',
};

const success = (): Response => new Response(JSON.stringify({
  ok: true, protocol: 1, app: 'this-is-the-mae', redditUser: 'this_is_the_mae',
}));

describe('Devvit managed external transport', () => {
  test('calls the installation using an authorisation header, not a query token', async () => {
    const fetcher: DevvitExternalFetch = async (url, init) => {
      expect(url).toBe(config.baseUrl + '/external/mae/health');
      expect(init.method).toBe('POST');
      expect(new Headers(init.headers).get('authorization')).toBe('bearer ' + config.managedToken);
      expect(url).not.toContain(config.managedToken);
      return success();
    };
    const client = new DevvitExternalClient(config, fetcher);
    expect((await client.probe()).redditUser).toBe('this_is_the_mae');
  });

  test('refuses any non-Devvit origin or a URL containing credentials or paths', () => {
    for (const baseUrl of ['http://example.com', 'https://example.com',
      config.baseUrl + '/external', 'https://user:pass@this-is-the-mae-abc123-external.devvit.net']) {
      expect(() => new DevvitExternalClient({ ...config, baseUrl })).toThrow();
    }
  });

  test('does not expose tokens or response bodies on failures', async () => {
    const fetcher: DevvitExternalFetch = async () => new Response('sensitive diagnostic', { status: 403 });
    const client = new DevvitExternalClient(config, fetcher);
    try {
      await client.probe();
      throw new Error('expected rejection');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      expect(message).toContain('403');
      expect(message).not.toContain(config.managedToken);
      expect(message).not.toContain('sensitive diagnostic');
    }
  });

  test('rejects an unrecognised or malformed protocol response', async () => {
    const fetcher: DevvitExternalFetch = async () => new Response(JSON.stringify({
      ok: true, protocol: 2, app: 'this-is-the-mae', redditUser: 'this_is_the_mae',
    }));
    expect(new DevvitExternalClient(config, fetcher).probe()).rejects.toThrow('protocol');
  });
});
