import { describe, expect, test } from 'bun:test';
import { cannedMatches, parseLegacyPairs } from '../src/community/canned.ts';
import { canChooseAnswer, command } from '../src/community/commands.ts';
import { correctedSyllables, detectLegacyHaiku } from '../src/community/haiku.ts';
import { legacyCommentSignals, legacyPostSignals } from '../src/community/legacyPolicy.ts';
import {
  countVectorCosine,
  firstLegacySimilarQuestion,
  legacyQuestionTitleValid,
  normaliseLegacyQuestion,
} from '../src/community/questions.ts';
import { cleanLegacyText } from '../src/community/text.ts';
import { bumpLeaderboard, numberEmoji, publicMaeReplyDue } from '../src/community/titm.ts';

describe('legacy text and canned replies', () => {
  test('normalises text like the Python oracle', () => {
    expect(cleanLegacyText("Mae's NFT?!")).toBe('maes nft');
  });

  test('uses the first two CSV columns and substring matching', () => {
    const pairs = parseLegacyPairs('hello,nya~\nthis is the mae,Mae!\n');
    expect(cannedMatches('Well, HELLO!!!', pairs).map(pair => pair.reply)).toEqual(['nya~']);
  });
});

describe('this is the Mae community feature', () => {
  test('renders the counter as legacy digit emoji', () => {
    expect(numberEmoji(1203)).toBe('1️⃣2️⃣0️⃣3️⃣');
  });

  test('repairs the legacy leaderboard increment bug intentionally', () => {
    const rows = bumpLeaderboard([{ user: 'alice', score: 2, at: 10 }], 'alice', 20);
    expect(rows).toEqual([{ user: 'alice', score: 3, at: 20 }]);
  });

  test('preserves the 12 hour public reply cooldown', () => {
    expect(publicMaeReplyDue(100, 100 + 43_201)).toBe(true);
    expect(publicMaeReplyDue(100, 100 + 43_200)).toBe(false);
  });
});

describe('commands', () => {
  test('legacy command parsing is case-sensitive and prefix based', () => {
    expect(command('!remove please')).toBe('remove');
    expect(command('!thankyou!!')).toBe('thankyou');
    expect(command(' !remove')).toBeNull();
    expect(command('!THANKYOU')).toBeNull();
  });

  test('target authority uses current moderator data rather than the old static tuple', () => {
    const mods = new Set(['current_mod']);
    expect(canChooseAnswer('op', 'op', mods)).toBe(true);
    expect(canChooseAnswer('current_mod', 'op', mods)).toBe(true);
    expect(canChooseAnswer('old_static_mod', 'op', mods)).toBe(false);
  });
});

describe('question workflow', () => {
  test('freezes the old question-title gate for parity fixtures', () => {
    expect(legacyQuestionTitleValid('How do I buy NYA?')).toBe(true);
    expect(legacyQuestionTitleValid('Buying NYA')).toBe(false);
  });

  test('normalises legacy question text and computes count-vector cosine', () => {
    expect(normaliseLegacyQuestion('How do I buy Catgirl NYA safely?')).toBe('buy nya safely');
    expect(countVectorCosine('buy nya safely', 'buy nya safely')).toBeCloseTo(1);
  });

  test('uses the observed strict greater-than 0.49 duplicate threshold', () => {
    const candidate = { submissionId: 'abc', normalisedTitle: 'buy nya safely' };
    expect(firstLegacySimilarQuestion('How can I buy NYA safely?', [candidate])?.submissionId).toBe('abc');
  });
});

describe('legacy moderation signals', () => {
  test('keeps blacklist matching case-sensitive as an oracle signal', () => {
    expect(legacyCommentSignals({ body: 'visit youtube.com', flairCss: 'h', flairText: 'Catgirl', userInWarnedStore: false, userInBannedStore: false }).blacklisted).toBe(true);
    expect(legacyCommentSignals({ body: 'visit YOUTUBE.COM', flairCss: 'h', flairText: 'Catgirl', userInWarnedStore: false, userInBannedStore: false }).blacklisted).toBe(false);
  });

  test('freezes old post karma thresholds without making them the new policy', () => {
    const signals = legacyPostSignals({ flairCss: 'w', flairText: 'Warned', linkKarma: 5 });
    expect(signals.warnedBelowMinimumKarma).toBe(true);
    expect(signals.belowMinimumKarma).toBe(false);
  });
});

describe('haiku parity primitives', () => {
  test('applies the hand-authored legacy syllable corrections', () => {
    const bogus = (): number => 99;
    expect(correctedSyllables('NFT', bogus)).toBe(3);
    expect(correctedSyllables('meme', bogus)).toBe(1);
  });

  test('constructs exact 5/7/5 boundaries from an injected estimator', () => {
    const estimate = (): number => 1;
    const words = Array.from({ length: 17 }, (_, index) => `word${index + 1}`).join(' ');
    expect(detectLegacyHaiku(words, estimate)?.lines.map(line => line.split(' ').length)).toEqual([5, 7, 5]);
  });
});
