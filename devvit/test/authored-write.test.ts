import {describe,expect,test} from 'vitest';
import {executeAuthoredWrite,parseAuthoredRequest,verifyAuthoredIdentity,
  type AuthoredApi} from '../src/server/authoredWrite.ts';
import type {MutationDeduplication} from '../src/server/modmailMutation.ts';

const base={subreddit:'catgirlcoin',operationId:'canonical-123456',expectedAuthor:'Mae'} as const;
const claimStore=():MutationDeduplication=>{
  const state=new Map<string,{fingerprint:string,status:'pending'|'applied'}>();
  return {
    claim:async(id,fingerprint)=>{
      const current=state.get(id);
      if(current===undefined){
        state.set(id,{fingerprint,status:'pending'});
        return 'acquired';
      }
      if(current.fingerprint!==fingerprint)return 'conflict';
      return current.status;
    },
    complete:async(id,fingerprint)=>{state.set(id,{fingerprint,status:'applied'});},
  };
};
const fakeApi=(called:string[]):AuthoredApi=>({
  getAppUsername:async()=>'Mae',
  submitSelf:async({subredditName,title,runAs})=>{
    called.push('post:'+title+':'+runAs);
    return{id:'t3_abc',subredditName,authorName:'Mae'};
  },
  sendPrivateMessage:async({to,subject})=>{called.push('message:'+to+':'+subject);},
});
describe('canonical actor-gated Devvit publishing and messaging',()=>{
  test('accepts only exact self-post and private-message request shapes',()=>{
    expect(parseAuthoredRequest({...base,action:'self-post',title:'News',body:'Content',flairTemplateId:null}).action)
      .toBe('self-post');
    expect(parseAuthoredRequest({...base,action:'private-message',recipient:'Alice',
      subject:'Hello',body:'Message'}).action).toBe('private-message');
    expect(()=>parseAuthoredRequest({...base,action:'crosspost',title:'News'})).toThrow();
    expect(()=>parseAuthoredRequest({...base,action:'private-message',recipient:'Alice',
      subject:'Hello',body:'Message',runAs:'USER'})).toThrow();
  });
  test('fails closed before claiming or writing when the app actor is wrong',async()=>{
    const called:string[]=[];
    const api:AuthoredApi={...fakeApi(called),getAppUsername:async()=>'this-is-the-mae'};
    const request=parseAuthoredRequest({...base,action:'private-message',recipient:'Alice',
      subject:'Hello',body:'Message'});
    await expect(executeAuthoredWrite(request,'catgirlcoin',api,claimStore()))
      .rejects.toThrow('cannot impersonate');
    expect(called).toEqual([]);
    expect(()=>verifyAuthoredIdentity(null,'Mae')).toThrow();
  });
  test('also refuses cross-community installation mismatch',async()=>{
    const called:string[]=[];
    const request=parseAuthoredRequest({...base,action:'self-post',title:'News',
      body:'Content',flairTemplateId:null});
    await expect(executeAuthoredWrite(request,'nyaonearth',fakeApi(called),claimStore()))
      .rejects.toThrow('installation mismatch');
    expect(called).toEqual([]);
  });
  test('submits a self post once and never invents its ID on a repeated call',async()=>{
    const called:string[]=[];
    const api=fakeApi(called), claims=claimStore();
    const request=parseAuthoredRequest({...base,action:'self-post',title:'News',
      body:'Content',flairTemplateId:null});
    expect((await executeAuthoredWrite(request,'catgirlcoin',api,claims)).postId).toBe('t3_abc');
    await expect(executeAuthoredWrite(request,'catgirlcoin',api,claims))
      .rejects.toThrow('reconciliation');
    expect(called).toEqual(['post:News:APP']);
  });
  test('messages get idempotent acknowledgements with no second send',async()=>{
    const called:string[]=[];
    const api=fakeApi(called),claims=claimStore();
    const request=parseAuthoredRequest({...base,action:'private-message',recipient:'Alice',
      subject:'Hello',body:'Message'});
    expect((await executeAuthoredWrite(request,'catgirlcoin',api,claims)).status).toBe('applied');
    expect((await executeAuthoredWrite(request,'catgirlcoin',api,claims)).status).toBe('already-applied');
    expect(called).toEqual(['message:Alice:Hello']);
  });
  test('rejects second send after an uncertain provider outcome',async()=>{
    const called:string[]=[];
    const api=fakeApi(called),claims=claimStore();
    const request=parseAuthoredRequest({...base,action:'private-message',recipient:'Alice',
      subject:'Hello',body:'Message'});
    const failing:AuthoredApi={...api,sendPrivateMessage:async()=>{
      called.push('ambiguous');
      throw new Error('provider did not acknowledge');
    }};
    await expect(executeAuthoredWrite(request,'catgirlcoin',failing,claims)).rejects.toThrow('provider');
    await expect(executeAuthoredWrite(request,'catgirlcoin',api,claims)).rejects.toThrow('reconciliation');
    expect(called).toEqual(['ambiguous']);
  });
  test('rejects a returned post under the wrong author without claiming success',async()=>{
    const api:AuthoredApi={...fakeApi([]),submitSelf:async()=>({
      id:'t3_abc',subredditName:'catgirlcoin',authorName:'NotMae',
    })};
    const request=parseAuthoredRequest({...base,action:'self-post',
      title:'News',body:'Content',flairTemplateId:null});
    await expect(executeAuthoredWrite(request,'catgirlcoin',api,claimStore()))
      .rejects.toThrow('author did not match');
  });
});
