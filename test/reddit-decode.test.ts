import { describe, expect, test } from 'bun:test';
import { flairAssignments, flairTemplates, moderators, rules } from '../src/reddit/decode.ts';

describe('Reddit API decoders', () => {
  test('decodes moderator listings', () => {
    const page = moderators({
      kind: 'UserList',
      data: {
        after: null,
        children: [{ kind: 't2', data: { name: 'mod', id: 'abc', mod_permissions: ['all'] } }],
      },
    });
    expect(page.items).toEqual([{ name: 'mod', id: 'abc', permissions: ['all'] }]);
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
});
