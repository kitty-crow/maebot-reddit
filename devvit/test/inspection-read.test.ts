import { describe, expect, test } from 'vitest';
import { parseInspectionRequest, projectSubreddit, projectPostScore } from '../src/server/inspectionRead.ts';

const sample = {
  id:'t5_abc', name:'catgirlcoin', title:'Catgirl Coin', numberOfSubscribers:120,
  userFlairsEnabled:true, usersCanAssignUserFlairs:true, postFlairsEnabled:true,
  nsfw:false, settings:{ allowedPostType:'any' as const },
};

describe('read-only Devvit inspection batch', () => {
  test('maps complete subreddit metadata and moderator identity', () => {
    expect(projectSubreddit(sample,'catgirlcoin',true)).toEqual({
      id:'t5_abc',name:'catgirlcoin',title:'Catgirl Coin',subscribers:120,
      userIsModerator:true,userFlairEnabled:true,userFlairSelfAssign:true,
      linkFlairEnabled:true,over18:false,submissionType:'any',
    });
  });
  test('does not fabricate missing title, community or subscriber count', () => {
    expect(() => projectSubreddit({...sample,title:undefined},'catgirlcoin',true)).toThrow();
    expect(() => projectSubreddit({...sample,numberOfSubscribers:-2},'catgirlcoin',true)).toThrow();
    expect(() => projectSubreddit(sample,'nyaonearth',true)).toThrow();
  });
  test('preserves post scores and archive state but rejects different community', () => {
    const post={id:'t3_abc123',subredditName:'catgirlcoin',score:12.9,archived:true};
    expect(projectPostScore(post,'catgirlcoin','t3_abc123'))
      .toEqual({fullname:'t3_abc123',score:12,archived:true});
    expect(() => projectPostScore(post,'nyaonearth','t3_abc123')).toThrow();
    expect(() => projectPostScore(post,'catgirlcoin','t3_different')).toThrow();
  });
  test('accepts bounded post-only scores and explicit subreddit requests', () => {
    expect(parseInspectionRequest({kind:'subreddit',subreddit:'catgirlcoin'}))
      .toEqual({kind:'subreddit',subreddit:'catgirlcoin'});
    expect(parseInspectionRequest({kind:'post-scores',subreddit:'nyaonearth',
      fullnames:['t3_abc','t3_def']})).toEqual({
        kind:'post-scores',subreddit:'nyaonearth',fullnames:['t3_abc','t3_def'],
      });
  });
  test('rejects comment scores, duplicates, extra keys and unrelated installations', () => {
    const base={kind:'post-scores',subreddit:'catgirlcoin'};
    expect(() => parseInspectionRequest({...base,fullnames:['t1_comment']})).toThrow();
    expect(() => parseInspectionRequest({...base,fullnames:['t3_abc','t3_abc']})).toThrow();
    expect(() => parseInspectionRequest({...base,fullnames:[]})).toThrow();
    expect(() => parseInspectionRequest({kind:'subreddit',subreddit:'other'})).toThrow();
    expect(() => parseInspectionRequest({kind:'subreddit',subreddit:'catgirlcoin',debug:true})).toThrow();
  });
});
