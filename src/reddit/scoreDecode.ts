import type { Json } from '../types/json.ts';
import { arrVal, mapVal, optNum, optStr, strVal } from '../types/value.ts';
import type { RedditThingScore } from './types.ts';

export const thingScores = (raw: Json): readonly RedditThingScore[] => {
  const root = mapVal(raw, 'score inventory');
  const data = mapVal(root['data'], 'score inventory.data');
  return arrVal(data['children'], 'score inventory.data.children').map((child, index): RedditThingScore => {
    const wrapper = mapVal(child, `score inventory.children[${index}]`);
    const row = mapVal(wrapper['data'], `score inventory.children[${index}].data`);
    const kind = optStr(wrapper['kind']);
    const id = strVal(row['id'], `score inventory.children[${index}].id`);
    const fullname = optStr(row['name']) ?? (kind === 't1' || kind === 't3' ? `${kind}_${id}` : '');
    if (!/^(?:t1|t3)_[A-Za-z0-9]+$/u.test(fullname)) {
      throw new Error(`score inventory.children[${index}] did not contain a post/comment fullname`);
    }
    return {
      fullname,
      score: Math.floor(optNum(row['score']) ?? 0),
    };
  });
};
