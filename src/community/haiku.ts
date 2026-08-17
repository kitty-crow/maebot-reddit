export const zeroSyllable = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '&']);
export const oneSyllable = new Set([
  'are', 'write', 'meme', 'bored', 'turned', 'those', 'there', 'else', 'use', 'here', 'since', 'one', 'store', 'fixed', 'broke', 'where', 'files', 'please',
]);
export const twoSyllable = new Set(['surprised', 'mistakes', 'someone', 'ignored', 'something', 'feature', 'mistake', 'celeste']);
export const threeSyllable = new Set(['nft', 'somebody', 'database', 'bnb', 'cgc', 'usd', 'btc', 'eth']);

export type SyllableEstimator = (word: string) => number;

export const correctedSyllables = (word: string, estimate: SyllableEstimator): number => {
  const lower = word.toLowerCase();
  if (zeroSyllable.has(lower)) return 0;
  if (oneSyllable.has(lower)) return 1;
  if (twoSyllable.has(lower)) return 2;
  if (threeSyllable.has(lower)) return 3;
  return Math.max(0, Math.floor(estimate(word)));
};

export type Haiku = {
  readonly lines: readonly [string, string, string];
};

export const detectLegacyHaiku = (text: string, estimate: SyllableEstimator): Haiku | null => {
  const words = text.replaceAll('\n', ' ').split(' ').filter(word => word.length > 0);
  const counts = words.map(word => correctedSyllables(word, estimate));
  if (counts.reduce((sum, value) => sum + value, 0) !== 17) return null;

  const lines: string[] = [];
  let start = 0;
  for (const target of [5, 7, 5]) {
    let total = 0;
    let end = start;
    while (end < words.length && total < target) {
      total += counts[end] ?? 0;
      end += 1;
    }
    if (total !== target) return null;
    lines.push(words.slice(start, end).join(' '));
    start = end;
  }
  if (start !== words.length || lines.length !== 3) return null;
  return { lines: [lines[0] ?? '', lines[1] ?? '', lines[2] ?? ''] };
};
