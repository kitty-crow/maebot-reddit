import { describe, expect, test } from 'bun:test';
import { DevvitExternalClient, type DevvitExternalFetch } from '../src/reddit/devvitExternal.ts';
import { parseDevvitRecentComments, type DevvitActivityRequest } from '../src/reddit/devvitActivityRead.ts';

const request: DevvitActivityRequest = {
  installation:'catgirlcoin',username:'Alice',communities:['catgirlcoin','nyaonearth'],
  limit:10,maxScanned:1000,
};
const comment = {
  id:'abc',fullname:'t1_abc',subreddit:'catgirlcoin',
  submissionFullname:'t3_post',parentFullname:'t3_post',
  submissionTitle:null,submissionAuthor:null,submissionPermalink:null,submissionFlairText:null,
  author:'Alice',body:'Useful observation',permalink:'/r/catgirlcoin/comments/post/example/abc/',
  createdUtc:1794124800,distinguished:null,stickied:false,removedByCategory:null,
  score:3,mediaUrls:[],
};
const wire = (comments: readonly object[], installation = 'catgirlcoin'):string =>
  JSON.stringify({protocol:1,installation,username:'Alice',comments});

describe('Devvit member history preview transport',()=>{
  test('projects the available comment fields with missing fields explicitly null',()=>{
    expect(parseDevvitRecentComments(wire([comment]),request)).toEqual([comment]);
  });
  test('rejects wrong installation, community, and comment identity',()=>{
    expect(()=>parseDevvitRecentComments(wire([comment],'nyaonearth'),request)).toThrow();
    expect(()=>parseDevvitRecentComments(wire([{...comment,subreddit:'other'}]),request)).toThrow();
    expect(()=>parseDevvitRecentComments(wire([{...comment,fullname:'t1_wrong'}]),request)).toThrow();
    expect(()=>parseDevvitRecentComments(wire([{...comment,submissionTitle:'fabricated'}]),request)).toThrow();
  });
  test('rejects duplicates and result sets bigger than the canonical limit',()=>{
    expect(()=>parseDevvitRecentComments(wire([comment,comment]),request)).toThrow();
    expect(()=>parseDevvitRecentComments(wire([comment]),{...request,limit:0})).toThrow();
  });
  test('reads through managed installation token with no live state mutation',async()=>{
    const fetcher:DevvitExternalFetch=async (url,init)=>{
      expect(url).toBe('https://this-is-the-mae-abc123-external.devvit.net/external/mae/read/activity');
      expect(new Headers(init.headers).get('authorization')).toBe('bearer devvit_at_test_secret_key');
      expect(JSON.parse(String(init.body))).toEqual(request);
      return new Response(wire([comment]));
    };
    const client=new DevvitExternalClient({
      baseUrl:'https://this-is-the-mae-abc123-external.devvit.net',
      managedToken:'devvit_at_test_secret_key',
    },fetcher);
    expect(await client.readRecentUserComments(request)).toEqual([comment]);
  });
  test('rejects requests outside Mae communities before network access',async()=>{
    const client=new DevvitExternalClient({
      baseUrl:'https://this-is-the-mae-abc123-external.devvit.net',
      managedToken:'devvit_at_test_secret_key',
    },async()=>{throw new Error('Should not perform fetch');});
    await expect(client.readRecentUserComments({
      ...request,communities:['catgirlcoin','catgirlcoin'],
    })).rejects.toThrow('Invalid Devvit activity communities');
  });
});
