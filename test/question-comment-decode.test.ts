import { expect, test } from 'bun:test';
import { comments } from '../src/reddit/decode.ts';

test('decodes Reddit comment parent and submission context for question commands', () => {
  const page = comments({
    kind: 'Listing',
    data: {
      after: null,
      children: [{
        kind: 't1',
        data: {
          id: 'thanks1',
          name: 't1_thanks1',
          subreddit: 'catgirlcoin',
          link_id: 't3_question1',
          parent_id: 't1_answer1',
          link_title: 'How does NYA work?',
          link_author: 'Alice',
          link_permalink: '/r/catgirlcoin/comments/question1/how_does_nya_work/',
          link_flair_text: 'Question :hana:',
          author: 'Alice',
          body: '!thankyou',
          permalink: '/r/catgirlcoin/comments/question1/how_does_nya_work/thanks1/',
          created_utc: 123,
          distinguished: null,
          stickied: false,
          removed_by_category: null,
          score: 1,
        },
      }],
    },
  });

  expect(page.items[0]).toMatchObject({
    submissionFullname: 't3_question1',
    parentFullname: 't1_answer1',
    submissionTitle: 'How does NYA work?',
    submissionAuthor: 'Alice',
    submissionPermalink: '/r/catgirlcoin/comments/question1/how_does_nya_work/',
    submissionFlairText: 'Question :hana:',
  });
});
