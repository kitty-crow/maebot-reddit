import {describe,expect,test} from 'bun:test';
import {DevvitExternalClient,type DevvitExternalFetch} from '../src/reddit/devvitExternal.ts';
import {parseDevvitAuthoredReceipt,type DevvitAuthoredRequest} from '../src/reddit/devvitAuthoredWrite.ts';

const config={
  baseUrl:'https://this-is-the-mae-abc123-external.devvit.net',
  managedToken:'devvit_at_test_secret_key',
};
const post:DevvitAuthoredRequest={
  subreddit:'catgirlcoin',operationId:'canonical-123456',expectedAuthor:'Mae',
  action:'self-post',title:'Update',body:'News',flairTemplateId:null,
};
const message:DevvitAuthoredRequest={
  subreddit:'catgirlcoin',operationId:'canonical-234567',expectedAuthor:'Mae',
  action:'private-message',recipient:'Alice',subject:'Hello',body:'Body',
};
const crosspost:DevvitAuthoredRequest={
  subreddit:'catgirlcoin',operationId:'canonical-456789',expectedAuthor:'Mae',
  action:'crosspost',title:'Mirror',sourcePostId:'t3_source',flairTemplateId:null,
};
const markRead:DevvitAuthoredRequest={
  subreddit:'catgirlcoin',operationId:'canonical-345678',expectedAuthor:'Mae',
  action:'mark-private-message-read',fullname:'t4_abc',
};
describe('actor-gated Devvit authored-write transport',()=>{
  test('uses managed authentication and preserves the complete self-post payload',async()=>{
    const fetcher:DevvitExternalFetch=async(url,init)=>{
      expect(url).toBe(config.baseUrl+'/external/mae/write/authored');
      expect(init.method).toBe('POST');
      expect(new Headers(init.headers).get('authorization')).toBe('bearer '+config.managedToken);
      expect(JSON.parse(String(init.body))).toEqual(post);
      return new Response(JSON.stringify({
        protocol:1,operationId:post.operationId,status:'applied',postId:'t3_abc123',postPermalink:'/r/catgirlcoin/comments/abc123/news/',
      }));
    };
    const client=new DevvitExternalClient(config,fetcher);
    expect(await client.mutateAuthored(post)).toEqual({
      protocol:1,operationId:post.operationId,status:'applied',postId:'t3_abc123',postPermalink:'/r/catgirlcoin/comments/abc123/news/',
    });
  });
  test('keeps crosspost source identity distinct from the returned native post ID',async()=>{
    const fetcher:DevvitExternalFetch=async(_url,init)=>{
      expect(JSON.parse(String(init.body))).toEqual(crosspost);
      return new Response(JSON.stringify({
        protocol:1,operationId:crosspost.operationId,status:'applied',postId:'t3_mirror',postPermalink:'/r/catgirlcoin/comments/mirror/news/',
      }));
    };
    expect(await new DevvitExternalClient(config,fetcher).mutateAuthored(crosspost))
      .toEqual({protocol:1,operationId:crosspost.operationId,status:'applied',postId:'t3_mirror',postPermalink:'/r/catgirlcoin/comments/mirror/news/'});
  });
  test('supports a distinct guarded private-message write',async()=>{
    const fetcher:DevvitExternalFetch=async(_url,init)=>{
      expect(JSON.parse(String(init.body))).toEqual(message);
      return new Response(JSON.stringify({
        protocol:1,operationId:message.operationId,status:'applied',
      }));
    };
    expect(await new DevvitExternalClient(config,fetcher).mutateAuthored(message))
      .toEqual({protocol:1,operationId:message.operationId,status:'applied'});
  });
  test('supports individually identified native message-read operations',async()=>{
    const fetcher:DevvitExternalFetch=async(_url,init)=>{
      expect(JSON.parse(String(init.body))).toEqual(markRead);
      return new Response(JSON.stringify({
        protocol:1,operationId:markRead.operationId,status:'applied',
      }));
    };
    expect(await new DevvitExternalClient(config,fetcher).mutateAuthored(markRead))
      .toEqual({protocol:1,operationId:markRead.operationId,status:'applied'});
  });
  test('rejects mismatched canonical operation IDs and invalid provider responses',()=>{
    expect(()=>parseDevvitAuthoredReceipt(JSON.stringify({
      protocol:1,operationId:'other-operation',status:'applied',postId:'t3_abc',
    }),post)).toThrow();
    expect(()=>parseDevvitAuthoredReceipt(JSON.stringify({
      protocol:1,operationId:post.operationId,status:'applied',postId:'t1_notpost',
    }),post)).toThrow();
    expect(()=>parseDevvitAuthoredReceipt(JSON.stringify({
      protocol:1,operationId:post.operationId,status:'applied',postId:'t3_abc',
    }),post)).toThrow();
    expect(()=>parseDevvitAuthoredReceipt(JSON.stringify({
      protocol:1,operationId:post.operationId,status:'applied',postId:'t3_abc',
      postPermalink:'/r/catgirlcoin/comments/not-the-same-id/post/',
    }),post)).toThrow();
    expect(()=>parseDevvitAuthoredReceipt(JSON.stringify({
      protocol:1,operationId:post.operationId,status:'already-applied',
    }),post)).toThrow('reconciliation');
    expect(()=>parseDevvitAuthoredReceipt(JSON.stringify({
      protocol:1,operationId:message.operationId,status:'applied',postId:'t3_abc',
    }),message)).toThrow();
  });
  test('fails closed before touching the network on invalid authors and actions',async()=>{
    let attempts=0;
    const fetcher:DevvitExternalFetch=async()=>{attempts+=1;throw new Error('unexpected');};
    const client=new DevvitExternalClient(config,fetcher);
    await expect(client.mutateAuthored({...message,expectedAuthor:'INVALID AUTHOR'}))
      .rejects.toThrow('Invalid canonical author');
    await expect(client.mutateAuthored({...post,operationId:'bad'}))
      .rejects.toThrow('Invalid canonical author');
    expect(attempts).toBe(0);
  });
  test('never automatically resends a private message following an HTTP failure',async()=>{
    let attempts=0;
    const fetcher:DevvitExternalFetch=async()=>{
      attempts+=1;
      return new Response('private provider diagnostics',{status:409});
    };
    await expect(new DevvitExternalClient(config,fetcher).mutateAuthored(message))
      .rejects.toThrow('reconcile before retry');
    expect(attempts).toBe(1);
  });
  test('treats lost acknowledgements as ambiguous without another send',async()=>{
    let attempts=0;
    const fetcher:DevvitExternalFetch=async()=>{
      attempts+=1;
      throw new Error('private provider diagnostics');
    };
    await expect(new DevvitExternalClient(config,fetcher).mutateAuthored(post))
      .rejects.toThrow('outcome uncertain');
    expect(attempts).toBe(1);
  });
});
