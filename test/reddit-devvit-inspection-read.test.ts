import { describe, expect, test } from 'bun:test';
import { DevvitExternalClient, type DevvitExternalFetch } from '../src/reddit/devvitExternal.ts';
import { parseDevvitPostScores, parseDevvitSubreddit } from '../src/reddit/devvitInspectionRead.ts';
import type { DevvitInspectionRequest } from '../src/reddit/devvitInspectionRead.ts';

const subreddit='catgirlcoin' as const;
const details={
  id:'t5_abc',name:subreddit,title:'Catgirl Coin',subscribers:120,
  userIsModerator:true,userFlairEnabled:true,userFlairSelfAssign:false,
  linkFlairEnabled:true,over18:false,submissionType:'any',
};
const request: Extract<DevvitInspectionRequest,{readonly kind:'post-scores'}>={
  subreddit,kind:'post-scores',fullnames:['t3_abc'],
};
const envelope=(kind:string,values:object):string=>
  JSON.stringify({protocol:1,subreddit,kind,...values});

describe('Devvit inspection read transport',()=>{
  test('decodes exact subreddit information with no fabricated fields',()=>{
    expect(parseDevvitSubreddit(envelope('subreddit',{data:details}),subreddit)).toEqual(details);
    expect(()=>parseDevvitSubreddit(envelope('subreddit',{
      data:{...details,name:'nyaonearth'},
    }),subreddit)).toThrow();
    expect(()=>parseDevvitSubreddit(envelope('subreddit',{
      data:{...details,subscribers:-1},
    }),subreddit)).toThrow();
  });
  test('parses exact post scores, preserving archive state',()=>{
    expect(parseDevvitPostScores(envelope('post-scores',{
      scores:[{fullname:'t3_abc',score:12,archived:true}],
    }),request)).toEqual([{fullname:'t3_abc',score:12,archived:true}]);
  });
  test('rejects missing entries, extra entries and mismatched post order',()=>{
    expect(()=>parseDevvitPostScores(envelope('post-scores',{scores:[]}),request)).toThrow();
    expect(()=>parseDevvitPostScores(envelope('post-scores',{scores:[
      {fullname:'t3_wrong',score:1,archived:false},
    ]}),request)).toThrow();
    expect(()=>parseDevvitPostScores(envelope('post-scores',{scores:[
      {fullname:'t3_abc',score:1,archived:false},
      {fullname:'t3_extra',score:1,archived:false},
    ]}),request)).toThrow();
  });
  test('authorises and verifies both native read operations',async()=>{
    const seen:string[]=[];
    const fetcher:DevvitExternalFetch=async (url,init)=>{
      expect(url).toBe('https://this-is-the-mae-abc123-external.devvit.net/external/mae/read/inspection');
      expect(new Headers(init.headers).get('authorization')).toBe('bearer devvit_at_test_secret_key');
      const body=JSON.parse(String(init.body)) as {readonly kind:'subreddit'|'post-scores'};
      seen.push(body.kind);
      return new Response(body.kind==='subreddit'
        ? envelope('subreddit',{data:details})
        : envelope('post-scores',{scores:[{fullname:'t3_abc',score:12,archived:true}]}));
    };
    const client=new DevvitExternalClient({
      baseUrl:'https://this-is-the-mae-abc123-external.devvit.net',
      managedToken:'devvit_at_test_secret_key',
    },fetcher);
    expect(await client.readSubreddit(subreddit)).toEqual(details);
    expect(await client.readPostScores(subreddit,['t3_abc'])).toEqual([
      {fullname:'t3_abc',score:12,archived:true},
    ]);
    expect(seen).toEqual(['subreddit','post-scores']);
  });
  test('rejects comments from the parity-sensitive post score endpoint',async()=>{
    const client=new DevvitExternalClient({
      baseUrl:'https://this-is-the-mae-abc123-external.devvit.net',
      managedToken:'devvit_at_test_secret_key',
    },async()=>{throw new Error('Must not perform network call');});
    await expect(client.readPostScores(subreddit,['t1_comment'])).rejects.toThrow();
  });
});
