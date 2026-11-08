import { describe, expect, test } from 'vitest';
import { parseMessageReadRequest, projectMessagePreview, projectMessageFolder,
  type MessageSource } from '../src/server/directMessageRead.ts';

const sample:MessageSource = {
  id:'t4_abc123',from:{type:'user',username:'Alice'},
  body:'Hello Mae',created:new Date('2026-11-08T08:00:00Z'),
};
describe('read-only native Devvit private messages',()=>{
  test('accepts only Mae installation URLs and bounded folders',()=>{
    expect(parseMessageReadRequest({installation:'catgirlcoin',folder:'inbox',limit:25}))
      .toEqual({installation:'catgirlcoin',folder:'inbox',limit:25});
    expect(()=>parseMessageReadRequest({installation:'outside',folder:'inbox',limit:25})).toThrow();
    expect(()=>parseMessageReadRequest({installation:'catgirlcoin',folder:'all',limit:25})).toThrow();
    expect(()=>parseMessageReadRequest({installation:'catgirlcoin',folder:'inbox',limit:101})).toThrow();
  });
  test('preserves only fields that the SDK actually exposes',()=>{
    expect(projectMessagePreview(sample)).toEqual({
      fullname:'t4_abc123',fromType:'user',fromName:'Alice',
      body:'Hello Mae',createdUtc:1794124800,
    });
  });
  test('distinguishes subreddit senders and validates message identity',()=>{
    expect(projectMessagePreview({...sample,from:{type:'subreddit',name:'catgirlcoin'}}).fromType).toBe('subreddit');
    expect(()=>projectMessagePreview({...sample,id:'t3_wrong'})).toThrow();
  });
  test('rejects duplicate or oversized native listings',()=>{
    expect(()=>projectMessageFolder([sample,sample],2)).toThrow();
    expect(()=>projectMessageFolder([sample],0)).toThrow();
  });
});
