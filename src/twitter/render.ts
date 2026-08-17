import type { Tweet } from '../../vendor/maebot-twitter/src/index.ts';

export type RedditTweetRender = {
  readonly title: string;
  readonly body: string;
};

const compact = (value: string): string => value.replace(/\s+/gu, ' ').trim();

const clip = (value: string, max: number): string => {
  const chars = [...value];
  if (chars.length <= max) return value;
  return `${chars.slice(0, Math.max(1, max - 1)).join('').trimEnd()}…`;
};

const percentage = (value: number): string => {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(Math.trunc(rounded)) : rounded.toFixed(1);
};

const mediaLines = (tweet: Tweet): readonly string[] => [
  ...tweet.photos.map((url, index) => `- Photo ${index + 1}: ${url}`),
  ...tweet.videos.map((url, index) => `- Video ${index + 1}: ${url}`),
];

export const redditTweetTitle = (tweet: Tweet, maxChars = 280): string => {
  const text = compact(tweet.text);
  const fallback = `Update from @${tweet.author.handle}`;
  return clip(text.length === 0 ? fallback : text, Math.max(20, maxChars));
};

export const renderTweetForReddit = (tweet: Tweet): RedditTweetRender => {
  const sections: string[] = [];
  const text = tweet.text.trim();
  if (text.length > 0) sections.push(text);

  const media = mediaLines(tweet);
  if (media.length > 0) sections.push(`**Media**\n${media.join('\n')}`);

  if (tweet.quote !== null) {
    const quotedText = tweet.quote.text.trim();
    const quoted = [
      `**Quoted tweet by @${tweet.quote.author.handle}**`,
      ...(quotedText.length === 0 ? [] : [quotedText]),
      `Quoted tweet: ${tweet.quote.url}`,
    ];
    sections.push(quoted.join('\n'));
  }

  if (tweet.poll !== null) {
    const choices = tweet.poll.choices.map(choice =>
      `- ${choice.label}: ${choice.count} vote${choice.count === 1 ? '' : 's'} (${percentage(choice.percentage)}%)`);
    const total = `${tweet.poll.total} total vote${tweet.poll.total === 1 ? '' : 's'}`;
    const ending = tweet.poll.endsAt.length === 0 ? [] : [`Ends: ${tweet.poll.endsAt}`];
    sections.push(`**Poll**\n${choices.join('\n')}\n${total}${ending.length === 0 ? '' : `\n${ending.join('\n')}`}`);
  }

  sections.push(`Original tweet: ${tweet.url}`);
  return {
    title: redditTweetTitle(tweet),
    body: sections.join('\n\n'),
  };
};

export const renderLegacyFallback = (tweet: Tweet, primaryRedditUrl: string): RedditTweetRender => {
  const rendered = renderTweetForReddit(tweet);
  return {
    title: rendered.title,
    body: `${rendered.body}\n\nPrimary Reddit post: ${primaryRedditUrl}`,
  };
};
