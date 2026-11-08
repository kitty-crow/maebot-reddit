import { describe, expect, test } from 'vitest';
import { executeModerationMutation, parseModerationMutation, type ModerationApi,
  type ModerationMutation } from '../src/server/moderationMutation.ts';
import type { MutationDeduplication } from '../src/server/modmailMutation.ts';

const base = { subreddit:'catgirlcoin', operationId:'canonical-123456' } as const;
const makeStore = (): MutationDeduplication => {
  const items = new Map<string,{fingerprint:string;status:'pending'|'applied'}>();
  return {
    claim: async (id, fingerprint) => {
      const item = items.get(id);
      if (item === undefined) {
        items.set(id,{fingerprint,status:'pending'});
        return 'acquired';
      }
      if (item.fingerprint !== fingerprint) return 'conflict';
      return item.status;
    },
    complete: async (id,fingerprint) => {
      items.set(id,{fingerprint,status:'applied'});
    },
  };
};
const fakeApi = (calls: string[]): ModerationApi => ({
  isModerator: async username => username === 'Moderator',
  getThingCommunity: async id => id === 't3_other' ? 'nyaonearth' : 'catgirlcoin',
  banUser: async input => { calls.push('ban:'+input.username+':'+input.reason+':'+input.note); },
  unbanUser: async username => { calls.push('unban:'+username); },
  unmuteUser: async username => { calls.push('unmute:'+username); },
  remove: async fullname => { calls.push('remove:'+fullname); },
  setUserFlair: async input => { calls.push('flair-template:'+input.flairTemplateId); },
  setUserFlairDirect: async input => { calls.push('flair-direct:'+input.text); },
  setPostFlair: async input => { calls.push('post-flair:'+input.postId); },
  createFlairTemplate: async input => {
    calls.push('create:'+input.kind+':'+input.template.text);
    return 'created-uuid';
  },
});
const allOperations = (): readonly ModerationMutation[] => [
  parseModerationMutation({...base,action:'ban',username:'Alice',reason:'spam',note:'moderator evidence'}),
  parseModerationMutation({...base,action:'unban',username:'Alice'}),
  parseModerationMutation({...base,action:'unmute',username:'Alice'}),
  parseModerationMutation({...base,action:'remove',fullname:'t1_abc'}),
  parseModerationMutation({...base,action:'set-user-flair',username:'Alice',templateId:'12345678',customText:null}),
  parseModerationMutation({...base,action:'set-user-flair-direct',username:'Alice',flairText:'Trusted',cssClass:'trusted'}),
  parseModerationMutation({...base,action:'set-post-flair',postId:'t3_abc',templateId:'12345678',customText:null}),
  parseModerationMutation({...base,action:'create-flair-template',kind:'post',template:{
    text:'News',modOnly:true,textEditable:false,backgroundColour:'#123456',
    textColour:'light',allowableContent:'text',maxEmojis:1,
  }}),
];

describe('Devvit moderation and flair batch', () => {
  test('parses all eight canonical action shapes', () => {
    expect(allOperations().map(operation => operation.action)).toEqual([
      'ban','unban','unmute','remove','set-user-flair','set-user-flair-direct',
      'set-post-flair','create-flair-template',
    ]);
  });
  test('rejects unsupported actions, fields, communities and invalid targets', () => {
    expect(() => parseModerationMutation({...base, action:'mute',username:'Alice'})).toThrow();
    expect(() => parseModerationMutation({...base, action:'unban',username:'Alice',debug:true})).toThrow();
    expect(() => parseModerationMutation({...base, action:'unban',subreddit:'unrelated',username:'Alice'})).toThrow();
    expect(() => parseModerationMutation({...base, action:'remove',fullname:'t4_abc'})).toThrow();
    expect(() => parseModerationMutation({...base, action:'set-user-flair',
      username:'Alice',templateId:'12345678',customText:15})).toThrow();
    expect(() => parseModerationMutation({...base,action:'create-flair-template',kind:'post',template:{
      text:'News',modOnly:true,textEditable:false,backgroundColour:'invalid',
      textColour:null,allowableContent:null,maxEmojis:null,
    }})).toThrow();
  });
  test('blocks moderators and cross-community content before performing writes', async () => {
    const calls: string[] = [];
    const api=fakeApi(calls);
    await expect(executeModerationMutation(parseModerationMutation({
      ...base, action:'unban',username:'Moderator',
    }),api,makeStore())).rejects.toThrow('moderator');
    await expect(executeModerationMutation(parseModerationMutation({
      ...base,action:'remove',fullname:'t3_other',
    }),api,makeStore())).rejects.toThrow('outside installed community');
    expect(calls).toEqual([]);
  });
  test('executes every operation as a distinct canonical mutation', async () => {
    const calls: string[] = [];
    const api=fakeApi(calls);
    const actions=allOperations();
    for(const [index,item] of actions.entries()){
      const operation = { ...item,operationId:base.operationId+'-'+index };
      const receipt=await executeModerationMutation(operation,api,makeStore());
      expect(receipt.status).toBe('applied');
    }
    expect(calls).toEqual([
      'ban:Alice:spam:moderator evidence','unban:Alice','unmute:Alice',
      'remove:t1_abc','flair-template:12345678','flair-direct:Trusted',
      'post-flair:t3_abc','create:post:News',
    ]);
  });
  test('identical operation IDs execute once, and changed payloads conflict', async () => {
    const calls: string[] = [];
    const api=fakeApi(calls),claims=makeStore();
    const request=allOperations()[0];
    if(request===undefined) throw new Error('Missing operation fixture');
    expect((await executeModerationMutation(request,api,claims)).status).toBe('applied');
    expect((await executeModerationMutation(request,api,claims)).status).toBe('already-applied');
    const changed=parseModerationMutation({
      ...base,action:'ban',username:'Alice',reason:'different',note:'moderator evidence',
    });
    await expect(executeModerationMutation(changed,api,claims)).rejects.toThrow('reused');
    expect(calls).toEqual(['ban:Alice:spam:moderator evidence']);
  });
  test('never acknowledges a duplicate flair-template creation without the original ID', async () => {
    const calls:string[] = [];
    const api=fakeApi(calls), claims=makeStore();
    const request=parseModerationMutation({...base,action:'create-flair-template',kind:'user',template:{
      text:'Trusted',modOnly:true,textEditable:false,backgroundColour:null,
      textColour:'dark',allowableContent:'text',maxEmojis:1,
    }});
    expect((await executeModerationMutation(request,api,claims)).createdTemplateId).toBe('created-uuid');
    await expect(executeModerationMutation(request,api,claims)).rejects.toThrow('reconciliation');
    expect(calls).toEqual(['create:user:Trusted']);
  });
  test('uncertain writes stay pending and cannot be blindly replayed', async () => {
    const calls: string[] = [];
    const normal=fakeApi(calls), claims=makeStore();
    const failedApi: ModerationApi={...normal,remove:async () => {throw new Error('network lost');}};
    const request=parseModerationMutation({...base,action:'remove',fullname:'t3_abc'});
    await expect(executeModerationMutation(request,failedApi,claims)).rejects.toThrow('network lost');
    await expect(executeModerationMutation(request,normal,claims)).rejects.toThrow('reconcile');
    expect(calls).toEqual([]);
  });
});
