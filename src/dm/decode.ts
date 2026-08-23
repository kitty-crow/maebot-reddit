import type { Json } from '../types/json.ts';
import { arrVal, boolVal, mapVal, numVal, optStr, strVal } from '../types/value.ts';
import type { RedditDirectMessage, RedditDirectMessagePage } from './types.ts';

const nullableName = (value: Json | undefined): string | null =>
  typeof value === 'string' && value.length > 0 && value !== '[deleted]' ? value : null;

export const directMessages = (raw: Json, name = 'private messages'): RedditDirectMessagePage => {
  const root = mapVal(raw, name);
  const data = mapVal(root['data'], `${name}.data`);
  const children = arrVal(data['children'], `${name}.data.children`);
  const messages: RedditDirectMessage[] = [];

  children.forEach((child, index) => {
    const wrapper = mapVal(child, `${name}.children[${index}]`);
    if (optStr(wrapper['kind']) !== 't4') return;
    const row = mapVal(wrapper['data'], `${name}.children[${index}].data`);
    const id = strVal(row['id'], `${name}.children[${index}].id`);
    messages.push({
      id,
      fullname: optStr(row['name']) ?? `t4_${id}`,
      author: nullableName(row['author']),
      destination: nullableName(row['dest']),
      subject: optStr(row['subject']) ?? '',
      body: optStr(row['body']) ?? '',
      createdUtc: numVal(row['created_utc'], `${name}.children[${index}].created_utc`),
      parentFullname: optStr(row['parent_id']),
      firstMessageFullname: optStr(row['first_message_name']),
      isNew: boolVal(row['new'] ?? false, `${name}.children[${index}].new`),
      wasComment: boolVal(row['was_comment'] ?? false, `${name}.children[${index}].was_comment`),
    });
  });

  return { messages, after: optStr(data['after']) };
};
