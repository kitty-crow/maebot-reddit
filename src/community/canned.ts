import { cleanLegacyText } from './text.ts';

export type CannedPair = {
  readonly phrase: string;
  readonly reply: string;
};

export const parseLegacyPairs = (raw: string): readonly CannedPair[] => raw
  .split(/\r?\n/u)
  .filter(line => line.length > 0)
  .map(line => {
    const columns = line.split(',');
    return {
      phrase: columns[0] ?? '',
      reply: columns[1] ?? '',
    };
  })
  .filter(pair => pair.phrase.length > 0);

export const cannedMatches = (text: string, pairs: readonly CannedPair[]): readonly CannedPair[] => {
  const cleaned = cleanLegacyText(text);
  return pairs.filter(pair => cleaned.includes(cleanLegacyText(pair.phrase)));
};
