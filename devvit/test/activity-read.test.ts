import { describe, expect, test } from 'vitest';
import { parseActivityRequest, projectRecentComments, type ActivityRequest, type ActivityCommentSource } from '../src/server/activityRead.ts';

const request = {
  installation:'catgirlcoin',username:'Alice',communities:['catgirlcoin','nyaonearth'],limit:2,maxScanned:10,
} satisfies ActivityRequest;
const comment: ActivityCommentSource = {
  id:'t1_abc',postId:'t3_post',parentId:'t3_post',subredditName:'catgirlcoin',
  authorName:'Alice',body:'Useful observation',permalink:'/r/catgirlcoin/comments/post/example/abc/',
  createdAt:new Date('2026-11-08T08:00:00Z'),distinguishedBy:undefined,stickied:false,score:3,
};

describe('bounded Devvit member comment activity',()=>{
  test('preserves canonical essentials without inventing unavailable link context',()=>{
    const rows=projectRecentComments([comment],request);
    expect(rows).toEqual([{
      id:'abc',fullname:'t1_abc',subreddit:'catgirlcoin',
      submissionFullname:'t3_post',parentFullname:'t3_post',
      submissionTitle:null,submissionAuthor:null,submissionPermalink:null,submissionFlairText:null,
      author:'Alice',body:'Useful observation',permalink:comment.permalink,
      createdUtc:1794124800,distinguished:null,stickied:false,removedByCategory:null,
      score:3,mediaUrls:[],
    }]);
  });
  test('filters comments only to the two Mae communities and respects limit',()=>{
    const raw=[{...comment,id:'t1_ignore',subredditName:'other'},
      comment,{...comment,id:'t1_second',subredditName:'nyaonearth'},
      {...comment,id:'t1_third'}];
    expect(projectRecentComments(raw,request).map(x=>x.fullname)).toEqual(['t1_abc','t1_second']);
  });
  test('rejects unsupported installations, users and unbounded scans',()=>{
    expect(parseActivityRequest(request)).toEqual(request);
    expect(()=>parseActivityRequest({...request,installation:'other'})).toThrow();
    expect(()=>parseActivityRequest({...request,communities:['other']})).toThrow();
    expect(()=>parseActivityRequest({...request,communities:['catgirlcoin','catgirlcoin']})).toThrow();
    expect(()=>parseActivityRequest({...request,maxScanned:1001})).toThrow();
  });
  test('refuses malformed native comment IDs and duplicate rows',()=>{
    expect(()=>projectRecentComments([{...comment,id:'abc'}],request)).toThrow();
    expect(()=>projectRecentComments([comment,comment],request)).toThrow();
  });
});
