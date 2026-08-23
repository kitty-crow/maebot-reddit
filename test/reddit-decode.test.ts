import { describe, expect, test } from 'bun:test';
import { comments, flairAssignments, flairTemplates, moderators, posts, relationshipUsers, rules } from '../src/reddit/decode.ts';

describe('Reddit API decoders', () => {
  test('decodes wrapped moderator listings', () => {
    const page = moderators({
      kind: 'UserList',
      data: {
        after: null,
        children: [{ kind: 't2', data: { name: 'mod', id: 'abc', mod_permissions: ['all'] } }],
      },
    });
    expect(page.items).toEqual([{ name: 'mod', id: 'abc', permissions: ['all'] }]);
  });

  test('decodes live direct-child moderator listings', () => {
    const page = moderators({
      kind: 'UserList',
      data: {
        after: 'next',
        children: [
          { name: 'mod', id: 'abc', mod_permissions: ['posts', 'flair'] },
          { name: 'owner', id: null, mod_permissions: ['all'] },
        ],
      },
    });
    expect(page.items).toEqual([
      { name: 'mod', id: 'abc', permissions: ['posts', 'flair'] },
      { name: 'owner', id: null, permissions: ['all'] },
    ]);
    expect(page.after).toBe('next');
  });

  test('decodes wrapped relationship-user listings', () => {
    const page = relationshipUsers({
      kind: 'UserList',
      data: {
        after: null,
        children: [{ kind: 't2', data: { name: 'blocked-user', note: 'reason', date: 123 } }],
      },
    }, 'banned users');
    expect(page.items).toEqual([{ username: 'blocked-user', note: 'reason', date: 123 }]);
  });

  test('decodes live direct-child relationship-user listings even when data is null', () => {
    const page = relationshipUsers({
      kind: 'UserList',
      data: {
        after: 'next',
        children: [
          { name: 'blocked-user', note: null, date: 123, data: null },
          { name: 'other-user', note: 'manual ban', date: null },
        ],
      },
    }, 'banned users');
    expect(page.items).toEqual([
      { username: 'blocked-user', note: null, date: 123 },
      { username: 'other-user', note: 'manual ban', date: null },
    ]);
    expect(page.after).toBe('next');
  });

  test('decodes v2 flair templates with migration-relevant semantics', () => {
    const values = flairTemplates([{ id: 'f1', text: 'Catgirl', css_class: 'h', text_color: 'dark', background_color: '#ffffff', mod_only: false, text_editable: true, allowable_content: 'all', max_emojis: 10 }]);
    expect(values[0]?.id).toBe('f1');
    expect(values[0]?.cssClass).toBe('h');
    expect(values[0]?.textEditable).toBe(true);
  });

  test('decodes legacy flairlist response and cursor', () => {
    const page = flairAssignments({
      users: [{ user: 'alice', flair_text: 'Catgirl', flair_css_class: 'h', flair_template_id: 'f1' }],
      next: 't2_next',
    });
    expect(page.assignments[0]?.username).toBe('alice');
    expect(page.next).toBe('t2_next');
  });

  test('decodes subreddit rule payloads', () => {
    const value = rules({
      rules: [{ short_name: 'Be civil', description: 'Be kind', violation_reason: 'Incivility', kind: 'all', priority: 0 }],
      site_rules: ['Spam'],
    });
    expect(value.rules[0]?.shortName).toBe('Be civil');
    expect(value.siteRules).toEqual(['Spam']);
  });

  test('decodes post score and image metadata for reputation and visual moderation', () => {
    const page = posts({
      kind: 'Listing',
      data: {
        after: null,
        children: [{
          kind: 't3',
          data: {
            id: 'post1',
            name: 't3_post1',
            subreddit: 'catgirlcoin',
            title: 'Roadmap reaction',
            author: 'member',
            permalink: '/r/catgirlcoin/comments/post1/roadmap/',
            created_utc: 123,
            selftext: 'new road map too',
            url: 'https://i.redd.it/dead-end.gif',
            link_flair_template_id: null,
            link_flair_text: null,
            stickied: false,
            locked: false,
            over_18: false,
            crosspost_parent: null,
            score: 17,
            preview: {
              images: [{ source: { url: 'https://preview.redd.it/dead-end.jpg?x=1&amp;y=2' } }],
            },
          },
        }],
      },
    });
    expect(page.items[0]?.score).toBe(17);
    expect(page.items[0]?.mediaUrls).toContain('https://i.redd.it/dead-end.gif');
    expect(page.items[0]?.mediaUrls).toContain('https://preview.redd.it/dead-end.jpg?x=1&y=2');
  });

  test('decodes comment score and embedded GIF metadata', () => {
    const page = comments({
      kind: 'Listing',
      data: {
        after: null,
        children: [{
          kind: 't1',
          data: {
            id: 'comment1',
            name: 't1_comment1',
            subreddit: 'catgirlcoin',
            link_id: 't3_parent',
            author: 'member',
            body: '![gif](giphy|deadend)',
            permalink: '/r/catgirlcoin/comments/parent/post/comment1/',
            created_utc: 124,
            distinguished: null,
            stickied: false,
            removed_by_category: null,
            score: 4,
            media_metadata: {
              gif1: {
                e: 'AnimatedImage',
                s: {
                  gif: 'https://preview.redd.it/dead-end.gif?width=320&amp;format=mp4',
                  u: 'https://preview.redd.it/dead-end.png?width=320&amp;format=png',
                },
              },
            },
          },
        }],
      },
    });
    expect(page.items[0]?.score).toBe(4);
    expect(page.items[0]?.mediaUrls).toContain('https://preview.redd.it/dead-end.gif?width=320&format=mp4');
    expect(page.items[0]?.mediaUrls).toContain('https://preview.redd.it/dead-end.png?width=320&format=png');
  });
});
