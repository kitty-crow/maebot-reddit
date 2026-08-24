import { describe, expect, test } from 'bun:test';
import {
  isMisspelledPawsomeFlair,
  repairReputationTracking,
  reputationUsersRequiringReview,
} from '../src/reputation/trackingRepair.ts';
import {
  MODERATOR_POINTS,
  PAWSOME_FLAIR_TEXT,
  PAWSOME_POINTS,
} from '../src/reputation/policy.ts';
import type { JsonMap } from '../src/types/json.ts';

const user = (
  username: string,
  overrides: JsonMap = {},
): JsonMap => ({
  username,
  points: 0,
  tier: 0,
  status: 'unmapped',
  currentFlairTemplateId: null,
  currentFlairText: null,
  currentFlairCssClass: null,
  desiredFlairTemplateId: null,
  desiredFlairText: null,
  immutableModeratorFlair: false,
  needsFlair: false,
  needsReview: true,
  source: 'unmapped-flair',
  seededAt: 123,
  ...overrides,
});

const store = (...users: JsonMap[]): JsonMap => ({
  schema: 1,
  subreddit: 'catgirlcoin',
  bootstrappedAt: 123,
  users: Object.fromEntries(users.map(value => [String(value['username']).toLowerCase(), value])),
});

describe('canonical reputation tracking repair', () => {
  test('detects the Pawesome spelling mistake from text and ignores the emoji suffix', () => {
    expect(isMisspelledPawsomeFlair('Pawesome contributor :catgirl-moon:')).toBe(true);
    expect(isMisspelledPawsomeFlair('Pawesome contributor :lisa:')).toBe(true);
    expect(isMisspelledPawsomeFlair('Pawsome contributor :catgirl-moon:')).toBe(false);
    expect(isMisspelledPawsomeFlair('Pawsome contributor :lisa:')).toBe(false);
  });

  test('repairs typo holders to canonical Pawsome and live CatgirlCoin moderators to tier nine', () => {
    const typo = user('TypoUser', {
      currentFlairText: 'Pawesome contributor :catgirl-moon:',
      currentFlairCssClass: 'h',
      desiredFlairText: 'Pawesome contributor :catgirl-moon:',
    });
    const moderator = user('RealModerator', {
      currentFlairText: 'Telegram Mod :catgirl-pizza:',
      currentFlairCssClass: 'm',
      desiredFlairText: 'Telegram Mod :catgirl-pizza:',
    });
    const lisaException = user('T_M_T_T_M_F', {
      points: PAWSOME_POINTS,
      tier: 5,
      status: 'ordinary',
      currentFlairTemplateId: 'custom-lisa',
      currentFlairText: 'Pawsome contributor :lisa:',
      currentFlairCssClass: 'h',
      desiredFlairTemplateId: 'custom-lisa',
      desiredFlairText: 'Pawsome contributor :lisa:',
      needsReview: false,
      source: 'tier-flair',
    });

    const result = repairReputationTracking(store(typo, moderator, lisaException), {
      at: 456,
      moderators: [{
        username: 'RealModerator',
        templateId: null,
        text: 'Telegram Mod :catgirl-pizza:',
        cssClass: 'm',
      }],
      pawsome: {
        templateId: 'canonical-pawsome',
        text: PAWSOME_FLAIR_TEXT,
        cssClass: 'h',
        usernames: ['TypoUser'],
      },
    });

    const users = result.value['users'];
    if (users === null || Array.isArray(users) || typeof users !== 'object') throw new Error('users missing');

    const repairedTypo = users['typouser'];
    if (repairedTypo === null || Array.isArray(repairedTypo) || typeof repairedTypo !== 'object') throw new Error('TypoUser missing');
    expect(repairedTypo['points']).toBe(PAWSOME_POINTS);
    expect(repairedTypo['tier']).toBe(5);
    expect(repairedTypo['status']).toBe('ordinary');
    expect(repairedTypo['currentFlairTemplateId']).toBe('canonical-pawsome');
    expect(repairedTypo['currentFlairText']).toBe(PAWSOME_FLAIR_TEXT);
    expect(repairedTypo['needsReview']).toBe(false);

    const repairedModerator = users['realmoderator'];
    if (repairedModerator === null || Array.isArray(repairedModerator) || typeof repairedModerator !== 'object') throw new Error('RealModerator missing');
    expect(repairedModerator['points']).toBe(MODERATOR_POINTS);
    expect(repairedModerator['tier']).toBe(9);
    expect(repairedModerator['status']).toBe('moderator');
    expect(repairedModerator['immutableModeratorFlair']).toBe(true);
    expect(repairedModerator['currentFlairText']).toBe('Telegram Mod :catgirl-pizza:');

    const preserved = users['t_m_t_t_m_f'];
    if (preserved === null || Array.isArray(preserved) || typeof preserved !== 'object') throw new Error('T_M_T_T_M_F missing');
    expect(preserved['points']).toBe(PAWSOME_POINTS);
    expect(preserved['currentFlairText']).toBe('Pawsome contributor :lisa:');
    expect(preserved['currentFlairTemplateId']).toBe('custom-lisa');

    expect(result.pawsomeRepaired).toBe(1);
    expect(result.moderatorsRepaired).toBe(1);
    expect(reputationUsersRequiringReview(result.value)).toEqual([]);
  });

  test('refuses to reseed an already resolved member as Pawsome', () => {
    const resolved = user('ResolvedUser', {
      points: 10,
      tier: 2,
      status: 'ordinary',
      currentFlairText: 'Pawesome contributor :catgirl-moon:',
      needsReview: false,
      source: 'live-contribution',
    });

    expect(() => repairReputationTracking(store(resolved), {
      at: 456,
      moderators: [],
      pawsome: {
        templateId: 'canonical-pawsome',
        text: PAWSOME_FLAIR_TEXT,
        cssClass: 'h',
        usernames: ['ResolvedUser'],
      },
    })).toThrow('Refusing to reseed resolved reputation state');
  });
});
