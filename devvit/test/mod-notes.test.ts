import { describe, expect, test } from 'vitest';
import { parseModNoteRequest, projectModNote, executeModNoteWrite,
  type ModNoteApi } from '../src/server/modNotes.ts';
import type { MutationDeduplication } from '../src/server/modmailMutation.ts';

const base = {subreddit:'catgirlcoin',username:'Alice'} as const;
const op = 'canonical-123456';
const claims = (): MutationDeduplication => {
  const store=new Map<string,{fingerprint:string,status:'pending'|'applied'}>();
  return {
    claim: async (id,fingerprint) => {
      const current=store.get(id);
      if(current===undefined){
        store.set(id,{fingerprint,status:'pending'});
        return 'acquired';
      }
      if(current.fingerprint!==fingerprint)return 'conflict';
      return current.status;
    },
    complete: async (id,fingerprint)=>{
      store.set(id,{fingerprint,status:'applied'});
    },
  };
};
const api = (calls:string[]):ModNoteApi=>({
  addModNote: async values => {calls.push('add:'+values.note+':'+(values.label??'NONE'));return {id:'ModNote_abcdef'};},
  deleteModNote: async values => {calls.push('delete:'+values.noteId);return true;},
});

describe('native Devvit Mod Notes batch',()=>{
  test('allows Mae five native labels and omission of NONE',()=>{
    for(const label of ['NONE','HELPFUL_USER','SOLID_CONTRIBUTOR','SPAM_WATCH','SPAM_WARNING','ABUSE_WARNING']){
      expect(parseModNoteRequest({...base,kind:'add',operationId:op,note:'Good note',label,redditId:null}).kind).toBe('add');
    }
  });
  test('rejects invalid community, username, note length, labels and unsupported Reddit IDs',()=>{
    expect(()=>parseModNoteRequest({...base,subreddit:'other',kind:'list',limit:25})).toThrow();
    expect(()=>parseModNoteRequest({...base,kind:'add',operationId:op,note:' ',label:'NONE',redditId:null})).toThrow();
    expect(()=>parseModNoteRequest({...base,kind:'add',operationId:op,note:'A',label:'BOT_BAN',redditId:null})).toThrow();
    expect(()=>parseModNoteRequest({...base,kind:'add',operationId:op,note:'A',label:'NONE',redditId:'t4_abc'})).toThrow();
    expect(()=>parseModNoteRequest({...base,kind:'delete',operationId:op,noteId:'invalid'})).toThrow();
  });
  test('preserves note identity, source community and timestamps',()=>{
    expect(projectModNote({
      id:'ModNote_abcdef',type:'NOTE',user:{name:'Alice'},subreddit:{name:'catgirlcoin'},
      createdAt:new Date(0),userNote:{note:'Useful',label:'HELPFUL_USER'},
    },'catgirlcoin','Alice')).toEqual({
      id:'ModNote_abcdef',username:'Alice',note:'Useful',label:'HELPFUL_USER',createdUtc:0,
    });
    expect(()=>projectModNote({
      id:'ModNote_abcdef',type:'NOTE',user:{name:'Alice'},subreddit:{name:'nyaonearth'},
      createdAt:new Date(0),
    },'catgirlcoin','Alice')).toThrow();
  });
  test('never duplicates a new note and does not return a fake note ID',async()=>{
    const calls:string[]=[];
    const store=claims(),backend=api(calls);
    const request=parseModNoteRequest({...base,kind:'add',operationId:op,note:'Useful',label:'NONE',redditId:null});
    if(request.kind!=='add')throw new Error('Invalid test request');
    const result=await executeModNoteWrite(request,backend,store,'catgirlcoin');
    expect(result.noteId).toBe('ModNote_abcdef');
    await expect(executeModNoteWrite(request,backend,store,'catgirlcoin')).rejects.toThrow('reconciliation');
    expect(calls).toEqual(['add:Useful:NONE']);
  });
  test('a failed deletion never returns a successful receipt',async()=>{
    const req=parseModNoteRequest({...base,kind:'delete',operationId:op,noteId:'ModNote_abcdef'});
    if(req.kind!=='delete')throw new Error('Invalid test request');
    await expect(executeModNoteWrite(req,{...api([]),deleteModNote:async()=>false},claims(),'catgirlcoin'))
      .rejects.toThrow('did not confirm');
  });
});
