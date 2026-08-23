import { expect, test } from 'bun:test';
import { directMessages } from '../src/dm/decode.ts';
import type { Json } from '../src/types/json.ts';

const listing: Json = {
  kind: 'Listing',
  data: {
    after: 't4_next',
    children: [
      {
        kind: 't4',
        data: {
          id: 'abc',
          name: 't4_abc',
          author: 'SomeUser',
          dest: 'this_is_the_mae',
          subject: 'Hello',
          body: 'Hi Mae',
          created_utc: 123,
          parent_id: null,
          first_message_name: 't4_root',
          new: true,
          was_comment: false,
        },
      },
      {
        kind: 't1',
        data: { id: 'ignored' },
      },
    ],
  },
};

test('Reddit DM decoder reads t4 messages and ignores non-message listing children', () => {
  expect(directMessages(listing)).toEqual({
    after: 't4_next',
    messages: [{
      id: 'abc',
      fullname: 't4_abc',
      author: 'SomeUser',
      destination: 'this_is_the_mae',
      subject: 'Hello',
      body: 'Hi Mae',
      createdUtc: 123,
      parentFullname: null,
      firstMessageFullname: 't4_root',
      isNew: true,
      wasComment: false,
    }],
  });
});

test('Reddit DM decoder normalises deleted users and absent optional fields', () => {
  const raw: Json = {
    data: {
      after: null,
      children: [{
        kind: 't4',
        data: {
          id: 'deleted',
          author: '[deleted]',
          dest: '[deleted]',
          created_utc: 7,
          new: false,
          was_comment: false,
        },
      }],
    },
  };
  const item = directMessages(raw).messages[0];
  expect(item?.fullname).toBe('t4_deleted');
  expect(item?.author).toBeNull();
  expect(item?.destination).toBeNull();
  expect(item?.subject).toBe('');
  expect(item?.body).toBe('');
});
