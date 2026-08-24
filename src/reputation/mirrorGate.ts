import type { PostMirrorSourceDecision, PostMirrorSourceGate } from '../mirror/service.ts';
import { isMap, type JsonMap } from '../types/json.ts';
import type { ReputationStore } from './store.ts';

const decisionFor = (contributions: JsonMap, fullname: string): PostMirrorSourceDecision => {
  const raw = contributions[fullname];
  if (!isMap(raw)) return 'pending';
  if (raw['kind'] !== 'post') return 'deny';
  if (raw['exempt'] === true) return 'allow';
  return raw['removeRequired'] === true ? 'deny' : 'allow';
};

export class ReputationPostMirrorGate implements PostMirrorSourceGate {
  public constructor(private readonly reputation: ReputationStore) {}

  public async decisions(
    fullnames: readonly string[],
  ): Promise<ReadonlyMap<string, PostMirrorSourceDecision>> {
    const raw = await this.reputation.raw();
    if (!isMap(raw)) throw new Error('Reputation mirror gate root must be an object');
    const contributions = raw['contributions'];
    if (!isMap(contributions)) throw new Error('Reputation contribution map is missing');

    const out = new Map<string, PostMirrorSourceDecision>();
    for (const fullname of new Set(fullnames)) {
      out.set(fullname, decisionFor(contributions, fullname));
    }
    return out;
  }
}
