import { describe, expect, test } from 'bun:test';
import { DevvitExternalClient, type DevvitExternalFetch } from '../src/reddit/devvitExternal.ts';
import { parseDevvitNoteListing, parseDevvitNoteReceipt, type DevvitModNoteRequest } from '../src/reddit/devvitModNotes.ts';

const subreddit='catgirlcoin';
const username='Alice';
const operationId='canonical-123456';
const note={id:'ModNote_abcd',username,note:'Helpful',label:'HELPFUL_USER',createdUtc:1794121200};
const config={baseUrl:'https://this-is-the-mae-abc123-external.devvit.net',
  managedToken:'devvit_at_test_secret_key'};

describe('Devvit native Mod Notes transport',()=>{
  test('validates Reddit note identities and the selected subreddit',()=>{
    const body=JSON.stringify({protocol:1,subreddit,kind:'list',username,notes:[note]});
    expect(parseDevvitNoteListing(body,subreddit,username,100)).toEqual([note]);
    expect(()=>parseDevvitNoteListing(body,'nyaonearth',username,100)).toThrow();
    expect(()=>parseDevvitNoteListing(body,subreddit,'Bob',100)).toThrow();
  });
  test('requires the exact created Mod Note ID in successful write receipts',()=>{
    const request: DevvitModNoteRequest = {
      subreddit,username,operationId,kind:'add',
      note:'Helpful',label:'HELPFUL_USER',redditId:null,
    };
    expect(parseDevvitNoteReceipt(JSON.stringify({
      protocol:1,operationId,status:'applied',noteId:'ModNote_abcd',
    }),request)).toEqual({protocol:1,operationId,status:'applied',noteId:'ModNote_abcd'});
    expect(()=>parseDevvitNoteReceipt(JSON.stringify({
      protocol:1,operationId,status:'already-applied',
    }),request)).toThrow();
  });
  test('uses managed authentication for reads and canonical-ID writes',async()=>{
    const seen:string[]=[];
    const fetcher:DevvitExternalFetch=async (url,init)=>{
      expect(new Headers(init.headers).get('authorization')).toBe('bearer '+config.managedToken);
      const body=JSON.parse(String(init.body)) as {readonly kind:string;readonly operationId?:string};
      seen.push(body.kind);
      return new Response(url.endsWith('read/modnotes')
        ? JSON.stringify({protocol:1,subreddit,kind:'list',username,notes:[note]})
        : JSON.stringify({protocol:1,operationId:body.operationId,status:'applied'}));
    };
    const client=new DevvitExternalClient(config,fetcher);
    expect(await client.readModNotes(subreddit,username)).toEqual([note]);
    expect(await client.mutateModNote({
      subreddit,username,operationId,kind:'delete',noteId:note.id,
    })).toEqual({protocol:1,operationId,status:'applied'});
    expect(seen).toEqual(['list','delete']);
  });
  test('does not retry a native note deletion on failed HTTP',async()=>{
    let calls=0;
    const fetcher:DevvitExternalFetch=async()=>{calls+=1;return new Response('private',{status:409});};
    const client=new DevvitExternalClient(config,fetcher);
    await expect(client.mutateModNote({
      subreddit,username,operationId,kind:'delete',noteId:note.id,
    })).rejects.toThrow('reconcile before retry');
    expect(calls).toBe(1);
  });
});
