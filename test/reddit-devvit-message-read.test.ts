import { describe, expect, test } from 'bun:test';
import { DevvitExternalClient, type DevvitExternalFetch } from '../src/reddit/devvitExternal.ts';
import { parseDevvitMessages, type DevvitMessageRequest, type DevvitMessagePreview } from '../src/reddit/devvitMessageRead.ts';

const request:DevvitMessageRequest={installation:'catgirlcoin',folder:'unread',limit:25};
const message: DevvitMessagePreview = {
  fullname:'t4_abc123',fromType:'user',fromName:'Alice',
  body:'Hello Mae',createdUtc:1794124800,
};
const envelope=(messages:readonly object[],scope='app'):string=>
  JSON.stringify({protocol:1,installation:'catgirlcoin',folder:'unread',
    accountScope:scope,messages});

describe('read-only Devvit native message preview transport',()=>{
  test('retains only SDK-exposed fields without fabricated threading metadata',()=>{
    expect(parseDevvitMessages(envelope([message]),request)).toEqual([message]);
  });
  test('rejects another account scope and mismatched installation',()=>{
    expect(()=>parseDevvitMessages(envelope([message],'installation'),request)).toThrow();
    expect(()=>parseDevvitMessages(envelope([message]),{...request,installation:'nyaonearth'})).toThrow();
  });
  test('rejects duplicate, invalid, or excessive messages',()=>{
    expect(()=>parseDevvitMessages(envelope([message,message]),request)).toThrow();
    expect(()=>parseDevvitMessages(envelope([{...message,fullname:'t3_post'}]),request)).toThrow();
    expect(()=>parseDevvitMessages(envelope([message]),{...request,limit:0})).toThrow();
  });
  test('uses the managed token and an explicitly scoped read-only request',async()=>{
    const fetcher:DevvitExternalFetch=async (url,init)=>{
      expect(url).toBe('https://this-is-the-mae-abc123-external.devvit.net/external/mae/read/messages');
      expect(new Headers(init.headers).get('authorization')).toBe('bearer devvit_at_test_secret_key');
      expect(JSON.parse(String(init.body))).toEqual(request);
      return new Response(envelope([message]));
    };
    const client=new DevvitExternalClient({
      baseUrl:'https://this-is-the-mae-abc123-external.devvit.net',
      managedToken:'devvit_at_test_secret_key',
    },fetcher);
    expect(await client.readMessagePreviews(request)).toEqual([message]);
  });
  test('rejects invalid folders before network access',async()=>{
    const client=new DevvitExternalClient({
      baseUrl:'https://this-is-the-mae-abc123-external.devvit.net',
      managedToken:'devvit_at_test_secret_key',
    },async()=>{throw new Error('Must not fetch');});
    await expect(client.readMessagePreviews({...request,limit:0})).rejects.toThrow();
  });
});
