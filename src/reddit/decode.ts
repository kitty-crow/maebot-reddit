import type { Json, JsonMap } from '../types/json.ts';
import { arrVal, boolVal, mapVal, numVal, optBool, optNum, optStr, strVal } from '../types/value.ts';
import type {
  RedditAccount,
  RedditComment,
  RedditFlairAssignment,
  RedditFlairTemplate,
  RedditModerator,
  RedditPost,
  RedditRule,
  RedditSubreddit,
} from './types.ts';

export type RedditListing<T> = {
  readonly items: readonly T[];
  readonly after: string | null;
};

const nullableName = (v: Json | undefined): string | null => typeof v === 'string' && v !== '[deleted]' ? v : null;

const rows = (raw: Json, name: string): { readonly data: JsonMap; readonly after: string | null }[] => {
  const root = mapVal(raw, name);
  const data = mapVal(root['data'], `${name}.data`);
  const after = optStr(data['after']);
  return arrVal(data['children'], `${name}.data.children`).map((child, index) => {
    const item = mapVal(child, `${name}.children[${index}]`);
    return { data: mapVal(item['data'], `${name}.children[${index}].data`), after };
  });
};

const listing = <T>(raw: Json, name: string, decode: (row: JsonMap, index: number) => T): RedditListing<T> => {
  const root = mapVal(raw, name);
  const data = mapVal(root['data'], `${name}.data`);
  const children = arrVal(data['children'], `${name}.data.children`);
  return {
    items: children.map((child, index) => {
      const wrapper = mapVal(child, `${name}.children[${index}]`);
      return decode(mapVal(wrapper['data'], `${name}.children[${index}].data`), index);
    }),
    after: optStr(data['after']),
  };
};

export const account = (raw: Json): RedditAccount => {
  const row = mapVal(raw, 'account');
  return {
    id: strVal(row['id'], 'account.id'),
    name: strVal(row['name'], 'account.name'),
    createdUtc: optNum(row['created_utc']),
    linkKarma: optNum(row['link_karma']),
    commentKarma: optNum(row['comment_karma']),
  };
};

export const moderators = (raw: Json): RedditListing<RedditModerator> => listing(raw, 'moderators', row => ({
  name: strVal(row['name'], 'moderator.name'),
  id: optStr(row['id']),
  permissions: Array.isArray(row['mod_permissions'])
    ? row['mod_permissions'].filter((v): v is string => typeof v === 'string')
    : [],
}));

const flairTemplate = (row: JsonMap, index: number): RedditFlairTemplate => ({
  id: strVal(row['id'], `flair[${index}].id`),
  text: strVal(row['text'], `flair[${index}].text`),
  cssClass: optStr(row['css_class']),
  textColour: optStr(row['text_color']),
  backgroundColour: optStr(row['background_color']),
  modOnly: optBool(row['mod_only']) ?? false,
  textEditable: optBool(row['text_editable']) ?? false,
  allowableContent: optStr(row['allowable_content']),
  maxEmojis: optNum(row['max_emojis']),
});

export const flairTemplates = (raw: Json): readonly RedditFlairTemplate[] =>
  arrVal(raw, 'flair templates').map((value, index) => flairTemplate(mapVal(value, `flair[${index}]`), index));

export type FlairAssignmentPage = {
  readonly assignments: readonly RedditFlairAssignment[];
  readonly next: string | null;
};

export const flairAssignments = (raw: Json): FlairAssignmentPage => {
  const root = mapVal(raw, 'flair assignments');
  const values = Array.isArray(root['users'])
    ? root['users']
    : (() => {
      const data = root['data'];
      if (data === undefined) return [];
      const map = mapVal(data, 'flair assignments.data');
      return arrVal(map['children'], 'flair assignments.data.children').map((child, index) => {
        const wrapper = mapVal(child, `flair assignments.children[${index}]`);
        return wrapper['data'] ?? null;
      });
    })();

  const assignments = values.map((value, index): RedditFlairAssignment => {
    const row = mapVal(value, `flair assignments[${index}]`);
    const user = row['user'];
    const username = typeof user === 'string'
      ? user
      : strVal(mapVal(user, `flair assignments[${index}].user`)['name'], `flair assignments[${index}].user.name`);
    return {
      username,
      templateId: optStr(row['flair_template_id']),
      text: optStr(row['flair_text']),
      cssClass: optStr(row['flair_css_class']),
    };
  });

  const data = root['data'];
  const after = data !== undefined && !Array.isArray(data) && typeof data === 'object' && data !== null
    ? optStr((data as JsonMap)['after'])
    : null;
  return { assignments, next: optStr(root['next']) ?? after };
};

export type RulesPayload = {
  readonly rules: readonly RedditRule[];
  readonly siteRules: readonly string[];
};

export const rules = (raw: Json): RulesPayload => {
  const root = mapVal(raw, 'rules');
  const source = Array.isArray(root['rules']) ? root['rules'] : [];
  return {
    rules: source.map((value, index): RedditRule => {
      const row = mapVal(value, `rules[${index}]`);
      return {
        shortName: strVal(row['short_name'], `rules[${index}].short_name`),
        description: strVal(row['description'], `rules[${index}].description`),
        violationReason: optStr(row['violation_reason']),
        kind: optStr(row['kind']),
        priority: optNum(row['priority']),
      };
    }),
    siteRules: Array.isArray(root['site_rules'])
      ? root['site_rules'].filter((value): value is string => typeof value === 'string')
      : [],
  };
};

export const subreddit = (raw: Json): RedditSubreddit => {
  const root = mapVal(raw, 'subreddit');
  const data = mapVal(root['data'], 'subreddit.data');
  return {
    id: strVal(data['id'], 'subreddit.id'),
    name: strVal(data['display_name'], 'subreddit.display_name'),
    title: strVal(data['title'], 'subreddit.title'),
    subscribers: optNum(data['subscribers']),
    userIsModerator: optBool(data['user_is_moderator']) ?? false,
    userFlairEnabled: optBool(data['user_flair_enabled_in_sr']),
    userFlairSelfAssign: optBool(data['user_flair_self_assign_enabled']),
    linkFlairEnabled: optBool(data['link_flair_enabled']),
    over18: optBool(data['over18']),
    submissionType: optStr(data['submission_type']),
  };
};

const post = (row: JsonMap): RedditPost => {
  const id = strVal(row['id'], 'post.id');
  return {
    id,
    fullname: optStr(row['name']) ?? `t3_${id}`,
    subreddit: strVal(row['subreddit'], 'post.subreddit'),
    title: strVal(row['title'], 'post.title'),
    author: nullableName(row['author']),
    permalink: strVal(row['permalink'], 'post.permalink'),
    createdUtc: numVal(row['created_utc'], 'post.created_utc'),
    selfText: optStr(row['selftext']) ?? '',
    url: optStr(row['url']) ?? '',
    flairTemplateId: optStr(row['link_flair_template_id']),
    flairText: optStr(row['link_flair_text']),
    stickied: boolVal(row['stickied'] ?? false, 'post.stickied'),
    locked: boolVal(row['locked'] ?? false, 'post.locked'),
    over18: boolVal(row['over_18'] ?? false, 'post.over_18'),
    crosspostParent: optStr(row['crosspost_parent']),
  };
};

export const posts = (raw: Json, name = 'posts'): RedditListing<RedditPost> => listing(raw, name, row => post(row));

export const sticky = (raw: Json): RedditPost | null => {
  const values = rows(raw, 'sticky');
  const first = values[0];
  return first === undefined ? null : post(first.data);
};

const comment = (row: JsonMap): RedditComment => {
  const id = strVal(row['id'], 'comment.id');
  return {
    id,
    fullname: optStr(row['name']) ?? `t1_${id}`,
    subreddit: strVal(row['subreddit'], 'comment.subreddit'),
    submissionFullname: strVal(row['link_id'], 'comment.link_id'),
    author: nullableName(row['author']),
    body: strVal(row['body'], 'comment.body'),
    permalink: strVal(row['permalink'], 'comment.permalink'),
    createdUtc: numVal(row['created_utc'], 'comment.created_utc'),
    distinguished: optStr(row['distinguished']),
    stickied: optBool(row['stickied']) ?? false,
    removedByCategory: optStr(row['removed_by_category']),
  };
};

export const comments = (raw: Json): RedditListing<RedditComment> => listing(raw, 'comments', row => comment(row));
