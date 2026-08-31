import { describe, expect, test } from 'bun:test';
import { parseMemberAuditLog } from '../src/modnotes/auditResults.ts';
import { reconcileReputationAudit } from '../src/reputation/auditReconcile.ts';
import { isMap, type JsonMap } from '../src/types/json.ts';

const resultBlock = (
  index: number,
  total: number,
  username: string,
  beforePoints: number,
  afterPoints: number,
  beforeStatus: string,
  afterStatus: string,
): string => `
USER RESULT ${index}/${total}: u/${username}
Notes: Constructive participant.
Score: ${beforePoints} -> ${afterPoints}
Status: ${beforeStatus} -> ${afterStatus}
Tag: Helpful (HELPFUL_USER)
Mod Note: Mae score: ${afterPoints}. Constructive participant.
------------------------------------------------------------------------------------------`;

describe('member Mod Notes completed-audit recovery', () => {
  test('distinguishes attempted users from users with final results', () => {
    const raw = `
Members: 2
[progress] CURRENT USER 1/2: u/Alpha
${resultBlock(1, 2, 'Alpha', 0, 1, 'warned', 'ordinary')}
[progress] CURRENT USER 2/2: u/Beta
[Member Mod Notes] 2/2 u/Beta failed: network: temporary failure
members=2 generated=1 reused=0 scored=0 posted=0 failed=1
`;
    const parsed = parseMemberAuditLog(raw);
    expect(parsed.declaredMembers).toBe(2);
    expect(parsed.attemptedUsers).toEqual(['Alpha', 'Beta']);
    expect(parsed.results.map(result => result.username)).toEqual(['Alpha']);
    expect(parsed.duplicateUsers).toEqual([]);
  });
});

describe('member Mod Notes reputation audit reconciliation', () => {
  test('updates score-derived state without replaying historical contributions', () => {
    const state: JsonMap = {
      schema: 1,
      flairCatalog: {
        user: [
          { id: 'warned-id', text: 'Warned' },
          { id: 'uncivil-id', text: 'Uncivil' },
          { id: 'scam-id', text: 'SCAM' },
        ],
        post: [],
      },
      flairReferences: {
        user: {
          mae: 'mae-id',
          lisa: 'lisa-id',
          kita: 'kita-id',
          aoi: 'aoi-id',
          hana: 'hana-id',
          rin: 'rin-id',
          celeste: 'celeste-id',
          pawsomeContributor: 'pawsome-id',
          warned: 'warned-id',
          uncivil: 'uncivil-id',
          scam: 'scam-id',
        },
        post: {},
      },
      users: {
        member: {
          username: 'Member',
          points: -2,
          tier: 0,
          status: 'warned',
          currentFlairTemplateId: null,
          currentFlairText: null,
          desiredFlairTemplateId: null,
          desiredFlairText: null,
          immutableModeratorFlair: false,
          needsFlair: false,
          needsReview: false,
          source: 'live-contribution',
          seededAt: 1,
        },
      },
      contributions: {
        t1_existing: { fullname: 't1_existing' },
      },
      reputationJournal: {},
      discipline: {},
      notices: {},
      coverage: {},
    };

    const next = reconcileReputationAudit(state, [{
      username: 'Member',
      beforePoints: -2,
      afterPoints: 5,
      beforeStatus: 'warned',
      afterStatus: 'ordinary',
    }], 'audit123', 100);

    if (!isMap(next)) throw new Error('Expected reconciled reputation root');
    const users = next['users'];
    if (!isMap(users)) throw new Error('Expected reconciled users map');
    const member = users['member'];
    if (!isMap(member)) throw new Error('Expected reconciled member');
    expect(member['points']).toBe(5);
    expect(member['tier']).toBe(1);
    expect(member['status']).toBe('ordinary');
    expect(member['needsReview']).toBe(false);

    const contributions = next['contributions'];
    if (!isMap(contributions)) throw new Error('Expected contribution map');
    expect(Object.keys(contributions)).toEqual(['t1_existing']);

    const journal = next['reputationJournal'];
    if (!isMap(journal)) throw new Error('Expected reputation journal');
    expect(isMap(journal['member-mod-notes-audit:audit123:member'])).toBe(true);
  });
});
